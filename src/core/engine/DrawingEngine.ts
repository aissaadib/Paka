/**
 * Drawing engine.
 *
 * The engine is the single owner of editor state that must stay out of React:
 * the document, the stroke store, the viewport, brush configuration, the active
 * tool, history and the renderer. React only reads a low-frequency snapshot
 * through `subscribe`/`getState`, and calls intent methods (zoom, undo, layer
 * operations). Pointer samples go straight from the input binder into the
 * active tool and never touch component state.
 *
 * Boundaries:
 *  - document data      -> `core/document` (pure functions + stroke store)
 *  - input              -> `core/input` (normalization + DOM binding)
 *  - stroke processing  -> `core/brushes` (sampling policy, interpolation)
 *  - pixels             -> `core/rendering` (renderer + surfaces)
 *  - history            -> `core/commands`
 *  - tools              -> `core/tools`
 */

import type { BrushSettings } from "../../types/brush";
import type { CursorReport, PointerSample } from "../../types/pointer";
import type { ToolId } from "../../types/tool";
import type { Viewport } from "../../types/viewport";
import { clamp } from "../../utils/math";
import { createStore, type Listener, type Store } from "../../utils/store";
import { DEFAULT_BRUSH, brushSettingsEqual, normalizeBrush, updateBrushSettings } from "../brushes/defaults";
import { StrokeBuilder, createStrokeRecord } from "../brushes/strokeBuilder";
import { CommandStack, DEFAULT_HISTORY_LIMIT } from "../commands/commandStack";
import {
  createStrokeCommand,
  createStrokeCommandHost,
  type StrokeCommandHost,
} from "../commands/strokeCommand";
import type { CommandStackState } from "../commands/types";
import * as documentOps from "../document/document";
import { StrokeStore } from "../document/strokeStore";
import type { DrawingDocument, LayerId, StrokeRecord } from "../document/types";
import {
  CanvasInputBinder,
  type CanvasInputHandlers,
  type WheelInput,
} from "../input/canvasInputBinder";
import { toStrokeSample } from "../input/pointer";
import { serializeProject, type ParsedProject } from "../project/projectFormat";
import { Canvas2DRenderer } from "../rendering/Canvas2DRenderer";
import type { DrawingRenderer, StrokeSource } from "../rendering/types";
import {
  ZOOM_STEP,
  centerOn,
  docToScreen,
  fitToViewport,
  panBy,
  zoomAt,
  zoomToAt,
} from "../rendering/viewport";
import { createToolRegistry, type ToolRegistry } from "../tools/toolRegistry";
import type { Tool, ToolContext } from "../tools/types";

/** Low-frequency state React is allowed to render from. */
export interface EditorSnapshot {
  readonly document: DrawingDocument;
  readonly viewport: Viewport;
  readonly brush: BrushSettings;
  readonly toolId: ToolId;
  readonly history: CommandStackState;
  readonly file: DocumentFileState;
}

/**
 * Where the document lives on disk and whether it has unsaved changes.
 *
 * `dirty` compares a mutation counter against the counter captured by the last
 * successful save or load. Undoing back to the saved state does not clear it
 * (the document is still not byte-identical to the file), which is the usual
 * behaviour for drawing applications and the safe direction to err in.
 */
export interface DocumentFileState {
  readonly path: string | null;
  readonly dirty: boolean;
}

export interface NewDocumentOptions {
  readonly name?: string;
  readonly width: number;
  readonly height: number;
  readonly background?: string;
}

export interface DrawingEngineOptions {
  readonly document?: DrawingDocument;
  readonly brush?: BrushSettings;
  readonly toolId?: ToolId;
  readonly historyLimit?: number;
  /** Upper bound for the layer surface raster scale. */
  readonly maxRasterScale?: number;
  /**
   * A pre-built renderer. This is the seam that keeps the raster backend
   * replaceable (a WebGL/WebGPU one is a drop-in): when given, `attach()` will
   * not create a Canvas 2D renderer, and the caller owns its configuration.
   */
  readonly renderer?: DrawingRenderer;
}

const DEFAULT_DOCUMENT_WIDTH = 1600;
const DEFAULT_DOCUMENT_HEIGHT = 1200;
/** Wheel delta to zoom factor conversion (natural-exponential). */
const WHEEL_ZOOM_SENSITIVITY = 0.0018;
const WHEEL_ZOOM_FACTOR_LIMIT = 0.25;

export class DrawingEngine implements StrokeSource {
  private doc: DrawingDocument;
  private viewport: Viewport = { zoom: 1, offsetX: 0, offsetY: 0 };
  private brush: BrushSettings;
  private currentToolId: ToolId;
  private readonly tools: ToolRegistry;
  private readonly commands: CommandStack;
  private readonly strokes = new StrokeStore();
  private readonly store: Store<EditorSnapshot>;
  private readonly cursorListeners = new Set<(report: CursorReport) => void>();
  private readonly commandHost: StrokeCommandHost;
  private readonly toolContext: ToolContext;
  private readonly middlePanTool: Tool;
  private readonly maxRasterScale: number;

  private renderer: DrawingRenderer | null = null;
  private binder: CanvasInputBinder | null = null;
  private strokeBuilder: StrokeBuilder | null = null;
  private activeStroke: StrokeRecord | null = null;
  private panGestureActive = false;
  private cursor: CursorReport | null = null;
  private viewportSize = { width: 0, height: 0 };
  private laidOut = false;
  private devicePixelRatio = 1;
  private rasterScale = 1;

  /** Path of the saved project; `null` until the document is saved once. */
  private filePath: string | null = null;
  /** Bumped by every change that would have to be written to the file. */
  private revision = 0;
  /** The revision that was last written to (or loaded from) disk. */
  private savedRevision = 0;
  private fileState: DocumentFileState = { path: null, dirty: false };

  constructor(options: DrawingEngineOptions = {}) {
    this.doc =
      options.document ??
      documentOps.createDocument({
        name: "Untitled",
        width: DEFAULT_DOCUMENT_WIDTH,
        height: DEFAULT_DOCUMENT_HEIGHT,
      });
    this.brush = normalizeBrush(options.brush ?? DEFAULT_BRUSH);
    this.currentToolId = options.toolId ?? "brush";
    this.renderer = options.renderer ?? null;
    this.tools = createToolRegistry();
    this.middlePanTool = this.tools.pan;
    this.commands = new CommandStack({ limit: options.historyLimit ?? DEFAULT_HISTORY_LIMIT });
    this.maxRasterScale = clamp(options.maxRasterScale ?? 2, 1, 4);
    this.commandHost = createStrokeCommandHost(this.strokes, (layerId) => {
      this.renderer?.invalidateLayer(layerId);
    });
    this.store = createStore(this.buildSnapshot());

    const engine = this;
    this.toolContext = {
      get viewport(): Viewport {
        return engine.viewport;
      },
      getBrush: () => engine.brush,
      getActiveLayerId: () => engine.doc.activeLayerId,
      setViewport: (viewport) => engine.setViewport(viewport),
      requestRender: () => engine.requestRender(),
      beginStroke: (sample) => engine.beginStroke(sample),
      extendStroke: (sample) => engine.extendStroke(sample),
      finishStroke: () => engine.finishStroke(),
      cancelStroke: () => engine.cancelStroke(),
      isStrokeActive: () => engine.activeStroke !== null,
    };

    this.commands.subscribe(() => this.publish());
  }

  // ---------------------------------------------------------------- lifecycle

  /** Binds the engine to a canvas element: renderer + DOM input listeners. */
  attach(canvas: HTMLCanvasElement): void {
    if (this.renderer) {
      return;
    }

    this.devicePixelRatio = this.readDevicePixelRatio();
    this.rasterScale = clamp(this.devicePixelRatio, 1, this.maxRasterScale);

    const renderer = new Canvas2DRenderer({
      canvas,
      strokeSource: this,
      rasterScale: this.rasterScale,
    });
    renderer.setDocument(this.doc);
    renderer.setViewport(this.viewport);
    if (this.viewportSize.width > 0) {
      renderer.setDisplaySize(this.viewportSize.width, this.viewportSize.height, this.devicePixelRatio);
    }
    this.renderer = renderer;

    const handlers: CanvasInputHandlers = {
      getViewport: () => this.viewport,
      onPointerSample: (sample) => this.handlePointerSample(sample),
      onWheel: (input) => this.handleWheel(input),
      onPointerPresence: (inside) => this.handlePresence(inside),
    };
    this.binder = new CanvasInputBinder(canvas, handlers);
    this.binder.attach();
    this.requestRender();
  }

  detach(): void {
    this.abortStroke();
    this.binder?.detach();
    this.binder = null;
    this.renderer?.destroy();
    this.renderer = null;
  }

  destroy(): void {
    this.detach();
    this.cursorListeners.clear();
  }

  /**
   * Reports the CSS size of the drawing surface. Called by the workspace on
   * resize and when the window moves between displays with different DPRs.
   */
  setViewportSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      return;
    }
    this.viewportSize = { width, height };

    if (!this.laidOut) {
      this.laidOut = true;
      this.setViewport(this.initialViewport(), false);
    }

    const dpr = this.readDevicePixelRatio();
    const scaleChanged = dpr !== this.devicePixelRatio;
    this.devicePixelRatio = dpr;
    this.rasterScale = clamp(dpr, 1, this.maxRasterScale);

    if (this.renderer) {
      if (scaleChanged) {
        this.renderer.setRasterScale(this.rasterScale);
      }
      this.renderer.setDisplaySize(width, height, dpr);
    }
  }

  // ------------------------------------------------------------------ reading

  getState(): EditorSnapshot {
    return this.store.getState();
  }

  subscribe(listener: Listener): () => void {
    return this.store.subscribe(listener);
  }

  /** High-frequency cursor reports; consumers update the DOM directly. */
  subscribeCursor(listener: (report: CursorReport) => void): () => void {
    this.cursorListeners.add(listener);
    return () => {
      this.cursorListeners.delete(listener);
    };
  }

  getCursor(): string {
    return this.activeTool().cursor;
  }

  listStrokes(layerId: LayerId): readonly StrokeRecord[] {
    return this.strokes.list(layerId);
  }

  // ---------------------------------------------------------- document / view

  newDocument(options: NewDocumentOptions): void {
    this.abortStroke();
    this.doc = documentOps.createDocument(options);
    this.strokes.clear();
    this.commands.clear();
    this.filePath = null;
    this.revision = 0;
    this.savedRevision = 0;
    if (this.laidOut) {
      this.viewport = this.initialViewport();
    }
    this.renderer?.setViewport(this.viewport);
    this.renderer?.setDocument(this.doc);
    this.invalidateLayers(this.doc);
    this.republishCursor();
    this.publish();
    this.requestRender();
  }

  /**
   * Replaces the drawing with a parsed project.
   *
   * Strokes go back into the store in document order and one undoable command is
   * recorded per stroke, so a reopened drawing stays editable - the individual
   * strokes can still be undone and redone - instead of degrading into a flat
   * picture. Layer surfaces are invalidated because a loaded layer id can match
   * an id from the previous document while describing entirely different pixels.
   */
  loadProject(project: ParsedProject, path: string | null): void {
    this.abortStroke();
    this.doc = project.document;
    this.strokes.clear();
    this.commands.clear();

    const nextIndex = new Map<LayerId, number>();
    for (const stroke of project.strokes) {
      const index = nextIndex.get(stroke.layerId) ?? 0;
      this.strokes.insert(stroke);
      this.commands.push(createStrokeCommand(stroke, index, this.commandHost));
      nextIndex.set(stroke.layerId, index + 1);
    }

    this.filePath = path;
    this.revision = 0;
    this.savedRevision = 0;

    if (this.laidOut) {
      this.viewport = this.initialViewport();
    }
    this.renderer?.setViewport(this.viewport);
    this.renderer?.setDocument(this.doc);
    this.invalidateLayers(this.doc);
    this.republishCursor();
    this.publish();
    this.requestRender();
  }

  /** The document and its strokes, as project file text. */
  serialize(): string {
    return serializeProject(this.doc, this);
  }

  /**
   * Composites the visible document into a new canvas at document pixel size.
   * Used by PNG export; the editor state is not modified.
   */
  renderDocumentImage(): HTMLCanvasElement {
    if (!this.renderer) {
      throw new Error("The drawing surface is not attached yet, so there is nothing to export.");
    }
    return this.renderer.composeDocumentImage();
  }

  /**
   * Records that the current revision was written to `path`.
   *
   * The document keeps its own name: a drawing called "Still life" saved as
   * `sketch.paka` is still called "Still life". The file name is what the UI
   * shows once a project has a place on disk, and it is what a later Save As
   * suggests.
   */
  markSaved(path: string): void {
    this.filePath = path;
    this.savedRevision = this.revision;
    this.publish();
  }

  addLayer(): void {
    this.applyDocument(documentOps.addLayer(this.doc));
  }

  removeLayer(layerId: LayerId): void {
    const next = documentOps.removeLayer(this.doc, layerId);
    if (next === this.doc) {
      return;
    }
    this.strokes.clearLayer(layerId);
    this.applyDocument(next);
  }

  renameLayer(layerId: LayerId, name: string): void {
    const trimmed = name.trim();
    if (trimmed === "") {
      return;
    }
    this.applyDocument(documentOps.updateLayer(this.doc, layerId, { name: trimmed }));
  }

  setLayerVisibility(layerId: LayerId, visible: boolean): void {
    this.applyDocument(documentOps.updateLayer(this.doc, layerId, { visible }));
  }

  toggleLayerVisibility(layerId: LayerId): void {
    const layer = this.doc.layers.find((candidate) => candidate.id === layerId);
    if (layer) {
      this.setLayerVisibility(layerId, !layer.visible);
    }
  }

  setLayerOpacity(layerId: LayerId, opacity: number): void {
    this.applyDocument(documentOps.updateLayer(this.doc, layerId, { opacity }));
  }

  moveLayer(layerId: LayerId, delta: number): void {
    this.applyDocument(documentOps.moveLayer(this.doc, layerId, delta));
  }

  selectLayer(layerId: LayerId): void {
    this.applyDocument(documentOps.setActiveLayer(this.doc, layerId));
  }

  setBrush(patch: Partial<BrushSettings>): void {
    const next = updateBrushSettings(this.brush, patch);
    if (brushSettingsEqual(this.brush, next)) {
      return;
    }
    this.brush = next;
    this.publish();
  }

  setTool(toolId: ToolId): void {
    if (this.currentToolId === toolId) {
      return;
    }
    // Let the outgoing tool finish cleanly (a brush stroke is committed).
    this.activeTool().reset(this.toolContext);
    this.currentToolId = toolId;
    this.publish();
  }

  setViewport(viewport: Viewport, republishCursor = true): void {
    this.viewport = viewport;
    this.renderer?.setViewport(viewport);
    if (republishCursor) {
      this.republishCursor();
    }
    this.publish();
    this.requestRender();
  }

  panViewportBy(deltaX: number, deltaY: number): void {
    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    this.setViewport(panBy(this.viewport, deltaX, deltaY));
  }

  zoomIn(): void {
    this.zoomAtCenter(this.viewport.zoom * ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomAtCenter(this.viewport.zoom / ZOOM_STEP);
  }

  zoomTo(zoom: number): void {
    this.zoomAtCenter(zoom);
  }

  zoomToFit(): void {
    if (this.viewportSize.width <= 0 || this.viewportSize.height <= 0) {
      return;
    }
    this.setViewport(fitToViewport(this.viewportSize, this.documentSize()));
  }

  // ------------------------------------------------------------------ history

  undo(): boolean {
    if (this.activeStroke) {
      return false;
    }
    return this.recordHistoryChange(() => this.commands.undo());
  }

  redo(): boolean {
    if (this.activeStroke) {
      return false;
    }
    return this.recordHistoryChange(() => this.commands.redo());
  }

  // ----------------------------------------------------------- stroke capture

  beginStroke(sample: PointerSample): void {
    if (this.activeStroke) {
      return;
    }
    const layerId = this.doc.activeLayerId;
    if (!layerId) {
      return;
    }

    const stroke = createStrokeRecord(layerId, this.brush);
    const builder = new StrokeBuilder(stroke);
    builder.addSample(toStrokeSample(sample));

    this.strokeBuilder = builder;
    this.activeStroke = stroke;

    const renderer = this.renderer;
    if (renderer) {
      renderer.beginStroke(stroke);
      renderer.extendStroke(stroke, 0);
    }
  }

  extendStroke(sample: PointerSample): void {
    const builder = this.strokeBuilder;
    if (!builder) {
      return;
    }
    const fromIndex = builder.addSample(toStrokeSample(sample));
    if (fromIndex < builder.pointCount) {
      this.renderer?.extendStroke(builder.stroke, fromIndex);
    }
  }

  finishStroke(): void {
    const builder = this.strokeBuilder;
    const stroke = this.activeStroke;
    this.strokeBuilder = null;
    this.activeStroke = null;
    if (!builder || !stroke) {
      return;
    }

    this.renderer?.endStroke(stroke);
    const index = this.strokes.count(stroke.layerId);
    this.strokes.insert(stroke);
    // The revision is bumped before the command is recorded, so the single
    // snapshot the command stack publishes already carries the dirty flag.
    this.revision += 1;
    this.commands.push(createStrokeCommand(stroke, index, this.commandHost));
    this.publish();
  }

  cancelStroke(): void {
    if (!this.activeStroke) {
      return;
    }
    this.strokeBuilder = null;
    this.activeStroke = null;
    this.renderer?.cancelStroke();
  }

  requestRender(): void {
    this.renderer?.requestRender();
  }

  // ------------------------------------------------------------------ private

  private activeTool(): Tool {
    return this.tools[this.currentToolId];
  }

  private documentSize() {
    return { width: this.doc.width, height: this.doc.height };
  }

  private initialViewport(): Viewport {
    const fitted = fitToViewport(this.viewportSize, this.documentSize());
    // Never open zoomed in beyond 100%: a small document should look small.
    const zoom = Math.min(1, fitted.zoom);
    return centerOn(this.viewportSize, this.documentSize(), zoom);
  }

  private zoomAtCenter(zoom: number): void {
    const centerX = this.viewportSize.width / 2;
    const centerY = this.viewportSize.height / 2;
    this.setViewport(zoomToAt(this.viewport, centerX, centerY, zoom));
  }

  private applyDocument(next: DrawingDocument): void {
    if (next === this.doc) {
      return;
    }
    this.doc = next;
    this.renderer?.setDocument(next);
    // A layer added now could reuse the id of a layer removed earlier in the
    // session, so surfaces are invalidated rather than trusted.
    this.invalidateLayers(next);
    this.revision += 1;
    this.publish();
    this.requestRender();
  }

  /** Forces every layer of `document` to be re-rasterized from its strokes. */
  private invalidateLayers(document: DrawingDocument): void {
    if (!this.renderer) {
      return;
    }
    for (const layer of document.layers) {
      this.renderer.invalidateLayer(layer.id);
    }
  }

  /** Bumps the revision when a history step actually changed the document. */
  private recordHistoryChange(step: () => boolean): boolean {
    const changed = step();
    if (changed) {
      this.revision += 1;
      this.publish();
    }
    return changed;
  }

  private refreshFileState(): void {
    const path = this.filePath;
    const dirty = this.revision !== this.savedRevision;
    if (path !== this.fileState.path || dirty !== this.fileState.dirty) {
      this.fileState = { path, dirty };
    }
  }

  private readDevicePixelRatio(): number {
    if (typeof window === "undefined") {
      return 1;
    }
    const ratio = window.devicePixelRatio;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  }

  private handlePointerSample(sample: PointerSample): void {
    this.reportCursor(sample);

    if (sample.phase === "down") {
      // Middle-button drag pans regardless of the active tool.
      if (sample.button === 1) {
        this.panGestureActive = true;
        this.middlePanTool.onPointerDown(this.toolContext, sample);
        return;
      }
      this.activeTool().onPointerDown(this.toolContext, sample);
      return;
    }

    if (sample.phase === "move") {
      if (this.panGestureActive) {
        this.middlePanTool.onPointerMove(this.toolContext, sample);
        return;
      }
      this.activeTool().onPointerMove(this.toolContext, sample);
      return;
    }

    if (this.panGestureActive) {
      this.middlePanTool.onPointerUp(this.toolContext, sample);
      this.panGestureActive = false;
      return;
    }

    const tool = this.activeTool();
    if (sample.phase === "up") {
      tool.onPointerUp(this.toolContext, sample);
    } else {
      tool.onPointerCancel(this.toolContext, sample);
    }
  }

  private handleWheel(input: WheelInput): void {
    if (input.ctrlKey || input.altKey) {
      const factor = clamp(
        Math.exp(-input.deltaY * WHEEL_ZOOM_SENSITIVITY),
        WHEEL_ZOOM_FACTOR_LIMIT,
        1 / WHEEL_ZOOM_FACTOR_LIMIT,
      );
      if (factor === 1) {
        return;
      }
      this.setViewport(zoomAt(this.viewport, input.screenX, input.screenY, factor));
      return;
    }

    if (input.shiftKey) {
      const horizontal = input.deltaX !== 0 ? input.deltaX : input.deltaY;
      this.panViewportBy(-horizontal, 0);
      return;
    }

    this.panViewportBy(-input.deltaX, -input.deltaY);
  }

  private handlePresence(inside: boolean): void {
    const cursor = this.cursor;
    if (!cursor || cursor.inside === inside) {
      return;
    }
    this.cursor = { ...cursor, inside };
    this.emitCursor(this.cursor);
  }

  private reportCursor(sample: PointerSample): void {
    this.cursor = {
      inside: true,
      docX: sample.docX,
      docY: sample.docY,
      screenX: sample.screenX,
      screenY: sample.screenY,
      kind: sample.kind,
      pressure: sample.pressure,
      hasPressure: sample.hasPressure,
    };
    this.emitCursor(this.cursor);
  }

  private republishCursor(): void {
    const cursor = this.cursor;
    if (!cursor) {
      return;
    }
    const screen = docToScreen(this.viewport, cursor.docX, cursor.docY);
    this.cursor = { ...cursor, screenX: screen.x, screenY: screen.y };
    this.emitCursor(this.cursor);
  }

  private emitCursor(report: CursorReport): void {
    for (const listener of this.cursorListeners) {
      listener(report);
    }
  }

  private abortStroke(): void {
    if (this.activeStroke) {
      this.cancelStroke();
    }
  }

  private buildSnapshot(): EditorSnapshot {
    this.refreshFileState();
    return {
      document: this.doc,
      viewport: this.viewport,
      brush: this.brush,
      toolId: this.currentToolId,
      history: this.commands.getState(),
      file: this.fileState,
    };
  }

  /** Publishes only when an observable field actually changed identity. */
  private publish(): void {
    const previous = this.store.getState();
    const next = this.buildSnapshot();
    if (
      previous.document === next.document &&
      previous.viewport === next.viewport &&
      previous.brush === next.brush &&
      previous.toolId === next.toolId &&
      previous.history === next.history &&
      previous.file === next.file
    ) {
      return;
    }
    this.store.setState(next);
  }
}
