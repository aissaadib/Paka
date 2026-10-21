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
import { hexToRgb, rgbToHex } from "../../utils/color";
import { createId } from "../../utils/id";
import { clamp } from "../../utils/math";
import { createStore, type Listener, type Store } from "../../utils/store";
import { DEFAULT_BRUSH, brushSettingsEqual, normalizeBrush, updateBrushSettings } from "../brushes/defaults";
import { StrokeBuilder, cloneStroke, createStrokeRecord } from "../brushes/strokeBuilder";
import { CommandStack, DEFAULT_HISTORY_LIMIT } from "../commands/commandStack";
import {
  createDocumentCommand,
  type DocumentCommandHost,
  type ElementTransfer,
} from "../commands/documentCommand";
import { createFillCommand } from "../commands/fillCommand";
import { createGradientCommand } from "../commands/gradientCommand";
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
import {
  addGuideToDocument,
  findGuide,
  findGuideAt,
  guidesEqual,
  isDuplicateGuide,
  removeGuideFromDocument,
  roundGuidePosition,
  setGuidePosition,
} from "../document/guides";
import {
  cornerOf,
  findSelectionHandle,
  HANDLE_CURSORS,
  HANDLE_GRAB_RADIUS_PX,
  ROTATION_HANDLE_OFFSET_PX,
  selectionHandles,
  type SelectionHandleId,
  type SelectionHandles,
} from "../document/selectionHandles";
import {
  boundsCentre,
  clampScaleFactor,
  createRotateTransform,
  createScaleTransform,
  rotationAngleFrom,
  scaleFactorFrom,
  selectionFrame,
  snapRotationAngle,
  type SampleTransform,
} from "../document/selectionTransform";
import { StrokeStore } from "../document/strokeStore";
import {
  boundsContainPoint,
  boundsFromCorners,
  strokeIntersectsBounds,
} from "../document/strokeSelection";
import type {
  DrawingDocument,
  FillPatchRecord,
  GradientRecord,
  Guide,
  GuideAxis,
  LayerBlendMode,
  LayerElement,
  LayerId,
  StrokeRecord,
} from "../document/types";
import { isFillPatch, isGradient, isStroke } from "../document/types";
import { cloneFillPatch, createFillPatch } from "../fill/fillPatch";
import { MAX_FILL_SCAN_PIXELS, floodFill } from "../fill/floodFill";
import {
  DEFAULT_GRADIENT_END_COLOR,
  cloneGradient,
  createGradientRecord,
  gradientIsDegenerate,
  moveGradientEnd,
} from "../gradient/gradientRecord";
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
  fitToViewport,
  panBy,
  screenToDoc,
  zoomAt,
  zoomToAt,
} from "../rendering/viewport";
import { createToolRegistry, type ToolRegistry } from "../tools/toolRegistry";
import {
  DEFAULT_SHAPE_INNER_RATIO,
  DEFAULT_SHAPE_ROTATION,
  DEFAULT_SHAPE_SIDES,
  normalizeShapeOptions,
  type ShapeOptions,
  type ShapePoint,
} from "../tools/shapeGeometry";
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
  /**
   * The id of the composition guide the guides tool has selected, or `null`.
   *
   * Editor state, like `selectedStrokes`: the guides themselves are document
   * state and travel with the document, but which one is selected belongs to
   * the tool that owns the selection.
   */
  readonly selectedGuideId: string | null;
  /**
   * Whether the shape tools fill their outline instead of tracing it.
   *
   * Editor state rather than document state: it describes the next shape, not
   * the ones already committed - a committed shape carries its own flag, so
   * toggling this never rewrites existing strokes.
   */
  readonly shapeFill: boolean;
  /**
   * How many sides the next polygon has, and how many points the next star has.
   *
   * Editor state, like `shapeFill`: it describes the next shape, not the ones
   * already committed - a committed shape stores only its points.
   */
  readonly shapeSides: number;
  /**
   * The star's inner radius as a fraction of its outer radius (`0.05..1`).
   * Editor state, like `shapeFill`.
   */
  readonly shapeInnerRatio: number;
  /**
   * The rotation of the next polygon or star about its box's centre, in
   * degrees (`0..360`). Editor state, like `shapeFill`.
   */
  readonly shapeRotation: number;
  /**
   * Colour distance the bucket treats as "the same region", in 8-bit sRGB
   * channel units (`0..255`). Editor state: it describes the next fill, not the
   * fills already committed, which carry their own pixels.
   */
  readonly fillTolerance: number;
  /**
   * Gradient shape the next drag commits. Editor state: it describes the next
   * gradient, while a committed gradient carries its own geometry.
   */
  readonly gradientType: "linear" | "radial";
  /** End colour of the next gradient; its start is the current brush colour. */
  readonly gradientEndColor: string;
  /**
   * A user-facing message from an editor action that could not complete, or
   * `null`. The status bar shows it; it is not a file message and is not
   * persisted.
   */
  readonly notice: string | null;
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
 * Shown when a layer operation is refused because a pointer gesture is still
 * in flight. One explanation per gesture is enough; see
 * `refuseLayerChangeDuringGesture`.
 */
const GESTURE_REFUSAL_NOTICE =
  "Finish the current stroke, selection or guide drag before changing layers.";

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
 * The brush a shape is drawn with.
 *
 * The stamp engine draws a chain of round dabs along a path, which suits the
 * brush and the eraser but not a shape: a shape is an outline, and a filled
 * shape is a flat polygon. So a shape records the plain segment path even when
 * the brush is stamped, and the stroke stays self-describing.
 */
function shapeBrush(brush: BrushSettings): BrushSettings {
  return brush.stamp ? { ...brush, stamp: false } : brush;
}

/**
 * The union of the painted bounds of `strokes`, or `null` when there are none.
 *
 * The rule itself lives in `core/document/selectionTransform.ts`, which is
 * pure; the brush knowledge stays here, where the diameter is known.
 */
function boundsOfStrokes(strokes: readonly StrokeRecord[]): Bounds | null {
  return selectionFrame(strokes, (stroke) => strokeDiameter(stroke.brush, 1) / 2);
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
 * Four gestures, one per thing the select tool can do with a selection:
 *
 *  - `marquee` carries a live rubber-band rectangle;
 *  - `move` carries the strokes being translated together with their
 *    pre-gesture coordinates, which is what makes the move both previewable
 *    and exactly reversible;
 *  - `scale` and `rotate` carry the same pre-gesture copies plus the frame
 *    the transform is about. The frame is captured when the gesture starts,
 *    so the centre of the transform cannot drift while the drag runs.
 */
interface MarqueeGesture {
  readonly mode: "marquee";
  readonly anchor: Point;
  /** The rubber band, replaced on every move. */
  bounds: Bounds | null;
}

interface MoveGesture {
  readonly mode: "move";
  readonly anchor: Point;
  /** The selected strokes and their original coordinates. */
  readonly entries: readonly MoveEntry[];
  /** The translation applied so far, in document pixels. */
  dx: number;
  dy: number;
}

interface ScaleGesture {
  readonly mode: "scale";
  /** The selected strokes and their original coordinates. */
  readonly entries: readonly MoveEntry[];
  /** The centre of the frame the gesture started on: the point it scales about. */
  readonly centre: Point;
  /** The corner the press grabbed, at gesture start. */
  readonly corner: Point;
  /** The handle the press grabbed, for the cursor and the overlay. */
  readonly handle: SelectionHandleId;
  /**
   * Where the press landed, in document space.
   *
   * The drag is measured from here, so a press that missed the handle by a
   * little does not jump the content.
   */
  readonly press: Point;
  /** The factor applied so far. */
  factor: number;
  /** The pointer's document position, for the handle that follows it. */
  pointer: Point;
}

interface RotateGesture {
  readonly mode: "rotate";
  /** The selected strokes and their original coordinates. */
  readonly entries: readonly MoveEntry[];
  /** The centre of the frame the gesture started on: the point it turns about. */
  readonly centre: Point;
  /** The handle the press grabbed, for the cursor and the overlay. */
  readonly handle: SelectionHandleId;
  /**
   * Where the press landed, in document space.
   *
   * The drag is measured from here, so a press that missed the handle by a
   * little does not jump the content.
   */
  readonly press: Point;
  /** The angle applied so far, in radians, clockwise from up. */
  angle: number;
  /** The pointer's document position, for the handle that follows it. */
  pointer: Point;
}

type SelectionGesture = MarqueeGesture | MoveGesture | ScaleGesture | RotateGesture;

/**
 * A fill whose pixels are already on the layer but whose history step has not
 * been recorded yet.
 *
 * The press applies the patch so the user sees the real result immediately; the
 * release commits it as one undo step. Until then the patch is not part of the
 * saved drawing's history and cancelling removes it exactly.
 */
interface ActiveFill {
  readonly patch: FillPatchRecord;
  readonly index: number;
}

/**
 * A gradient that is already painted on the layer but has not entered history.
 *
 * Moving the pointer replaces the record in place, so the user sees the real
 * gradient at its layer position. Releasing commits it; cancelling removes it
 * with no history entry and no revision change.
 */
interface ActiveGradient {
  gradient: GradientRecord;
  readonly index: number;
}

/**
 * A guide gesture in flight.
 *
 * The guide lives in the document while the gesture runs - that is how the
 * renderer shows it - but **nothing enters history until the gesture ends**:
 * the release commits one command, and a cancel puts the document back exactly
 * as it was. The document before the gesture is therefore kept here: it is
 * both the command's revert point and the cancel's restore point.
 */
interface GuideGesture {
  readonly mode: "create" | "move";
  /** The document as it was before the gesture started. */
  readonly before: DrawingDocument;
  /** The press point, in document space (create only). */
  readonly pressX: number;
  readonly pressY: number;
  /** The guide being moved (move only). */
  readonly guideId: string | null;
  /** The guide the create gesture put on the canvas (create only). */
  createdId: string | null;
}

/**
 * Copies one element into a layer, generating a fresh id.
 *
 * Used when a layer is duplicated. Fills keep their raster mask and gradients
 * keep their geometry and stops; only identity and destination layer change.
 */
function cloneElement(element: LayerElement, layerId: LayerId): LayerElement {
  if (isFillPatch(element)) {
    return cloneFillPatch(element, layerId);
  }
  if (isGradient(element)) {
    return cloneGradient(element, layerId);
  }
  return cloneStroke(element, layerId);
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
  /**
   * Whether the next shape is filled. See `EditorSnapshot.shapeFill` for why
   * this is editor state and not part of the brush or the document.
   */
  private shapeFill = false;
  /**
   * The options the next polygon or star is drawn with. See
   * `EditorSnapshot.shapeSides` for why they are editor state.
   */
  private shapeSides = DEFAULT_SHAPE_SIDES;
  private shapeInnerRatio = DEFAULT_SHAPE_INNER_RATIO;
  private shapeRotation = DEFAULT_SHAPE_ROTATION;
  /** Bucket-fill tolerance in 8-bit channel units. */
  private fillTolerance = 24;
  private activeFill: ActiveFill | null = null;
  /** Gradient options for the next drag, captured when the gesture starts. */
  private gradientType: "linear" | "radial" = "linear";
  private gradientEndColor = DEFAULT_GRADIENT_END_COLOR;
  private activeGradient: ActiveGradient | null = null;
  private notice: string | null = null;
  /**
   * Whether the gesture-refusal notice has already been raised for the
   * gesture in flight. One explanation per gesture is enough; repeating it on
   * every refused tick would republish the status bar for nothing.
   */
  private refusalNoticeShown = false;
  private selection: Selection | null = null;
  private selectionGesture: SelectionGesture | null = null;
  /** The guide the guides tool has selected, or `null`. */
  private selectedGuideId: string | null = null;
  /** The guide gesture in flight, or `null`. */
  private guideGesture: GuideGesture | null = null;
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
  /**
   * True when the file on disk holds a *preview* rather than the document.
   *
   * A save taken while a guide drag was in flight writes the live preview,
   * not the document the user will keep: cancelling the drag then leaves the
   * file and the document different. The file therefore cannot be called
   * clean until it is written again. The flag is cleared by the next save.
   */
  private fileHoldsPreview = false;
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
      clearLayerElements: (layerId) => engine.strokes.clearLayer(layerId),
      restoreLayerElements: (layerId, elements) => {
        // Idempotent: applying the same restore twice cannot duplicate content.
        engine.strokes.restore(layerId, elements);
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
      getShapeOptions: () => engine.getShapeOptions(),
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
      findSelectionHandleAt: (docX, docY) => engine.findSelectionHandleAt(docX, docY),
      beginSelection: (sample) => engine.beginSelection(sample),
      beginSelectionMove: (sample) => engine.beginSelectionMove(sample),
      beginSelectionTransform: (sample, handle) =>
        engine.beginSelectionTransform(sample, handle),
      updateSelection: (sample) => engine.updateSelection(sample),
      finishSelection: () => engine.finishSelection(),
      cancelSelection: () => engine.cancelSelection(),
      clearSelection: () => engine.clearSelection(),
      pickColor: (sample) => engine.pickColor(sample),
      beginFill: (sample) => engine.beginFill(sample),
      finishFill: () => engine.finishFill(),
      cancelFill: () => engine.cancelFill(),
      isFillActive: () => engine.activeFill !== null,
      beginGradient: (sample) => engine.beginGradient(sample),
      updateGradient: (sample) => engine.updateGradient(sample),
      finishGradient: (sample) => engine.finishGradient(sample),
      cancelGradient: () => engine.cancelGradient(),
      isGradientActive: () => engine.activeGradient !== null,
      findGuideAt: (docX, docY) => engine.findGuideAt(docX, docY),
      beginGuideCreate: (sample) => engine.beginGuideCreate(sample),
      setGuideAxis: (axis) => engine.setGuideAxis(axis),
      beginGuideMove: (guide) => engine.beginGuideMove(guide),
      moveGuideTo: (sample) => engine.moveGuideTo(sample),
      finishGuideGesture: () => engine.finishGuideGesture(),
      cancelGuideGesture: () => engine.cancelGuideGesture(),
      selectGuide: (guideId) => engine.selectGuide(guideId),
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
    this.resetGuideGesture();
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

  listElements(layerId: LayerId): readonly LayerElement[] {
    return this.strokes.listElements(layerId);
  }

  // ---------------------------------------------------------- document / view

  newDocument(options: NewDocumentOptions): void {
    this.abortStroke();
    this.resetSelection();
    this.resetGuideGesture();
    this.doc = documentOps.createDocument(options);
    this.strokes.clear();
    this.commands.clear();
    this.notice = null;
    this.filePath = null;
    this.revision = 0;
    this.savedRevision = 0;
    this.fileHoldsPreview = false;
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
    this.resetGuideGesture();
    this.doc = project.document;
    this.strokes.clear();
    this.commands.clear();
    this.notice = null;

    const nextIndex = new Map<LayerId, number>();
    for (const element of project.elements) {
      const index = nextIndex.get(element.layerId) ?? 0;
      this.strokes.insert(element);
      // A reopened drawing keeps its history shape: one undo step per element,
      // including fills and gradients. Fills replay committed pixels; gradients
      // replay their committed geometry and stops.
      this.commands.push(
        isFillPatch(element)
          ? createFillCommand(element, index, this.commandHost)
          : isGradient(element)
            ? createGradientCommand(element, index, this.commandHost)
            : createStrokeCommand(element, index, this.commandHost),
      );
      nextIndex.set(element.layerId, index + 1);
    }

    this.filePath = path;
    this.revision = 0;
    this.savedRevision = 0;
    this.fileHoldsPreview = false;

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
   *
   * A save taken **while a guide drag is in flight** writes the live preview,
   * not the document the user is going to keep: cancelling the drag then
   * leaves the file and the document different. Such a file is therefore not
   * called clean - it has to be written again before the editor may claim
   * that what is on disk is what is on screen.
   */
  markSaved(path: string): void {
    this.filePath = path;
    this.savedRevision = this.revision;
    this.fileHoldsPreview = this.guideGesture !== null;
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
    if (this.refuseLayerChangeDuringGesture()) {
      return;
    }
    const before = this.doc;
    this.commitDocumentChange("Add Layer", before, documentOps.addLayer(before));
  }

  /** Copies a layer - metadata and strokes - directly above the original. */
  duplicateLayer(layerId: LayerId): void {
    if (this.refuseLayerChangeDuringGesture()) {
      return;
    }
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
    const elements = this.strokes
      .listElements(layerId)
      .map((element) => cloneElement(element, copy.id));
    this.commitDocumentChange("Duplicate Layer", before, after, {
      addedElements: { layerId: copy.id, elements },
    });
  }

  removeLayer(layerId: LayerId): void {
    if (this.refuseLayerChangeDuringGesture()) {
      return;
    }
    const before = this.doc;
    const after = documentOps.removeLayer(before, layerId);
    if (after === before) {
      return;
    }
    // `listElements` returns the live array, which the command clears when it
    // applies, so the elements to restore are copied out first.
    const removedElements: ElementTransfer = {
      layerId,
      elements: [...this.strokes.listElements(layerId)],
    };
    this.commitDocumentChange("Delete Layer", before, after, { removedElements });
  }

  renameLayer(layerId: LayerId, name: string): void {
    if (this.refuseLayerChangeDuringGesture()) {
      return;
    }
    const trimmed = name.trim();
    if (trimmed === "") {
      return;
    }
    const before = this.doc;
    this.commitDocumentChange(
      "Rename Layer",
      before,
      documentOps.updateLayer(before, layerId, { name: trimmed }),
      { preserveActiveLayer: true },
    );
  }

  setLayerVisibility(layerId: LayerId, visible: boolean): void {
    if (this.refuseLayerChangeDuringGesture()) {
      return;
    }
    const before = this.doc;
    this.commitDocumentChange(
      "Layer Visibility",
      before,
      documentOps.updateLayer(before, layerId, { visible }),
      { preserveActiveLayer: true },
    );
  }

  toggleLayerVisibility(layerId: LayerId): void {
    const layer = this.doc.layers.find((candidate) => candidate.id === layerId);
    if (layer) {
      this.setLayerVisibility(layerId, !layer.visible);
    }
  }

  setLayerOpacity(layerId: LayerId, opacity: number): void {
    if (this.refuseLayerChangeDuringGesture()) {
      return;
    }
    const before = this.doc;
    // Dragging the opacity slider fires continuously; the merge key collapses
    // the whole drag into one undo step instead of one per tick.
    this.commitDocumentChange(
      "Layer Opacity",
      before,
      documentOps.updateLayer(before, layerId, { opacity }),
      { mergeKey: `layer-opacity:${layerId}`, preserveActiveLayer: true },
    );
  }

  setLayerBlendMode(layerId: LayerId, blendMode: LayerBlendMode): void {
    if (this.refuseLayerChangeDuringGesture()) {
      return;
    }
    const before = this.doc;
    this.commitDocumentChange(
      "Layer Blend Mode",
      before,
      documentOps.updateLayer(before, layerId, { blendMode }),
      { preserveActiveLayer: true },
    );
  }

  moveLayer(layerId: LayerId, delta: number): void {
    if (this.refuseLayerChangeDuringGesture()) {
      return;
    }
    const before = this.doc;
    this.commitDocumentChange(
      "Reorder Layers",
      before,
      documentOps.moveLayer(before, layerId, delta),
      { preserveActiveLayer: true },
    );
  }

  /**
   * Selects the active layer. This changes no pixels and is not an edit, so it
   * is not undoable and never marks the document dirty - only the renderer and
   * the UI snapshot are refreshed.
   *
   * It also ends the current history merge run: changing the layer between two
   * opacity drags is two gestures, not one.
   */
  selectLayer(layerId: LayerId): void {
    if (this.refuseLayerChangeDuringGesture()) {
      return;
    }
    this.commands.breakMerge();
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
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Sets whether the next shape is filled.
   *
   * Not undoable and not dirty: it changes what the *next* shape will be, and
   * every committed shape keeps the flag it was drawn with. The setting is
   * consulted when a shape gesture starts, so the shape takes the value that was
   * active when the user pressed.
   */
  setShapeFill(filled: boolean): void {
    if (this.shapeFill === filled) {
      return;
    }
    this.shapeFill = filled;
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * The options the next polygon or star is drawn with.
   *
   * Editor state, like `shapeFill`: the values are clamped to their
   * documented ranges, and a shape reads them when its gesture starts, so it
   * keeps the side count, the inner ratio and the rotation that were active
   * when the user pressed.
   */
  getShapeOptions(): ShapeOptions {
    return normalizeShapeOptions({
      sides: this.shapeSides,
      innerRatio: this.shapeInnerRatio,
      rotation: this.shapeRotation,
    });
  }

  /**
   * Sets how many sides the next polygon has, and how many points the next
   * star has (`3..24`).
   */
  setShapeSides(sides: number): void {
    const next = normalizeShapeOptions({
      sides,
      innerRatio: this.shapeInnerRatio,
      rotation: this.shapeRotation,
    }).sides;
    if (next === this.shapeSides) {
      return;
    }
    this.shapeSides = next;
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Sets the next star's inner radius as a fraction of its outer radius
   * (`0.05..1`).
   */
  setShapeInnerRatio(ratio: number): void {
    const next = normalizeShapeOptions({
      sides: this.shapeSides,
      innerRatio: ratio,
      rotation: this.shapeRotation,
    }).innerRatio;
    if (next === this.shapeInnerRatio) {
      return;
    }
    this.shapeInnerRatio = next;
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Turns the next polygon or star about its box's centre (`0..360` degrees).
   */
  setShapeRotation(degrees: number): void {
    const next = normalizeShapeOptions({
      sides: this.shapeSides,
      innerRatio: this.shapeInnerRatio,
      rotation: degrees,
    }).rotation;
    if (next === this.shapeRotation) {
      return;
    }
    this.shapeRotation = next;
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Sets the bucket fill's colour tolerance (`0..255`, 8-bit sRGB units).
   *
   * Editor state, like `shapeFill`: it describes the next fill. A committed
   * fill stores its pixels, so changing the tolerance never rewrites one.
   */
  setFillTolerance(tolerance: number): void {
    if (!Number.isFinite(tolerance)) {
      return;
    }
    const next = Math.round(clamp(tolerance, 0, 255));
    if (next === this.fillTolerance) {
      return;
    }
    this.fillTolerance = next;
    this.commands.breakMerge();
    this.publish();
  }

  /** Chooses linear or radial for the next gradient drag. */
  setGradientType(type: "linear" | "radial"): void {
    if (type !== "linear" && type !== "radial") {
      return;
    }
    if (this.gradientType === type) {
      return;
    }
    this.gradientType = type;
    this.commands.breakMerge();
    this.publish();
  }

  /** Sets the end colour of the next gradient, as a hex string. */
  setGradientEndColor(color: string): void {
    const normalized = hexToRgb(color);
    if (!normalized) {
      return;
    }
    const next = rgbToHex(normalized);
    if (this.gradientEndColor === next) {
      return;
    }
    this.gradientEndColor = next;
    this.commands.breakMerge();
    this.publish();
  }

  /** Clears a user-facing notice raised by an editor action. */
  dismissNotice(): void {
    if (this.notice === null) {
      return;
    }
    this.notice = null;
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
    // The guide selection belongs to the guides tool, exactly as the stroke
    // selection belongs to the select tool.
    if (toolId !== "guides") {
      this.clearGuideSelection();
    }
    this.commands.breakMerge();
    this.publish();
  }

  setViewport(viewport: Viewport, republishCursor = true): void {
    this.viewport = viewport;
    this.renderer?.setViewport(viewport);
    if (republishCursor) {
      this.republishCursor();
    }
    this.commands.breakMerge();
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

  /** True while a pointer gesture owns content that is not yet in history. */
  private isGestureActive(): boolean {
    return (
      this.activeStroke !== null ||
      this.activeFill !== null ||
      this.activeGradient !== null ||
      this.selectionGesture !== null ||
      this.guideGesture !== null
    );
  }

  /**
   * Marks the start of a gesture.
   *
   * Each gesture gets its own refusal notice: the explanation is shown once
   * per gesture, so a refused slider drag does not republish the status bar
   * on every tick, and the next gesture can explain again.
   */
  private beginGesture(): void {
    this.refusalNoticeShown = false;
  }

  /** True when `layerId` is still part of the current document. */
  private layerExists(layerId: LayerId): boolean {
    return this.doc.layers.some((layer) => layer.id === layerId);
  }

  /**
   * Refuses a layer change while a gesture is in flight.
   *
   * A layer edit at that moment could remove or reorder the layer the preview
   * is being painted into, so release would commit into a layer that is no
   * longer part of the document. Refusing is the safe no-op; the notice tells
   * the user why the click did nothing.
   *
   * The explanation is shown **once per gesture**. A slider drag that is
   * refused on every tick would otherwise raise the notice on every tick, and
   * a dismissed notice would pop back up on the next one; the refusal itself
   * is unchanged, and the explanation stays on screen until it is dismissed.
   * The next gesture may explain again.
   */
  private refuseLayerChangeDuringGesture(): boolean {
    if (!this.isGestureActive()) {
      return false;
    }
    if (!this.refusalNoticeShown) {
      this.refusalNoticeShown = true;
      this.raiseNotice(GESTURE_REFUSAL_NOTICE);
    }
    return true;
  }

  undo(): boolean {
    if (this.isGestureActive()) {
      return false;
    }
    return this.recordHistoryChange(() => {
      const changed = this.commands.undo();
      // Undoing is an action between gesture runs: a later same-keyed change
      // starts its own history entry instead of folding across the undo.
      if (changed) {
        this.commands.breakMerge();
      }
      return changed;
    });
  }

  redo(): boolean {
    if (this.isGestureActive()) {
      return false;
    }
    return this.recordHistoryChange(() => {
      const changed = this.commands.redo();
      if (changed) {
        this.commands.breakMerge();
      }
      return changed;
    });
  }

  // ----------------------------------------------------------- stroke capture

  beginStroke(sample: PointerSample): void {
    if (this.activeStroke || this.activeFill || this.activeGradient) {
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

    this.beginGesture();
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
    const stroke = createStrokeRecord(
      layerId,
      // The stamp engine draws a chain of dabs along the path; a shape is an
      // outline (and, when filled, a flat polygon), so it keeps the plain
      // segment path even when the brush is stamped.
      shapeBrush(this.brush),
      this.activeTool().erases === true,
      // Read here, at press time, so the preview and the committed stroke agree:
      // a shape keeps the fill setting it was started with. A line's definition
      // is not fillable, so the setting cannot produce a degenerate sliver.
      this.shapeFill && this.activeTool().definition.fillable === true,
    );
    stroke.startTime = sample.timeStamp;
    this.beginGesture();
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

  // -------------------------------------------------------------- bucket fill

  /**
   * Runs a contiguous flood fill at the press point.
   *
   * The region is sampled from the **merged visible composite** - paper plus
   * every visible layer at its opacity - so line art on another layer defines
   * the boundary the user sees. The committed patch is written to the **active
   * layer**, exactly like a stroke. The patch enters the layer immediately so
   * the visible pixels are the real result; `finishFill` records the history
   * step on release and `cancelFill` removes it cleanly.
   *
   * Returns whether a patch was applied. A press outside the paper, a fill that
   * would change nothing, a document too large to scan safely or an unavailable
   * renderer is a no-op with no history entry and no dirty flag.
   */
  private beginFill(sample: PointerSample): boolean {
    if (this.activeStroke || this.activeFill || this.activeGradient) {
      return false;
    }
    const layerId = this.doc.activeLayerId;
    if (!layerId) {
      return false;
    }
    if (!isInsideDocument(this.doc, sample.docX, sample.docY)) {
      return false;
    }

    const documentPixels = this.doc.width * this.doc.height;
    if (documentPixels > MAX_FILL_SCAN_PIXELS) {
      this.raiseNotice(
        `Bucket fill is limited to ${MAX_FILL_SCAN_PIXELS.toLocaleString("en-US")} document pixels; ` +
          `this document is ${this.doc.width} x ${this.doc.height}.`,
      );
      return false;
    }

    const image = this.renderer?.readCompositeImage();
    if (!image) {
      return false;
    }

    const seedX = Math.min(this.doc.width - 1, Math.max(0, Math.floor(sample.docX)));
    const seedY = Math.min(this.doc.height - 1, Math.max(0, Math.floor(sample.docY)));
    const region = floodFill(image, seedX, seedY, this.fillTolerance);
    if (!region) {
      return false;
    }

    // At tolerance 0 every selected pixel is exactly the seed colour. Painting
    // that colour back is a no-op, and recording an invisible undo step would
    // make the history button look broken.
    if (this.fillTolerance === 0) {
      const offset = (seedY * image.width + seedX) * 4;
      const colour = hexToRgb(this.brush.color);
      if (
        colour &&
        colour.r === image.data[offset] &&
        colour.g === image.data[offset + 1] &&
        colour.b === image.data[offset + 2] &&
        image.data[offset + 3] === 255
      ) {
        return false;
      }
    }

    const patch = createFillPatch(layerId, this.brush.color, region);
    const index = this.strokes.elementCount(layerId);
    this.strokes.insert(patch);
    this.beginGesture();
    this.activeFill = { patch, index };
    this.renderer?.invalidateLayer(layerId);
    this.notice = null;
    this.publish();
    this.requestRender();
    return true;
  }

  /**
   * Commits the patch applied by the press as exactly one undo step.
   *
   * The command carries the patch itself, so redo replays these pixels; it does
   * not run flood fill again against a composite that may have changed.
   */
  private finishFill(): void {
    const active = this.activeFill;
    if (!active) {
      return;
    }
    if (!this.layerExists(active.patch.layerId)) {
      // The layer disappeared mid-gesture (only possible through an external
      // document swap). Discard the preview instead of leaving an orphan patch.
      this.cancelFill();
      return;
    }
    this.activeFill = null;
    // Bumped before the command is recorded so the snapshot the stack publishes
    // already carries the dirty flag.
    this.revision += 1;
    this.commands.push(createFillCommand(active.patch, active.index, this.commandHost));
    this.publish();
  }

  /**
   * Removes an uncommitted fill, leaving the document exactly as it was.
   *
   * Used by a lost pointer capture, a tool switch and `Esc`-style aborts. No
   * history entry is recorded and the revision does not move, so a cancelled
   * fill cannot make the document dirty.
   */
  private cancelFill(): void {
    const active = this.activeFill;
    if (!active) {
      return;
    }
    this.activeFill = null;
    this.strokes.remove(active.patch.layerId, active.patch.id);
    this.renderer?.invalidateLayer(active.patch.layerId);
    this.publish();
    this.requestRender();
  }

  private raiseNotice(message: string): void {
    this.notice = message;
    this.publish();
  }

  // ---------------------------------------------------------------- gradient

  /**
   * Starts a gradient gesture and paints the first preview on the active layer.
   *
   * The press point is the start (linear) or centre (radial); movement updates
   * the record in place. Like a bucket fill, the preview is real layer content
   * but not yet history, so cancelling can remove it exactly.
   */
  private beginGradient(sample: PointerSample): boolean {
    if (this.activeStroke || this.activeFill || this.activeGradient) {
      return false;
    }
    const layerId = this.doc.activeLayerId;
    if (!layerId || !isInsideDocument(this.doc, sample.docX, sample.docY)) {
      return false;
    }

    const x = clamp(sample.docX, 0, this.doc.width);
    const y = clamp(sample.docY, 0, this.doc.height);
    const gradient = createGradientRecord(
      layerId,
      { type: this.gradientType, x1: x, y1: y, x2: x, y2: y },
      this.brush.color,
      this.gradientEndColor,
      this.brush.opacity,
    );
    const index = this.strokes.elementCount(layerId);
    this.strokes.insert(gradient);
    this.beginGesture();
    this.activeGradient = { gradient, index };
    this.renderer?.invalidateLayer(layerId);
    this.notice = null;
    this.publish();
    this.requestRender();
    return true;
  }

  /** Moves the free end of the in-progress gradient and repaints its layer. */
  private updateGradient(sample: PointerSample): void {
    const active = this.activeGradient;
    if (!active || !this.layerExists(active.gradient.layerId)) {
      return;
    }
    const next = moveGradientEnd(
      active.gradient,
      clamp(sample.docX, 0, this.doc.width),
      clamp(sample.docY, 0, this.doc.height),
    );
    if (next === active.gradient) {
      return;
    }
    this.strokes.replace(next);
    active.gradient = next;
    this.renderer?.invalidateLayer(next.layerId);
    this.publish();
    this.requestRender();
  }

  /**
   * Commits the preview as one undoable step. A drag shorter than
   * `MIN_GRADIENT_LENGTH` has no direction, so it is cancelled rather than
   * recorded as an invisible history entry.
   */
  private finishGradient(sample: PointerSample): void {
    const current = this.activeGradient;
    if (!current) {
      return;
    }
    if (!this.layerExists(current.gradient.layerId)) {
      // Same defensive path as a fill: never record geometry into a layer that
      // is no longer in the document.
      this.cancelGradient();
      return;
    }
    this.updateGradient(sample);
    const active = this.activeGradient;
    if (!active) {
      return;
    }
    if (gradientIsDegenerate(active.gradient)) {
      this.cancelGradient();
      return;
    }
    this.activeGradient = null;
    this.revision += 1;
    this.commands.push(
      createGradientCommand(active.gradient, active.index, this.commandHost),
    );
    this.publish();
  }

  /** Removes an uncommitted gradient without history or a dirty revision. */
  private cancelGradient(): void {
    const active = this.activeGradient;
    if (!active) {
      return;
    }
    this.activeGradient = null;
    this.strokes.remove(active.gradient.layerId, active.gradient.id);
    this.renderer?.invalidateLayer(active.gradient.layerId);
    this.publish();
    this.requestRender();
  }

  finishStroke(): void {
    const builder = this.strokeBuilder;
    const stroke = this.activeStroke;
    this.strokeBuilder = null;
    this.activeStroke = null;
    if (!stroke) {
      return;
    }

    if (!this.layerExists(stroke.layerId)) {
      // A layer mutation is refused during a gesture, so this is a last-resort
      // guard for an external document swap: discard the preview rather than
      // inserting its samples into a layer that no longer exists.
      this.renderer?.cancelStroke();
      this.publish();
      return;
    }

    if (builder) {
      // A stabilized stroke ends where the pointer was released: `finish()`
      // appends that raw point so the settled segment is previewed and then
      // committed like any other sample.
      const fromIndex = builder.pointCount;
      builder.finish();
      if (builder.pointCount > fromIndex) {
        this.renderer?.extendStroke(stroke, fromIndex);
      }
    }

    this.renderer?.endStroke(stroke);
    const index = this.strokes.elementCount(stroke.layerId);
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

  /**
   * The transform handle a press grabs, or `null` when it grabs none.
   *
   * The grab radius is screen-space, so the engine converts it with the live
   * zoom: a handle is equally easy to grab at 2 % and at 6400 %. There are no
   * handles without a selection, so a press on empty canvas never starts a
   * transform by accident.
   */
  findSelectionHandleAt(docX: number, docY: number): SelectionHandleId | null {
    const handles = this.selectionHandleLayout(this.selectionBounds());
    if (!handles) {
      return null;
    }
    return findSelectionHandle(handles, docX, docY, this.handleGrabRadius());
  }

  /** Drops the selection and its overlay. Not an edit: nothing enters history. */
  clearSelection(): void {
    this.cancelSelectionGesture();
    this.commands.breakMerge();
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
    const layer = this.strokes.listElements(selection.layerId);
    for (let index = 0; index < layer.length; index += 1) {
      const element = layer[index];
      if (isStroke(element) && wanted.has(element.id)) {
        entries.push({ stroke: element, index });
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
    if (this.activeStroke || this.activeFill || this.activeGradient || this.selectionGesture) {
      return false;
    }
    const selection = this.selection;
    if (!selection) {
      return false;
    }
    const wanted = new Set(selection.strokeIds);
    const layer = this.strokes.listElements(selection.layerId);
    const entries: DuplicateEntry[] = [];
    for (let index = 0; index < layer.length; index += 1) {
      const source = layer[index];
      if (isStroke(source) && wanted.has(source.id)) {
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

  /**
   * Scales the selection about the centre of its frame.
   *
   * The same coordinate map the corner handle writes, with the factor
   * supplied instead of dragged: a uniform scale about the centre of the
   * selection's frame, clamped exactly as a drag's factor is, so a selection
   * can never collapse or invert.
   *
   * The factor is **relative**. A factor of 1.5 makes the selection one and a
   * half times as large; applying it again makes it two and a quarter times as
   * large. It is not a target size, because the transform does not remember
   * what the selection used to be, and a target could not be honoured.
   *
   * The brush is not scaled with the geometry: the transform moves the
   * strokes' samples and nothing else, so a scaled stroke is the same stroke
   * drawn along a different path.
   *
   * Returns false when there is nothing to scale - no selection, a gesture in
   * flight, or a transform that would move nothing - so the selection and the
   * history are left alone.
   */
  scaleSelection(factor: number): boolean {
    const entries = this.beginSelectionEdit();
    if (!entries) {
      return false;
    }
    const bounds = boundsOfStrokes(entries.map((entry) => entry.stroke));
    if (!bounds) {
      return false;
    }
    const transform = createScaleTransform(
      boundsCentre(bounds),
      factor,
      `Scale ${Math.round(factor * 100)}%`,
    );
    // A single dab, or a selection already at the centre, maps onto itself:
    // nothing to record.
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

  /**
   * Turns the selection about the centre of its frame.
   *
   * The same coordinate map the rotation handle writes, with the angle
   * supplied instead of dragged. A **positive angle turns the content
   * clockwise**, because the document's y axis points down.
   *
   * The angle is **not** snapped here: a fixed step is already a step, and
   * snapping it again would only risk moving it. It is also not measured from
   * a press, because there is no press.
   *
   * Note what an inverse of this operation is *not*: the turn moves the
   * selection's frame - the axis-aligned envelope of a turned selection is
   * not centred on the point it turned around - so a second turn is about the
   * new frame's centre, not the first one's. Turning back by the same angle
   * is therefore not a round trip. Undo is the exact inverse, because it
   * restores the stored originals.
   *
   * Returns false when there is nothing to turn - no selection, a gesture in
   * flight, or a turn that would move nothing, such as a turn of a selection
   * that is already symmetric about its centre.
   */
  rotateSelection(degrees: number): boolean {
    const entries = this.beginSelectionEdit();
    if (!entries) {
      return false;
    }
    const bounds = boundsOfStrokes(entries.map((entry) => entry.stroke));
    if (!bounds) {
      return false;
    }
    const radians = (degrees * Math.PI) / 180;
    const transform = createRotateTransform(
      boundsCentre(bounds),
      radians,
      `Rotate ${degrees}°`,
    );
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
    this.beginGesture();
    this.selectionGesture = {
      mode: "marquee",
      anchor: { x: sample.docX, y: sample.docY },
      bounds: { x: sample.docX, y: sample.docY, width: 0, height: 0 },
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
    this.beginGesture();
    this.selectionGesture = {
      mode: "move",
      anchor: { x: sample.docX, y: sample.docY },
      entries,
      dx: 0,
      dy: 0,
    };
  }

  /**
   * Starts a scale or a rotation, from the handle the press grabbed.
   *
   * The frame is captured **now**, and it is the frame the transform is about:
   * the centre of that frame is the point the content turns or grows around,
   * and the corner the press grabbed is the point the scale is measured
   * against. Neither may move while the drag runs, or the content would drift
   * under the pointer.
   *
   * As with the move, each selected stroke's coordinates are copied up front:
   * the copies are the live preview's reference and, on release, the history
   * command's revert value. A transform moves the samples and nothing else -
   * the brush, the colour, the opacity and the pressure are untouched - so a
   * scaled stroke is still an ordinary stroke.
   */
  private beginSelectionTransform(sample: PointerSample, handle: SelectionHandleId): void {
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
    const frame = this.selectionBounds();
    if (!frame) {
      return;
    }
    const handles = selectionHandles(frame, this.rotationHandleOffset());
    if (!handles) {
      // A frame with no area has no corner to pull and no direction to turn
      // around, so there is nothing to transform.
      return;
    }
    const centre = boundsCentre(frame);
    const pointer = { x: sample.docX, y: sample.docY };
    this.beginGesture();
    if (handle === "rotate") {
      this.selectionGesture = {
        mode: "rotate",
        entries,
        centre,
        handle,
        press: pointer,
        angle: 0,
        pointer,
      };
      return;
    }
    const corner = cornerOf(handles, handle);
    if (!corner) {
      return;
    }
    this.selectionGesture = {
      mode: "scale",
      entries,
      centre,
      corner,
      handle,
      press: pointer,
      factor: 1,
      pointer,
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
   *
   * A scale and a rotation write the transform's map over the same copies, so
   * the preview is the committed result: the transform is always recomputed
   * from the originals, never from the current state, and it cannot drift.
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

    if (gesture.mode === "scale") {
      const pointer = { x: sample.docX, y: sample.docY };
      // Measured from where the press landed: the pointer may be up to a grab
      // radius off the handle, and an absolute reading would jump the content
      // at the press.
      const factor = clampScaleFactor(
        scaleFactorFrom(gesture.centre, gesture.corner, gesture.press, pointer),
      );
      gesture.pointer = pointer;
      if (factor === gesture.factor) {
        return;
      }
      gesture.factor = factor;
      this.applyTransformGesture(gesture.entries, createScaleTransform(gesture.centre, factor));
      return;
    }

    if (gesture.mode === "rotate") {
      const pointer = { x: sample.docX, y: sample.docY };
      // The turn since the press, not the pointer's angle: a press that missed
      // the handle must not turn the content.
      const turn = rotationAngleFrom(gesture.centre, gesture.press, pointer);
      // The snap is on by default and Shift turns it **off**, so the user can
      // turn freely when the 15 degree steps get in the way.
      const angle = sample.modifiers.shift ? turn : snapRotationAngle(turn);
      gesture.pointer = pointer;
      if (angle === gesture.angle) {
        return;
      }
      gesture.angle = angle;
      this.applyTransformGesture(gesture.entries, createRotateTransform(gesture.centre, angle));
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
   * Writes a transform's map over the gesture's copies and repaints.
   *
   * The map runs over the **originals**, so the preview is always the result
   * the history command would produce and repeated pointer moves cannot
   * compound a rounding error.
   */
  private applyTransformGesture(
    entries: readonly MoveEntry[],
    transform: SampleTransform,
  ): void {
    for (const entry of entries) {
      transformStrokeSamples(entry.stroke, entry.original, transform);
    }
    this.refreshStrokeLayers(entries);
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
   *
   * A scale and a rotation record one history step too, and only when they
   * moved something: a turn of a symmetric selection, or a scale of a single
   * dab, maps every sample onto itself, and an undo step whose undo does
   * nothing reads as a broken undo button.
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

    if (gesture.mode === "scale" || gesture.mode === "rotate") {
      const transform =
        gesture.mode === "scale"
          ? createScaleTransform(gesture.centre, gesture.factor)
          : createRotateTransform(gesture.centre, gesture.angle);
      if (!transformChangesSamples(gesture.entries, transform)) {
        this.syncSelectionOverlay();
        this.requestRender();
        return;
      }
      this.revision += 1;
      this.commands.push(
        createTransformStrokesCommand(gesture.entries, transform, this.commandHost),
      );
      this.publish();
      this.syncSelectionOverlay();
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
   * there is nothing to put back. A move, a scale and a rotation restore every
   * stroke's original coordinates and re-rasterize, which is exact because the
   * originals were copied rather than derived. A cancelled transform records
   * nothing at all.
   */
  private cancelSelection(): void {
    const gesture = this.selectionGesture;
    if (!gesture) {
      return;
    }
    this.selectionGesture = null;
    if (gesture.mode !== "marquee") {
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
    this.commands.breakMerge();
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
    if (this.activeStroke || this.activeFill || this.activeGradient || this.selectionGesture) {
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
   *
   * The transform **handles** come with it. They belong to the **committed
   * selection**, never to the marquee's rubber band: while a band is being
   * dragged the overlay shows the band, and the handles appear only for a real
   * selection - on the frame derived from the strokes, so after a transform
   * they sit on the selection's new corners. While a transform gesture runs,
   * the handle the pointer grabbed follows the pointer, which is what makes
   * the drag feel attached to the cursor.
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
    // The committed selection's own frame. It is the frame the handles belong
    // to, and it is not the rubber band.
    const selectionFrame = boundsOfStrokes(strokes);
    renderer.setSelection({
      bounds: marquee ?? selectionFrame,
      strokes,
      handles: marquee === null ? this.selectionHandleLayout(selectionFrame) : null,
    });
  }

  /**
   * The transform handles of the current selection, in document space.
   *
   * There are none without a selection, and none for a frame with no area: a
   * single point has no corner to pull and no direction to turn around.
   */
  private selectionHandleLayout(bounds: Bounds | null): SelectionHandles | null {
    if (!bounds) {
      return null;
    }
    const handles = selectionHandles(bounds, this.rotationHandleOffset());
    if (!handles) {
      return null;
    }
    const gesture = this.selectionGesture;
    if (!gesture || (gesture.mode !== "scale" && gesture.mode !== "rotate")) {
      return handles;
    }
    // The grabbed handle follows the pointer while the drag runs.
    if (gesture.mode === "rotate") {
      return { corners: handles.corners, rotate: gesture.pointer };
    }
    const ids: SelectionHandleId[] = ["scale-nw", "scale-ne", "scale-se", "scale-sw"];
    const index = ids.indexOf(gesture.handle);
    if (index < 0) {
      return handles;
    }
    const corners = [...handles.corners];
    corners[index] = gesture.pointer;
    return { corners, rotate: handles.rotate };
  }

  /** The rotation handle's distance above the frame, in document units. */
  private rotationHandleOffset(): number {
    const zoom = this.viewport.zoom;
    if (!Number.isFinite(zoom) || zoom <= 0) {
      return ROTATION_HANDLE_OFFSET_PX;
    }
    return ROTATION_HANDLE_OFFSET_PX / zoom;
  }

  /** The grab radius of a handle, in document units. */
  private handleGrabRadius(): number {
    const zoom = this.viewport.zoom;
    if (!Number.isFinite(zoom) || zoom <= 0) {
      return HANDLE_GRAB_RADIUS_PX;
    }
    return HANDLE_GRAB_RADIUS_PX / zoom;
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

  // ------------------------------------------------------- composition guides

  /**
   * The guide a press grabs, or `null` when it grabs none.
   *
   * The grab radius is screen-space, so it is converted with the live zoom:
   * a guide is equally easy to hit at 2 % and at 6400 %.
   */
  findGuideAt(docX: number, docY: number): Guide | null {
    return findGuideAt(this.doc.guides, docX, docY, this.viewport.zoom);
  }

  /**
   * Starts creating a guide at the press point.
   *
   * The axis is not decided yet: it comes from the direction the pointer
   * travels, which only the drag knows. The guide's position is the *press*
   * coordinate along that axis, so it marks where the user started rather than
   * where they let go.
   */
  beginGuideCreate(sample: PointerSample): void {
    if (!Number.isFinite(sample.docX) || !Number.isFinite(sample.docY)) {
      return;
    }
    this.abortGuideGesture();
    this.beginGesture();
    this.guideGesture = {
      mode: "create",
      before: this.doc,
      pressX: sample.docX,
      pressY: sample.docY,
      guideId: null,
      createdId: null,
    };
  }

  /**
   * Puts the new guide on the canvas, on the axis the drag chose.
   *
   * The axis is fixed at creation: a guide never changes the axis it was
   * created on, because that would silently invalidate the user's mental model
   * of where the marker sits. A guide that would land on top of an existing
   * one is refused instead - two guides on the same spot are pointless, and
   * the drag simply does nothing.
   */
  setGuideAxis(axis: GuideAxis): void {
    const gesture = this.guideGesture;
    if (!gesture || gesture.mode !== "create" || gesture.createdId !== null) {
      return;
    }
    const position = roundGuidePosition(
      axis === "vertical" ? gesture.pressX : gesture.pressY,
    );
    if (isDuplicateGuide(this.doc.guides, axis, position)) {
      return;
    }
    const guide: Guide = { id: createId("guide"), axis, position };
    gesture.createdId = guide.id;
    this.applyDocumentState(addGuideToDocument(this.doc, guide));
  }

  /** Starts moving an existing guide along its own axis. */
  beginGuideMove(guide: Guide): void {
    this.abortGuideGesture();
    this.beginGesture();
    this.guideGesture = {
      mode: "move",
      before: this.doc,
      pressX: 0,
      pressY: 0,
      guideId: guide.id,
      createdId: null,
    };
  }

  /**
   * Moves the guide of a move gesture to follow the pointer.
   *
   * Only the coordinate across the guide's axis matters: a vertical guide
   * follows x and ignores y, so it stays a vertical guide. A move that would
   * land on another guide is refused, like a create that would.
   */
  moveGuideTo(sample: PointerSample): void {
    const gesture = this.guideGesture;
    if (!gesture || gesture.mode !== "move" || gesture.guideId === null) {
      return;
    }
    if (!Number.isFinite(sample.docX) || !Number.isFinite(sample.docY)) {
      return;
    }
    const guide = findGuide(this.doc.guides, gesture.guideId);
    if (!guide) {
      return;
    }
    const position = roundGuidePosition(
      guide.axis === "vertical" ? sample.docX : sample.docY,
    );
    if (position === guide.position) {
      return;
    }
    if (isDuplicateGuide(this.doc.guides, guide.axis, position, guide.id)) {
      return;
    }
    this.applyDocumentState(setGuidePosition(this.doc, guide.id, position));
  }

  /**
   * Commits the guide gesture as one undoable step.
   *
   * A gesture that changed nothing - a click on empty canvas, or a drag that
   * ended where it started - commits nothing at all, so history never holds a
   * step that appears to do nothing.
   */
  finishGuideGesture(): void {
    const gesture = this.guideGesture;
    if (!gesture) {
      return;
    }
    this.guideGesture = null;
    const after = this.doc;
    if (after === gesture.before || guidesEqual(gesture.before.guides, after.guides)) {
      // Nothing changed: a click on empty canvas, or a drag that ended where
      // it started. No history entry, so history never holds a step that
      // appears to do nothing.
      return;
    }
    if (gesture.mode === "create") {
      this.commitDocumentChange("Add Guide", gesture.before, after);
      return;
    }
    this.commitDocumentChange("Move Guide", gesture.before, after, {
      mergeKey: gesture.guideId === null ? undefined : `guide-move:${gesture.guideId}`,
    });
  }

  /**
   * Aborts the guide gesture, restoring the document.
   *
   * The guide returns to the position it had before the gesture, or
   * disappears when the gesture created it. Nothing entered history, so
   * nothing has to be taken out of it.
   *
   * The tool owns its gesture bookkeeping, so it is told as well: a cancel
   * that comes from outside the pointer pipeline - the `Esc` key - would
   * otherwise leave the tool believing a drag is still in flight, and it
   * would swallow the next press.
   */
  cancelGuideGesture(): void {
    this.abortGuideGesture();
    this.tools.guides.reset(this.toolContext);
  }

  /**
   * Clears an in-flight guide gesture without telling the tool.
   *
   * Used when a *new* gesture starts: the tool is already running that
   * gesture, and resetting it here would cancel the one being started.
   */
  private abortGuideGesture(): void {
    const gesture = this.guideGesture;
    if (!gesture) {
      return;
    }
    this.guideGesture = null;
    this.applyDocumentState(gesture.before);
  }

  /**
   * Selects a guide, or clears the selection with `null`.
   *
   * The selection belongs to the guides tool: it is editor state, not document
   * state, and it is dropped when the tool is left. Selecting also ends the
   * current history merge run, so two drags of the same guide are two undo
   * steps rather than one.
   */
  selectGuide(guideId: string | null): void {
    this.commands.breakMerge();
    if (this.selectedGuideId === guideId) {
      this.publish();
      return;
    }
    this.selectedGuideId = guideId;
    this.renderer?.setSelectedGuide(guideId);
    this.publish();
    this.requestRender();
  }

  /**
   * Removes the selected guide as one undoable step.
   *
   * Returns whether a guide was removed, so a caller can tell a no-op (no
   * guide is selected) from a deletion.
   */
  deleteSelectedGuide(): boolean {
    const guideId = this.selectedGuideId;
    if (guideId === null) {
      return false;
    }
    const before = this.doc;
    const after = removeGuideFromDocument(before, guideId);
    if (after === before) {
      return false;
    }
    this.clearGuideSelection();
    this.commitDocumentChange("Delete Guide", before, after);
    return true;
  }

  /** Forgets the guide selection, e.g. when the guides tool is left. */
  private clearGuideSelection(): void {
    if (this.selectedGuideId === null) {
      return;
    }
    this.selectedGuideId = null;
    this.renderer?.setSelectedGuide(null);
  }

  /**
   * Aborts a guide gesture and forgets the guide selection.
   *
   * Used where the document is being replaced: the gesture's preview goes
   * with the document, so there is nothing to restore. The tool is reset as
   * well, so it cannot keep believing a drag is in flight.
   */
  private resetGuideGesture(): void {
    this.guideGesture = null;
    this.clearGuideSelection();
    this.tools.guides.reset(this.toolContext);
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
      readonly removedElements?: ElementTransfer;
      readonly addedElements?: ElementTransfer;
      readonly preserveActiveLayer?: boolean;
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
    // A guide that no longer exists cannot stay selected: an undo that removed
    // it, or a document that was replaced.
    if (
      this.selectedGuideId !== null &&
      !next.guides.some((guide) => guide.id === this.selectedGuideId)
    ) {
      this.clearGuideSelection();
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
    // A file written while a guide drag was in flight holds the *preview*,
    // not the document: the picture on disk and the picture in the editor can
    // differ, so the file cannot be called clean until it is written again.
    const dirty = this.revision !== this.savedRevision || this.fileHoldsPreview;
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
      cursor: this.cursorFor(sample.docX, sample.docY),
    };
    this.emitCursor(this.cursor);
  }

  /**
   * The CSS cursor to show at a document position.
   *
   * The tool's own cursor, except under the select tool's transform handles:
   * a corner handle asks for the diagonal resize cursor and the rotation
   * handle for a grab cursor, which is what tells the user that the press
   * will transform rather than move. While a transform gesture runs the
   * grabbed handle keeps its cursor, so it does not flicker when the pointer
   * leaves the handle.
   */
  private cursorFor(docX: number, docY: number): string {
    const tool = this.activeTool();
    if (this.currentToolId !== "select") {
      return tool.cursor;
    }
    const gesture = this.selectionGesture;
    if (gesture?.mode === "scale" || gesture?.mode === "rotate") {
      return HANDLE_CURSORS[gesture.handle];
    }
    const handle = this.findSelectionHandleAt(docX, docY);
    return handle === null ? tool.cursor : HANDLE_CURSORS[handle];
  }

  /**
   * Re-emits the cursor after a viewport change.
   *
   * The pointer has not moved, but the viewport has: the document point under
   * it is a different one now, and so is the answer to "is a handle under the
   * pointer?". A zoom moves the handles, so a cursor that still claimed a
   * resize cursor would be lying. Both the position and the cursor are
   * therefore recomputed from the pointer's *screen* position.
   */
  private republishCursor(): void {
    const cursor = this.cursor;
    if (!cursor) {
      return;
    }
    const doc = screenToDoc(this.viewport, cursor.screenX, cursor.screenY);
    this.cursor = {
      ...cursor,
      docX: doc.x,
      docY: doc.y,
      cursor: this.cursorFor(doc.x, doc.y),
    };
    this.emitCursor(this.cursor);
  }

  private emitCursor(report: CursorReport): void {
    for (const listener of this.cursorListeners) {
      listener(report);
    }
  }

  private abortStroke(): void {
    if (this.activeGradient) {
      this.cancelGradient();
    }
    if (this.activeFill) {
      this.cancelFill();
    }
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
      selectedGuideId: this.selectedGuideId,
      shapeFill: this.shapeFill,
      shapeSides: this.shapeSides,
      shapeInnerRatio: this.shapeInnerRatio,
      shapeRotation: this.shapeRotation,
      fillTolerance: this.fillTolerance,
      gradientType: this.gradientType,
      gradientEndColor: this.gradientEndColor,
      notice: this.notice,
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
      previous.selectedStrokes === next.selectedStrokes &&
      previous.selectedGuideId === next.selectedGuideId &&
      previous.shapeFill === next.shapeFill &&
      previous.shapeSides === next.shapeSides &&
      previous.shapeInnerRatio === next.shapeInnerRatio &&
      previous.shapeRotation === next.shapeRotation &&
      previous.fillTolerance === next.fillTolerance &&
      previous.gradientType === next.gradientType &&
      previous.gradientEndColor === next.gradientEndColor &&
      previous.notice === next.notice
    ) {
      return;
    }
    this.store.setState(next);
  }
}
