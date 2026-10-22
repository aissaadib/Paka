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
import type { Bounds, Point, Size } from "../../types/geometry";
import type { CursorReport, PointerSample } from "../../types/pointer";
import type { ToolId } from "../../types/tool";
import type { FlipAxis } from "../../types/transform";
import type { ViewId, Viewport } from "../../types/viewport";
import { hexToRgb, rgbToHex, type Rgb } from "../../utils/color";
import { createId } from "../../utils/id";
import { clamp } from "../../utils/math";
import { createStore, type Listener, type Store } from "../../utils/store";
import { DEFAULT_BRUSH, DEFAULT_SECONDARY_COLOR, brushSettingsEqual, normalizeBrush, updateBrushSettings } from "../brushes/defaults";
import { type BrushCursorReport } from "../brushes/brushCursor";
import {
  brushSizeFromDrag,
  shouldStartBrushSizeGesture,
} from "../brushes/brushSizeGesture";
import {
  brushPresetsEqual,
  createPresetId,
  duplicatePreset,
  importPreset,
  isBundledPreset,
  mergeBundledPresets,
  normalizeBrushPresets,
  normalizePresetName,
  uniquePresetName,
  type BrushPreset,
} from "../brushes/presets";
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
import { createGroupCommand } from "../commands/groupCommand";
import * as documentOps from "../document/document";
import {
  DEFAULT_GRID_SETTINGS,
  normalizeGridSpacing,
  snapDocumentPoint,
} from "../document/grid";
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
  DEFAULT_SYMMETRY_SETTINGS,
  createSymmetryCopies,
  isOnSymmetryCenter,
  normalizeSymmetryCount,
  normalizeSymmetryMode,
  type SymmetryMode,
  type SymmetrySettings,
} from "../document/symmetry";
import {
  DEFAULT_RULER_SETTINGS,
  rulerAxisAt,
} from "../rendering/rulers";
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
  GradientStop,
  Guide,
  GuideAxis,
  LayerBlendMode,
  LayerElement,
  LayerId,
  StrokeRecord,
} from "../document/types";
import { isFillPatch, isGradient, isStroke } from "../document/types";
import { cloneFillPatch, createFillPatch } from "../fill/fillPatch";
import { MAX_FILL_SCAN_PIXELS } from "../fill/floodFill";
import { scanFill, type FillScanResult } from "../fill/fillScan";
import {
  DEFAULT_FILL_ANTIALIAS,
  DEFAULT_FILL_CLOSE_GAPS,
  DEFAULT_FILL_EXPAND,
  DEFAULT_FILL_REFERENCE,
  fillReferenceLayers,
  normalizeFillAntialias,
  normalizeFillCloseGaps,
  normalizeFillExpand,
  normalizeFillReference,
  type FillReferenceMode,
} from "../fill/fillOptions";
import {
  DEFAULT_GRADIENT_END_COLOR,
  cloneGradient,
  createGradientRecord,
  gradientIsDegenerate,
  gradientStopsEqual,
  moveGradientEnd,
  normalizeGradientMidStops,
} from "../gradient/gradientRecord";
import {
  GRADIENT_HANDLE_CURSORS,
  GRADIENT_HANDLE_GRAB_RADIUS_PX,
  findGradientHandle,
  gradientGeometryEqual,
  gradientGeometryHit,
  gradientHandles,
  moveGradientHandle,
  type GradientHandleId,
} from "../gradient/gradientHandles";
import {
  createGradientEditCommand,
  type GradientEditHost,
} from "../commands/gradientEditCommand";
import {
  CanvasInputBinder,
  type CanvasInputHandlers,
  type WheelInput,
} from "../input/canvasInputBinder";
import { CLICK_SLOP_PX } from "../input/clickGesture";
import { toStrokeSample } from "../input/pointer";
import { surfaceOwnsInteraction } from "../input/ownership";
import { serializeProject, type ParsedProject } from "../project/projectFormat";
import type {
  ReferenceImage,
  ReferenceOverlayItem,
  ReferenceSource,
} from "../reference/types";
import { Canvas2DRenderer } from "../rendering/Canvas2DRenderer";
import { strokeDiameter } from "../rendering/canvas2dStroke";
import type { DrawingRenderer, StrokeSource } from "../rendering/types";
import {
  DEFAULT_VIEW_TRANSFORM,
  ZOOM_STEP,
  centerOn,
  docToScreen,
  fitToViewport,
  panBy,
  resetView,
  rotateView,
  screenToDoc,
  toggleViewMirror,
  viewTransformOf,
  zoomAt,
  zoomToAt,
} from "../rendering/viewport";
import { createToolRegistry, type ToolRegistry } from "../tools/toolRegistry";
import {
  CanvasViewRegistry,
  PRIMARY_VIEW_ID,
  SECONDARY_VIEW_ID,
  createCanvasView,
  sameViewSummaries,
  type CanvasView,
  type ViewSummary,
} from "./canvasViews";
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
  /**
   * The CSS size of the **active** view's surface, in canvas pixels.
   *
   * The viewport transform alone does not say what the canvas is showing: the
   * visible document area also depends on how big the surface is. A navigator
   * needs both to draw the rectangle that marks the visible area.
   *
   * It is the *active* view's size, because the viewport beside it is the
   * active view's too: the two always describe the same window.
   */
  readonly viewportSize: Size;
  /**
   * The views open over the document.
   *
   * A view is a window on the document, not a copy of it: the artwork, the
   * history and the dirty flag are shared by all of them. What a view owns is
   * its transform - its zoom, its pan, its rotation and its mirror.
   */
  readonly views: readonly ViewSummary[];
  /**
   * The view the commands act on.
   *
   * The active view is the one the user is working in: a press in a view
   * focuses it, and the zoom, the fit and the rotation then turn that view.
   */
  readonly activeViewId: ViewId;
  /**
   * Whether the second view of the canvas is open.
   *
   * Editor state, like the grid: the second view is a way of looking at the
   * document, not part of it, so it never reaches a project file and never
   * makes the drawing unsaved.
   */
  readonly secondaryViewOpen: boolean;
  readonly brush: BrushSettings;
  /**
   * The colour a right-button stroke paints with.
   *
   * Editor state: a right-button gesture resolves its colour at press time and
   * stores it on the committed stroke, so changing this never repaints existing
   * artwork and the choice is not part of the project file.
   */
  readonly secondaryColor: string;
  /**
   * The named brush presets: the ones the user saved and the built-in ones.
   *
   * Editor preference, like the brush itself: applying, saving, renaming or
   * deleting a preset never touches the document, the revision or history.
   * The settings store persists the list.
   */
  readonly presets: readonly BrushPreset[];
  /**
   * The preset the active brush was applied from, or `null` when the brush is
   * not based on a preset.
   *
   * Editor state, like `presets`: it says where the brush came from, not what
   * it holds now. The brush may have been edited since the preset was
   * applied, and the two are deliberately kept apart: `activePresetId` is the
   * preset's defaults, `brush` is the edited values the next stroke uses.
   * The panel, the preview and the reset button all read them from here, so
   * they cannot disagree about which preset is in effect.
   */
  readonly activePresetId: string | null;
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
   * The gradient the gradient tool has selected, or `null`.
   *
   * Editor state, like `selectedGuideId`: the gradient itself is document
   * content and travels with the document, but which one is selected - and
   * which of its handles the arrow keys would move - belongs to the tool that
   * owns the selection. The overlay that shows it is drawn by the renderer.
   */
  readonly selectedGradient: SelectedGradientState | null;
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
   * What the bucket measures its region against: the merged visible
   * composite, the active layer alone, or one chosen layer.
   *
   * Editor state, like `fillTolerance`: a committed fill stores the pixels it
   * painted, so changing the reference never rewrites one.
   */
  readonly fillReference: FillReferenceMode;
  /**
   * The layer the bucket samples in the `layer` reference mode, or `null`.
   *
   * Editor state, and never serialized: a layer belongs to a document, while
   * this option has to survive a restart.
   */
  readonly fillReferenceLayerId: LayerId | null;
  /**
   * How far the bucket grows (positive) or shrinks (negative) the region it
   * found, in document pixels. Editor state, like `fillTolerance`.
   */
  readonly fillExpand: number;
  /**
   * How wide the bucket's soft edge is, in document pixels. Editor state, like
   * `fillTolerance`.
   */
  readonly fillAntialias: number;
  /**
   * How wide a passage the bucket seals, in document pixels, so the fill
   * cannot leak through a break in the line art. Editor state, like
   * `fillTolerance`.
   */
  readonly fillCloseGaps: number;
  /**
   * Gradient shape the next drag commits. Editor state: it describes the next
   * gradient, while a committed gradient carries its own geometry.
   */
  readonly gradientType: "linear" | "radial";
  /** End colour of the next gradient; its start is the current brush colour. */
  readonly gradientEndColor: string;
  /**
   * Middle stops of the next gradient, sorted strictly between the endpoints.
   *
   * Editor state like the end colour: a committed gradient carries its own
   * stops, so changing this never edits an existing gradient.
   */
  readonly gradientMidStops: readonly GradientStop[];
  /**
   * Whether the grid is drawn.
   *
   * Editor state, like the guides: the grid is a display aid, not document
   * content, so it never reaches a layer surface, an export or the project
   * file. Off by default.
   */
  readonly gridVisible: boolean;
  /** Distance between grid lines, in document pixels. */
  readonly gridSpacing: number;
  /**
   * Whether a drawing sample snaps to the guides and the grid.
   *
   * Editor state: it changes where the *next* sample lands, not where the
   * committed strokes already are. Off by default.
   */
  readonly gridSnapping: boolean;
  /**
   * Whether the ruler strips are drawn.
   *
   * Editor state, like the grid: the rulers measure the view, not the
   * document, so they never reach a layer surface, an export or the project
   * file. Off by default.
   */
  readonly rulersVisible: boolean;
  /**
   * Whether the next stroke is repeated around the symmetry centre.
   *
   * Editor state, like the grid: it describes the *next* stroke, and the
   * copies it produces are ordinary strokes in the document. Off by default.
   */
  readonly symmetryEnabled: boolean;
  /** Which symmetry the copies use. */
  readonly symmetryMode: SymmetryMode;
  /** How many copies the radial symmetry draws (`2..12`). */
  readonly symmetryCount: number;
  /** The symmetry centre, in document pixels. */
  readonly symmetryCenter: Point;
  /**
   * True while the symmetry centre is being dragged.
   *
   * Editor state, like the centre itself: the drag moves the centre, and the
   * escape key abandons it.
   */
  readonly symmetryDragging: boolean;
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

/**
 * A cached overview of the document, and the state it was made from.
 *
 * The overview is only rebuilt when the document changed or the requested size
 * changed, so a pan, a zoom or a redraw of the panel costs nothing.
 */
interface OverviewCache {
  /** The document the overview was made from, by identity. */
  readonly document: DrawingDocument;
  /** The revision of that document. */
  readonly revision: number;
  readonly width: number;
  readonly height: number;
  readonly canvas: HTMLCanvasElement;
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
  /**
   * The reference images the artist keeps beside the canvas.
   *
   * The engine never owns the references and never holds a bitmap: it asks the
   * source for the overlay it paints and for the pixel under the pointer, and
   * it tells the source how big the workspace is. A reference is not document
   * content, so nothing about it reaches the document, the history or a file.
   */
  readonly referenceSource?: ReferenceSource | null;
  /**
   * True when another surface owns the interaction.
   *
   * The quick-resize gesture must not be taken away from a field the user is
   * typing in, so the engine asks before it claims a press. The default reads
   * the focused element; a caller that knows more (an open dialog, a panel
   * being dragged) can say so here.
   */
  readonly interactionBlocked?: () => boolean;
}

const DEFAULT_DOCUMENT_WIDTH = 1600;
const DEFAULT_DOCUMENT_HEIGHT = 1200;
/** Wheel delta to zoom factor conversion (natural-exponential). */
const WHEEL_ZOOM_SENSITIVITY = 0.0018;
const WHEEL_ZOOM_FACTOR_LIMIT = 0.25;

/**
 * The tools whose samples follow the guides and the grid while snapping is on.
 *
 * Snapping is a drawing aid: it moves the samples a tool commits, so a stroke's
 * samples land on the grid lines, a shape's corners sit on them and a gradient
 * starts and ends on them.
 *
 * It is applied to every tool that commits drawing samples - the brush, the
 * eraser, the shape tools, the line and the gradient - so "the sample I drew"
 * and "the sample that was committed" agree. It is not applied to the bucket
 * and the colour picker, whose presses read pixels rather than place geometry,
 * nor to the select, guides and pan tools, whose gestures do not commit
 * drawing samples at all.
 *
 * The snap is a *magnet* with a small screen-space radius (6 CSS pixels), not
 * a lattice lock: a sample that is nowhere near a target keeps its position,
 * so a freehand stroke is only nudged where it passes a line it would have
 * crossed anyway.
 */
const SNAPPING_TOOL_IDS: ReadonlySet<ToolId> = new Set<ToolId>([
  "brush",
  "eraser",
  "line",
  "rectangle",
  "ellipse",
  "polygon",
  "star",
  "gradient",
]);

/**
 * Shown when a layer operation is refused because a pointer gesture is still
 * in flight. One explanation per gesture is enough; see
 * `refuseLayerChangeDuringGesture`.
 */
const GESTURE_REFUSAL_NOTICE =
  "Finish the current stroke, selection or guide drag before changing layers.";

/**
 * The cursor the picker shows over a reference image.
 *
 * The magnifier, because that is what a press there does: it looks closely at
 * one pixel of the reference and takes its colour. The picker's own crosshair
 * is kept for the artwork, so the two are told apart at a glance.
 */
const REFERENCE_SAMPLE_CURSOR = "zoom-in";

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
 * A symmetry centre being dragged.
 *
 * The centre is **editor state**: it is not part of the document, so moving it
 * is not an edit and enters no history. The gesture is kept only so a cancel
 * can put the centre back where it was.
 */
interface SymmetryCenterGesture {
  /** The centre as it was before the drag. */
  readonly before: Point;
}

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
 * A gradient handle drag in flight.
 *
 * The committed record is kept so a cancel can restore it **exactly**, and the
 * preview record is kept so the release can commit it as one history step.
 * Nothing enters history while the drag runs: the layer is re-rasterized from
 * the preview record on every move, and the release records one command.
 */
interface GradientEditGesture {
  readonly gradientId: string;
  readonly layerId: LayerId;
  /** The handle the press grabbed. */
  readonly handle: GradientHandleId;
  /** The committed record the drag started from; the cancel path restores it. */
  readonly original: GradientRecord;
  /** The preview record; the release records it. */
  current: GradientRecord;
}

/**
 * The gradient the gradient tool has selected, and the handle it would move.
 *
 * Editor state, like the stroke selection: the gradient itself is document
 * content and travels with the document, but *which* gradient is selected
 * belongs to the tool that owns the selection. It is published so a panel can
 * show the geometry as numbers and drive it back through the engine.
 */
export interface SelectedGradientState {
  /** The element id of the selected gradient. */
  readonly id: string;
  /** Whether the gradient is linear or radial. */
  readonly type: "linear" | "radial";
  /** The axis start of a linear gradient, the centre of a radial one. */
  readonly x1: number;
  readonly y1: number;
  /** The axis end of a linear gradient, the radius handle of a radial one. */
  readonly x2: number;
  readonly y2: number;
  /** The handle the arrow keys would move, or `null` when none was grabbed. */
  readonly handle: GradientHandleId | null;
}

/**
 * A quick brush-size resize in flight.
 *
 * The gesture changes the size of the *next* stroke, so nothing it does is an
 * edit: no stroke is painted, no command is pushed and the revision does not
 * move. The size the gesture started from is kept so a cancel can put it
 * back exactly.
 */
interface BrushSizeGesture {
  /** The brush size when the gesture began, in document pixels. */
  readonly startSize: number;
  /** The press point, in canvas-local CSS pixels. */
  readonly startScreenY: number;
  /** The size the gesture proposes right now, in document pixels. */
  readonly size: number;
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
  /**
   * The axis a ruler drag fixed, or `null` when the drag decides it.
   *
   * A guide pulled out of a ruler already knows its axis - the top ruler
   * measures x, so it makes a *vertical* guide - and a drag from there moves
   * the guide along that axis instead of choosing a new one.
   */
  axis: GuideAxis | null;
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

/**
 * The size of a view that has not been laid out yet.
 *
 * A shared, never-written object: it stands for "no size reported", and a
 * view that has one replaces it with an object of its own.
 */
const EMPTY_VIEWPORT_SIZE: Size = { width: 0, height: 0 };

export class DrawingEngine implements StrokeSource {
  private doc: DrawingDocument;
  /**
   * The views over the document.
   *
   * One document, several windows: the registry holds the transform of each
   * view and which one is active. The artwork, the history and the dirty flag
   * belong to the engine and to nothing else, so the views cannot disagree
   * about what the document contains.
   */
  private readonly views = new CanvasViewRegistry();
  private brush: BrushSettings;
  private secondaryColor = DEFAULT_SECONDARY_COLOR;
  private presets: readonly BrushPreset[] = mergeBundledPresets([]);
  /**
   * The preset the active brush was applied from, or `null`.
   *
   * The origin of the brush, kept apart from the brush itself: editing a
   * field changes `brush` and leaves this alone, so the preset's defaults
   * stay available for a reset even after the brush has been changed.
   */
  private activePresetId: string | null = null;
  private currentToolId: ToolId;
  private readonly tools: ToolRegistry;
  private readonly commands: CommandStack;
  private readonly strokes = new StrokeStore();
  private readonly store: Store<EditorSnapshot>;
  private readonly cursorListeners = new Set<(report: CursorReport) => void>();
  private readonly commandHost: StrokeCommandHost;
  private readonly gradientEditHost: GradientEditHost;
  private readonly documentCommandHost: DocumentCommandHost;
  private readonly toolContext: ToolContext;
  private readonly middlePanTool: Tool;
  private readonly maxRasterScale: number;

  private renderer: DrawingRenderer | null = null;
  private binder: CanvasInputBinder | null = null;
  /**
   * The reference images the artist keeps beside the canvas.
   *
   * The engine never owns them and never holds a bitmap: the source does. The
   * engine asks it for the overlay to paint and for the pixel under the
   * pointer, and it tells it how big the workspace is.
   */
  private referenceSource: ReferenceSource | null = null;
  /** Releases the engine's subscription to the reference source. */
  private referenceUnsubscribe: (() => void) | null = null;
  /**
   * The reference under the pointer, or `null`.
   *
   * Editor state for the *feedback* only: it tells the canvas which reference
   * to outline, so the artist can see what a press would sample. It is not
   * document state and never reaches a file.
   */
  private hoveredReferenceId: string | null = null;
  /**
   * The view the last pointer sample came from.
   *
   * The references are drawn on the main canvas only, so a press in the
   * second view must not sample one: the picture is not on that canvas, and
   * the coordinates of the other canvas mean something else entirely.
   */
  private pointerViewId: ViewId = PRIMARY_VIEW_ID;
  private strokeBuilder: StrokeBuilder | null = null;
  private activeStroke: StrokeRecord | null = null;
  private panGestureActive = false;
  /**
   * A right-button press that has not started a gesture yet.
   *
   * The right button opens the canvas menu on a click and paints with the
   * secondary colour on a drag. The two share one button, so the gesture waits
   * for the first movement: a click must not leave a dab, a fill or a
   * selection behind, and the menu must open on an empty canvas.
   *
   * The brush is resolved at press time and kept, so the gesture still paints
   * with the colour the press chose.
   */
  private deferredRightGesture: {
    readonly sample: PointerSample;
    readonly brush: BrushSettings;
    readonly viewId: ViewId;
  } | null = null;
  /**
   * The brush a deferred gesture starts with.
   *
   * Set only while the deferred press is handed to the tool, so that
   * `brushForSample` answers with the brush the press resolved rather than
   * with the brush of the moment the gesture finally starts.
   */
  private deferredBrush: BrushSettings | null = null;
  /**
   * Whether the temporary pan modifier is held.
   *
   * Set from the keyboard layer while the space bar is down: a press then pans
   * the canvas instead of drawing, whatever the active tool is.
   */
  private panModifier = false;
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
  /**
   * What the next fill measures its region against, and how it shapes the
   * region afterwards. Editor state, like `fillTolerance`: a committed fill
   * stores its own pixels.
   */
  private fillReference: FillReferenceMode = DEFAULT_FILL_REFERENCE;
  private fillReferenceLayerId: LayerId | null = null;
  private fillExpand = DEFAULT_FILL_EXPAND;
  private fillAntialias = DEFAULT_FILL_ANTIALIAS;
  private fillCloseGaps = DEFAULT_FILL_CLOSE_GAPS;
  private activeFill: ActiveFill | null = null;
  /** Gradient options for the next drag, captured when the gesture starts. */
  private gradientType: "linear" | "radial" = "linear";
  private gradientEndColor = DEFAULT_GRADIENT_END_COLOR;
  private gradientMidStops: readonly GradientStop[] = [];
  private activeGradient: ActiveGradient | null = null;
  /**
   * The gradient the gradient tool has selected, or `null`.
   *
   * Editor state, not document state: the gradient is content and travels with
   * the document, but which one is selected belongs to the tool. It names the
   * layer as well as the element, so a selection cannot outlive the layer it
   * was made on.
   */
  private selectedGradient: { id: string; layerId: LayerId } | null = null;
  /** The handle the arrow keys would move, or `null` when none was grabbed. */
  private selectedGradientHandle: GradientHandleId | null = null;
  /** The handle drag in flight, or `null`. */
  private gradientEdit: GradientEditGesture | null = null;
  /**
   * The published view of the selected gradient.
   *
   * Cached so the snapshot can compare it by identity: a new object on every
   * publish would make every publish look like a change.
   */
  private selectedGradientState: SelectedGradientState | null = null;
  /**
   * Grid display settings. Session state: the grid is an aid, not document
   * content, so it is not in the project file and never enters history.
   */
  private gridVisible = DEFAULT_GRID_SETTINGS.visible;
  private gridSpacing = DEFAULT_GRID_SETTINGS.spacing;
  private gridSnapping = DEFAULT_GRID_SETTINGS.snap;
  /** Ruler display settings. Session state, like the grid. */
  private rulersVisible = DEFAULT_RULER_SETTINGS.visible;
  /**
   * The symmetry the next stroke is repeated around. Session state, like the
   * grid: the copies it produces are ordinary strokes, so the symmetry itself
   * is never part of the document.
   */
  private symmetryEnabled = DEFAULT_SYMMETRY_SETTINGS.enabled;
  private symmetryMode = DEFAULT_SYMMETRY_SETTINGS.mode;
  private symmetryCount = DEFAULT_SYMMETRY_SETTINGS.count;
  private symmetryCenter: Point = { ...DEFAULT_SYMMETRY_SETTINGS.center };
  /** The symmetry centre being dragged, or `null`. */
  private symmetryCenterGesture: SymmetryCenterGesture | null = null;
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
  /**
   * The last cursor report of each view.
   *
   * A cursor is a property of a *window*: the pointer is over one canvas at a
   * time, and each view's overlay has to know whether the pointer is over it.
   * The reports are therefore kept per view and carry the view they belong to.
   */
  private readonly cursors = new Map<ViewId, CursorReport>();
  /**
   * The cached summaries of the open views.
   *
   * Replaced only when a view really changed, so the snapshot can compare the
   * list by identity.
   */
  private viewSummaryCache: readonly ViewSummary[] = [];
  /**
   * The canvas of the second view, when it is attached.
   *
   * The canvas belongs to the React layer that draws it; the engine keeps the
   * reference so it can register the view with the renderer again when the
   * renderer is rebuilt.
   */
  private secondaryCanvas: HTMLCanvasElement | null = null;
  /** The input binder of the second view, when it is attached. */
  private secondaryBinder: CanvasInputBinder | null = null;
  /**
   * The quick brush-size resize in flight, or `null`.
   *
   * The gesture owns the pointer while it runs: the press never reaches a
   * painting tool, so a resize cannot leave a stroke behind.
   */
  private brushSizeGesture: BrushSizeGesture | null = null;
  /**
   * Listeners for the brush cursor overlay.
   *
   * A separate stream from the cursor reports: the overlay needs the brush
   * size, the zoom and the two states that change how the ring is drawn, and
   * none of them belong in a pointer report.
   */
  private readonly brushCursorListeners = new Set<(report: BrushCursorReport) => void>();
  /**
   * Whether another surface owns the interaction.
   *
   * Asked before the quick resize claims a press, so a field the user is
   * typing in keeps the keyboard and the pointer to itself.
   */
  private readonly interactionBlocked: () => boolean;
  private devicePixelRatio = 1;
  private rasterScale = 1;

  /**
   * The cached overview of the document, for a navigator panel.
   *
   * The overview is a downscale of the composite, so it only has to be
   * rebuilt when the *document* changes - not when the view moves. The cache
   * key is the document's identity plus the revision, so a stroke, a fill, a
   * layer change and a reopened project all invalidate it while a pan or a
   * zoom does not.
   */
  private overview: OverviewCache | null = null;

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

  // ------------------------------------------------------------------- views

  /**
   * The transform of the **active** view.
   *
   * Every command that moves the view acts on the view the user is working in,
   * and the tools see that view too: a pan or a zoom started in the second
   * view moves the second view and leaves the first one exactly where it was.
   */
  private get viewport(): Viewport {
    return this.views.active.viewport;
  }

  private set viewport(viewport: Viewport) {
    this.views.active.viewport = viewport;
  }

  /**
   * The CSS size of the **main** drawing surface.
   *
   * The main canvas is the one the workspace lays out, so its size is the one
   * the snapshot reports. The second view has a size of its own, kept with the
   * view.
   */
  private get viewportSize(): Size {
    return this.views.get(PRIMARY_VIEW_ID)?.size ?? EMPTY_VIEWPORT_SIZE;
  }

  private set viewportSize(size: Size) {
    const view = this.views.get(PRIMARY_VIEW_ID);
    if (view) {
      view.size = size;
    }
  }

  /** The CSS size of the active view's surface. */
  private get activeViewSize(): Size {
    return this.views.active.size;
  }

  constructor(options: DrawingEngineOptions = {}) {
    this.doc =
      options.document ??
      documentOps.createDocument({
        name: "Untitled",
        width: DEFAULT_DOCUMENT_WIDTH,
        height: DEFAULT_DOCUMENT_HEIGHT,
      });
    // The main canvas is the primary view. It exists from the start, before
    // any canvas is attached, so a command always has a view to act on.
    this.views.add(createCanvasView(PRIMARY_VIEW_ID, { zoom: 1, offsetX: 0, offsetY: 0 }));
    this.brush = normalizeBrush(options.brush ?? DEFAULT_BRUSH);
    this.currentToolId = options.toolId ?? "brush";
    this.interactionBlocked = options.interactionBlocked ?? surfaceOwnsInteraction;
    this.renderer = options.renderer ?? null;
    this.tools = createToolRegistry();
    this.middlePanTool = this.tools.pan;
    this.commands = new CommandStack({ limit: options.historyLimit ?? DEFAULT_HISTORY_LIMIT });
    this.maxRasterScale = clamp(options.maxRasterScale ?? 2, 1, 4);
    this.commandHost = createStrokeCommandHost(this.strokes, (layerId) => {
      this.renderer?.invalidateLayer(layerId);
    });
    // A gradient edit swaps one record for another: it neither inserts nor
    // removes an element, so it needs only the replace half of the host.
    this.gradientEditHost = {
      replace: (element) => {
        this.strokes.replace(element);
      },
      refresh: (layerId) => {
        this.renderer?.invalidateLayer(layerId);
      },
    };
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
    // The symmetry centre belongs to the paper it is used on, so it starts in
    // the middle of the document rather than at the origin.
    this.symmetryCenter = { x: Math.round(this.doc.width / 2), y: Math.round(this.doc.height / 2) };

    // The references are wired before the first render: the overlay is part of
    // what the artist sees, and the engine has to be able to sample them.
    this.setReferenceSource(options.referenceSource ?? null);

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
      finishStroke: (sample) => engine.finishStroke(sample),
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
      selectGradientAt: (docX, docY) => engine.selectGradientAt(docX, docY),
      beginGradientHandleDrag: (sample) => engine.beginGradientHandleDrag(sample),
      updateGradientHandleDrag: (sample) => engine.updateGradientHandleDrag(sample),
      finishGradientHandleDrag: () => engine.finishGradientHandleDrag(),
      cancelGradientHandleDrag: () => engine.cancelGradientHandleDrag(),
      isGradientHandleDragActive: () => engine.isGradientHandleDragActive(),
      findGuideAt: (docX, docY) => engine.findGuideAt(docX, docY),
      beginGuideCreate: (sample, axis) => engine.beginGuideCreate(sample, axis),
      rulerAxisAt: (screenX, screenY) => engine.rulerAxisAt(screenX, screenY),
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
    renderer.setViewport(this.primaryViewport());
    renderer.setGrid({
      visible: this.gridVisible,
      spacing: this.gridSpacing,
      snap: this.gridSnapping,
    });
    if (this.viewportSize.width > 0) {
      renderer.setDisplaySize(this.viewportSize.width, this.viewportSize.height, this.devicePixelRatio);
    }
    renderer.setRulers({ visible: this.rulersVisible });
    renderer.setSymmetry(this.symmetrySettings());
    this.renderer = renderer;
    // The second view is a second *target* of the same renderer, so it reads
    // the same layer surfaces and the same in-progress stroke. It is
    // registered here as well, because the renderer is created here.
    this.ensureSecondaryAttached();

    this.binder = this.createBinder(canvas, PRIMARY_VIEW_ID);
    this.syncSelectionOverlay();
    this.syncGradientOverlay();
    this.syncReferenceOverlay();
    this.requestRender();
  }

  detach(): void {
    this.abortStroke();
    this.resetGuideGesture();
    this.binder?.detach();
    this.binder = null;
    // The second view's input goes with the renderer's: a view that is still
    // open but has no canvas must not keep listening to a stale one.
    this.secondaryBinder?.detach();
    this.secondaryBinder = null;
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

    // The size object is replaced only when the size really changed, so the
    // snapshot can compare it by identity and a resize that reports the same
    // size does not republish.
    const sizeChanged = this.viewportSize.width !== width || this.viewportSize.height !== height;
    if (sizeChanged) {
      this.viewportSize = { width, height };
      // The references live in the workspace, so they need to know how big it
      // is: a new one is placed in it, and "fit to view" fits into it.
      this.referenceSource?.setViewportSize(width, height);
    }

    // The first size the main canvas reports fits it to the document.
    const primary = this.views.get(PRIMARY_VIEW_ID);
    if (primary && !primary.laidOut) {
      primary.laidOut = true;
      this.setViewViewport(PRIMARY_VIEW_ID, this.initialViewportFor(primary), false);
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

    if (sizeChanged) {
      this.publish();
    }
  }

  // ------------------------------------------------------------- second view

  /**
   * Opens a second view of the same document.
   *
   * The second view is another **window on the same drawing**: it shares the
   * document, the history, the dirty flag and the rasterized pixels, and it
   * has a transform of its own. Nothing is copied, so a stroke drawn in
   * either view is one stroke in one document, and it shows up in both views
   * at once.
   *
   * The canvas itself belongs to the React layer that draws it, so opening the
   * view and attaching the canvas are two steps: this one, and
   * `attachSecondaryView`.
   */
  openSecondaryView(): void {
    if (this.views.has(SECONDARY_VIEW_ID)) {
      return;
    }
    const view = createCanvasView(SECONDARY_VIEW_ID, { ...this.primaryViewport() });
    this.views.add(view);
    this.publish();
    this.requestRender();
  }

  /**
   * Closes the second view.
   *
   * The view takes nothing away from the document: the artwork, the history
   * and the dirty flag are exactly as they were before it was opened.
   */
  closeSecondaryView(): void {
    if (!this.views.has(SECONDARY_VIEW_ID)) {
      return;
    }
    this.detachSecondaryView();
    this.views.remove(SECONDARY_VIEW_ID);
    this.publish();
    this.requestRender();
  }

  /**
   * Whether the second view is open.
   *
   * Editor state, like the grid: the second view is a way of looking at the
   * document, not part of the document, so it never reaches a project file and
   * never makes the drawing unsaved.
   */
  get secondaryViewOpen(): boolean {
    return this.views.has(SECONDARY_VIEW_ID);
  }

  /**
   * Attaches the canvas of the second view.
   *
   * The canvas becomes a display target of the renderer and gets its own input
   * binding, so the two views take pointer input independently and each maps
   * it through its own transform.
   */
  attachSecondaryView(canvas: HTMLCanvasElement): void {
    this.secondaryCanvas = canvas;
    this.ensureSecondaryAttached();
    this.requestRender();
  }
  /**
   * Reports for the brush cursor overlay.
   *
   * The overlay is a *view*: the ring it draws is never part of a layer
   * surface, an export, the history or the project file. The engine owns the
   * answer so the overlay has one source of truth for the size, the zoom and
   * the two states that change how the ring is drawn.
   */
  subscribeBrushCursor(listener: (report: BrushCursorReport) => void): () => void {
    this.brushCursorListeners.add(listener);
    // The overlay needs the current size and zoom before the first pointer
    // move, so the first report is sent straight away.
    listener(this.brushCursorReport());
    return () => {
      this.brushCursorListeners.delete(listener);
    };
  }

  /**
   * Cancels the quick brush-size resize, if one is running.
   *
   * The size the gesture started from is put back, so cancelling a resize
   * leaves the brush exactly as it was. Returns whether a resize was actually
   * running, so the caller can tell "cancelled" from "nothing to cancel".
   */
  cancelBrushSizeGesture(): boolean {
    const gesture = this.brushSizeGesture;
    if (gesture === null) {
      return false;
    }
    this.brushSizeGesture = null;
    if (gesture.size !== gesture.startSize) {
      this.setBrush({ size: gesture.startSize });
    }
    this.emitBrushCursor();
    return true;
  }

  getCursor(): string {
    return this.activeTool().cursor;
  }

  /**
   * Detaches the canvas of the second view.
   *
   * The view may still be open - the React layer unmounts the canvas before
   * the engine hears that the view was closed - so only the canvas is given
   * back, not the view itself.
   */
  detachSecondaryView(): void {
    this.secondaryBinder?.detach();
    this.secondaryBinder = null;
    this.secondaryCanvas = null;
    this.renderer?.removeDisplayTarget?.(SECONDARY_VIEW_ID);
    this.requestRender();
  }

  /**
   * Reports the CSS size of the second view's surface.
   *
   * The first size the view hears about fits it to the document, the same way
   * the main canvas is fitted when it appears.
   */
  setSecondaryViewSize(width: number, height: number): void {
    const view = this.views.get(SECONDARY_VIEW_ID);
    if (!view || width <= 0 || height <= 0) {
      return;
    }

    const sizeChanged = view.size.width !== width || view.size.height !== height;
    if (sizeChanged) {
      view.size = { width, height };
    }

    this.renderer?.setDisplayTargetSize?.(
      SECONDARY_VIEW_ID,
      width,
      height,
      this.devicePixelRatio,
    );

    if (!view.laidOut) {
      view.laidOut = true;
      this.setViewViewport(SECONDARY_VIEW_ID, this.initialViewportFor(view), false);
    }

    if (sizeChanged) {
      this.publish();
    }
    this.renderer?.setViewport(this.viewport);
    this.renderer?.setDocument(this.doc);
    this.invalidateLayers(this.doc);
    this.republishCursor();
    this.emitBrushCursor();
    this.publish();
    this.requestRender();
  }

  /**
   * Makes a view the active one.
   *
   * The active view is the one the commands act on: zooming, fitting and the
   * rotation turn the view the user is working in. A press in a view focuses
   * it, so the user never has to say which window they meant.
   */
  focusView(viewId: ViewId): void {
    if (!this.views.setActive(viewId)) {
      return;
    }
    this.publish();
  }

  /**
   * Opens or closes the second view of the canvas.
   *
   * Opening it is a view-only change: the document, the history and the dirty
   * flag are untouched, because the second view shows the *same* document.
   */
  toggleSecondaryView(): void {
    if (this.secondaryViewOpen) {
      this.closeSecondaryView();
      return;
    }
    this.openSecondaryView();
  }

  /**
   * Fits one view to its own window, and makes it the active one.
   *
   * The view is focused first, so the fit lands in the window the user asked
   * for rather than in the other one.
   */
  fitView(viewId: ViewId): void {
    if (!this.views.has(viewId)) {
      return;
    }
    this.focusView(viewId);
    this.zoomToFit();
  }

  /**
   * Puts one view at 100 %, and makes it the active one.
   */
  actualSizeView(viewId: ViewId): void {
    if (!this.views.has(viewId)) {
      return;
    }
    this.focusView(viewId);
    this.zoomTo(1);
  }

  /** The id of the active view. */
  get activeViewId(): ViewId {
    return this.views.activeId;
  }

  /**
   * Binds the DOM input of one view.
   *
   * Each view has its own binder, because each view has its own transform: a
   * pointer position only means something relative to the canvas it happened
   * in. The binder asks the engine for that view's viewport on every event, so
   * a pan or a zoom is picked up immediately.
   */
  private createBinder(canvas: HTMLCanvasElement, viewId: ViewId): CanvasInputBinder {
    const handlers: CanvasInputHandlers = {
      getViewport: () => this.viewFor(viewId)?.viewport ?? this.viewport,
      onPointerSample: (sample) => this.handlePointerSample(sample, viewId),
      onWheel: (input) => this.handleWheel(input, viewId),
      onPointerPresence: (inside) => this.handlePresence(inside, viewId),
    };
    const binder = new CanvasInputBinder(canvas, handlers);
    binder.attach();
    return binder;
  }

  /**
   * Registers the second view with a renderer.
   *
   * A second *target* of the same renderer, never a second renderer: the two
   * views then read the same layer surfaces and the same in-progress stroke,
   * which is what keeps them in step without duplicating any pixels.
   */
  private registerSecondaryTarget(renderer: DrawingRenderer): void {
    const canvas = this.secondaryCanvas;
    const view = this.views.get(SECONDARY_VIEW_ID);
    if (!canvas || !view) {
      return;
    }
    renderer.addDisplayTarget?.({
      id: SECONDARY_VIEW_ID,
      canvas,
      viewport: view.viewport,
    });
    if (view.size.width > 0 && view.size.height > 0) {
      renderer.setDisplayTargetSize?.(
        SECONDARY_VIEW_ID,
        view.size.width,
        view.size.height,
        this.devicePixelRatio,
      );
    }
  }

  /**
   * Makes sure the second view is listening and is registered with the
   * renderer.
   *
   * The canvas belongs to the React layer, so it can outlive the renderer: the
   * renderer is rebuilt when the main canvas is re-attached, and the second
   * view has to be put back on it then.
   */
  private ensureSecondaryAttached(): void {
    const canvas = this.secondaryCanvas;
    if (!canvas) {
      return;
    }
    this.secondaryBinder?.detach();
    this.secondaryBinder = this.createBinder(canvas, SECONDARY_VIEW_ID);
    if (this.renderer) {
      this.registerSecondaryTarget(this.renderer);
    }
  }

  /** The transform of the main canvas's view. */
  private primaryViewport(): Viewport {
    return this.views.get(PRIMARY_VIEW_ID)?.viewport ?? { zoom: 1, offsetX: 0, offsetY: 0 };
  }

  /** The view with the given id, when it is open. */
  private viewFor(viewId: ViewId): CanvasView | undefined {
    return this.views.get(viewId);
  }

  /**
   * The summaries of the open views.
   *
   * The list is replaced only when a view really changed, so the snapshot can
   * compare it by identity: a new array on every publish would make every
   * publish look like a change.
   */
  private viewSummaries(): readonly ViewSummary[] {
    const next = this.views.summaries();
    if (sameViewSummaries(this.viewSummaryCache, next)) {
      return this.viewSummaryCache;
    }
    this.viewSummaryCache = next;
    return next;
  }

  /**
   * Fits every open view to the document again.
   *
   * A new document has a different size, so the old placement would show the
   * wrong part of the paper. Every view is re-fitted, not only the active one:
   * they all look at the same document, so they all have to look at the *new*
   * one.
   */
  private resetViewsToDocument(): void {
    for (const view of this.views.all()) {
      if (!view.laidOut) {
        continue;
      }
      view.viewport = this.initialViewportFor(view);
      this.renderer?.setDisplayTargetViewport?.(view.id, view.viewport);
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
    this.resetGradientSelection();
    this.resetGuideGesture();
    this.doc = documentOps.createDocument(options);
    this.strokes.clear();
    this.commands.clear();
    this.notice = null;
    this.filePath = null;
    this.revision = 0;
    this.savedRevision = 0;
    this.fileHoldsPreview = false;
    // A new paper gets a new centre: the symmetry axis belongs to the document
    // it is used on.
    this.symmetryCenter = { x: Math.round(this.doc.width / 2), y: Math.round(this.doc.height / 2) };
    this.syncOverlaysToRenderer();
    this.resetViewsToDocument();
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
    this.resetGradientSelection();
    this.resetGuideGesture();
    this.doc = project.document;
    this.strokes.clear();
    this.commands.clear();
    this.notice = null;
    // The opened paper gets its own centre: the symmetry axis belongs to the
    // document it is used on.
    this.symmetryCenter = { x: Math.round(this.doc.width / 2), y: Math.round(this.doc.height / 2) };
    this.syncOverlaysToRenderer();

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

    this.resetViewsToDocument();
    this.renderer?.setDocument(this.doc);
    this.invalidateLayers(this.doc);
    this.republishCursor();
    this.emitBrushCursor();
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
    // A file written while a gesture is in flight holds the *preview*, not the
    // document: the picture on disk and the picture in the editor can differ,
    // so the file cannot be called clean until it is written again. A gradient
    // gesture is such a preview: its record already sits in the element list,
    // and a cancelled drag puts the committed one back.
    this.fileHoldsPreview =
      this.guideGesture !== null || this.activeGradient !== null || this.gradientEdit !== null;
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
   * Samples the colour under the pointer for the colour picker.
   *
   * Like selecting a layer, this is not an edit. It reads what the user sees
   * and sets the brush colour through `setBrush` - the same path the colour
   * control uses, so colour has one source of truth. It touches no stroke,
   * pushes no history entry and never bumps the revision, so picking cannot
   * make the document dirty.
   *
   * A **reference image is sampled first**. The references are drawn over the
   * canvas, so a reference under the pointer is what the artist is pointing
   * at; the document composite is only read when the pointer is not over one.
   * The reference is read in workspace space, through its own placement, so a
   * scaled or moved reference is sampled at the pixel the pointer is really
   * over.
   *
   * A press outside the paper and outside every reference is ignored, exactly
   * like `beginStroke`: there is nothing there to sample.
   */
  private pickColor(sample: PointerSample): void {
    // The references are drawn on the main canvas, so only a press there can
    // land on one: the second view is another window onto the artwork.
    const reference =
      this.pointerViewId === PRIMARY_VIEW_ID
        ? (this.referenceSource?.sampleAt(sample.screenX, sample.screenY) ?? null)
        : null;
    if (reference) {
      this.applySampledColor(reference, sample);
      return;
    }
    if (!isInsideDocument(this.doc, sample.docX, sample.docY)) {
      return;
    }
    const color = this.renderer?.readCompositePixel(sample.docX, sample.docY);
    if (!color) {
      return;
    }
    this.applySampledColor(color, sample);
  }

  /**
   * Puts a sampled colour into the primary or the secondary colour.
   *
   * A plain press sets the primary colour - the one a left-button stroke
   * paints with - and Alt sets the secondary one, the colour a right-button
   * stroke paints with. That is the convention every art application uses, so
   * a reference can be sampled into either colour without leaving the picker.
   */
  private applySampledColor(color: Rgb, sample: PointerSample): void {
    const hex = rgbToHex(color);
    if (sample.modifiers.alt) {
      this.setSecondaryColor(hex);
      return;
    }
    this.setBrush({ color: hex });
  }

  setBrush(patch: Partial<BrushSettings>): void {
    const next = updateBrushSettings(this.brush, patch);
    if (brushSettingsEqual(this.brush, next)) {
      return;
    }
    const sizeChanged = next.size !== this.brush.size;
    this.brush = next;
    this.commands.breakMerge();
    // The cursor ring shows the brush size, so it has to follow it. A colour
    // or an opacity change does not move the ring.
    if (sizeChanged) {
      this.emitBrushCursor();
    }
    this.publish();
  }

  /**
   * Sets the colour a right-button gesture paints with.
   *
   * Editor state, not a document edit: it describes the *next* gesture. The
   * colour is resolved once at press time, so a stroke keeps the colour it was
   * started with even if this changes before release.
   */
  setSecondaryColor(color: string): void {
    const normalized = hexToRgb(color);
    if (!normalized) {
      return;
    }
    const next = rgbToHex(normalized);
    if (this.secondaryColor === next) {
      return;
    }
    this.secondaryColor = next;
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Swaps the primary and secondary colours.
   *
   * The document is untouched: the swap changes which colour the next
   * left/right-button gesture paints with, never the strokes already drawn.
   */
  swapColors(): void {
    const primary = this.brush.color;
    const secondary = this.secondaryColor;
    if (primary === secondary) {
      return;
    }
    this.secondaryColor = primary;
    this.brush = updateBrushSettings(this.brush, { color: secondary });
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * The brush a gesture paints with, resolving the secondary colour for a
   * right-button press.
   *
   * This runs at press time only. A shape, stroke, fill or gradient stores the
   * resolved colour on its own record, so the rest of the gesture, undo/redo
   * and a reopened file all agree without re-reading the current buttons.
   */
  private brushForSample(sample: PointerSample): BrushSettings {
    // A deferred right-button gesture keeps the brush its press resolved, so
    // the colour is still the one the press chose.
    if (this.deferredBrush !== null) {
      return this.deferredBrush;
    }
    if (sample.button !== 2 || this.secondaryColor === this.brush.color) {
      return this.brush;
    }
    return { ...this.brush, color: this.secondaryColor };
  }

  /**
   * Replaces the preset library.
   *
   * The settings store calls this once while applying a file. It is editor
   * state, so it publishes without touching the document, the revision or
   * history. The entries are read by `normalizeBrushPresets`, the same
   * reader the settings file uses, so a malformed entry is handled the same
   * way wherever it comes from.
   *
   * The built-in brushes are joined in afterwards: they are code, so the file
   * cannot change them, and the file only carries the user's own state about
   * them - whether they are a favourite and when they were last used.
   */
  setPresets(presets: readonly BrushPreset[]): void {
    const next = mergeBundledPresets(normalizeBrushPresets(presets));
    if (brushPresetsEqual(this.presets, next)) {
      return;
    }
    this.presets = next;
    this.activePresetId = this.resolveActivePresetId();
    this.publish();
  }

  /**
   * The preset the active brush is based on.
   *
   * A preset that no longer exists cannot be the origin, so the origin is
   * dropped. When the brush has no origin yet and it is *exactly* one of the
   * presets, that preset becomes the origin: the brush was restored from the
   * settings file with those values, so the preset is where it came from.
   *
   * A brush that matches no preset keeps no origin, which is what makes
   * "custom" a real state rather than a label.
   */
  private resolveActivePresetId(): string | null {
    if (this.activePresetId !== null) {
      const stillThere = this.presets.some((preset) => preset.id === this.activePresetId);
      if (stillThere) {
        return this.activePresetId;
      }
      return null;
    }
    const matching = this.presets.find((preset) => brushSettingsEqual(preset.brush, this.brush));
    return matching?.id ?? null;
  }

  /**
   * Sets which preset the active brush is based on, without changing the brush.
   *
   * `null` means "custom": the brush is no longer tied to a preset, and the
   * reset button falls back to the factory default. The preset picker calls
   * this when the user chooses "Custom / unsaved".
   */
  setActivePreset(id: string | null): void {
    if (id !== null && !this.presets.some((preset) => preset.id === id)) {
      return;
    }
    if (this.activePresetId === id) {
      return;
    }
    this.activePresetId = id;
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Restores the brush to the defaults it was based on.
   *
   * When the brush came from a preset, the preset's brush comes back - which
   * is how an edited preset is re-applied, since the picker cannot re-select
   * the option that is already showing. Without a preset the factory default
   * comes back.
   *
   * Editor state only: no history entry, no revision bump and no dirty flag,
   * exactly like any other brush change.
   */
  resetBrush(): void {
    const preset = this.activePresetId === null
      ? undefined
      : this.presets.find((candidate) => candidate.id === this.activePresetId);
    this.setBrush(preset ? preset.brush : DEFAULT_BRUSH);
  }

  /**
   * Saves the current brush as a new preset and returns it.
   *
   * Editor state only: no history entry, no revision bump and no dirty flag.
   * An empty name is rejected (`null`); a duplicate name gets a numeric
   * suffix so the picker can tell the entries apart. The built-in brushes
   * count as taken names, so a new preset called "Pen" becomes "Pen (2)".
   */
  saveBrushPreset(name: string): BrushPreset | null {
    const trimmed = normalizePresetName(name);
    if (trimmed === "") {
      return null;
    }
    const preset: BrushPreset = {
      id: createPresetId(),
      name: uniquePresetName(trimmed, this.presets),
      brush: { ...this.brush },
      favorite: false,
      builtin: false,
      lastUsedAt: null,
    };
    this.presets = [...this.presets, preset];
    // The saved preset holds exactly the live brush, so it is where the brush
    // came from from now on.
    this.activePresetId = preset.id;
    this.commands.breakMerge();
    this.publish();
    return preset;
  }

  /**
   * Renames a preset and returns the stored entry, or `null` when the id is
   * unknown or the name is empty. A duplicate name gets a numeric suffix.
   *
   * A built-in brush cannot be renamed: it is code, and a renamed copy of it
   * would be a different brush wearing its name. Duplicating it is how the
   * user gets a version they can change.
   */
  renameBrushPreset(id: string, name: string): BrushPreset | null {
    const trimmed = normalizePresetName(name);
    if (trimmed === "") {
      return null;
    }
    const index = this.presets.findIndex((preset) => preset.id === id);
    if (index === -1) {
      return null;
    }
    const current = this.presets[index];
    if (isBundledPreset(current)) {
      return null;
    }
    const renamed: BrushPreset = {
      ...current,
      name: uniquePresetName(trimmed, this.presets, id),
    };
    if (renamed.name === current.name) {
      return renamed;
    }
    this.presets = this.presets.map((preset) => (preset.id === id ? renamed : preset));
    this.commands.breakMerge();
    this.publish();
    return renamed;
  }

  /**
   * Deletes a preset. Returns whether the id was found.
   *
   * A built-in brush is protected and is never deleted: it is code, and
   * removing it would take the feature away rather than the user's data.
   */
  deleteBrushPreset(id: string): boolean {
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (preset === undefined || isBundledPreset(preset)) {
      return false;
    }
    const next = this.presets.filter((candidate) => candidate.id !== id);
    this.presets = next;
    // A deleted preset cannot be the brush's origin any more. The brush itself
    // is left as it is: deleting a saved preset does not change what the next
    // stroke looks like.
    if (this.activePresetId === id) {
      this.activePresetId = null;
    }
    this.commands.breakMerge();
    this.publish();
    return true;
  }

  /**
   * Duplicates a preset: the same brush under a fresh id and a name that does
   * not clash with the ones already saved.
   *
   * Editor state only: no history entry, no revision bump and no dirty flag.
   * Returns the new entry, or `null` when the id is unknown. A built-in
   * brush can be duplicated - that is how the user gets a version of it they
   * can change.
   */
  duplicateBrushPreset(id: string): BrushPreset | null {
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (!preset) {
      return null;
    }
    const copy = duplicatePreset(preset, this.presets);
    this.presets = [...this.presets, copy];
    // The copy holds the same brush as the live one, so it is the brush's
    // origin from now on.
    this.activePresetId = copy.id;
    this.commands.breakMerge();
    this.publish();
    return copy;
  }

  /**
   * Stores the live brush in a preset, overwriting the values it held.
   *
   * This is how a preset is edited: the user changes the brush, and the
   * change is written into the preset they are working from. The live brush
   * is left exactly as it is - only the stored copy changes.
   *
   * A built-in brush cannot be overwritten, for the same reason it cannot be
   * renamed. Returns the stored entry, or `null` when the id is unknown or
   * the preset is built in.
   */
  updateBrushPreset(id: string): BrushPreset | null {
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (preset === undefined || isBundledPreset(preset)) {
      return null;
    }
    const updated: BrushPreset = { ...preset, brush: { ...this.brush } };
    this.presets = this.presets.map((candidate) => (candidate.id === id ? updated : candidate));
    this.commands.breakMerge();
    this.publish();
    return updated;
  }

  /**
   * Stars or unstars a preset.
   *
   * The star is the user's own note about a brush, so it works for the
   * built-in brushes as well - only the brush itself is protected. Returns
   * whether the id was found.
   */
  toggleBrushPresetFavorite(id: string): boolean {
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (preset === undefined) {
      return false;
    }
    this.presets = this.presets.map((candidate) =>
      candidate.id === id ? { ...candidate, favorite: !candidate.favorite } : candidate,
    );
    this.commands.breakMerge();
    this.publish();
    return true;
  }

  /**
   * Adds presets to the library and returns how many were added.
   *
   * Every entry is copied: it gets a fresh id and a name that does not clash
   * with the ones already there, so importing the same library twice gives
   * two libraries rather than one library with the second replacing the
   * first. The favourite flag travels with the brush; the last-used stamp
   * does not, because the copy has not been used here.
   */
  importBrushPresets(entries: readonly BrushPreset[]): number {
    if (entries.length === 0) {
      return 0;
    }
    let list = this.presets;
    for (const entry of entries) {
      list = [...list, importPreset(entry, list)];
    }
    this.presets = list;
    this.commands.breakMerge();
    this.publish();
    return entries.length;
  }

  /**
   * Applies a preset through the normal brush setter.
   *
   * The brush values are exactly what the preset stored; the setter keeps this
   * an editor-only change, so applying a preset cannot dirty the drawing.
   *
   * The preset also becomes the brush's origin, so a later edit of the brush
   * can still be reset back to it, and it is stamped as used, so the browser
   * can offer the brushes that were used lately.
   */
  applyBrushPreset(id: string): boolean {
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (!preset) {
      return false;
    }
    this.activePresetId = id;
    const used: BrushPreset = { ...preset, lastUsedAt: Date.now() };
    this.presets = this.presets.map((candidate) => (candidate.id === id ? used : candidate));
    // The same path `setBrush` takes: the preset holds every field, so the
    // merged brush is the preset's brush.
    const next = updateBrushSettings(this.brush, used.brush);
    if (!brushSettingsEqual(this.brush, next)) {
      this.brush = next;
    }
    this.commands.breakMerge();
    this.publish();
    return true;
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

  /**
   * Sets what the bucket measures its region against.
   *
   * `merged` samples every visible layer, `active` samples the active layer
   * alone and `layer` samples one chosen layer. Editor state, like
   * `fillTolerance`: a committed fill stores the pixels it painted.
   */
  setFillReference(reference: FillReferenceMode): void {
    const next = normalizeFillReference(reference);
    if (next === this.fillReference) {
      return;
    }
    this.fillReference = next;
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Sets the layer the bucket samples in the `layer` reference mode.
   *
   * The id belongs to a document, so it is never serialized: a restored
   * preference falls back to the active layer until the user picks one.
   */
  setFillReferenceLayer(layerId: LayerId | null): void {
    if (layerId !== null && !this.layerExists(layerId)) {
      return;
    }
    if (layerId === this.fillReferenceLayerId) {
      return;
    }
    this.fillReferenceLayerId = layerId;
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Sets how far the bucket grows (positive) or shrinks (negative) the region
   * it found, in document pixels.
   */
  setFillExpand(expand: number): void {
    const next = normalizeFillExpand(expand);
    if (next === this.fillExpand) {
      return;
    }
    this.fillExpand = next;
    this.commands.breakMerge();
    this.publish();
  }

  /** Sets how wide the bucket's soft edge is, in document pixels. */
  setFillAntialias(antialias: number): void {
    const next = normalizeFillAntialias(antialias);
    if (next === this.fillAntialias) {
      return;
    }
    this.fillAntialias = next;
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Sets how wide a passage the bucket seals, in document pixels.
   *
   * A passage narrower than this cannot leak the fill into the shape next
   * door, so a one-pixel break in the line art no longer ruins the fill.
   */
  setFillCloseGaps(closeGaps: number): void {
    const next = normalizeFillCloseGaps(closeGaps);
    if (next === this.fillCloseGaps) {
      return;
    }
    this.fillCloseGaps = next;
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

  /**
   * Sets the middle stops of the next gradient.
   *
   * Endpoints stay the brush colour and `gradientEndColor`; a stop at either
   * edge is dropped, invalid colours are ignored and offsets are sorted and
   * clamped. Like the other gradient options this describes the next drag only:
   * a committed gradient keeps the stops it was drawn with.
   */
  setGradientMidStops(stops: readonly GradientStop[]): void {
    const next = normalizeGradientMidStops(stops);
    if (gradientStopsEqual(this.gradientMidStops, next)) {
      return;
    }
    this.gradientMidStops = next;
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Shows or hides the grid.
   *
   * Display state, not an edit: it changes no pixels on a layer, writes
   * nothing to history and does not dirty the file. The grid is painted on the
   * display canvas only, so an export is identical whether it was on or off.
   */
  setGridVisible(visible: boolean): void {
    if (this.gridVisible === visible) {
      return;
    }
    this.gridVisible = visible;
    this.syncGridToRenderer();
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Sets the grid spacing in document pixels (`2..500`, whole pixels).
   *
   * Like the visibility, this is display state: a spacing change is not an
   * edit and never rewrites a stroke. Out-of-range values are clamped and a
   * non-finite value restores the default rather than producing an unreadable
   * grid.
   */
  setGridSpacing(spacing: number): void {
    const next = normalizeGridSpacing(spacing);
    if (next === this.gridSpacing) {
      return;
    }
    this.gridSpacing = next;
    this.syncGridToRenderer();
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Turns snapping on or off.
   *
   * While it is on, a drawing sample within 6 CSS pixels of a guide or a grid
   * line is committed exactly on that target. The tolerance is converted with
   * the live zoom, so the same physical gesture snaps identically at every
   * zoom. Snapping changes where the next sample lands; it never moves a
   * committed stroke and is not an undoable step.
   */
  setGridSnapping(snap: boolean): void {
    if (this.gridSnapping === snap) {
      return;
    }
    this.gridSnapping = snap;
    this.syncGridToRenderer();
    this.commands.breakMerge();
    this.publish();
  }

  /** Pushes the current grid settings to the renderer, if one is attached. */
  private syncGridToRenderer(): void {
    this.renderer?.setGrid({
      visible: this.gridVisible,
      spacing: this.gridSpacing,
      snap: this.gridSnapping,
    });
  }

  /**
   * Shows or hides the ruler strips.
   *
   * Display state, not an edit: the rulers measure the view, so they change no
   * pixels on a layer, write nothing to history and do not dirty the file.
   * They are painted on the display canvas only, so an export is identical
   * whether they were on or off.
   */
  setRulersVisible(visible: boolean): void {
    if (this.rulersVisible === visible) {
      return;
    }
    this.rulersVisible = visible;
    this.syncOverlaysToRenderer();
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Turns the symmetry on or off.
   *
   * Editor state, like the grid: it describes the *next* stroke. The copies it
   * produces are ordinary strokes, so turning it on or off never rewrites a
   * stroke that is already on the canvas.
   */
  setSymmetryEnabled(enabled: boolean): void {
    if (this.symmetryEnabled === enabled) {
      return;
    }
    this.symmetryEnabled = enabled;
    this.syncOverlaysToRenderer();
    this.commands.breakMerge();
    this.publish();
  }

  /** Chooses the symmetry the copies use. */
  setSymmetryMode(mode: SymmetryMode): void {
    const next = normalizeSymmetryMode(mode);
    if (this.symmetryMode === next) {
      return;
    }
    this.symmetryMode = next;
    this.syncOverlaysToRenderer();
    this.commands.breakMerge();
    this.publish();
  }

  /** Sets how many copies the radial symmetry draws (`2..12`). */
  setSymmetryCount(count: number): void {
    const next = normalizeSymmetryCount(count);
    if (this.symmetryCount === next) {
      return;
    }
    this.symmetryCount = next;
    this.syncOverlaysToRenderer();
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Moves the symmetry centre, in document pixels.
   *
   * The centre is editor state, like the grid: moving it is not an edit, so it
   * adds no history step and never marks the document unsaved. The position is
   * rounded to a whole document pixel, because a fractional centre would put
   * the copies on a half-pixel and blur their edge at some zooms.
   */
  setSymmetryCenter(center: Point): void {
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      return;
    }
    const next = { x: Math.round(center.x), y: Math.round(center.y) };
    if (this.symmetryCenter.x === next.x && this.symmetryCenter.y === next.y) {
      return;
    }
    this.symmetryCenter = next;
    this.syncOverlaysToRenderer();
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Puts the symmetry centre back in the middle of the paper.
   *
   * The reset the panel's **Centre** action runs: the centre belongs to the
   * paper it is used on, so it starts (and can always be put back) at the
   * middle of the document.
   */
  resetSymmetryCenter(): void {
    this.setSymmetryCenter({
      x: Math.round(this.doc.width / 2),
      y: Math.round(this.doc.height / 2),
    });
  }

  /** The symmetry settings, as the renderer and the copy builder read them. */
  private symmetrySettings(): SymmetrySettings {
    return {
      enabled: this.symmetryEnabled,
      mode: this.symmetryMode,
      count: this.symmetryCount,
      center: this.symmetryCenter,
    };
  }

  /** Pushes the ruler and symmetry settings to the renderer, if one is attached. */
  private syncOverlaysToRenderer(): void {
    this.renderer?.setRulers({ visible: this.rulersVisible });
    this.renderer?.setSymmetry(this.symmetrySettings());
  }

  /**
   * Starts dragging the symmetry centre, if the press landed on the marker.
   *
   * The centre is a handle, so it wins over the active tool: a press on the
   * marker moves the centre instead of drawing. The **select** tool keeps its
   * own handles, because its marquee is how the user picks strokes, and a
   * small marker in the way of a marquee would be in the way of the drawing.
   *
   * Returns whether the press was taken by the marker.
   */
  private beginSymmetryCenterDrag(sample: PointerSample): boolean {
    if (!this.symmetryEnabled || this.currentToolId === "select") {
      return false;
    }
    if (sample.button !== 0) {
      return false;
    }
    if (!isOnSymmetryCenter(this.symmetrySettings(), sample.docX, sample.docY, this.viewport.zoom)) {
      return false;
    }
    this.symmetryCenterGesture = { before: { ...this.symmetryCenter } };
    this.beginGesture();
    this.publish();
    return true;
  }

  /** Moves the symmetry centre to follow the pointer. */
  private moveSymmetryCenter(sample: PointerSample): void {
    if (!this.symmetryCenterGesture) {
      return;
    }
    if (!Number.isFinite(sample.docX) || !Number.isFinite(sample.docY)) {
      return;
    }
    this.setSymmetryCenter({ x: sample.docX, y: sample.docY });
  }

  /**
   * Ends the centre drag, keeping the centre where the pointer left it.
   *
   * The centre is editor state, so there is nothing to commit: the drag ends
   * and the centre stays.
   */
  private endSymmetryCenterDrag(): void {
    this.symmetryCenterGesture = null;
    this.publish();
  }

  /**
   * Cancels the centre drag, putting the centre back where it was.
   *
   * The gesture is aborted by the pointer pipeline losing the pointer (a
   * cancel, a lost capture) or by the escape key, and the user did not ask
   * for the centre to move, so it goes back.
   */
  cancelSymmetryCenterDrag(): boolean {
    const gesture = this.symmetryCenterGesture;
    if (!gesture) {
      return false;
    }
    this.symmetryCenterGesture = null;
    this.setSymmetryCenter(gesture.before);
    this.publish();
    return true;
  }

  /**
   * The sample a drawing tool should see, with snapping applied.
   *
   * Tools that read pixels or do not commit drawing samples are left alone, so
   * a bucket press fills under the pointer and a guide drag stays a guide drag.
   * When snapping is off, or no target is in reach, the sample is returned
   * as-is: enabling snapping never makes an untouched sample move.
   *
   * Two rules keep the snap from changing what a gesture *is*:
   *
   *  - a press outside the paper is ignored by every drawing gesture, so the
   *    snap never pulls a point that started outside onto the paper;
   *  - a snap that would leave the paper is not applied, so a gesture can
   *    never be refused by its own snap.
   */
  private snapSample(sample: PointerSample): PointerSample {
    if (!this.gridSnapping || !SNAPPING_TOOL_IDS.has(this.currentToolId)) {
      return sample;
    }
    if (!isInsideDocument(this.doc, sample.docX, sample.docY)) {
      return sample;
    }
    const result = snapDocumentPoint(sample.docX, sample.docY, {
      enabled: true,
      guides: this.doc.guides,
      spacing: this.gridSpacing,
      zoom: this.viewport.zoom,
    });
    const x = result.x >= 0 && result.x <= this.doc.width ? result.x : sample.docX;
    const y = result.y >= 0 && result.y <= this.doc.height ? result.y : sample.docY;
    if (!result.snappedX && !result.snappedY) {
      return sample;
    }
    if (x === sample.docX && y === sample.docY) {
      return sample;
    }
    return { ...sample, docX: x, docY: y };
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
    // The gradient selection belongs to the gradient tool: leaving it drops
    // the selection rather than leaving handles over a gradient the tool can
    // no longer edit.
    if (toolId !== "gradient") {
      this.clearGradientSelection();
    }
    this.commands.breakMerge();
    this.publish();
  }

  /**
   * Sets the transform of the **active** view.
   *
   * The tools call this when the user pans or zooms, and the commands call it
   * for the view they act on, so a gesture in one view never moves the other.
   */
  setViewport(viewport: Viewport, republishCursor = true): void {
    this.setViewViewport(this.views.activeId, viewport, republishCursor);
  }

  /**
   * Sets the transform of one view.
   *
   * The renderer is told about it, so the view shows the new placement at
   * once, and the view's own cursor is re-asked for: the document point under
   * the pointer is a different one now, and so is the answer to "is a handle
   * under the pointer?".
   */
  private setViewViewport(
    viewId: ViewId,
    viewport: Viewport,
    republishCursor = true,
  ): void {
    const view = this.views.get(viewId);
    if (!view) {
      return;
    }
    // Measured before the change: the zoom of the view being set, not of the
    // active one, so a zoom in the second view does not read as a zoom of the
    // first.
    const zoomChanged = viewport.zoom !== view.viewport.zoom;
    view.viewport = viewport;
    this.renderer?.setDisplayTargetViewport?.(viewId, viewport);
    if (republishCursor) {
      this.republishCursor(viewId);
    }
    if (zoomChanged) {
      // The cursor ring is a document measurement drawn through the zoom, so
      // a zoom changes its size on screen.
      this.emitBrushCursor();
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
    this.zoomAtAnchor(this.viewport.zoom * ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomAtAnchor(this.viewport.zoom / ZOOM_STEP);
  }

  zoomTo(zoom: number): void {
    this.zoomAtAnchor(zoom);
  }

  zoomToFit(): void {
    const size = this.activeViewSize;
    if (size.width <= 0 || size.height <= 0) {
      return;
    }
    // The fit keeps the view's current orientation: a turned document is fitted
    // by its turned bounding box, so the whole paper still fits on screen.
    this.setViewport(
      fitToViewport(size, this.documentSize(), 32, viewTransformOf(this.viewport)),
    );
  }

  /**
   * Turns the view clockwise by `degrees`.
   *
   * View-only: the document's pixels, the history and the dirty flag are all
   * untouched - the user is looking at the paper from another angle, not
   * editing it.
   */
  rotateView(degrees: number): void {
    this.setViewport(
      rotateView(this.viewport, this.activeViewSize, (degrees * Math.PI) / 180),
    );
  }

  /**
   * Mirrors the view left to right, or back.
   *
   * View-only, like the rotation: the document is not flipped, the view of it
   * is. The picture on screen is the paper turned over, and a PNG export is
   * the untouched document.
   */
  toggleViewMirror(): void {
    this.setViewport(toggleViewMirror(this.viewport, this.activeViewSize));
  }

  /**
   * Puts the view back the way it was found: the whole document, upright and
   * unmirrored.
   *
   * View-only, like every other view action: no history entry, no dirty flag.
   */
  resetView(): void {
    const size = this.activeViewSize;
    if (size.width <= 0 || size.height <= 0) {
      // Nothing is laid out yet, so there is no frame to fit the paper into;
      // the orientation is still cleared.
      this.setViewport({ ...this.viewport, zoom: 1, transform: DEFAULT_VIEW_TRANSFORM });
      return;
    }
    this.setViewport(resetView(size, this.documentSize()));
  }

  /**
   * Holds or releases the temporary pan modifier.
   *
   * While it is held, a drag on the canvas pans the view instead of drawing,
   * whatever the active tool is. The modifier only decides what a *new* press
   * does: a stroke that is already in flight keeps drawing, so the artwork can
   * never be lost to a stray key press.
   *
   * The modifier is view-only: it moves the canvas and touches nothing else.
   */
  setPanModifier(pressed: boolean): void {
    if (this.panModifier === pressed) {
      return;
    }
    this.panModifier = pressed;
    // The cursor answers the modifier, so it has to be re-asked for.
    this.republishCursor();
  }

  /**
   * Moves the view so that a document point sits in the middle of the canvas.
   *
   * The zoom does not change: this moves the view, it does not magnify it.
   * View state, like a pan or a zoom - no history entry, no revision bump and
   * no dirty flag.
   *
   * The offset is derived from the view transform the viewport already has, so
   * the point lands in the middle of the canvas whether the view is upright,
   * turned or mirrored.
   */
  centerViewportOn(docX: number, docY: number): void {
    const { width, height } = this.activeViewSize;
    if (width <= 0 || height <= 0) {
      return;
    }
    // Where the point is on screen right now, minus the current translation,
    // is the transform's own contribution: the offset that puts it in the
    // middle is the centre of the canvas minus that contribution.
    const screen = docToScreen(this.viewport, docX, docY);
    this.setViewport({
      ...this.viewport,
      offsetX: width / 2 - (screen.x - this.viewport.offsetX),
      offsetY: height / 2 - (screen.y - this.viewport.offsetY),
    });
  }

  /**
   * Moves the view so that the whole document sits in the middle of the canvas.
   *
   * The zoom stays where it is; only the pan changes. View state: no history
   * entry, no revision bump and no dirty flag.
   */
  centerViewport(): void {
    const size = this.activeViewSize;
    if (size.width <= 0 || size.height <= 0) {
      return;
    }
    const document = this.documentSize();
    this.centerViewportOn(document.width / 2, document.height / 2);
  }

  /**
   * A small overview of the document, for a navigator panel.
   *
   * The overview is cached: it is rebuilt only when the document changed or a
   * different size was asked for, so panning, zooming and redrawing the panel
   * cost nothing. A gesture in flight owns content that is not in the document
   * yet, so the cached overview is returned unchanged until the gesture ends.
   *
   * A read: no document pixel changes, nothing enters history and the
   * document is not marked dirty.
   */
  getOverview(width: number, height: number): HTMLCanvasElement | null {
    const renderer = this.renderer;
    if (!renderer) {
      return null;
    }
    const targetWidth = Math.max(1, Math.round(width));
    const targetHeight = Math.max(1, Math.round(height));
    const cached = this.overview;
    if (
      cached &&
      cached.document === this.doc &&
      cached.revision === this.revision &&
      cached.width === targetWidth &&
      cached.height === targetHeight
    ) {
      return cached.canvas;
    }
    if (this.isGestureActive()) {
      return cached?.canvas ?? null;
    }
    const canvas = renderer.renderOverview(targetWidth, targetHeight);
    this.overview = canvas
      ? {
          document: this.doc,
          revision: this.revision,
          width: targetWidth,
          height: targetHeight,
          canvas,
        }
      : null;
    return canvas;
  }

  // ------------------------------------------------------------------ history

  /** True while a pointer gesture owns content that is not yet in history. */
  private isGestureActive(): boolean {
    return (
      this.activeStroke !== null ||
      this.activeFill !== null ||
      this.activeGradient !== null ||
      this.gradientEdit !== null ||
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

    const stroke = createStrokeRecord(layerId, this.brushForSample(sample), this.activeTool().erases === true);
    const builder = new StrokeBuilder(stroke);
    builder.addSample(toStrokeSample(sample));

    this.beginGesture();
    this.strokeBuilder = builder;
    this.activeStroke = stroke;
    // The cursor ring fades while a stroke is in flight, so the artwork under
    // the pointer stays readable.
    this.emitBrushCursor();

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
      shapeBrush(this.brushForSample(sample)),
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
    this.emitBrushCursor();
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
   * The region is sampled from the **reference** the options name: the merged
   * visible composite (paper plus every visible layer at its opacity), the
   * active layer alone, or one chosen layer. The committed patch is written to
   * the **active layer**, exactly like a stroke. The patch enters the layer
   * immediately so the visible pixels are the real result; `finishFill` records
   * the history step on release and `cancelFill` removes it cleanly.
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

    // The reference decides which layers the region is measured against. A
    // layer the user cannot see cannot bound a region either, so a hidden
    // sample layer is refused rather than silently sampling the paper alone.
    const sampleLayers = fillReferenceLayers(
      this.fillReference,
      this.doc.activeLayerId,
      this.fillReferenceLayerId,
    );
    if (sampleLayers !== null) {
      for (const candidate of sampleLayers) {
        const layer = this.doc.layers.find((known) => known.id === candidate);
        if (!layer || !layer.visible) {
          this.raiseNotice(
            layer
              ? `The bucket cannot sample the hidden layer "${layer.name}".`
              : "The bucket cannot sample a layer that is no longer in the document.",
          );
          return false;
        }
      }
    }

    const image = this.renderer?.readCompositeImage({ layerIds: sampleLayers });
    if (!image) {
      return false;
    }

    const seedX = Math.min(this.doc.width - 1, Math.max(0, Math.floor(sample.docX)));
    const seedY = Math.min(this.doc.height - 1, Math.max(0, Math.floor(sample.docY)));
    const colour = this.brushForSample(sample).color;
    const region = scanFill(image, seedX, seedY, {
      tolerance: this.fillTolerance,
      expand: this.fillExpand,
      antialias: this.fillAntialias,
      closeGaps: this.fillCloseGaps,
    });
    if (!region) {
      return false;
    }

    // A fill that would paint the colour that is already there changes nothing
    // the user can see. Recording an invisible undo step would make the history
    // button look broken, so the press is refused instead.
    if (this.fillChangesNothing(image, region, colour)) {
      return false;
    }

    const patch = createFillPatch(layerId, colour, region);
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
   * Whether the fill would paint the colour that is already there.
   *
   * Every covered pixel of the reference already shows the fill colour, so the
   * patch would be invisible. Recording it would add an undo step the user
   * cannot see, which is what makes the history button look broken - and it
   * would dirty a document that did not change.
   *
   * The comparison is against the **reference** the fill sampled, because that
   * is the picture the region was measured against. A region that already
   * carries the fill colour is refused whatever the reference was.
   */
  private fillChangesNothing(
    image: ImageData,
    region: FillScanResult,
    colour: string,
  ): boolean {
    const rgb = hexToRgb(colour);
    if (!rgb) {
      return false;
    }
    for (let row = 0; row < region.height; row += 1) {
      const sourceRow = (region.y + row) * image.width + region.x;
      const maskRow = row * region.width;
      for (let column = 0; column < region.width; column += 1) {
        if (region.mask[maskRow + column] === 0) {
          continue;
        }
        const offset = (sourceRow + column) * 4;
        if (
          image.data[offset] !== rgb.r ||
          image.data[offset + 1] !== rgb.g ||
          image.data[offset + 2] !== rgb.b
        ) {
          return false;
        }
      }
    }
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
      this.brushForSample(sample).color,
      this.gradientEndColor,
      this.brush.opacity,
      this.gradientMidStops,
    );
    const index = this.strokes.elementCount(layerId);
    this.strokes.insert(gradient);
    this.beginGesture();
    this.activeGradient = { gradient, index };
    // A new gradient takes over from the selected one: its handles would
    // otherwise lie over the gradient being drawn.
    this.clearGradientSelection();
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
    // The gradient just drawn is the one the tool now owns: its handles appear
    // straight away, so its geometry can be adjusted without selecting it
    // again.
    this.setSelectedGradient({
      id: active.gradient.id,
      layerId: active.gradient.layerId,
    });
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

  // ------------------------------------------------ gradient selection & edit

  /** The gradient with this id on a layer, or `null` when it is not there. */
  private findGradient(layerId: LayerId, gradientId: string): GradientRecord | null {
    for (const element of this.strokes.listElements(layerId)) {
      if (isGradient(element) && element.id === gradientId) {
        return element;
      }
    }
    return null;
  }

  /**
   * Selects the gradient under a document point.
   *
   * The hit test is against the gradient's **geometry** - the axis of a linear
   * gradient, the circle of a radial one - and not against its pixels: a
   * gradient paints its whole layer, so every point of the paper belongs to it
   * and only the geometry can say which one the user meant. The topmost
   * gradient on the active layer wins, because the topmost one is the one the
   * user sees.
   *
   * Returns whether a gradient was selected.
   */
  selectGradientAt(docX: number, docY: number): boolean {
    const layerId = this.doc.activeLayerId;
    if (!layerId) {
      return false;
    }
    const radius = this.gradientHandleGrabRadius();
    const elements = this.strokes.listElements(layerId);
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const element = elements[index];
      if (!isGradient(element)) {
        continue;
      }
      if (!gradientGeometryHit(element, docX, docY, radius)) {
        continue;
      }
      this.setSelectedGradient({ id: element.id, layerId });
      return true;
    }
    return false;
  }

  /**
   * Drops the gradient selection and its overlay.
   *
   * Not an edit: nothing enters history and the document is untouched. The
   * selection belongs to the gradient tool, so it is dropped when the tool is
   * left, when the layer changes and when the gradient itself goes away.
   */
  clearGradientSelection(): void {
    if (!this.selectedGradient) {
      this.selectedGradientHandle = null;
      this.syncSelectedGradientState();
      this.syncGradientOverlay();
      return;
    }
    this.setSelectedGradient(null);
  }

  /**
   * Replaces the gradient selection.
   *
   * Every change goes through here, so the merge run is broken and the overlay
   * and the published state are refreshed together: a selection change is an
   * action between gesture runs, and two edits separated by it stay two undo
   * steps.
   */
  private setSelectedGradient(next: { id: string; layerId: LayerId } | null): void {
    this.selectedGradient = next;
    this.selectedGradientHandle = null;
    this.commands.breakMerge();
    this.syncSelectedGradientState();
    this.syncGradientOverlay();
    this.publish();
  }

  /**
   * Rebuilds the published view of the selected gradient.
   *
   * The object is only replaced when a value really changed, so the snapshot
   * can compare it by identity and a publish that changes nothing stays silent.
   */
  private syncSelectedGradientState(): void {
    const selected = this.selectedGradient;
    const gradient = selected
      ? this.findGradient(selected.layerId, selected.id)
      : null;
    if (!selected || !gradient) {
      this.selectedGradientState = null;
      return;
    }
    const handle = this.gradientEdit?.handle ?? this.selectedGradientHandle;
    const previous = this.selectedGradientState;
    if (
      previous &&
      previous.id === gradient.id &&
      previous.type === gradient.type &&
      previous.x1 === gradient.x1 &&
      previous.y1 === gradient.y1 &&
      previous.x2 === gradient.x2 &&
      previous.y2 === gradient.y2 &&
      previous.handle === handle
    ) {
      return;
    }
    this.selectedGradientState = {
      id: gradient.id,
      type: gradient.type,
      x1: gradient.x1,
      y1: gradient.y1,
      x2: gradient.x2,
      y2: gradient.y2,
      handle,
    };
  }

  /**
   * Hands the renderer the gradient overlay.
   *
   * The overlay belongs to the **selected** gradient on the **active** layer: a
   * gradient on another layer is not the tool's business, and a selection that
   * names a gradient which no longer exists draws nothing. The positions are
   * the gradient's own points, so the handles sit on it at any zoom.
   */
  private syncGradientOverlay(): void {
    const renderer = this.renderer;
    if (!renderer) {
      return;
    }
    const selected = this.selectedGradient;
    const gradient =
      selected && selected.layerId === this.doc.activeLayerId
        ? this.findGradient(selected.layerId, selected.id)
        : null;
    if (!gradient) {
      renderer.setGradientOverlay(null);
      return;
    }
    const handles = gradientHandles(gradient);
    renderer.setGradientOverlay({
      type: gradient.type,
      start: handles.start,
      end: handles.end,
      activeHandle: this.gradientEdit?.handle ?? this.selectedGradientHandle,
    });
  }

  /** The gradient handles' grab radius, in document units. */
  private gradientHandleGrabRadius(): number {
    const zoom = this.viewport.zoom;
    if (!Number.isFinite(zoom) || zoom <= 0) {
      return GRADIENT_HANDLE_GRAB_RADIUS_PX;
    }
    return GRADIENT_HANDLE_GRAB_RADIUS_PX / zoom;
  }

  /**
   * Sets the source of the reference images, or clears it with `null`.
   *
   * The engine subscribes to the source: a change in the references is a
   * change in what the artist sees, so the overlay is rebuilt and the canvas
   * is redrawn. Nothing about a reference is published in the editor snapshot
   * or written to a file: a reference is not document state, and it can never
   * make a document dirty.
   */
  setReferenceSource(source: ReferenceSource | null): void {
    if (this.referenceSource === source) {
      return;
    }
    this.referenceUnsubscribe?.();
    this.referenceUnsubscribe = null;
    this.referenceSource = source;
    this.hoveredReferenceId = null;
    if (source) {
      this.referenceUnsubscribe = source.subscribe(() => {
        this.syncReferenceOverlay();
        this.requestRender();
      });
    }
    this.syncReferenceOverlay();
    this.requestRender();
  }

  /**
   * Hands the renderer the reference overlay.
   *
   * The overlay carries the images and the pixels to draw them with, plus the
   * reference that is selected and the one under the pointer, so the renderer
   * can draw the frames that tell the artist which image a press would
   * sample. A reference with no decoded pixels is left out: there is nothing
   * to draw.
   */
  private syncReferenceOverlay(): void {
    const renderer = this.renderer;
    if (!renderer) {
      return;
    }
    const source = this.referenceSource;
    if (!source) {
      renderer.setReferenceOverlay(null);
      return;
    }
    const items: ReferenceOverlayItem[] = [];
    for (const reference of source.references) {
      const pixels = source.sourceFor(reference.id);
      if (pixels) {
        items.push({ reference, source: pixels });
      }
    }
    renderer.setReferenceOverlay({
      items,
      selectedId: source.selectedId,
      hoveredId: this.hoveredReferenceId,
    });
  }

  /**
   * The reference under a workspace point, or `null`.
   *
   * The point is in **workspace space** - the canvas' own CSS pixels - because
   * that is the space a reference lives in. The reference is found in the
   * source, which knows which one is on top.
   *
   * Only the main canvas carries references, so a point in the second view
   * never finds one.
   */
  private referenceAt(screenX: number, screenY: number): ReferenceImage | null {
    if (this.pointerViewId !== PRIMARY_VIEW_ID) {
      return null;
    }
    return this.referenceSource?.hitTest(screenX, screenY) ?? null;
  }

  /**
   * Drops the gradient selection when the gradient it names is gone.
   *
   * An undo can remove the gradient (an undone creation) and a redo can bring
   * it back (a redone one). The selection follows the content rather than
   * outliving it, so the handles never describe a gradient that is not there.
   */
  private pruneGradientSelection(): void {
    const selected = this.selectedGradient;
    if (!selected) {
      return;
    }
    if (this.findGradient(selected.layerId, selected.id)) {
      return;
    }
    this.setSelectedGradient(null);
  }

  /**
   * The gradient handle a press grabs, or `null` when it grabs none.
   *
   * The selected gradient's own handles are the only ones on the canvas: a
   * gradient is not selected by clicking on it, it is selected by clicking on
   * its geometry, and only then do its handles exist.
   */
  findGradientHandleAt(docX: number, docY: number): GradientHandleId | null {
    const selected = this.selectedGradient;
    if (!selected || selected.layerId !== this.doc.activeLayerId) {
      return null;
    }
    const gradient = this.findGradient(selected.layerId, selected.id);
    if (!gradient) {
      return null;
    }
    return findGradientHandle(
      gradientHandles(gradient),
      docX,
      docY,
      this.gradientHandleGrabRadius(),
    );
  }

  /**
   * Starts dragging one of the selected gradient's handles.
   *
   * Returns whether a handle was grabbed. The drag is a **preview**: the
   * record is replaced in place and the layer is re-rasterized, so the user
   * sees the real gradient, but nothing enters history until the release.
   */
  beginGradientHandleDrag(sample: PointerSample): boolean {
    if (this.activeStroke || this.activeFill || this.activeGradient || this.gradientEdit) {
      return false;
    }
    const selected = this.selectedGradient;
    if (!selected || selected.layerId !== this.doc.activeLayerId) {
      return false;
    }
    const gradient = this.findGradient(selected.layerId, selected.id);
    if (!gradient) {
      // The gradient is gone (an undo removed it): there is nothing to drag.
      this.clearGradientSelection();
      return false;
    }
    const handle = findGradientHandle(
      gradientHandles(gradient),
      sample.docX,
      sample.docY,
      this.gradientHandleGrabRadius(),
    );
    if (!handle) {
      return false;
    }
    this.beginGesture();
    this.gradientEdit = {
      gradientId: gradient.id,
      layerId: gradient.layerId,
      handle,
      original: gradient,
      current: gradient,
    };
    this.selectedGradientHandle = handle;
    this.commands.breakMerge();
    this.syncSelectedGradientState();
    this.publish();
    this.requestRender();
    return true;
  }

  /**
   * Moves the dragged handle, previewing the result.
   *
   * The record is replaced in place - same id, same place in the painting
   * order - and the layer is invalidated, so the renderer rebuilds the gradient
   * from the document. No history entry is recorded: the release records one
   * command for the whole drag.
   */
  updateGradientHandleDrag(sample: PointerSample): void {
    const edit = this.gradientEdit;
    if (!edit) {
      return;
    }
    if (!this.layerExists(edit.layerId)) {
      this.cancelGradientHandleDrag();
      return;
    }
    const next = moveGradientHandle(
      edit.current,
      edit.handle,
      this.clampToDocumentX(sample.docX),
      this.clampToDocumentY(sample.docY),
    );
    if (next === edit.current) {
      return;
    }
    edit.current = next;
    this.strokes.replace(next);
    this.renderer?.invalidateLayer(next.layerId);
    this.syncSelectedGradientState();
    this.syncGradientOverlay();
    this.publish();
    this.requestRender();
  }

  /**
   * Commits the handle drag as one undoable step.
   *
   * A drag that ended where it started records nothing, so history never holds
   * a step that appears to do nothing. A drag that collapsed the gradient - the
   * two handles on top of each other - restores the committed gradient rather
   * than recording an invisible step.
   */
  finishGradientHandleDrag(): void {
    const edit = this.gradientEdit;
    if (!edit) {
      return;
    }
    this.gradientEdit = null;
    if (!this.layerExists(edit.layerId)) {
      // The layer vanished under the gesture: nothing to commit.
      this.syncGradientOverlay();
      this.publish();
      return;
    }
    const original = edit.original;
    const next = edit.current;
    if (gradientGeometryEqual(original, next) || gradientIsDegenerate(next)) {
      this.strokes.replace(original);
      this.renderer?.invalidateLayer(edit.layerId);
      this.syncSelectedGradientState();
      this.syncGradientOverlay();
      this.publish();
      this.requestRender();
      return;
    }
    this.revision += 1;
    this.commands.breakMerge();
    this.commands.push(createGradientEditCommand(original, next, this.gradientEditHost));
    this.syncSelectedGradientState();
    this.syncGradientOverlay();
    this.publish();
    this.requestRender();
  }

  /**
   * Aborts the handle drag, restoring the committed gradient exactly.
   *
   * The record that was committed is put back - the same object - so a cancel
   * leaves the document byte-identical to what it was. Nothing enters history
   * and the revision does not move.
   */
  cancelGradientHandleDrag(): void {
    const edit = this.gradientEdit;
    if (!edit) {
      return;
    }
    this.gradientEdit = null;
    this.strokes.replace(edit.original);
    this.renderer?.invalidateLayer(edit.layerId);
    this.syncSelectedGradientState();
    this.syncGradientOverlay();
    this.publish();
    this.requestRender();
  }

  /** True while a gradient handle is being dragged. */
  isGradientHandleDragActive(): boolean {
    return this.gradientEdit !== null;
  }

  /**
   * Cancels the gradient gesture in flight and clears the selection.
   *
   * The `Esc` key owns this: a drag in flight is abandoned - the committed
   * gradient is restored exactly - and the selection goes with it. The tool is
   * reset as well, so a cancel that comes from outside the pointer pipeline
   * does not leave it believing a drag is still running.
   */
  cancelGradientGesture(): void {
    this.cancelGradientHandleDrag();
    this.tools.gradient.reset(this.toolContext);
    this.clearGradientSelection();
  }

  /**
   * Moves the selected gradient's focused handle by a fixed delta.
   *
   * The focused handle is the one the user last grabbed; the arrow keys move
   * it by one document pixel, or ten with Shift. Repeated nudges coalesce in
   * the command stack, so a held arrow key is one history step rather than one
   * per repeat - the same rule the stroke selection follows.
   */
  nudgeGradientHandle(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) {
      return false;
    }
    const selected = this.selectedGradient;
    const handle = this.selectedGradientHandle;
    if (!selected || !handle) {
      return false;
    }
    const gradient = this.findGradient(selected.layerId, selected.id);
    if (!gradient) {
      return false;
    }
    const point =
      handle === "start"
        ? { x: gradient.x1, y: gradient.y1 }
        : { x: gradient.x2, y: gradient.y2 };
    return this.commitGradientHandleMove(gradient, handle, point.x + dx, point.y + dy, true);
  }

  /**
   * Moves the selected gradient's focused handle to an absolute position.
   *
   * The numeric path: a panel that shows the geometry can write a number back
   * through the same code the pointer drag uses, so both produce the same
   * record and the same history step.
   */
  setGradientHandlePosition(x: number, y: number): boolean {
    const selected = this.selectedGradient;
    const handle = this.selectedGradientHandle;
    if (!selected || !handle) {
      return false;
    }
    const gradient = this.findGradient(selected.layerId, selected.id);
    if (!gradient) {
      return false;
    }
    return this.commitGradientHandleMove(gradient, handle, x, y, false);
  }

  /**
   * Writes a moved handle into the document and records it.
   *
   * The record is replaced in place and the layer is invalidated, so the
   * pixels follow immediately. `mergeKey` lets a run of nudges collapse into
   * one history entry; a single move (a numeric field) records its own step.
   */
  private commitGradientHandleMove(
    original: GradientRecord,
    handle: GradientHandleId,
    x: number,
    y: number,
    merge: boolean,
  ): boolean {
    const next = moveGradientHandle(
      original,
      handle,
      this.clampToDocumentX(x),
      this.clampToDocumentY(y),
    );
    if (next === original || gradientGeometryEqual(original, next)) {
      return false;
    }
    this.strokes.replace(next);
    this.renderer?.invalidateLayer(next.layerId);
    this.revision += 1;
    this.commands.push(
      createGradientEditCommand(
        original,
        next,
        this.gradientEditHost,
        merge ? `gradient-nudge:${next.id}:${handle}` : undefined,
      ),
    );
    this.syncSelectedGradientState();
    this.syncGradientOverlay();
    this.publish();
    this.requestRender();
    return true;
  }

  /** Clamps a document x to the paper. */
  private clampToDocumentX(x: number): number {
    return clamp(x, 0, this.doc.width);
  }

  /** Clamps a document y to the paper. */
  private clampToDocumentY(y: number): number {
    return clamp(y, 0, this.doc.height);
  }

  /**
   * Commits the in-progress stroke.
   *
   * The release sample is the pointer's last known position. It is what the
   * stroke ends on: a stabilized path lags behind a moving pointer, and the
   * catch-up in `finish()` lands the last stored sample exactly on the
   * release point. Without a release sample the last raw position is the
   * target, which is where the pointer was when the stroke ended.
   */
  finishStroke(release?: PointerSample): void {
    const builder = this.strokeBuilder;
    const stroke = this.activeStroke;
    this.strokeBuilder = null;
    this.activeStroke = null;
    this.emitBrushCursor();
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
      // appends the catch-up, so the settled segment is previewed and then
      // committed like any other sample.
      const fromIndex = builder.pointCount;
      builder.finish(release ? toStrokeSample(release) : undefined);
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

    // A symmetric stroke commits its copies with it: the copies are ordinary
    // strokes, so the layer holds them like any other content, and the whole
    // set is one undo step - the user drew one thing, not six.
    const copies = this.symmetryCopiesFor(stroke);
    if (copies.length === 0) {
      this.commands.push(createStrokeCommand(stroke, index, this.commandHost));
      this.publish();
      return;
    }

    const commands: Command[] = [createStrokeCommand(stroke, index, this.commandHost)];
    copies.forEach((copy, copyIndex) => {
      const copyIndexInLayer = index + 1 + copyIndex;
      this.strokes.insert(copy, copyIndexInLayer);
      // The copy reaches the layer the way the stroke itself did: it is
      // rasterized into the surface, in painting order, so the committed
      // pixels are the copy's own rather than a re-rasterization of the
      // whole layer.
      this.renderer?.beginStroke(copy);
      this.renderer?.extendStroke(copy, 0);
      this.renderer?.endStroke(copy);
      commands.push(createStrokeCommand(copy, copyIndexInLayer, this.commandHost));
    });
    this.commands.push(createGroupCommand("Symmetric Stroke", commands));
    this.publish();
  }

  /**
   * The copies a committed stroke gets from the symmetry, or none.
   *
   * The symmetry applies to the tools that *paint*: the brush and the shape
   * tools. The eraser is left alone, because an erasing stroke subtracts
   * coverage from the layer and its copies would have to be subtracted with
   * their own snapshot; the bucket and the gradient are not strokes at all.
   */
  private symmetryCopiesFor(stroke: StrokeRecord): StrokeRecord[] {
    if (!this.symmetryEnabled || stroke.erase === true) {
      return [];
    }
    return createSymmetryCopies(stroke, this.symmetrySettings());
  }

  cancelStroke(): void {
    if (!this.activeStroke) {
      return;
    }
    this.strokeBuilder = null;
    this.activeStroke = null;
    this.emitBrushCursor();
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
   * Selects every stroke on the active layer.
   *
   * A selection is editor state, so nothing enters history and the document
   * does not become dirty. The strokes are the ones the layer holds now, the
   * same ones the marquee would pick up: the selection is stroke-level, so
   * "all" means every whole stroke, not every pixel.
   *
   * Returns whether anything was selected, so a caller can tell a layer with
   * no strokes from a selection.
   */
  selectAll(): boolean {
    this.cancelSelectionGesture();
    const layerId = this.doc.activeLayerId;
    const strokeIds = layerId === null ? [] : this.strokes.list(layerId).map((stroke) => stroke.id);
    this.setSelection(strokeIds.length > 0 && layerId !== null ? { layerId, strokeIds } : null);
    this.syncSelectionOverlay();
    this.publish();
    this.requestRender();
    return strokeIds.length > 0;
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
   * Forgets the gradient selection without publishing.
   *
   * The counterpart of `resetSelection` for the gradient tool: a new document
   * or a loaded project has none of the gradients the selection named, so the
   * selection goes with them. It is not published here, because the callers
   * publish once at the end.
   */
  private resetGradientSelection(): void {
    this.selectedGradient = null;
    this.selectedGradientHandle = null;
    this.gradientEdit = null;
    this.selectedGradientState = null;
    this.syncGradientOverlay();
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
   * The axis a press on a ruler strip would make a guide on, or `null`.
   *
   * The top ruler measures x, so it makes a **vertical** guide; the left
   * ruler measures y, so it makes a **horizontal** one. The rulers are hidden
   * by default, and a press that is not on a strip makes no guide at all.
   */
  rulerAxisAt(screenX: number, screenY: number): GuideAxis | null {
    if (!this.rulersVisible) {
      return null;
    }
    const axis = rulerAxisAt(screenX, screenY);
    if (axis === null) {
      return null;
    }
    return axis === "horizontal" ? "vertical" : "horizontal";
  }

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
   *
   * A guide pulled out of a **ruler** already knows its axis, so the caller
   * passes it: the guide is created at once and the drag moves it along that
   * axis.
   */
  beginGuideCreate(sample: PointerSample, axis?: GuideAxis): void {
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
      axis: axis ?? null,
    };
    if (axis !== undefined) {
      this.setGuideAxis(axis);
    }
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
    if (gesture.axis !== null && gesture.axis !== axis) {
      // A ruler drag fixed the axis; the drag cannot change it.
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
      axis: guide.axis,
    };
  }

  /**
   * Moves the guide of a gesture to follow the pointer.
   *
   * Only the coordinate across the guide's axis matters: a vertical guide
   * follows x and ignores y, so it stays a vertical guide. A move that would
   * land on another guide is refused, like a create that would.
   *
   * A guide that was just pulled out of a ruler is moved by the same rule: the
   * drag carries it along its axis.
   */
  moveGuideTo(sample: PointerSample): void {
    const gesture = this.guideGesture;
    if (!gesture) {
      return;
    }
    if (!Number.isFinite(sample.docX) || !Number.isFinite(sample.docY)) {
      return;
    }
    const guideId = gesture.mode === "move" ? gesture.guideId : gesture.createdId;
    if (guideId === null) {
      return;
    }
    const guide = findGuide(this.doc.guides, guideId);
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

  /**
   * Removes every guide as one undoable step.
   *
   * The guides are document state, so clearing them is an edit: it is recorded
   * in history like any other document change and the file becomes unsaved.
   * Returns whether there was anything to clear.
   */
  clearGuides(): boolean {
    if (this.doc.guides.length === 0) {
      return false;
    }
    const before = this.doc;
    const after = { ...before, guides: [] };
    this.clearGuideSelection();
    this.commitDocumentChange("Clear Guides", before, after);
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

  /**
   * The transform a view starts with: the whole document, in its own frame.
   *
   * Each view gets its own, because each view has its own canvas and its own
   * size - the second view fits the paper into a different frame than the
   * first one.
   */
  private initialViewportFor(view: CanvasView): Viewport {
    const fitted = fitToViewport(view.size, this.documentSize());
    // Never open zoomed in beyond 100%: a small document should look small.
    const zoom = Math.min(1, fitted.zoom);
    return centerOn(view.size, this.documentSize(), zoom);
  }

  /**
   * Zooms while keeping the document point under the pointer where it is.
   *
   * The pointer wins when it is over the canvas, because that is the point the
   * user is looking at; the centre of the viewport is the fallback for a zoom
   * started from the keyboard or from a button.
   */
  private zoomAtAnchor(zoom: number): void {
    const anchor = this.viewAnchor();
    this.setViewport(zoomToAt(this.viewport, anchor.x, anchor.y, zoom));
  }

  /**
   * The screen point a view change is anchored on.
   *
   * The pointer's own position while it is over the canvas, the centre of the
   * viewport otherwise. A rotation or a mirror about the same point keeps what
   * the user is pointing at under the pointer.
   */
  private viewAnchor(): Point {
    const cursor = this.cursor;
    if (cursor && cursor.inside) {
      return { x: cursor.screenX, y: cursor.screenY };
    }
    const size = this.activeViewSize;
    return {
      x: size.width / 2,
      y: size.height / 2,
    };
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
    // The gradient selection belongs to the active layer, exactly like the
    // stroke selection: activating another layer drops it.
    if (
      activeLayerChanged ||
      (this.selectedGradient !== null &&
        !next.layers.some((layer) => layer.id === this.selectedGradient?.layerId))
    ) {
      this.clearGradientSelection();
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
      // The same for a gradient: an undone creation takes the gradient away,
      // and a redone one brings it back.
      this.pruneGradientSelection();
      this.syncGradientOverlay();
      this.syncSelectedGradientState();
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
   *
   * The sample carries the view it came from, because the sample's document
   * coordinates were mapped through *that* view's transform. A press focuses
   * its own view, so the commands that follow act on the window the user is
   * working in.
   */
  handlePointerSample(sample: PointerSample, viewId: ViewId = this.views.activeId): void {
    this.pointerViewId = viewId;
    if (sample.phase === "down" && this.views.activeId !== viewId) {
      // A press in a view makes that view the active one: the zoom, the fit
      // and the rotation that follow act on the window the user touched.
      this.focusView(viewId);
    }
    // The cursor reports where the pointer *is*; snapping only moves the
    // sample a drawing tool commits.
    this.reportCursor(sample, viewId);

    // The quick brush-size resize owns the pointer before any tool sees it, so
    // a resize can never leave a stroke behind.
    if (this.brushSizeGesture !== null) {
      if (sample.phase === "down") {
        // A press while a resize is running means the previous one was
        // orphaned: its pointer was released somewhere the canvas never saw.
        // The size goes back and the new press is free to start a new gesture.
        this.cancelBrushSizeGesture();
      } else {
        this.handleBrushSizeGestureSample(sample);
        return;
      }
    }
    if (this.startsBrushSizeGesture(sample)) {
      return;
    }

    const snapped = this.snapSample(sample);

    if (sample.phase === "down") {
      // A middle-button drag pans regardless of the active tool, and so does a
      // drag while the pan modifier is held.
      if (sample.button === 1 || this.panModifier) {
        this.panGestureActive = true;
        this.middlePanTool.onPointerDown(this.toolContext, sample);
        return;
      }
      // The symmetry centre is a handle: a press on the marker moves the
      // centre instead of drawing with the active tool.
      if (this.beginSymmetryCenterDrag(sample)) {
        return;
      }
      if (sample.button === 2) {
        // The right button is the canvas menu's button. A click opens the
        // menu and must leave the canvas untouched, so the gesture waits for
        // the first movement: a drag still paints with the secondary colour.
        this.deferredRightGesture = {
          sample: snapped,
          brush: this.brushForSample(snapped),
          viewId,
        };
        return;
      }
      this.activeTool().onPointerDown(this.toolContext, snapped);
      return;
    }

    if (sample.phase === "move") {
      if (this.panGestureActive) {
        this.middlePanTool.onPointerMove(this.toolContext, sample);
        return;
      }
      if (this.symmetryCenterGesture !== null) {
        this.moveSymmetryCenter(sample);
        return;
      }
      const deferred = this.deferredRightGesture;
      if (deferred !== null) {
        // The pointer moved, so this is a right-drag: the gesture starts at the
        // press and paints from there with the brush the press resolved.
        this.deferredRightGesture = null;
        this.startDeferredRightGesture(deferred);
        this.activeTool().onPointerMove(this.toolContext, snapped);
        return;
      }
      this.activeTool().onPointerMove(this.toolContext, snapped);
      return;
    }

    if (this.panGestureActive) {
      this.middlePanTool.onPointerUp(this.toolContext, sample);
      this.panGestureActive = false;
      return;
    }

    if (this.symmetryCenterGesture !== null) {
      // The tool never saw the press, so it is not told about the release.
      if (sample.phase === "cancel") {
        this.cancelSymmetryCenterDrag();
      } else {
        this.endSymmetryCenterDrag();
      }
      return;
    }

    const deferred = this.deferredRightGesture;
    if (deferred !== null) {
      this.deferredRightGesture = null;
      if (sample.phase === "up" && !this.isRightButtonClick(deferred, sample)) {
        // The button came up away from where it went down: it was a drag that
        // never produced a movement sample, so it still paints.
        this.startDeferredRightGesture(deferred);
        this.activeTool().onPointerUp(this.toolContext, snapped);
      }
      // A click is a menu gesture. It never started, so it painted nothing
      // and left nothing behind.
      return;
    }

    const tool = this.activeTool();
    if (sample.phase === "up") {
      tool.onPointerUp(this.toolContext, snapped);
    } else {
      tool.onPointerCancel(this.toolContext, sample);
    }
  }

  /**
   * Hands a deferred right-button press to the tool.
   *
   * The brush is put back for the call, so the gesture paints with the colour
   * the press resolved rather than with the brush of this moment.
   */
  private startDeferredRightGesture(deferred: {
    readonly sample: PointerSample;
    readonly brush: BrushSettings;
    readonly viewId: ViewId;
  }): void {
    this.deferredBrush = deferred.brush;
    try {
      this.activeTool().onPointerDown(this.toolContext, deferred.sample);
    } finally {
      this.deferredBrush = null;
    }
  }

  /**
   * True when a right-button gesture was a click rather than a drag.
   *
   * The distance is measured in the document and scaled by the zoom, so it is
   * the same four screen pixels whatever the zoom level is.
   */
  private isRightButtonClick(
    deferred: { readonly sample: PointerSample; readonly viewId: ViewId },
    release: PointerSample,
  ): boolean {
    const zoom = this.views.get(deferred.viewId)?.viewport.zoom ?? 1;
    const distance = Math.hypot(
      release.docX - deferred.sample.docX,
      release.docY - deferred.sample.docY,
    );
    return distance <= CLICK_SLOP_PX * zoom;
  }

  /**
   * Zooms or pans the view the wheel happened in.
   *
   * The wheel belongs to the canvas it was turned over, so it moves that view
   * and not the active one: scrolling in the second view must never move the
   * first.
   *
   * Public for the same reason `handlePointerSample` is: the input path can
   * be driven end to end without a DOM.
   */
  /**
   * Starts the quick brush-size resize when a press asks for it.
   *
   * The press is consumed: it never reaches the brush, so a resize cannot
   * paint. A press that another surface owns - a field the user is typing in -
   * is left alone and reaches the tool as usual.
   */
  private startsBrushSizeGesture(sample: PointerSample): boolean {
    if (
      !shouldStartBrushSizeGesture(sample, {
        toolId: this.currentToolId,
        blocked: this.interactionBlocked(),
      })
    ) {
      return false;
    }
    this.brushSizeGesture = {
      startSize: this.brush.size,
      startScreenY: sample.screenY,
      size: this.brush.size,
    };
    this.emitBrushCursor();
    return true;
  }

  /**
   * Feeds one sample to the quick brush-size resize.
   *
   * The size follows the pointer's vertical travel and is applied to the
   * brush as it changes, so the ring, the readout and the next stroke all
   * agree. A release keeps the size; a cancel puts the original back.
   */
  private handleBrushSizeGestureSample(sample: PointerSample): void {
    const gesture = this.brushSizeGesture;
    if (gesture === null) {
      return;
    }
    if (sample.phase === "move") {
      const size = brushSizeFromDrag(gesture.startSize, sample.screenY - gesture.startScreenY);
      if (size === gesture.size) {
        return;
      }
      this.brushSizeGesture = { ...gesture, size };
      // The brush is the one place the size lives, so the ring and the next
      // stroke cannot disagree about it.
      this.setBrush({ size });
      this.emitBrushCursor();
      return;
    }
    if (sample.phase === "up") {
      this.brushSizeGesture = null;
      this.emitBrushCursor();
      return;
    }
    // A cancel - a lost pointer capture, a pointer cancel event - restores the
    // size the gesture started from.
    this.cancelBrushSizeGesture();
  }

  handleWheel(input: WheelInput, viewId: ViewId = this.views.activeId): void {
    const view = this.views.get(viewId);
    if (!view) {
      return;
    }
    if (input.ctrlKey || input.altKey) {
      const factor = clamp(
        Math.exp(-input.deltaY * WHEEL_ZOOM_SENSITIVITY),
        WHEEL_ZOOM_FACTOR_LIMIT,
        1 / WHEEL_ZOOM_FACTOR_LIMIT,
      );
      if (factor === 1) {
        return;
      }
      this.setViewViewport(
        viewId,
        zoomAt(view.viewport, input.screenX, input.screenY, factor),
      );
      return;
    }

    if (input.shiftKey) {
      const horizontal = input.deltaX !== 0 ? input.deltaX : input.deltaY;
      this.setViewViewport(viewId, panBy(view.viewport, -horizontal, 0));
      return;
    }

    this.setViewViewport(viewId, panBy(view.viewport, -input.deltaX, -input.deltaY));
  }

  /**
   * Notes that the pointer entered or left a view.
   *
   * Each view keeps its own cursor, so leaving one canvas does not blank the
   * cursor of the other.
   */
  private handlePresence(inside: boolean, viewId: ViewId): void {
    const cursor = this.cursors.get(viewId);
    if (!cursor || cursor.inside === inside) {
      return;
    }
    const next = { ...cursor, inside };
    this.cursors.set(viewId, next);
    this.emitCursor(next);
  }

  private reportCursor(sample: PointerSample, viewId: ViewId): void {
    this.trackHoveredReference(sample);
    const report: CursorReport = {
      viewId,
      inside: true,
      docX: sample.docX,
      docY: sample.docY,
      screenX: sample.screenX,
      screenY: sample.screenY,
      kind: sample.kind,
      pressure: sample.pressure,
      hasPressure: sample.hasPressure,
      cursor: this.cursorFor(sample.docX, sample.docY, sample.screenX, sample.screenY),
    };
    this.cursors.set(viewId, report);
    this.emitCursor(report);
  }

  /**
   * Remembers which reference the pointer is over.
   *
   * The reference under the pointer is outlined on the canvas and the picker
   * asks for a different cursor there, so the artist can see that a press will
   * read the reference rather than the artwork. Only a change of reference
   * wakes the renderer up: a pointer moving inside the same image changes
   * nothing.
   */
  private trackHoveredReference(sample: PointerSample): void {
    const reference = this.referenceAt(sample.screenX, sample.screenY);
    const next = reference?.id ?? null;
    if (next === this.hoveredReferenceId) {
      return;
    }
    this.hoveredReferenceId = next;
    this.syncReferenceOverlay();
    this.requestRender();
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
   *
   * The picker has one more thing to say: over a **reference image** the press
   * reads the reference rather than the artwork, so it asks for the magnifier
   * cursor. The reference is found in workspace space, which is the space it
   * lives in.
   */
  private cursorFor(docX: number, docY: number, screenX: number, screenY: number): string {
    const tool = this.activeTool();
    // The pan modifier wins over the tool: a press will move the canvas, so
    // the pointer should say so.
    if (this.panModifier) {
      return "grab";
    }
    if (this.currentToolId === "picker" && this.referenceAt(screenX, screenY)) {
      return REFERENCE_SAMPLE_CURSOR;
    }
    if (this.currentToolId === "gradient") {
      // A gradient handle asks for the move cursor: the press will move that
      // point of the gradient, not draw a new one.
      const gesture = this.gradientEdit;
      if (gesture) {
        return GRADIENT_HANDLE_CURSORS[gesture.handle];
      }
      const handle = this.findGradientHandleAt(docX, docY);
      return handle === null ? tool.cursor : GRADIENT_HANDLE_CURSORS[handle];
    }
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
   * Re-emits a view's cursor after its viewport changed.
   *
   * The pointer has not moved, but the viewport has: the document point under
   * it is a different one now, and so is the answer to "is a handle under the
   * pointer?". A zoom moves the handles, so a cursor that still claimed a
   * resize cursor would be lying. Both the position and the cursor are
   * therefore recomputed from the pointer's *screen* position.
   *
   * Each view is re-asked on its own: the two windows have their own zooms,
   * so the same screen position means a different document point in each.
   */
  private republishCursor(viewId: ViewId = this.views.activeId): void {
    const cursor = this.cursors.get(viewId);
    if (!cursor) {
      return;
    }
    const viewport = this.views.get(viewId)?.viewport ?? this.viewport;
    const doc = screenToDoc(viewport, cursor.screenX, cursor.screenY);
    const next = {
      ...cursor,
      docX: doc.x,
      docY: doc.y,
      cursor: this.cursorFor(doc.x, doc.y, cursor.screenX, cursor.screenY),
    };
    this.cursors.set(viewId, next);
    this.emitCursor(next);
  }

  /**
   * The cursor of the active view, or `null` when it has none yet.
   *
   * The active view is the one the commands anchor on, so its pointer
   * position is the one a zoom keeps under the cursor.
   */
  private get cursor(): CursorReport | null {
    return this.cursors.get(this.views.activeId) ?? null;
  }

  private emitCursor(report: CursorReport): void {
    for (const listener of this.cursorListeners) {
      listener(report);
    }
  }

  /**
   * The state the brush cursor overlay should show.
   *
   * The size is the brush's own size, so the ring cannot claim a footprint
   * the brush does not have. The zoom is the viewport's, so the ring is drawn
   * at the size the brush covers on screen.
   */
  private brushCursorReport(): BrushCursorReport {
    return {
      size: this.brush.size,
      zoom: this.viewport.zoom,
      resizing: this.brushSizeGesture !== null,
      drawing: this.activeStroke !== null,
    };
  }

  private emitBrushCursor(): void {
    if (this.brushCursorListeners.size === 0) {
      return;
    }
    const report = this.brushCursorReport();
    for (const listener of this.brushCursorListeners) {
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
      // The size of the surface the *active* view is drawn on, so it agrees
      // with the viewport above: a navigator that marks the visible area
      // needs both halves of the same view.
      viewportSize: this.activeViewSize,
      views: this.viewSummaries(),
      activeViewId: this.views.activeId,
      secondaryViewOpen: this.secondaryViewOpen,
      brush: this.brush,
      secondaryColor: this.secondaryColor,
      presets: this.presets,
      activePresetId: this.activePresetId,
      toolId: this.currentToolId,
      history: this.commands.getState(),
      file: this.fileState,
      // Counted from the store rather than from the selection's id list, so a
      // stroke removed by undo or redo cannot be counted as still selected.
      selectedStrokes: this.selectedStrokes().length,
      selectedGuideId: this.selectedGuideId,
      selectedGradient: this.selectedGradientState,
      shapeFill: this.shapeFill,
      shapeSides: this.shapeSides,
      shapeInnerRatio: this.shapeInnerRatio,
      shapeRotation: this.shapeRotation,
      fillTolerance: this.fillTolerance,
      fillReference: this.fillReference,
      fillReferenceLayerId: this.fillReferenceLayerId,
      fillExpand: this.fillExpand,
      fillAntialias: this.fillAntialias,
      fillCloseGaps: this.fillCloseGaps,
      gradientType: this.gradientType,
      gradientEndColor: this.gradientEndColor,
      gradientMidStops: this.gradientMidStops,
      gridVisible: this.gridVisible,
      gridSpacing: this.gridSpacing,
      gridSnapping: this.gridSnapping,
      rulersVisible: this.rulersVisible,
      symmetryEnabled: this.symmetryEnabled,
      symmetryMode: this.symmetryMode,
      symmetryCount: this.symmetryCount,
      symmetryCenter: this.symmetryCenter,
      symmetryDragging: this.symmetryCenterGesture !== null,
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
      previous.viewportSize === next.viewportSize &&
      previous.views === next.views &&
      previous.activeViewId === next.activeViewId &&
      previous.secondaryViewOpen === next.secondaryViewOpen &&
      previous.brush === next.brush &&
      previous.secondaryColor === next.secondaryColor &&
      previous.presets === next.presets &&
      previous.activePresetId === next.activePresetId &&
      previous.toolId === next.toolId &&
      previous.history === next.history &&
      previous.file === next.file &&
      previous.selectedStrokes === next.selectedStrokes &&
      previous.selectedGuideId === next.selectedGuideId &&
      previous.selectedGradient === next.selectedGradient &&
      previous.shapeFill === next.shapeFill &&
      previous.shapeSides === next.shapeSides &&
      previous.shapeInnerRatio === next.shapeInnerRatio &&
      previous.shapeRotation === next.shapeRotation &&
      previous.fillTolerance === next.fillTolerance &&
      previous.fillReference === next.fillReference &&
      previous.fillReferenceLayerId === next.fillReferenceLayerId &&
      previous.fillExpand === next.fillExpand &&
      previous.fillAntialias === next.fillAntialias &&
      previous.fillCloseGaps === next.fillCloseGaps &&
      previous.gradientType === next.gradientType &&
      previous.gradientEndColor === next.gradientEndColor &&
      gradientStopsEqual(previous.gradientMidStops, next.gradientMidStops) &&
      previous.gridVisible === next.gridVisible &&
      previous.gridSpacing === next.gridSpacing &&
      previous.gridSnapping === next.gridSnapping &&
      previous.rulersVisible === next.rulersVisible &&
      previous.symmetryEnabled === next.symmetryEnabled &&
      previous.symmetryMode === next.symmetryMode &&
      previous.symmetryCount === next.symmetryCount &&
      previous.symmetryCenter === next.symmetryCenter &&
      previous.symmetryDragging === next.symmetryDragging &&
      previous.notice === next.notice
    ) {
      return;
    }
    this.store.setState(next);
  }
}
