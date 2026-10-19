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
import type { Bounds, Point } from "../../types/geometry";
import type { CursorReport, PointerSample } from "../../types/pointer";
import type { ToolId } from "../../types/tool";
import type { FlipAxis } from "../../types/transform";
import type { Viewport } from "../../types/viewport";
import { rgbToHex } from "../../utils/color";
import { clamp } from "../../utils/math";
import { createStore, type Listener, type Store } from "../../utils/store";
import { DEFAULT_BRUSH, brushSettingsEqual, normalizeBrush, updateBrushSettings } from "../brushes/defaults";
import { StrokeBuilder, cloneStroke, createStrokeRecord } from "../brushes/strokeBuilder";
import { CommandStack, DEFAULT_HISTORY_LIMIT } from "../commands/commandStack";
import { createDocumentCommand, type DocumentCommandHost, type StrokeTransfer } from "../commands/documentCommand";
import {
  createStrokeCommand,
  createStrokeCommandHost,
  type StrokeCommandHost,
} from "../commands/strokeCommand";
import {
  copyStrokeSamples,
  createDeleteStrokesCommand,
  createDuplicateStrokesCommand,
  createMoveStrokesCommand,
  createNudgeStrokesCommand,
  createTransformStrokesCommand,
  offsetStrokeSamples,
  planDuplicateInsertions,
  transformChangesSamples,
  transformStrokeSamples,
  writeStrokeSamples,
  type DeleteEntry,
  type DuplicateEntry,
  type MoveEntry,
  type StrokeTransform,
} from "../commands/strokeEditCommand";
import type { Command, CommandStackState } from "../commands/types";
import * as documentOps from "../document/document";
import { StrokeStore } from "../document/strokeStore";
import {
  boundsContainPoint,
  boundsFromCorners,
  strokeIntersectsBounds,
} from "../document/strokeSelection";
import type { DrawingDocument, LayerId, StrokeRecord } from "../document/types";
import {
  CanvasInputBinder,
  type CanvasInputHandlers,
  type WheelInput,
} from "../input/canvasInputBinder";
import { toStrokeSample } from "../input/pointer";
import { serializeProject, type ParsedProject } from "../project/projectFormat";
import { Canvas2DRenderer } from "../rendering/Canvas2DRenderer";
import { strokeDiameter } from "../rendering/canvas2dStroke";
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
import type { ShapePoint } from "../tools/shapeGeometry";
import type { Tool, ToolContext } from "../tools/types";

/** Low-frequency state React is allowed to render from. */
export interface EditorSnapshot {
  readonly document: DrawingDocument;
  readonly viewport: Viewport;
  readonly brush: BrushSettings;
  readonly toolId: ToolId;
  readonly history: CommandStackState;
  readonly file: DocumentFileState;
  /**
   * How many strokes the current selection holds; `0` when nothing is selected.
   *
   * A count rather than the selection itself: the UI needs to tell the user how
   * much a transform would move, and nothing else about the selection is
   * renderable from React (the overlay is drawn by the renderer).
   */
  readonly selectedStrokes: number;
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

/**
 * True when a document-space point lies on the document rectangle.
 *
 * The canvas is deliberately larger than the document - there is a margin of
 * unpainted workspace around the paper - so a press in the margin must be
 * ignored. Letting it through records samples that nothing can ever display: an
 * undo step that appears to do nothing, and, if it is the only stroke, an
 * exported PNG that looks blank. The bounds are inclusive so that a press
 * exactly on the edge pixel still paints.
 */
function isInsideDocument(document: DrawingDocument, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= document.width && y <= document.height;
}

/**
 * Union of the *painted* bounds of `strokes`, or `null` when there are none.
 *
 * Each stroke is widened by half its maximum diameter, because the pixels of a
 * stroke reach that far from its centreline and a frame hugging the centreline
 * would cut through wide brush work. The result is derived on demand from the
 * strokes rather than remembered, which is what keeps the frame correct after a
 * move, an undo or a redo without any state to keep in step.
 */
function boundsOfStrokes(strokes: readonly StrokeRecord[]): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const stroke of strokes) {
    const padding = strokeDiameter(stroke.brush, 1) / 2;
    for (let index = 0; index < stroke.xs.length; index += 1) {
      minX = Math.min(minX, stroke.xs[index] - padding);
      minY = Math.min(minY, stroke.ys[index] - padding);
      maxX = Math.max(maxX, stroke.xs[index] + padding);
      maxY = Math.max(maxY, stroke.ys[index] + padding);
    }
  }
  if (minX > maxX || minY > maxY) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * A committed selection: whole strokes of one layer.
 *
 * Only *which* strokes are selected is stored, never the rectangle that picked
 * them. The selection frame is derived from the strokes' own bounds
 * (`selectionBounds`), so it follows them through a move, an undo and a redo
 * with no bookkeeping that could drift out of step with the document. The layer
 * is fixed at selection time: a selection belongs to the layer it was made on,
 * because a transform writes stroke samples and strokes live in a layer.
 */
interface Selection {
  readonly layerId: LayerId;
  readonly strokeIds: readonly string[];
}

/**
 * An in-flight selection gesture.
 *
 * `marquee` carries a live rubber-band rectangle; `move` carries the strokes
 * being translated together with their pre-gesture coordinates, which is what
 * makes the move both previewable and exactly reversible.
 */
interface SelectionGesture {
  readonly mode: "marquee" | "move";
  readonly anchor: Point;
  /** Marquee only: the rubber band, replaced on every move. */
  bounds: Bounds | null;
  /** Move only: the selected strokes and their original coordinates. */
  readonly entries: readonly MoveEntry[];
  /** Move only: the translation applied so far, in document pixels. */
  dx: number;
  dy: number;
}

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
  private readonly documentCommandHost: DocumentCommandHost;
  private readonly toolContext: ToolContext;
  private readonly middlePanTool: Tool;
  private readonly maxRasterScale: number;

  private renderer: DrawingRenderer | null = null;
  private binder: CanvasInputBinder | null = null;
  private strokeBuilder: StrokeBuilder | null = null;
  private activeStroke: StrokeRecord | null = null;
  private panGestureActive = false;
  private selection: Selection | null = null;
  private selectionGesture: SelectionGesture | null = null;
  /**
   * Identity counter for the current selection, restarted whenever the
   * selection is replaced. It is what scopes nudge coalescing to *one* run: two
   * nudges of the same strokes merge only while nothing re-made the selection in
   * between (see `setSelection`).
   */
  private selectionRun = 0;
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
    this.documentCommandHost = {
      getDocument: () => engine.doc,
      applyDocument: (next) => engine.applyDocumentState(next),
      clearLayerStrokes: (layerId) => engine.strokes.clearLayer(layerId),
      restoreLayerStrokes: (layerId, strokes) => {
        // Idempotent: applying the same restore twice cannot duplicate strokes.
        engine.strokes.clearLayer(layerId);
        for (const stroke of strokes) {
          engine.strokes.insert(stroke);
        }
      },
    };
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
      beginShape: (sample) => engine.beginShape(sample),
      setShapeOutline: (points) => engine.setShapeOutline(points),
      finishShape: () => engine.finishShape(),
      cancelShape: () => engine.cancelShape(),
      isStrokeActive: () => engine.activeStroke !== null,
      isInsideSelection: (docX, docY) => engine.isInsideSelection(docX, docY),
      beginSelection: (sample) => engine.beginSelection(sample),
      beginSelectionMove: (sample) => engine.beginSelectionMove(sample),
      updateSelection: (sample) => engine.updateSelection(sample),
      finishSelection: () => engine.finishSelection(),
      cancelSelection: () => engine.cancelSelection(),
      clearSelection: () => engine.clearSelection(),
      pickColor: (sample) => engine.pickColor(sample),
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
    this.syncSelectionOverlay();
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
    this.resetSelection();
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
    this.resetSelection();
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

  /**
   * Adds a layer above the stack and makes it active.
   *
   * Layer operations are history entries, not direct mutations. That matters
   * most for deletion: a layer's stroke list is real user data, so discarding
   * and restoring it must be one reversible step.
   */
  addLayer(): void {
    const before = this.doc;
    this.commitDocumentChange("Add Layer", before, documentOps.addLayer(before));
  }

  /** Copies a layer - metadata and strokes - directly above the original. */
  duplicateLayer(layerId: LayerId): void {
    const before = this.doc;
    const after = documentOps.duplicateLayer(before, layerId);
    if (after === before) {
      return;
    }
    const copy = after.layers.find(
      (layer) => !before.layers.some((known) => known.id === layer.id),
    );
    if (!copy) {
      return;
    }
    const strokes = this.strokes.list(layerId).map((stroke) => cloneStroke(stroke, copy.id));
    this.commitDocumentChange("Duplicate Layer", before, after, {
      addedStrokes: { layerId: copy.id, strokes },
    });
  }

  removeLayer(layerId: LayerId): void {
    const before = this.doc;
    const after = documentOps.removeLayer(before, layerId);
    if (after === before) {
      return;
    }
    // `list` returns the live array, which the command clears when it applies,
    // so the strokes to restore are copied out first.
    const removedStrokes: StrokeTransfer = { layerId, strokes: [...this.strokes.list(layerId)] };
    this.commitDocumentChange("Delete Layer", before, after, { removedStrokes });
  }

  renameLayer(layerId: LayerId, name: string): void {
    const trimmed = name.trim();
    if (trimmed === "") {
      return;
    }
    const before = this.doc;
    this.commitDocumentChange(
      "Rename Layer",
      before,
      documentOps.updateLayer(before, layerId, { name: trimmed }),
    );
  }

  setLayerVisibility(layerId: LayerId, visible: boolean): void {
    const before = this.doc;
    this.commitDocumentChange(
      "Layer Visibility",
      before,
      documentOps.updateLayer(before, layerId, { visible }),
    );
  }

  toggleLayerVisibility(layerId: LayerId): void {
    const layer = this.doc.layers.find((candidate) => candidate.id === layerId);
    if (layer) {
      this.setLayerVisibility(layerId, !layer.visible);
    }
  }

  setLayerOpacity(layerId: LayerId, opacity: number): void {
    const before = this.doc;
    // Dragging the opacity slider fires continuously; the merge key collapses
    // the whole drag into one undo step instead of one per tick.
    this.commitDocumentChange(
      "Layer Opacity",
      before,
      documentOps.updateLayer(before, layerId, { opacity }),
      { mergeKey: `layer-opacity:${layerId}` },
    );
  }

  moveLayer(layerId: LayerId, delta: number): void {
    const before = this.doc;
    this.commitDocumentChange("Reorder Layers", before, documentOps.moveLayer(before, layerId, delta));
  }

  /**
   * Selects the active layer. This changes no pixels and is not an edit, so it
   * is not undoable and never marks the document dirty - only the renderer and
   * the UI snapshot are refreshed.
   */
  selectLayer(layerId: LayerId): void {
    this.applyDocumentState(documentOps.setActiveLayer(this.doc, layerId));
  }

  /**
   * Samples the composite for the colour picker.
   *
   * Like selecting a layer, this is not an edit. It reads what the user sees
   * through the renderer and sets the brush colour through `setBrush` - the same
   * path the colour control uses, so colour has one source of truth. It touches
   * no stroke, pushes no history entry and never bumps the revision, so picking
   * cannot make the document dirty.
   *
   * A press outside the paper is ignored, exactly like `beginStroke`: there is
   * no composite there to sample.
   */
  private pickColor(sample: PointerSample): void {
    if (!isInsideDocument(this.doc, sample.docX, sample.docY)) {
      return;
    }
    const color = this.renderer?.readCompositePixel(sample.docX, sample.docY);
    if (!color) {
      return;
    }
    this.setBrush({ color: rgbToHex(color) });
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
    // A selection belongs to the select tool. Switching away drops it rather
    // than leaving it visible: painting is *not* clipped to a selection, so a
    // lingering highlight would imply a constraint that does not exist.
    if (toolId !== "select") {
      this.resetSelection();
    }
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
    if (this.activeStroke || this.selectionGesture) {
      return false;
    }
    return this.recordHistoryChange(() => this.commands.undo());
  }

  redo(): boolean {
    if (this.activeStroke || this.selectionGesture) {
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
    // A press outside the paper is not a stroke. It is also how a non-finite
    // sample (NaN never satisfies `>= 0`) is rejected before it reaches history.
    if (!isInsideDocument(this.doc, sample.docX, sample.docY)) {
      return;
    }

    const stroke = createStrokeRecord(layerId, this.brush, this.activeTool().erases === true);
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

  // ------------------------------------------------------------- shape capture

  /**
   * Starts a shape gesture.
   *
   * Shapes do not trace the pointer: the tool computes a whole outline from the
   * drag and replaces it on every move (see `setShapeOutline`). The engine holds
   * the in-flight stroke and the renderer previews it exactly as for a brush
   * stroke, so committing is the same one-step path.
   */
  private beginShape(sample: PointerSample): void {
    if (this.activeStroke) {
      return;
    }
    const layerId = this.doc.activeLayerId;
    if (!layerId) {
      return;
    }
    // The same guard as `beginStroke`: a press outside the paper starts nothing,
    // and a non-finite sample never satisfies the bounds check.
    if (!isInsideDocument(this.doc, sample.docX, sample.docY)) {
      return;
    }
    const stroke = createStrokeRecord(layerId, this.brush, this.activeTool().erases === true);
    stroke.startTime = sample.timeStamp;
    this.strokeBuilder = null;
    this.activeStroke = stroke;
    this.renderer?.beginStroke(stroke);
  }

  /**
   * Replaces the in-progress shape's samples with a new outline.
   *
   * Pressure is fixed at 1 so a shape has constant width, and `times` are zero
   * because a shape has no timing - they exist only to keep the sample arrays
   * parallel. The renderer redraws the whole buffer, so the preview shows the
   * current geometry and nothing accumulates across moves.
   */
  private setShapeOutline(points: readonly ShapePoint[]): void {
    const stroke = this.activeStroke;
    if (!stroke) {
      return;
    }
    stroke.xs.length = 0;
    stroke.ys.length = 0;
    stroke.pressures.length = 0;
    stroke.times.length = 0;
    for (const point of points) {
      stroke.xs.push(point.x);
      stroke.ys.push(point.y);
      stroke.pressures.push(1);
      stroke.times.push(0);
    }
    this.renderer?.replaceStroke(stroke);
  }

  /** Commits the in-progress shape; an empty outline is discarded, not stored. */
  private finishShape(): void {
    const stroke = this.activeStroke;
    if (!stroke || stroke.xs.length === 0) {
      this.cancelShape();
      return;
    }
    this.finishStroke();
  }

  /** Discards the in-progress shape without touching the layer. */
  private cancelShape(): void {
    this.cancelStroke();
  }

  finishStroke(): void {
    const stroke = this.activeStroke;
    this.strokeBuilder = null;
    this.activeStroke = null;
    if (!stroke) {
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

  // ---------------------------------------------------------------- selection

  /**
   * True when a document point lies inside the selection's frame.
   *
   * The frame is the bounds of the selected strokes, so this answers the only
   * question the select tool asks on press - "is this the selection, or the
   * start of a new marquee?" - without a second hit test. An empty selection is
   * never inside anything.
   */
  isInsideSelection(docX: number, docY: number): boolean {
    const bounds = this.selectionBounds();
    return bounds !== null && boundsContainPoint(bounds, docX, docY);
  }

  /** Drops the selection and its overlay. Not an edit: nothing enters history. */
  clearSelection(): void {
    this.cancelSelectionGesture();
    if (!this.selection) {
      this.syncSelectionOverlay();
      return;
    }
    this.setSelection(null);
    this.syncSelectionOverlay();
    this.publish();
    this.requestRender();
  }

  /**
   * Deletes the selected strokes as a single undoable step.
   *
   * The strokes are removed and the step is *recorded*, so history has one entry
   * for undoing the whole deletion and redo puts every stroke back at its
   * original index - which is what preserves painting order rather than
   * shuffling the layer. The selection goes with them: it named strokes that no
   * longer exist.
   *
   * Returns whether anything was removed, so a caller can tell a no-op (no
   * selection) from a deletion.
   */
  deleteSelection(): boolean {
    const selection = this.selection;
    if (!selection) {
      return false;
    }
    this.cancelSelectionGesture();

    const wanted = new Set(selection.strokeIds);
    const entries: DeleteEntry[] = [];
    const layer = this.strokes.list(selection.layerId);
    for (let index = 0; index < layer.length; index += 1) {
      const stroke = layer[index];
      if (wanted.has(stroke.id)) {
        entries.push({ stroke, index });
      }
    }
    if (entries.length === 0) {
      // The selection names strokes that an undo removed. Nothing to delete, and
      // the id list is kept on purpose: redo re-inserts those strokes, and the
      // selection then resolves again.
      return false;
    }

    for (const entry of entries) {
      this.strokes.remove(entry.stroke.layerId, entry.stroke.id);
    }
    this.setSelection(null);
    this.syncSelectionOverlay();
    this.renderer?.invalidateLayer(selection.layerId);
    // Bumped before the command is recorded so the snapshot the command stack
    // publishes already carries the dirty flag.
    this.revision += 1;
    this.commands.push(createDeleteStrokesCommand(entries, this.commandHost));
    this.publish();
    this.requestRender();
    return true;
  }

  /**
   * Moves the selection by a fixed delta, as one undo step (arrow-key nudge).
   *
   * Repeated nudges of the same selection coalesce in the command stack, so a
   * held arrow key is one history step rather than one per repeat - the same
   * rule the opacity slider follows. The offset is summed over the copies taken
   * before the first nudge, which is what makes undo restore the run and redo
   * re-apply all of it exactly.
   */
  nudgeSelection(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) {
      return false;
    }
    const selection = this.selection;
    const entries = this.beginSelectionEdit();
    if (!selection || !entries) {
      return false;
    }
    for (const entry of entries) {
      offsetStrokeSamples(entry.stroke, entry.original, dx, dy);
    }
    this.commitSelectionEdit(
      entries,
      createNudgeStrokesCommand(
        entries,
        dx,
        dy,
        this.commandHost,
        // Scoped to this selection *instance*: a deselect and reselect of the
        // same strokes is a new run, so undo steps land where the user put them.
        `nudge:${this.selectionRun}:${selection.layerId}`,
      ),
    );
    return true;
  }

  /**
   * Copies the selected strokes directly above their originals, as one step, and
   * selects the copies.
   *
   * Selecting the copies (rather than keeping the originals selected) is what
   * makes duplicate-then-nudge behave the way the user expects: the thing that
   * moves is the copy that is visibly on top. Clone objects are created once, so
   * undo/redo re-inserts the very same strokes instead of minting new ids.
   */
  duplicateSelection(): boolean {
    if (this.activeStroke || this.selectionGesture) {
      return false;
    }
    const selection = this.selection;
    if (!selection) {
      return false;
    }
    const wanted = new Set(selection.strokeIds);
    const layer = this.strokes.list(selection.layerId);
    const entries: DuplicateEntry[] = [];
    for (let index = 0; index < layer.length; index += 1) {
      const source = layer[index];
      if (wanted.has(source.id)) {
        entries.push({ source, index, clone: cloneStroke(source) });
      }
    }
    if (entries.length === 0) {
      // Stale ids (an undone duplicate): report a no-op. The ids are deliberately
      // kept, so a redo that brings the strokes back restores the selection too.
      return false;
    }

    const insertions = planDuplicateInsertions(entries);
    for (const insertion of insertions) {
      this.strokes.insert(insertion.stroke, insertion.index);
    }
    this.setSelection({
      layerId: selection.layerId,
      strokeIds: insertions.map((insertion) => insertion.stroke.id),
    });
    this.renderer?.invalidateLayer(selection.layerId);
    this.revision += 1;
    this.commands.push(createDuplicateStrokesCommand(entries, this.commandHost));
    this.publish();
    this.syncSelectionOverlay();
    this.requestRender();
    return true;
  }

  /**
   * Reflects the selection about its own vertical or horizontal centre line.
   *
   * A flip is a coordinate map, not a new stroke: sample positions move, brush
   * and pressure data do not, so the result re-rasterizes and reopens exactly
   * like any other stroke. The map is applied to the copies taken before the
   * edit, so undo restores the originals and redo reproduces the flip.
   */
  flipSelection(axis: FlipAxis): boolean {
    const entries = this.beginSelectionEdit();
    if (!entries) {
      return false;
    }
    const bounds = boundsOfStrokes(entries.map((entry) => entry.stroke));
    if (!bounds) {
      return false;
    }
    const centreX = bounds.x + bounds.width / 2;
    const centreY = bounds.y + bounds.height / 2;
    const transform: StrokeTransform =
      axis === "horizontal"
        ? {
            label: "Flip Horizontal",
            mapX: (x) => centreX * 2 - x,
            mapY: (_x, y) => y,
          }
        : {
            label: "Flip Vertical",
            mapX: (x) => x,
            mapY: (_x, y) => centreY * 2 - y,
          };
    // A symmetric stroke (or a single dab) maps onto itself: nothing to record.
    if (!transformChangesSamples(entries, transform)) {
      return false;
    }
    for (const entry of entries) {
      transformStrokeSamples(entry.stroke, entry.original, transform);
    }
    this.commitSelectionEdit(
      entries,
      createTransformStrokesCommand(entries, transform, this.commandHost),
    );
    return true;
  }

  /** Starts a marquee gesture at the sample; the selection is decided on release. */
  private beginSelection(sample: PointerSample): void {
    if (!this.usableSelectionPoint(sample)) {
      return;
    }
    this.cancelSelectionGesture();
    this.selectionGesture = {
      mode: "marquee",
      anchor: { x: sample.docX, y: sample.docY },
      bounds: { x: sample.docX, y: sample.docY, width: 0, height: 0 },
      entries: [],
      dx: 0,
      dy: 0,
    };
    this.syncSelectionOverlay();
    this.requestRender();
  }

  /**
   * Starts translating the selection.
   *
   * Each selected stroke's coordinates are copied up front: the copies are the
   * live preview's reference and, on release, the history command's revert
   * value. Nothing is snapshotted bitmap-wise - the strokes themselves move.
   */
  private beginSelectionMove(sample: PointerSample): void {
    const selection = this.selection;
    if (!selection || !this.usableSelectionPoint(sample)) {
      return;
    }
    this.cancelSelectionGesture();
    const entries: MoveEntry[] = [];
    for (const stroke of this.selectedStrokes()) {
      entries.push({ stroke, original: copyStrokeSamples(stroke) });
    }
    if (entries.length === 0) {
      return;
    }
    this.selectionGesture = {
      mode: "move",
      anchor: { x: sample.docX, y: sample.docY },
      bounds: null,
      entries,
      dx: 0,
      dy: 0,
    };
  }

  /**
   * Applies the in-flight gesture to the sample.
   *
   * A marquee just replaces its rubber band. A move writes `original + delta`
   * into every selected stroke and invalidates the layer, so the pixels on
   * screen are always the ones a re-rasterization of the stroke list would
   * produce - the store stays authoritative during the drag, and nothing is
   * committed until release. The cost is a full layer re-rasterization per
   * pointer move; it is the price of never showing a preview that could differ
   * from the committed result (see the limitations in `docs/ARCHITECTURE.md`).
   */
  private updateSelection(sample: PointerSample): void {
    const gesture = this.selectionGesture;
    if (!gesture || !this.usableSelectionPoint(sample)) {
      return;
    }

    if (gesture.mode === "marquee") {
      gesture.bounds = boundsFromCorners(gesture.anchor, { x: sample.docX, y: sample.docY });
      this.syncSelectionOverlay();
      this.requestRender();
      return;
    }

    const dx = sample.docX - gesture.anchor.x;
    const dy = sample.docY - gesture.anchor.y;
    if (dx === gesture.dx && dy === gesture.dy) {
      return;
    }
    gesture.dx = dx;
    gesture.dy = dy;
    for (const entry of gesture.entries) {
      offsetStrokeSamples(entry.stroke, entry.original, dx, dy);
    }
    this.refreshStrokeLayers(gesture.entries);
    this.syncSelectionOverlay();
  }

  /**
   * Commits the in-flight gesture.
   *
   * A marquee selects every stroke of the active layer it meets, or clears the
   * selection when it meets none - a press that never moved is a zero-size
   * marquee, so a click selects the strokes under the pointer by the same rule.
   * A move records one history step; a press inside the selection that never
   * moved records nothing at all, so a stray click cannot leave an undo step
   * that appears to do nothing.
   */
  private finishSelection(): void {
    const gesture = this.selectionGesture;
    if (!gesture) {
      return;
    }
    this.selectionGesture = null;

    if (gesture.mode === "marquee") {
      this.selectInBounds(
        gesture.bounds ?? { x: gesture.anchor.x, y: gesture.anchor.y, width: 0, height: 0 },
      );
      this.syncSelectionOverlay();
      this.publish();
      this.requestRender();
      return;
    }

    const { dx, dy } = gesture;
    if (dx === 0 && dy === 0) {
      this.syncSelectionOverlay();
      return;
    }
    this.revision += 1;
    this.commands.push(createMoveStrokesCommand(gesture.entries, dx, dy, this.commandHost));
    this.publish();
    this.syncSelectionOverlay();
    this.requestRender();
  }

  /**
   * Aborts the in-flight gesture.
   *
   * A marquee simply disappears - the committed selection was never touched, so
   * there is nothing to put back. A move restores every stroke's original
   * coordinates and re-rasterizes, which is exact because the originals were
   * copied rather than derived.
   */
  private cancelSelection(): void {
    const gesture = this.selectionGesture;
    if (!gesture) {
      return;
    }
    this.selectionGesture = null;
    if (gesture.mode === "move") {
      for (const entry of gesture.entries) {
        writeStrokeSamples(entry.stroke, entry.original);
      }
      this.refreshStrokeLayers(gesture.entries);
    }
    this.syncSelectionOverlay();
    this.requestRender();
  }

  /** Aborts a stray gesture (a lost pointer-up) before starting a new one. */
  private cancelSelectionGesture(): void {
    if (this.selectionGesture) {
      this.cancelSelection();
    }
  }

  /**
   * Forgets the selection without publishing.
   *
   * Used where the caller already publishes - a new document, a loaded project,
   * a layer change - so the snapshot is built once, and by tool switching, where
   * the selection would otherwise outlive the tool that gives it meaning.
   */
  private resetSelection(): void {
    this.selectionGesture = null;
    this.setSelection(null);
    this.syncSelectionOverlay();
  }

  /**
   * Replaces the selection, starting a new nudge run.
   *
   * Every selection change goes through here so the run counter always moves
   * with the selection identity. Without it, nudging a stroke, deselecting and
   * reselecting the *same* stroke would fold both nudges into one history step:
   * the merge key names the strokes, and the strokes did not change.
   */
  private setSelection(next: Selection | null): void {
    this.selectionRun += 1;
    this.selection = next;
  }

  /** Selects the strokes of the active layer that the marquee meets. */
  private selectInBounds(bounds: Bounds): void {
    const layerId = this.doc.activeLayerId;
    if (!layerId) {
      this.setSelection(null);
      return;
    }
    const strokeIds: string[] = [];
    for (const stroke of this.strokes.list(layerId)) {
      // Widened by half the stroke's painted width, so a stroke whose pixels
      // reach into the marquee selects even when its centreline stays outside.
      if (strokeIntersectsBounds(stroke, bounds, strokeDiameter(stroke.brush, 1) / 2)) {
        strokeIds.push(stroke.id);
      }
    }
    this.setSelection(strokeIds.length > 0 ? { layerId, strokeIds } : null);
  }

  /**
   * Copies the selection's sample coordinates as the reference for an edit that
   * is not a drag (nudge, flip).
   *
   * Returns `null` when there is nothing to edit or a pointer gesture is in
   * flight: a keyboard transform during a drag would fight the gesture for the
   * same coordinates.
   */
  private beginSelectionEdit(): MoveEntry[] | null {
    if (this.activeStroke || this.selectionGesture) {
      return null;
    }
    const entries: MoveEntry[] = this.selectedStrokes().map((stroke) => ({
      stroke,
      original: copyStrokeSamples(stroke),
    }));
    return entries.length > 0 ? entries : null;
  }

  /**
   * Records a selection edit whose coordinates are already written.
   *
   * Re-rasterizes the touched layers, bumps the revision (so the document is
   * dirty and the status bar reflects the step), pushes the command and
   * republishes. `push`, not `execute`: the edit is on screen before the command
   * exists, exactly like a stroke or a drag.
   */
  private commitSelectionEdit(entries: readonly MoveEntry[], command: Command): void {
    this.refreshStrokeLayers(entries);
    this.revision += 1;
    this.commands.push(command);
    this.publish();
    this.syncSelectionOverlay();
    this.requestRender();
  }

  /** The selected strokes that still exist, in painting order. */
  private selectedStrokes(): readonly StrokeRecord[] {
    const selection = this.selection;
    if (!selection) {
      return [];
    }
    const wanted = new Set(selection.strokeIds);
    return this.strokes.list(selection.layerId).filter((stroke) => wanted.has(stroke.id));
  }

  private selectionBounds(): Bounds | null {
    return boundsOfStrokes(this.selectedStrokes());
  }

  /** Re-rasterizes every layer an edit touched, once each. */
  private refreshStrokeLayers(entries: readonly MoveEntry[]): void {
    const seen = new Set<LayerId>();
    for (const entry of entries) {
      const layerId = entry.stroke.layerId;
      if (seen.has(layerId)) {
        continue;
      }
      seen.add(layerId);
      this.renderer?.invalidateLayer(layerId);
    }
  }

  /**
   * Hands the renderer the current overlay.
   *
   * While a marquee is dragged the rubber band is live and the previous
   * selection stays traced, which is what lets the user see what they are
   * about to replace. Otherwise the committed strokes are traced inside their
   * own bounds. Strokes are passed as data: the renderer traces what it is
   * given and never looks the selection up itself.
   */
  private syncSelectionOverlay(): void {
    const renderer = this.renderer;
    if (!renderer) {
      return;
    }
    const marquee = this.selectionGesture?.mode === "marquee" ? this.selectionGesture.bounds : null;
    const strokes = this.selectedStrokes();
    if (marquee === null && strokes.length === 0) {
      renderer.setSelection(null);
      return;
    }
    renderer.setSelection({ bounds: marquee ?? boundsOfStrokes(strokes), strokes });
  }

  /**
   * True when a sample carries finite document coordinates.
   *
   * Selection is geometry on the way in, so a non-finite sample is rejected here
   * just as `beginStroke` rejects one through its bounds check: otherwise a NaN
   * would poison the marquee, the stroke offsets, or both.
   */
  private usableSelectionPoint(sample: PointerSample): boolean {
    return Number.isFinite(sample.docX) && Number.isFinite(sample.docY);
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

  /** Runs a layer change and records it as a single undoable history entry. */
  private commitDocumentChange(
    label: string,
    before: DrawingDocument,
    after: DrawingDocument,
    options: {
      readonly mergeKey?: string;
      readonly removedStrokes?: StrokeTransfer;
      readonly addedStrokes?: StrokeTransfer;
    } = {},
  ): void {
    if (after === before) {
      return;
    }
    this.executeDocumentCommand(
      createDocumentCommand({ label, before, after, ...options }, this.documentCommandHost),
    );
  }

  /**
   * Applies a layer operation and records it as one step.
   *
   * The revision is bumped before the command runs so the snapshot the command
   * stack publishes already carries the correct dirty flag.
   */
  private executeDocumentCommand(command: Command): void {
    this.revision += 1;
    this.commands.execute(command);
  }

  /**
   * Publishes a new document state without touching history or the dirty flag.
   *
   * Layer metadata and stack order never change a layer's *pixels*: a new layer
   * gets a dirty surface the first time it is composited, a removed layer has
   * its surface dropped by `setDocument`, and moving, hiding or renaming one
   * only changes the composite. Nothing is invalidated here on purpose -
   * invalidating would re-rasterize every stroke of every layer to service a
   * rename or a selection. Strokes invalidate their own layer through the
   * stroke command, and document *replacement* (new/open) invalidates
   * explicitly, because there a reused layer id can describe different pixels.
   */
  private applyDocumentState(next: DrawingDocument): void {
    if (next === this.doc) {
      return;
    }
    const activeLayerChanged = next.activeLayerId !== this.doc.activeLayerId;
    this.doc = next;
    this.renderer?.setDocument(next);
    // A selection is meaningful only on the layer it was made on: activating
    // another layer, or removing that layer, drops it rather than leaving a
    // highlight over strokes that are no longer the ones a transform would move.
    if (
      activeLayerChanged ||
      (this.selection !== null && !next.layers.some((layer) => layer.id === this.selection?.layerId))
    ) {
      this.resetSelection();
    }
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
      // Undo can remove the strokes a selection points at (undone duplicate and
      // delete) or move them (undone move): re-derive the overlay from the store
      // so the frame never outlives what it describes.
      this.syncSelectionOverlay();
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

  /**
   * Feeds one normalized pointer sample to the active tool.
   *
   * This is the engine's single pointer-input entry point; the DOM binder calls
   * it. It is public so tool behaviour can be driven end to end without a DOM,
   * but it is not a UI-facing action.
   */
  handlePointerSample(sample: PointerSample): void {
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
      // Counted from the store rather than from the selection's id list, so a
      // stroke removed by undo or redo cannot be counted as still selected.
      selectedStrokes: this.selectedStrokes().length,
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
      previous.file === next.file &&
      previous.selectedStrokes === next.selectedStrokes
    ) {
      return;
    }
    this.store.setState(next);
  }
}
