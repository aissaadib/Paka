/**
 * Canvas 2D renderer.
 *
 * Responsibilities:
 *  - own the display canvas backing store and its device pixel ratio,
 *  - own one raster surface per layer plus the in-progress stroke buffer,
 *  - composite paper + visible layers + active stroke into the display canvas,
 *  - re-rasterize a layer from its stroke list when its pixels are invalid
 *    (undo, redo, document resize, raster scale change).
 *
 * It deliberately knows nothing about tools, history or React. Stroke data is
 * read through the `StrokeSource` interface, so replacing this class with a
 * WebGL/WebGPU implementation does not require touching the rest of the app.
 */

import type {
  DrawingDocument,
  FillPatchRecord,
  GradientRecord,
  Layer,
  LayerId,
  LayerBlendMode,
  StrokeRecord,
} from "../document/types";
import { isFillPatch, isGradient } from "../document/types";
import type { SelectionHandles } from "../document/selectionHandles";
import type { GridSettings } from "../document/grid";
import { DEFAULT_GRID_SETTINGS, gridLinesBetween } from "../document/grid";
import type { SymmetrySettings } from "../document/symmetry";
import type { ReferenceOverlay } from "../reference/types";
import {
  DEFAULT_SYMMETRY_SETTINGS,
  symmetryAxes,
  symmetryTransforms,
} from "../document/symmetry";
import type { RulerSettings } from "./rulers";
import {
  DEFAULT_RULER_SETTINGS,
  RULER_LEFT_SIZE_PX,
  RULER_SIZE_PX,
  formatRulerLabel,
  rulerMinorStep,
  rulerStep,
  rulerTicks,
} from "./rulers";
import type { Bounds } from "../../types/geometry";
import type { Viewport } from "../../types/viewport";
import { PRIMARY_VIEW_ID } from "../../types/viewport";
import { hexToRgb } from "../../utils/color";
import { FrameScheduler } from "./frameScheduler";
import { LayerSurfaceStore, type LayerSurface } from "./layerSurfaceStore";
import { viewMatrix, visibleDocumentRect } from "./viewport";
import {
  rasterizeStroke,
  strokeDiameter,
  strokeFeatherRadius,
  strokeOpacity,
  TEXTURE_TILE_SIZE,
  textureCoverage,
} from "./canvas2dStroke";
import {
  COVERAGE_TILE_SIZE,
  StampCoverage,
  StampDabCursor,
  stampDabs,
  stampTextureLaneWidth,
  unionStampRect,
  type StampRect,
} from "./stampCoverage";
import type {
  CompositeReadOptions,
  DrawingRenderer,
  DisplayTargetOptions,
  RendererGradientOverlay,
  RendererKind,
  RendererSelection,
  Rgb,
  StrokeSource,
} from "./types";

export interface Canvas2DRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly strokeSource: StrokeSource;
  /** Surface resolution multiplier; use `devicePixelRatio` for crisp HiDPI output. */
  readonly rasterScale?: number;
  readonly scheduler?: FrameScheduler;
}

/**
 * The id of the display target the engine's own canvas is registered under.
 *
 * The renderer always has one target - the main canvas - and may have more:
 * a second view of the same document is a second target, not a second
 * renderer, so both views share the rasterized layer surfaces.
 *
 * It is the engine's primary *view* id, so the two cannot drift apart.
 */
export const PRIMARY_DISPLAY_TARGET = PRIMARY_VIEW_ID;

const DOCUMENT_BORDER_COLOR = "rgba(0, 0, 0, 0.35)";
/** Accent used for the selection marquee and the traced selected strokes. */
const SELECTION_COLOR = "#2f7bff";
/** Opaque enough to read over dark ink, translucent enough to see it through. */
const SELECTION_TRACE_ALPHA = 0.85;
/** Device pixels; divided by the display scale so it is constant at any zoom. */
const SELECTION_TRACE_WIDTH = 1.5;
const SELECTION_MARQUEE_DASH: readonly [number, number] = [6, 4];
/** Screen pixels; divided by the display scale so the handles never change size. */
const HANDLE_SIZE_PX = 8;
const ROTATION_HANDLE_RADIUS_PX = 5;
/** The handle's own fill, so a handle reads on top of dark ink as well. */
const HANDLE_FILL_COLOR = "#ffffff";
/**
 * Accent used for the composition guides.
 *
 * A different hue from the selection accent, so the two overlays can be told
 * apart at a glance; the *selected* guide is drawn in the selection colour.
 */
const GUIDE_COLOR = "#e0567f";
/**
 * Accent used for the gradient overlay.
 *
 * A third hue, so the gradient handles cannot be mistaken for the selection's
 * transform handles or for a composition guide.
 */
const GRADIENT_COLOR = "#8a6bff";
/**
 * The grid, deliberately fainter than the guides.
 *
 * A grid is a background reference: it has to be readable without competing
 * with the guides or the artwork, so it uses a low-alpha neutral rather than
 * the guides' accent hue.
 */
const GRID_COLOR = "rgba(70, 84, 104, 0.22)";
/**
 * Accent used for the reference images.
 *
 * A fourth hue, so a reference frame cannot be mistaken for the selection's
 * transform handles, for a composition guide or for the gradient handles.
 */
const REFERENCE_COLOR = "#2fb8a0";
/** The outline of the reference under the pointer, when it is not selected. */
const REFERENCE_HOVER_COLOR = "rgba(47, 184, 160, 0.6)";
/**
 * The closest two grid lines may be on screen before the grid is hidden, in
 * device pixels.
 *
 * Below roughly this gap the lines merge into a wash and cost a stroke per
 * line for nothing. Hiding the grid at that density keeps a 2 px spacing usable
 * when zoomed in and quiet when zoomed out.
 */
const MIN_GRID_GAP_PX = 3;

/**
 * The ruler strips.
 *
 * The strips are part of the workspace chrome, so they use the app's own
 * surface colours rather than an accent: a ruler is furniture, not an
 * annotation. The background is opaque enough to read a label on, and the
 * ticks are fainter than the labels.
 */
const RULER_BACKGROUND_COLOR = "#1c1f23";
const RULER_BORDER_COLOR = "#2a2e34";
const RULER_TICK_COLOR = "#5b636d";
const RULER_LABEL_COLOR = "#8a919b";
/** The label font, in CSS pixels. */
const RULER_FONT = "10px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * The symmetry overlay: the axes the copies are mirrored or turned about, and
 * the marker at the centre.
 *
 * A fourth accent, so the symmetry can be told from the selection, the guides
 * and the gradient at a glance. The centre marker is drawn in the selection
 * accent because it is the one handle the user grabs.
 */
const SYMMETRY_COLOR = "#3fb9a8";
const SYMMETRY_CENTER_COLOR = "#2f7bff";
/** The symmetry centre marker's radius, in CSS pixels. */
const SYMMETRY_CENTER_RADIUS_PX = 5;

/**
 * The guide's position label.
 *
 * A guide is a registration mark, and a registration mark is only useful if
 * the user can read where it sits: the label shows the guide's coordinate in
 * document pixels, next to the edge it is anchored to.
 */
const GUIDE_LABEL_COLOR = "#e0567f";
const GUIDE_LABEL_FONT = "10px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/** The label's chip, so it reads over dark ink as well. */
const GUIDE_LABEL_BACKGROUND = "rgba(14, 16, 19, 0.78)";

/** Maps a layer blend mode to a Canvas 2D composite operation. */
function compositeOperationFor(mode: LayerBlendMode): GlobalCompositeOperation {
  switch (mode) {
    case "normal":
      return "source-over";
    case "multiply":
      return "multiply";
    case "screen":
      return "screen";
    case "overlay":
      return "overlay";
    case "soft-light":
      return "soft-light";
    case "hard-light":
      return "hard-light";
    case "color-dodge":
      return "color-dodge";
    case "darken":
      return "darken";
    case "lighten":
      return "lighten";
    case "difference":
      return "difference";
    case "exclusion":
      return "exclusion";
  }
}

/**
 * A rectangle in the device pixels of the stroke buffer and the layer surface.
 *
 * The two share a pixel grid (both are the document at `rasterScale`), so a
 * region can be blitted from one to the other without resampling.
 */
interface StrokeRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * True when a layer contributes to the composite at all.
 *
 * Shared by the display/export painter and the colour probe so the two cannot
 * disagree about which layers a pick can see.
 */
function isComposited(layer: Layer): boolean {
  return layer.visible && layer.opacity > 0;
}

function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));
  if (canvas.width !== nextWidth) {
    canvas.width = nextWidth;
  }
  if (canvas.height !== nextHeight) {
    canvas.height = nextHeight;
  }
}

/**
 * `-0` is a different number to `0` even though they compare equal.
 *
 * A matrix term that is a negative zero is a surprise in a recorded call - it
 * prints as `-0` and it is not the number the caller wrote - so the sign of a
 * zero is normalised away.
 */
function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * One canvas the document is painted into, with its own view transform.
 *
 * A target holds no document state: the document, the layer surfaces and the
 * stroke buffer belong to the renderer, so two targets always show the same
 * artwork and differ only in where it is put on the screen.
 */
interface DisplayTarget {
  readonly id: string;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** The transform from document space to this target's screen space. */
  viewport: Viewport;
  /** The device pixel ratio of this target's backing store. */
  devicePixelRatio: number;
}

export class Canvas2DRenderer implements DrawingRenderer {
  readonly kind: RendererKind = "canvas2d";

  /**
   * The display targets: one canvas per view over the same document.
   *
   * Everything that belongs to the *document* - the layer surfaces, the stroke
   * buffer, the in-progress stroke - lives on the renderer and is shared by
   * every target. What a target owns is its canvas, its view transform and its
   * device pixel ratio: the three things that make one window a different
   * window.
   */
  private readonly targets = new Map<string, DisplayTarget>();
  private readonly strokeSource: StrokeSource;
  private readonly scheduler: FrameScheduler;
  private readonly surfaces: LayerSurfaceStore;
  private readonly strokeBuffer: HTMLCanvasElement;
  private readonly strokeCtx: CanvasRenderingContext2D;
  private readonly requestFrame: () => void;
  /** Grain tiles keyed by quantized strength; generated once and reused. */
  private readonly textureTiles = new Map<number, HTMLCanvasElement>();

  private doc: DrawingDocument | null = null;
  private activeStroke: StrokeRecord | null = null;
  /**
   * Pixels of the active layer as they were when an erasing stroke started.
   *
   * Erasing subtracts coverage from the layer itself, so the layer must be
   * rebuilt from a fixed base on every update: restoring this snapshot and
   * subtracting the whole stroke once is what keeps a self-crossing eraser from
   * subtracting twice, and what lets a cancelled erase leave no trace. Only
   * allocated while an erasing stroke is in flight (one surface-sized canvas).
   */
  private eraseBase: HTMLCanvasElement | null = null;
  private eraseLayerId: LayerId | null = null;
  /**
   * A 1x1 scratch canvas for `readCompositePixel`, allocated on first use.
   *
   * One pixel is all a colour probe needs, and allocating it lazily keeps the
   * "first canvas created is the stroke buffer" assumption intact - the stroke
   * buffer is still the only canvas the constructor creates.
   */
  private probeCanvas: HTMLCanvasElement | null = null;
  /**
   * Scratch buffer for a soft stroke's feathered edge, allocated on first use.
   *
   * A blurred copy of the stroke buffer is built here and then composited in
   * its place, so the raw buffer stays pure full coverage (and the hard path
   * keeps using it directly). It is sized to the stroke's padded bounding box,
   * not the whole document, so a soft stroke costs a pass over its own
   * footprint rather than a document-wide blur on every frame. One canvas is
   * reused for every stroke; the pixels in it are never authoritative.
   */
  private featherBuffer: HTMLCanvasElement | null = null;
  /**
   * Scratch canvas that groups the active layer with its in-progress stroke.
   *
   * Layer opacity and blend mode apply to the *finished* layer, so a preview
   * cannot be painted element-by-element on top of the layer: a half-opacity
   * layer would apply its alpha twice, and `multiply`/`screen` would blend the
   * preview with the backdrop instead of with the layer beneath it. When either
   * is non-default the layer surface and the stroke buffer are combined here
   * first, exactly as a commit would combine them, and the group is then drawn
   * once with the layer's opacity and composite operation. Committed pixels are
   * only ever read, never written, and the canvas is reused across frames.
   */
  private previewSurface: HTMLCanvasElement | null = null;
  /**
   * Coverage of the in-flight stamped stroke, in device pixels.
   *
   * The stamp engine unions its dabs with a maximum, and Canvas 2D cannot
   * express a maximum of alpha (its `lighten` blend mode compares colours,
   * not alpha), so the coverage is accumulated here in plain numbers and
   * uploaded to the stroke buffer as pixels. The map is bounded by the
   * stroke's own footprint - like the feather scratch - so it never adds a
   * document-sized surface to the raster budget.
   */
  private stampCoverage: StampCoverage | null = null;
  /** Places the dabs of the in-flight stroke as its path grows. */
  private stampCursor: StampDabCursor | null = null;
  /** The reused upload buffer: one coverage tile, never larger. */
  private stampUpload: ImageData | null = null;
  /** Scratch coverage map used when a committed stroke is re-rasterized. */
  private readonly stampScratch = new StampCoverage();
  /** Selection overlay: UI chrome, never composited into a surface or an export. */
  private selection: RendererSelection | null = null;
  /**
   * Gradient overlay: the handles and the line of the selected gradient.
   *
   * Overlay only, like the selection: painted on the display canvas above the
   * layers and never part of a layer surface, the document or an export.
   */
  private gradientOverlay: RendererGradientOverlay | null = null;
  /**
   * The guide the user has selected, or `null`.
   *
   * The guide *positions* are document state and arrive with the document; only
   * the selection is an overlay concern, so it has its own channel.
   */
  private selectedGuideId: string | null = null;
  /**
   * Grid display settings.
   *
   * Editor state, like the guide selection: the renderer owns only how the
   * grid is painted, not whether the user wants it. Off by default.
   */
  private grid: GridSettings = DEFAULT_GRID_SETTINGS;
  /**
   * Ruler display settings.
   *
   * Editor state, like the grid: the renderer owns only how the strips are
   * painted, not whether the user wants them. Off by default.
   */
  private rulers: RulerSettings = DEFAULT_RULER_SETTINGS;
  /**
   * The symmetry the in-progress stroke is repeated around.
   *
   * Editor state, like the grid: it describes the next stroke, and the copies
   * it produces are ordinary strokes in the document. Off by default.
   */
  private symmetry: SymmetrySettings = DEFAULT_SYMMETRY_SETTINGS;
  /**
   * The reference images painted over the workspace.
   *
   * Overlay only, like the selection and the grid: the references are drawn on
   * the display canvas in workspace space and never reach a layer surface, the
   * document or an export. The renderer holds the *placement* and the pixels;
   * which reference is selected and which one is under the pointer are handed
   * over with the overlay.
   */
  private referenceOverlay: ReferenceOverlay | null = null;
  private rasterScale: number;
  private destroyed = false;

  constructor(options: Canvas2DRendererOptions) {
    this.strokeSource = options.strokeSource;
    this.scheduler = options.scheduler ?? new FrameScheduler();
    this.rasterScale = options.rasterScale !== undefined && options.rasterScale > 0 ? options.rasterScale : 1;
    this.surfaces = new LayerSurfaceStore(this.rasterScale);

    this.strokeBuffer = document.createElement("canvas");
    const strokeCtx = this.strokeBuffer.getContext("2d");
    if (!strokeCtx) {
      throw new Error("Canvas 2D context unavailable for the stroke buffer.");
    }
    this.strokeCtx = strokeCtx;

    // The frame scheduler is wired before anything can ask for a frame: adding
    // a display target requests one.
    this.requestFrame = () => {
      this.scheduler.schedule(() => {
        this.render();
      });
    };

    // The main canvas is the primary target. It is registered here rather than
    // added later, so the renderer is never in a state where it has a
    // document but nothing to show it on.
    this.addDisplayTarget({
      id: PRIMARY_DISPLAY_TARGET,
      canvas: options.canvas,
      viewport: { zoom: 1, offsetX: 0, offsetY: 0 },
    });
  }

  get rasterScaleValue(): number {
    return this.rasterScale;
  }

  /**
   * True while the grouped live-preview scratch is held.
   *
   * The scratch is a full-resolution surface, and the erase snapshot is
   * another one; the raster budget in `core/document/document.ts` allows only
   * one of the two at a time, so the scratch exists only while a preview is
   * being composited and is released as soon as that preview ends.
   */
  get holdsPreviewScratch(): boolean {
    return this.previewSurface !== null;
  }

  setDocument(doc: DrawingDocument): void {
    if (this.destroyed) {
      return;
    }

    const sizeChanged =
      this.doc === null || this.doc.width !== doc.width || this.doc.height !== doc.height;
    this.doc = doc;
    // No preview is in flight for the new document, so the scratch is released.
    this.dropPreviewSurface();

    if (sizeChanged) {
      this.surfaces.setDocumentSize(doc.width, doc.height, this.rasterScale);
      resizeCanvas(this.strokeBuffer, doc.width * this.rasterScale, doc.height * this.rasterScale);
      // The surfaces were dropped, so an in-flight stroke no longer belongs to
      // the pixels that are about to be rebuilt. Forgetting it makes the next
      // sample take the defensive path in `extendStroke`: the buffer is redrawn
      // from scratch and, for an eraser, a fresh snapshot is taken of the
      // rebuilt layer. The engine aborts strokes before replacing the document,
      // so this only guards against a caller that skips that contract.
      this.abandonStroke();
    }

    // Surfaces for removed layers are dropped; new layers get a dirty surface
    // the first time they are composited.
    this.surfaces.retain(doc.layers.map((layer) => layer.id));
  }

  setViewport(viewport: Viewport): void {
    this.setDisplayTargetViewport(PRIMARY_DISPLAY_TARGET, viewport);
  }

  setDisplaySize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.setDisplayTargetSize(PRIMARY_DISPLAY_TARGET, cssWidth, cssHeight, devicePixelRatio);
  }

  /**
   * Adds a display target: a second canvas showing the same document.
   *
   * The target shares the renderer's document, layer surfaces and stroke
   * buffer, so a second view of the canvas costs a projection of the pixels
   * that are already rasterized rather than a second copy of them.
   */
  addDisplayTarget(options: DisplayTargetOptions): void {
    if (this.destroyed) {
      return;
    }
    const ctx = options.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D rendering is not available in this environment.");
    }
    const existing = this.targets.get(options.id);
    const target: DisplayTarget = {
      id: options.id,
      canvas: options.canvas,
      ctx,
      viewport: options.viewport,
      devicePixelRatio: existing?.devicePixelRatio ?? 1,
    };
    this.targets.set(options.id, target);
    this.requestFrame();
  }

  /**
   * Removes a display target.
   *
   * The document, the layer surfaces and the history are untouched: a closed
   * view takes nothing away from the document it was showing, and the other
   * views keep working.
   */
  removeDisplayTarget(id: string): void {
    if (!this.targets.delete(id)) {
      return;
    }
    this.requestFrame();
  }

  /** Sets the view transform of one display target. */
  setDisplayTargetViewport(id: string, viewport: Viewport): void {
    const target = this.targets.get(id);
    if (!target) {
      return;
    }
    target.viewport = viewport;
    this.requestFrame();
  }

  /** Sets the CSS size and device pixel ratio of one display target. */
  setDisplayTargetSize(
    id: string,
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio: number,
  ): void {
    if (this.destroyed) {
      return;
    }
    const target = this.targets.get(id);
    if (!target) {
      return;
    }
    target.devicePixelRatio = devicePixelRatio > 0 ? devicePixelRatio : 1;
    resizeCanvas(
      target.canvas,
      cssWidth * target.devicePixelRatio,
      cssHeight * target.devicePixelRatio,
    );
    this.requestFrame();
  }

  setRasterScale(scale: number): void {
    if (this.destroyed || scale <= 0 || scale === this.rasterScale) {
      return;
    }
    this.rasterScale = scale;
    const doc = this.doc;
    if (doc) {
      this.surfaces.setDocumentSize(doc.width, doc.height, scale);
      resizeCanvas(this.strokeBuffer, doc.width * scale, doc.height * scale);
      this.abandonStroke();
    }
    this.dropPreviewSurface();
    this.requestFrame();
  }

  invalidateLayer(layerId: LayerId): void {
    this.surfaces.markDirty(layerId);
    this.requestFrame();
  }

  beginStroke(stroke: StrokeRecord): void {
    this.activeStroke = stroke;
    const stamped = this.isStamped(stroke);
    this.stampCoverage = stamped ? new StampCoverage() : null;
    this.stampCursor = stamped ? new StampDabCursor(stroke.brush) : null;
    this.clearStrokeBuffer();
    if (stroke.erase === true) {
      // The erase snapshot and the grouped-preview scratch are mutually
      // exclusive full-resolution surfaces: an eraser previews by mutating its
      // own layer, so it never needs a group, and the scratch is released
      // before the snapshot is taken.
      this.dropPreviewSurface();
      this.beginErase(stroke.layerId);
    } else {
      this.dropEraseBase();
    }
    this.requestFrame();
  }

  extendStroke(stroke: StrokeRecord, fromIndex: number): void {
    if (this.activeStroke !== stroke) {
      // Defensive path: a stroke arrived without a matching `beginStroke`.
      this.activeStroke = stroke;
      this.stampCoverage = this.isStamped(stroke) ? new StampCoverage() : null;
      this.stampCursor = this.isStamped(stroke) ? new StampDabCursor(stroke.brush) : null;
      if (stroke.erase === true) {
        this.beginErase(stroke.layerId);
      }
      this.clearStrokeBuffer();
      this.prepareStrokeBuffer();
      if (this.stampCoverage !== null) {
        this.extendStampStroke(stroke);
      } else {
        rasterizeStroke(this.strokeCtx, stroke, 0);
      }
    } else if (this.stampCoverage !== null) {
      // The stamp engine appends its new dabs: the coverage map is the
      // authority, so only the rectangle the new dabs touched is uploaded.
      this.extendStampStroke(stroke);
    } else if (fromIndex <= 1) {
      // The stroke had a single sample until now, so the buffer holds the dab
      // that `rasterizeStroke` stamps for a press without movement. Once the
      // stroke grows, that dab is redundant - the segment caps cover the same
      // area - but it is a second pass of antialiasing exactly at the start, so
      // the live buffer would differ (by up to a few levels, on the start ring)
      // from what undo, reopen and export produce for the same stroke. Redraw
      // from scratch here; from the next sample on, appending is already
      // identical to a full re-rasterization of the stroke.
      this.clearStrokeBuffer();
      this.prepareStrokeBuffer();
      rasterizeStroke(this.strokeCtx, stroke, 0);
    } else {
      this.prepareStrokeBuffer();
      rasterizeStroke(this.strokeCtx, stroke, fromIndex);
    }
    if (stroke.erase === true) {
      this.applyErase(stroke);
    }
    this.requestFrame();
  }

  /**
   * Redraws the whole stroke buffer from the stroke's current samples.
   *
   * Shape tools replace their geometry on every move rather than appending, so
   * the buffer cannot be extended: it is cleared and re-rasterized from index 0
   * every time. Full coverage is used, exactly as during a brush stroke; the
   * stroke's opacity is applied when the buffer composites in `render()` and
   * `endStroke()`. Shapes never erase, so no snapshot handling is involved.
   */
  replaceStroke(stroke: StrokeRecord): void {
    if (this.destroyed) {
      return;
    }
    this.activeStroke = stroke;
    // A shape replaces its geometry on every move, so its buffer is redrawn
    // from scratch. A stamped shape is not a thing (the engine draws shapes
    // with the plain segment path), but the branch keeps the two paths apart.
    this.stampCoverage = this.isStamped(stroke) ? new StampCoverage() : null;
    this.stampCursor = this.isStamped(stroke) ? new StampDabCursor(stroke.brush) : null;
    this.clearStrokeBuffer();
    this.prepareStrokeBuffer();
    if (this.stampCoverage !== null) {
      this.extendStampStroke(stroke);
    } else {
      rasterizeStroke(this.strokeCtx, stroke, 0);
    }
    this.requestFrame();
  }

  endStroke(stroke: StrokeRecord): void {
    const doc = this.doc;
    if (!doc) {
      this.cancelStroke();
      return;
    }

    if (stroke.erase === true) {
      // The layer already holds the subtracted pixels: `applyErase` kept it in
      // sync as the stroke grew, so painting the buffer on top would re-add the
      // erased coverage.
      if (this.eraseBase === null) {
        // Only reachable when the document changed under the stroke, which
        // dropped the snapshot. The pixels then no longer match the stroke list,
        // so rebuild the layer from it - the stroke is in the store by the time
        // the frame runs.
        this.invalidateLayer(stroke.layerId);
      }
      this.dropEraseBase();
      this.clearStrokeBuffer();
      this.activeStroke = null;
      this.dropStampCoverage();
      this.dropPreviewSurface();
      this.requestFrame();
      return;
    }

    const surface = this.ensureRasterized(stroke.layerId);
    this.compositeStrokeBuffer(surface, stroke);
    this.clearStrokeBuffer();
    this.activeStroke = null;
    this.dropStampCoverage();
    // The preview is over: the group scratch is released so it cannot sit
    // next to a later erase snapshot (see the raster budget).
    this.dropPreviewSurface();
    this.requestFrame();
  }

  cancelStroke(): void {
    if (this.eraseBase) {
      // A cancelled erase leaves no pixels behind: during an erasing stroke the
      // surface holds *snapshot minus stroke*, which is not what the stroke list
      // says, so it must be put back before the snapshot is dropped.
      this.restoreEraseBase();
    }
    this.dropEraseBase();
    this.clearStrokeBuffer();
    this.activeStroke = null;
    this.dropStampCoverage();
    this.dropPreviewSurface();
    this.requestFrame();
  }

  setSelection(selection: RendererSelection | null): void {
    if (this.destroyed) {
      return;
    }
    this.selection = selection;
    this.requestFrame();
  }

  /**
   * Sets the gradient overlay - the handles and the line of the selected
   * gradient - or clears it with `null`.
   *
   * Overlay only: it is drawn on the display canvas above the layers and never
   * reaches a layer surface, the document or `composeDocumentImage`.
   */
  setGradientOverlay(overlay: RendererGradientOverlay | null): void {
    if (this.destroyed) {
      return;
    }
    this.gradientOverlay = overlay;
    this.requestFrame();
  }

  /**
   * Marks a guide as the selected one, or clears the selection.
   *
   * Overlay only: the selected guide is drawn in the selection accent on the
   * display canvas, and never reaches a layer surface or an export.
   */
  setSelectedGuide(guideId: string | null): void {
    if (this.destroyed || guideId === this.selectedGuideId) {
      return;
    }
    this.selectedGuideId = guideId;
    this.requestFrame();
  }

  /**
   * Sets the ruler display settings.
   *
   * Display only, like the grid: the strips are painted on the display canvas
   * and never reach a layer surface or `composeDocumentImage`, so an export is
   * identical whether the rulers were shown or not.
   */
  setRulers(rulers: RulerSettings): void {
    if (this.destroyed || rulers.visible === this.rulers.visible) {
      return;
    }
    this.rulers = rulers;
    this.requestFrame();
  }

  /**
   * Sets the symmetry the in-progress stroke is repeated around.
   *
   * The symmetry has two jobs here, and both are display-only: the overlay
   * shows the axes and the centre marker, and the in-progress stroke is
   * painted once per copy so the user sees the symmetric result *while* they
   * draw. The copies themselves are ordinary strokes the engine commits to the
   * layer, so nothing here reaches a layer surface or an export.
   */
  setSymmetry(symmetry: SymmetrySettings): void {
    if (this.destroyed) {
      return;
    }
    this.symmetry = symmetry;
    this.requestFrame();
  }

  /**
   * Sets the grid's visibility and spacing.
   *
   * Overlay only, like the guides: the grid is drawn on the display canvas and
   * never reaches a layer surface, a project file or an export. A no-op change
   * asks for no frame.
   */
  setGrid(grid: GridSettings): void {
    if (
      this.destroyed ||
      (grid.visible === this.grid.visible && grid.spacing === this.grid.spacing)
    ) {
      return;
    }
    this.grid = grid;
    this.requestFrame();
  }

  /**
   * Sets the reference overlay - the images the artist keeps beside the
   * canvas - or clears it with `null`.
   *
   * Overlay only, like the selection: the references are painted on the
   * display canvas and never reach a layer surface, the document or
   * `composeDocumentImage`, so an export is identical whether a reference was
   * shown or not.
   */
  setReferenceOverlay(overlay: ReferenceOverlay | null): void {
    if (this.destroyed) {
      return;
    }
    this.referenceOverlay = overlay;
    this.requestFrame();
  }

  /**
   * Paints every display target.
   *
   * One document, several windows: each target is painted from the same
   * surfaces and the same in-progress stroke, through its own view transform.
   * A target that is not attached (a closed view) is simply not in the map,
   * so there is nothing to clean up beyond dropping the target itself.
   */
  render(): void {
    if (this.destroyed) {
      return;
    }
    for (const target of this.targets.values()) {
      this.renderTarget(target);
    }
  }

  /** Paints one display target. */
  private renderTarget(target: DisplayTarget): void {
    const { ctx, canvas } = target;
    const pixelWidth = canvas.width;
    const pixelHeight = canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);

    const doc = this.doc;
    if (!doc || pixelWidth === 0 || pixelHeight === 0) {
      return;
    }

    const { viewport, devicePixelRatio } = target;
    const scale = devicePixelRatio * viewport.zoom;
    // The whole view is one affine: zoom, rotation and the mirror. The
    // transform maps document coordinates to device pixels, so the device pixel
    // ratio multiplies every term. Its scale stays uniform, which is why the
    // hairline widths below (`1 / scale`) are still one device pixel.
    const matrix = viewMatrix(viewport);
    ctx.setTransform(
      withoutNegativeZero(matrix.a * devicePixelRatio),
      withoutNegativeZero(matrix.b * devicePixelRatio),
      withoutNegativeZero(matrix.c * devicePixelRatio),
      withoutNegativeZero(matrix.d * devicePixelRatio),
      withoutNegativeZero(viewport.offsetX * devicePixelRatio),
      withoutNegativeZero(viewport.offsetY * devicePixelRatio),
    );

    this.paintDocument(ctx, this.activeStroke?.erase === true ? null : this.activeStroke);

    this.paintGrid(ctx, scale, target);

    this.paintGuides(ctx, scale, target);

    // The guide's own label, in screen space so it keeps its size at any
    // zoom. It is painted with the guides it belongs to.
    this.paintGuideLabels(ctx, target);

    this.paintSymmetry(ctx, scale, target);

    // The references belong to the workspace the artist works in, which is the
    // primary target; a second view of the document is another window onto the
    // artwork, not another place to keep a reference.
    if (target.id === PRIMARY_DISPLAY_TARGET) {
      this.paintReferences(ctx, target);
    }

    this.paintSelection(ctx, scale);

    this.paintGradientOverlay(ctx, scale);

    // Hairline document boundary: exactly one device pixel at any zoom.
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = DOCUMENT_BORDER_COLOR;
    ctx.strokeRect(0, 0, doc.width, doc.height);

    // The symmetry centre and the ruler strips are the outermost chrome: they
    // belong to the workspace rather than to the view of the paper.
    this.paintSymmetryCenter(ctx, target);

    this.paintRulers(ctx, target);
  }

  /**
   * Draws the grid over the artwork, beneath the guides.
   *
   * The lines are document-space multiples of the spacing, so they zoom and pan
   * with the paper, and they are clipped to the document rectangle: a grid
   * belongs to the artwork, unlike a guide, which spans the whole viewport.
   * The appearance is screen space - one device pixel wide - the same hairline
   * idiom as the guides and the document border.
   *
   * Nothing here reaches a layer surface or `composeDocumentImage`, so a PNG
   * export is byte-identical whether the grid was shown or not.
   */
  private paintGrid(ctx: CanvasRenderingContext2D, scale: number, target: DisplayTarget): void {
    const doc = this.doc;
    if (!doc || !this.grid.visible) {
      return;
    }

    const spacing = this.grid.spacing;
    // Device pixels between two lines: below this the grid is a wash, so it is
    // hidden rather than drawn as an unreadable block.
    if (!(spacing > 0) || spacing * scale < MIN_GRID_GAP_PX) {
      return;
    }

    const viewWidth = target.canvas.width / target.devicePixelRatio;
    const viewHeight = target.canvas.height / target.devicePixelRatio;
    const visible = visibleDocumentRect(target.viewport, viewWidth, viewHeight);
    const left = visible.left;
    const top = visible.top;
    const right = visible.right;
    const bottom = visible.bottom;

    // The visible part of the paper, which is all the grid covers.
    const startX = Math.max(0, left);
    const endX = Math.min(doc.width, right);
    const startY = Math.max(0, top);
    const endY = Math.min(doc.height, bottom);
    if (startX > endX || startY > endY) {
      return;
    }

    const verticals = gridLinesBetween(startX, endX, spacing);
    const horizontals = gridLinesBetween(startY, endY, spacing);
    if (verticals.length === 0 && horizontals.length === 0) {
      return;
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    for (const x of verticals) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (const y of horizontals) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * Draws the composition guides over the artwork.
   *
   * A guide is a full-viewport line, not a mark on the paper: it stays visible
   * while the paper is panned away, and a guide may sit outside the paper
   * altogether. Its *position* is document space - the canvas transform already
   * maps document to device - while its *appearance* is screen space: the line
   * is one device pixel wide at any zoom, the same hairline idiom as the
   * document border.
   *
   * The guides are not part of the document's pixels: they are drawn on the
   * display canvas only, so an export of a document with guides is
   * byte-identical to one without. The selected guide is drawn in the
   * selection accent, so it is told apart from the others at a glance.
   */
  private paintGuides(ctx: CanvasRenderingContext2D, scale: number, target: DisplayTarget): void {
    const doc = this.doc;
    if (!doc || doc.guides.length === 0) {
      return;
    }

    const viewWidth = target.canvas.width / target.devicePixelRatio;
    const viewHeight = target.canvas.height / target.devicePixelRatio;
    // The viewport in document space: what the user can see right now. A
    // rotated or mirrored view shows a rectangle that is not a rectangle in
    // document space, so this is the bounding box of the visible area.
    const visible = visibleDocumentRect(target.viewport, viewWidth, viewHeight);
    const left = visible.left;
    const top = visible.top;
    const right = visible.right;
    const bottom = visible.bottom;

    ctx.globalAlpha = 1;
    ctx.lineWidth = 1 / scale;
    for (const guide of doc.guides) {
      ctx.strokeStyle = guide.id === this.selectedGuideId ? SELECTION_COLOR : GUIDE_COLOR;
      ctx.beginPath();
      if (guide.axis === "vertical") {
        ctx.moveTo(guide.position, top);
        ctx.lineTo(guide.position, bottom);
      } else {
        ctx.moveTo(left, guide.position);
        ctx.lineTo(right, guide.position);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Draws the reference images over the workspace.
   *
   * A reference lives in **workspace space**: its rectangle is in the canvas'
   * own CSS pixels, not in document pixels, so it stays where the artist put
   * it while the artwork is zoomed and panned underneath. The canvas transform
   * at this point maps *document* space to device pixels, so the reference is
   * drawn with the transform replaced by the device pixel ratio alone - the
   * one affine that maps CSS pixels to device pixels.
   *
   * The images are drawn over the artwork, because the paper is opaque: a
   * reference *under* the paper would never be seen. The selection overlay is
   * painted after this, so the handles of a selected stroke stay readable over
   * a reference.
   *
   * Nothing here reaches a layer surface or `composeDocumentImage`, so a PNG
   * export is byte-identical whether a reference was shown or not.
   */
  private paintReferences(ctx: CanvasRenderingContext2D, target: DisplayTarget): void {
    const overlay = this.referenceOverlay;
    if (!overlay || overlay.items.length === 0) {
      return;
    }

    const dpr = target.devicePixelRatio;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    for (const item of overlay.items) {
      const reference = item.reference;
      if (!reference.visible || reference.opacity <= 0) {
        continue;
      }
      ctx.globalAlpha = reference.opacity;
      ctx.drawImage(
        item.source,
        reference.x,
        reference.y,
        reference.width,
        reference.height,
      );
    }

    ctx.globalAlpha = 1;

    // The frame of the selected reference, and the outline of the one under the
    // pointer. They are the feedback that tells the artist which image a press
    // would sample.
    for (const item of overlay.items) {
      const reference = item.reference;
      if (!reference.visible) {
        continue;
      }
      const selected = reference.id === overlay.selectedId;
      const hovered = reference.id === overlay.hoveredId;
      if (!selected && !hovered) {
        continue;
      }
      ctx.strokeStyle = selected ? REFERENCE_COLOR : REFERENCE_HOVER_COLOR;
      ctx.lineWidth = 1 / dpr;
      ctx.setLineDash(selected ? [4 / dpr, 3 / dpr] : []);
      ctx.strokeRect(reference.x, reference.y, reference.width, reference.height);
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Draws each guide's coordinate next to the edge it is anchored to.
   *
   * A guide is a registration mark, and a registration mark is only useful if
   * the user can read where it sits: the label shows the guide's position in
   * document pixels, so the same guide is read the same way at every zoom.
   *
   * The labels are **screen space**: they keep their size whatever the zoom,
   * and they sit just inside the canvas edge, clear of the ruler strips when
   * those are shown.
   */
  private paintGuideLabels(ctx: CanvasRenderingContext2D, target: DisplayTarget): void {
    const doc = this.doc;
    if (!doc || doc.guides.length === 0) {
      return;
    }
    const dpr = target.devicePixelRatio;
    const width = target.canvas.width / dpr;
    const height = target.canvas.height / dpr;
    const { zoom, offsetX, offsetY } = target.viewport;
    const top = this.rulers.visible ? RULER_SIZE_PX : 0;
    const left = this.rulers.visible ? RULER_LEFT_SIZE_PX : 0;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.font = GUIDE_LABEL_FONT;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    for (const guide of doc.guides) {
      const text = String(guide.position);
      if (guide.axis === "vertical") {
        const x = guide.position * zoom + offsetX;
        if (x < 0 || x > width) {
          continue;
        }
        ctx.textAlign = "center";
        this.drawLabelChip(ctx, x, top + 3, text, guide.id === this.selectedGuideId ? SELECTION_COLOR : GUIDE_LABEL_COLOR);
      } else {
        const y = guide.position * zoom + offsetY;
        if (y < 0 || y > height) {
          continue;
        }
        ctx.textAlign = "left";
        this.drawLabelChip(ctx, left + 3, y + 3, text, guide.id === this.selectedGuideId ? SELECTION_COLOR : GUIDE_LABEL_COLOR);
      }
    }
    ctx.restore();
  }

  /**
   * Draws a small chip of text with a background behind it.
   *
   * The background is what makes a label readable over dark ink as well as
   * over paper, and it is drawn in the current transform - screen space for
   * the guide and symmetry labels.
   */
  private drawLabelChip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
    color: string,
  ): void {
    const metrics = ctx.measureText(text);
    const width = Math.max(1, metrics.width);
    ctx.fillStyle = GUIDE_LABEL_BACKGROUND;
    ctx.fillRect(x - width / 2 - 2, y - 1, width + 4, 12);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /**
   * Draws the symmetry axes over the artwork.
   *
   * The axes are the lines the copies are mirrored or turned about, drawn
   * across the whole viewport like a guide: they are a registration aid, not
   * a mark on the paper, so they stay visible while the paper is panned away.
   *
   * They are overlay only: the display canvas only, never a layer surface and
   * never an export.
   */
  private paintSymmetry(ctx: CanvasRenderingContext2D, scale: number, target: DisplayTarget): void {
    const axes = symmetryAxes(this.symmetry);
    if (axes.length === 0) {
      return;
    }
    const viewWidth = target.canvas.width / target.devicePixelRatio;
    const viewHeight = target.canvas.height / target.devicePixelRatio;
    const visible = visibleDocumentRect(target.viewport, viewWidth, viewHeight);
    const { x: cx, y: cy } = this.symmetry.center;

    ctx.globalAlpha = 1;
    ctx.strokeStyle = SYMMETRY_COLOR;
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    for (const angle of axes) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let reach = Number.POSITIVE_INFINITY;
      if (dx > 0) {
        reach = Math.min(reach, (visible.right - cx) / dx);
      } else if (dx < 0) {
        reach = Math.min(reach, (visible.left - cx) / dx);
      }
      if (dy > 0) {
        reach = Math.min(reach, (visible.bottom - cy) / dy);
      } else if (dy < 0) {
        reach = Math.min(reach, (visible.top - cy) / dy);
      }
      if (!Number.isFinite(reach)) {
        reach = 0;
      }
      ctx.moveTo(cx - dx * reach, cy - dy * reach);
      ctx.lineTo(cx + dx * reach, cy + dy * reach);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * Draws the symmetry centre marker.
   *
   * The marker is the one handle the symmetry has: the user grabs it to move
   * the centre, so it is drawn in the selection accent and in **screen
   * space**, which keeps it the same size at every zoom.
   */
  private paintSymmetryCenter(ctx: CanvasRenderingContext2D, target: DisplayTarget): void {
    if (!this.symmetry.enabled) {
      return;
    }
    const dpr = target.devicePixelRatio;
    const { zoom, offsetX, offsetY } = target.viewport;
    const x = this.symmetry.center.x * zoom + offsetX;
    const y = this.symmetry.center.y * zoom + offsetY;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = SYMMETRY_CENTER_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, SYMMETRY_CENTER_RADIUS_PX, 0, Math.PI * 2);
    ctx.moveTo(x - SYMMETRY_CENTER_RADIUS_PX - 3, y);
    ctx.lineTo(x + SYMMETRY_CENTER_RADIUS_PX + 3, y);
    ctx.moveTo(x, y - SYMMETRY_CENTER_RADIUS_PX - 3);
    ctx.lineTo(x, y + SYMMETRY_CENTER_RADIUS_PX + 3);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws the ruler strips along the top and the left of the canvas.
   *
   * The strips are the workspace's own furniture: they are drawn in **screen
   * space**, on top of everything else, because they measure the view rather
   * than the paper. Their ticks are document coordinates, so they pan and zoom
   * with the paper, and the step between two labelled ticks is chosen from the
   * live zoom so the numbers stay readable.
   *
   * The rulers are overlay only: they never reach a layer surface, the
   * document or a PNG export.
   */
  private paintRulers(ctx: CanvasRenderingContext2D, target: DisplayTarget): void {
    if (!this.rulers.visible) {
      return;
    }
    const dpr = target.devicePixelRatio;
    const width = target.canvas.width / dpr;
    const height = target.canvas.height / dpr;
    if (width <= 0 || height <= 0) {
      return;
    }
    const { zoom, offsetX, offsetY } = target.viewport;
    const step = rulerStep(zoom);
    const minor = rulerMinorStep(step);

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.font = RULER_FONT;
    ctx.textBaseline = "middle";

    // The strips themselves.
    ctx.fillStyle = RULER_BACKGROUND_COLOR;
    ctx.fillRect(0, 0, width, RULER_SIZE_PX);
    ctx.fillRect(0, 0, RULER_LEFT_SIZE_PX, height);
    ctx.strokeStyle = RULER_BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_SIZE_PX + 0.5);
    ctx.lineTo(width, RULER_SIZE_PX + 0.5);
    ctx.moveTo(RULER_LEFT_SIZE_PX + 0.5, 0);
    ctx.lineTo(RULER_LEFT_SIZE_PX + 0.5, height);
    ctx.stroke();

    // The document range the strips cover.
    const fromX = (0 - offsetX) / zoom;
    const toX = (width - offsetX) / zoom;
    const fromY = (0 - offsetY) / zoom;
    const toY = (height - offsetY) / zoom;

    ctx.strokeStyle = RULER_TICK_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (minor > 0) {
      for (const tick of rulerTicks(fromX, toX, minor)) {
        const x = Math.round(tick * zoom + offsetX) + 0.5;
        ctx.moveTo(x, RULER_SIZE_PX - 4);
        ctx.lineTo(x, RULER_SIZE_PX);
      }
      for (const tick of rulerTicks(fromY, toY, minor)) {
        const y = Math.round(tick * zoom + offsetY) + 0.5;
        ctx.moveTo(RULER_LEFT_SIZE_PX - 4, y);
        ctx.lineTo(RULER_LEFT_SIZE_PX, y);
      }
    }
    ctx.stroke();

    // The labelled ticks: a longer mark and the coordinate.
    ctx.strokeStyle = RULER_LABEL_COLOR;
    ctx.beginPath();
    ctx.fillStyle = RULER_LABEL_COLOR;
    for (const tick of rulerTicks(fromX, toX, step)) {
      const x = Math.round(tick * zoom + offsetX) + 0.5;
      ctx.moveTo(x, RULER_SIZE_PX - 8);
      ctx.lineTo(x, RULER_SIZE_PX);
      ctx.textAlign = "center";
      ctx.fillText(formatRulerLabel(tick), x, RULER_SIZE_PX / 2 - 2);
    }
    for (const tick of rulerTicks(fromY, toY, step)) {
      const y = Math.round(tick * zoom + offsetY) + 0.5;
      ctx.moveTo(RULER_LEFT_SIZE_PX - 8, y);
      ctx.lineTo(RULER_LEFT_SIZE_PX, y);
      ctx.textAlign = "right";
      ctx.fillText(formatRulerLabel(tick), RULER_LEFT_SIZE_PX - 3, y);
    }
    ctx.stroke();
    ctx.restore();
  }

   /**
   * Draws the selection overlay: the selected strokes traced in the accent
   * colour, then the rubber-band rectangle and the transform handles.
   *
   * Strokes are traced along their centrelines rather than re-rasterized with
   * their brush, because the overlay answers one question - "what will a
   * transform move?" - and a thin constant-width trace answers it for a 1px pen
   * and a 512px brush alike. The trace is not part of the document: it is drawn
   * on the display canvas only, so an export of a document with a selection is
   * byte-identical to one without.
   */
  private paintSelection(ctx: CanvasRenderingContext2D, scale: number): void {
    const selection = this.selection;
    if (!selection) {
      return;
    }

    if (selection.strokes.length > 0) {
      ctx.globalAlpha = SELECTION_TRACE_ALPHA;
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = SELECTION_TRACE_WIDTH / scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const stroke of selection.strokes) {
        const count = stroke.xs.length;
        if (count === 0) {
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(stroke.xs[0], stroke.ys[0]);
        if (count === 1) {
          // A single sample is a dab; a zero-length segment plus a round cap
          // draws it as a dot, which is what the stroke itself painted.
          ctx.lineTo(stroke.xs[0], stroke.ys[0]);
        } else {
          for (let index = 1; index < count; index += 1) {
            ctx.lineTo(stroke.xs[index], stroke.ys[index]);
          }
        }
        ctx.stroke();
      }
    }

    const bounds = selection.bounds;
    if (bounds) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([SELECTION_MARQUEE_DASH[0] / scale, SELECTION_MARQUEE_DASH[1] / scale]);
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.setLineDash([]);
    }

    if (selection.handles) {
      this.paintSelectionHandles(ctx, scale, selection.handles, bounds);
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Draws the transform handles: a square on each corner of the frame and a
   * circle above it that turns the selection.
   *
   * Overlay only, like the frame and the trace: the handles are painted on the
   * display canvas and never reach a layer surface, the document or a PNG
   * export. Their **positions** are in document space, so they sit on the
   * selection's corners exactly; their **size** is in screen pixels, so they
   * stay the same size on screen at any zoom.
   */
  private paintSelectionHandles(
    ctx: CanvasRenderingContext2D,
    scale: number,
    handles: SelectionHandles,
    bounds: Bounds | null,
  ): void {
    const size = HANDLE_SIZE_PX / scale;
    const half = size / 2;
    const radius = ROTATION_HANDLE_RADIUS_PX / scale;

    ctx.globalAlpha = 1;
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.fillStyle = HANDLE_FILL_COLOR;
    ctx.lineWidth = 1 / scale;

    for (const corner of handles.corners) {
      ctx.fillRect(corner.x - half, corner.y - half, size, size);
      ctx.strokeRect(corner.x - half, corner.y - half, size, size);
    }

    // The rotation handle: a circle above the frame's top edge, tied to it by
    // a short stem so it reads as part of the frame.
    if (bounds) {
      ctx.beginPath();
      ctx.moveTo(handles.rotate.x, handles.rotate.y + radius);
      ctx.lineTo(handles.rotate.x, bounds.y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(handles.rotate.x, handles.rotate.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /**
   * Draws the gradient overlay: the line of the gradient's geometry and the
   * two handles that move it.
   *
   * A linear gradient draws its axis, from the start handle to the end
   * handle. A radial one draws the **circle** its radius makes, plus the
   * radius line from the centre to the radius handle, so the two handles read
   * as "the centre" and "the edge".
   *
   * Overlay only, like the selection handles: the positions are in document
   * space, so the handles sit on the gradient's own points, and the sizes are
   * in screen pixels, so they stay the same size at any zoom. Nothing here
   * reaches a layer surface or `composeDocumentImage`, so an export of a
   * document with a gradient selected is byte-identical to one without.
   */
  private paintGradientOverlay(ctx: CanvasRenderingContext2D, scale: number): void {
    const overlay = this.gradientOverlay;
    if (!overlay) {
      return;
    }

    const size = HANDLE_SIZE_PX / scale;
    const half = size / 2;

    ctx.globalAlpha = 1;
    ctx.strokeStyle = GRADIENT_COLOR;
    ctx.fillStyle = HANDLE_FILL_COLOR;
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([]);

    // The geometry itself: the axis of a linear gradient, the radius line and
    // the circle of a radial one.
    ctx.beginPath();
    ctx.moveTo(overlay.start.x, overlay.start.y);
    ctx.lineTo(overlay.end.x, overlay.end.y);
    ctx.stroke();

    if (overlay.type === "radial") {
      const radius = Math.hypot(
        overlay.end.x - overlay.start.x,
        overlay.end.y - overlay.start.y,
      );
      ctx.beginPath();
      ctx.arc(overlay.start.x, overlay.start.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // The handles. The one being dragged is filled with the accent, so the
    // user can see which end of the geometry they are holding.
    for (const [index, point] of [overlay.start, overlay.end].entries()) {
      const active = overlay.activeHandle === (index === 0 ? "start" : "end");
      ctx.fillStyle = active ? GRADIENT_COLOR : HANDLE_FILL_COLOR;
      ctx.fillRect(point.x - half, point.y - half, size, size);
      ctx.strokeRect(point.x - half, point.y - half, size, size);
    }

    ctx.fillStyle = HANDLE_FILL_COLOR;
    ctx.globalAlpha = 1;
  }

  /**
   * Composites the document - paper plus every visible layer - into a fresh
   * canvas at document pixel size.
   *
   * This is the export path, so it deliberately differs from `render()`: no
   * viewport transform, no border, no in-progress stroke, and a resolution that
   * is exactly the document size regardless of `rasterScale`. The display
   * canvas and the document itself are untouched, which is what lets a PNG be
   * exported mid-session without altering what is being edited.
   *
   * `layerIds` narrows the composite to a set of layers, for the bucket's
   * reference modes. `null` keeps every visible layer.
   */
  composeDocumentImage(layerIds: readonly LayerId[] | null = null): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const doc = this.doc;

    if (this.destroyed || !doc) {
      canvas.width = 1;
      canvas.height = 1;
      return canvas;
    }

    canvas.width = Math.max(1, Math.round(doc.width));
    canvas.height = Math.max(1, Math.round(doc.height));

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable for image export.");
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.paintDocument(ctx, null, layerIds);

    return canvas;
  }

  /**
   * Composites a small overview of the document.
   *
   * The overview is drawn from the *cached* layer surfaces, so it is a
   * downscale of what is already on screen rather than a second rendering of
   * the document. A layer whose pixels are stale is re-rasterized first, which
   * is the same work the display would do anyway.
   *
   * The caller chooses the size, and is expected to pick one that matches the
   * document's aspect ratio: the whole document is scaled into the canvas, so
   * a mismatched size would stretch the picture.
   */
  renderOverview(maxWidth: number, maxHeight: number): HTMLCanvasElement | null {
    const doc = this.doc;
    if (this.destroyed || !doc) {
      return null;
    }

    const width = Math.max(1, Math.round(maxWidth));
    const height = Math.max(1, Math.round(maxHeight));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, width, height);

    for (const layer of doc.layers) {
      if (!isComposited(layer)) {
        continue;
      }
      const surface = this.ensureRasterized(layer.id);
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = compositeOperationFor(layer.blendMode);
      ctx.drawImage(
        surface.canvas,
        0,
        0,
        surface.canvas.width,
        surface.canvas.height,
        0,
        0,
        width,
        height,
      );
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    return canvas;
  }

  /**
   * Reads the composite the user sees at a document point.
   *
   * A 1x1 scratch is filled with the paper, then every visible layer is drawn
   * offset so that the sampled document pixel lands exactly on `(0, 0)`. The
   * offset is floored so the probe stays pixel-aligned with what is on screen:
   * nothing is interpolated, so the read is the pixel under the eye rather than
   * a blend of its neighbours. The paper is opaque, so the returned colour
   * needs no alpha; the precision is the surfaces' - 8 bits per channel.
   */
  readCompositePixel(docX: number, docY: number): Rgb | null {
    const doc = this.doc;
    if (this.destroyed || !doc) {
      return null;
    }

    const probe = this.ensureProbeCanvas();
    const ctx = probe.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, 1, 1);

    const offsetX = -Math.floor(docX * this.rasterScale);
    const offsetY = -Math.floor(docY * this.rasterScale);
    for (const layer of doc.layers) {
      if (!isComposited(layer)) {
        continue;
      }
      const surface = this.ensureRasterized(layer.id);
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = compositeOperationFor(layer.blendMode);
      ctx.drawImage(surface.canvas, offsetX, offsetY);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    return { r: pixel[0], g: pixel[1], b: pixel[2] };
  }

  requestRender(): void {
    this.requestFrame();
  }

  /**
   * Reads the whole composite at document resolution for the bucket fill.
   *
   * `options.layerIds` narrows the read to a set of layers, so the bucket can
   * sample one layer instead of the merged picture. Hidden layers never
   * contribute, whatever the list says.
   */
  readCompositeImage(options?: CompositeReadOptions): ImageData | null {
    const doc = this.doc;
    if (this.destroyed || !doc) {
      return null;
    }
    const canvas = this.composeDocumentImage(options?.layerIds ?? null);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.scheduler.cancel();
    this.surfaces.dispose();
    // Every canvas the renderer painted into is released with it: a closed
    // view must not leave a target behind that would be painted again.
    this.targets.clear();
    this.activeStroke = null;
    this.dropEraseBase();
    this.dropStampCoverage();
    this.probeCanvas = null;
    this.featherBuffer = null;
    this.previewSurface = null;
    this.stampUpload = null;
  }

  /**
   * Paper plus every visible layer with `opacity > 0`, bottom-first. The caller
   * owns the transform, so display rendering and export share this exactly.
   *
   * `preview` is the in-progress (non-erasing) stroke. It is drawn in its own
   * layer's slot - after that layer's committed content and before any layer
   * above it - so releasing a stroke never changes its stacking. Erasing
   * strokes are not passed here: they are already subtracted from the layer
   * surface, which is what this loop composites. Export passes no preview, so
   * an in-flight stroke never leaks into a PNG.
   *
   * `layerIds` narrows the composite to a set of layers, which is how the
   * bucket samples the active layer or one chosen layer instead of the merged
   * picture. A hidden layer is skipped either way.
   */
  private paintDocument(
    ctx: CanvasRenderingContext2D,
    preview: StrokeRecord | null = null,
    layerIds: readonly LayerId[] | null = null,
  ): void {
    const doc = this.doc;
    if (!doc) {
      return;
    }

    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);

    for (const layer of doc.layers) {
      if (!isComposited(layer)) {
        continue;
      }
      if (layerIds !== null && !layerIds.includes(layer.id)) {
        continue;
      }
      const surface = this.ensureRasterized(layer.id);
      const previewHere = preview !== null && preview.layerId === layer.id;

      if (previewHere && (layer.opacity < 1 || layer.blendMode !== "normal")) {
        // Group first, then apply the layer's opacity and blend once: the same
        // order a commit takes. A hidden or zero-opacity layer was skipped
        // above, so its preview is hidden with it.
        const group = this.buildPreviewGroup(surface, preview);
        if (group) {
          ctx.globalAlpha = layer.opacity;
          ctx.globalCompositeOperation = compositeOperationFor(layer.blendMode);
          ctx.drawImage(group, 0, 0, doc.width, doc.height);
          continue;
        }
      }

      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = compositeOperationFor(layer.blendMode);
      ctx.drawImage(surface.canvas, 0, 0, doc.width, doc.height);

      if (previewHere) {
        // An opaque `normal` layer needs no scratch: source-over is associative,
        // so painting the preview straight after its layer is identical to
        // grouping the two first. This is the common case and costs no canvas.
        // The buffer holds full coverage; the stroke's alpha is applied here,
        // once (and, for a soft brush, its edge is feathered once - never per
        // segment).
        ctx.globalAlpha = strokeOpacity(preview.brush, preview.pressures);
        ctx.globalCompositeOperation = "source-over";
        this.paintSymmetricCoverage(ctx, preview);
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Draws a layer surface plus the in-progress stroke into one scratch canvas.
   *
   * Read-only with respect to the layer: the group is assembled in `preview`'s
   * own scratch, so no committed pixel or document state changes before the
   * release. Drawing the layer at document scale keeps `rasterScale` and the
   * feathered/textured stroke path consistent with `compositeStrokeBuffer`.
   */
  private buildPreviewGroup(
    surface: LayerSurface,
    stroke: StrokeRecord,
  ): HTMLCanvasElement | null {
    const doc = this.doc;
    if (!doc) {
      return null;
    }
    const canvas = this.ensurePreviewSurface();
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scale = this.rasterScale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(surface.canvas, 0, 0, doc.width, doc.height);
    ctx.globalAlpha = strokeOpacity(stroke.brush, stroke.pressures);
    this.paintSymmetricCoverage(ctx, stroke);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    return canvas;
  }

  /**
   * Paints the in-progress stroke once per symmetry copy.
   *
   * The stroke the user is drawing is one of the copies, so it is painted
   * first and unchanged; every other copy is the *same* coverage mapped
   * through the symmetry's transform. Mapping the finished coverage rather
   * than the samples is what keeps the preview honest: the mirror of a stroke
   * is the mirror of its pixels, whether the brush is hard, soft or a chain of
   * dabs.
   *
   * Each copy is painted with its own alpha, in the order the copies will be
   * committed in, so the preview is the picture the release produces.
   */
  private paintSymmetricCoverage(ctx: CanvasRenderingContext2D, stroke: StrokeRecord): void {
    this.paintStrokeCoverage(ctx, stroke);
    const transforms = symmetryTransforms(this.symmetry);
    for (let index = 1; index < transforms.length; index += 1) {
      const transform = transforms[index];
      ctx.save();
      // The canvas transform is the document-to-device map, so multiplying the
      // symmetry's matrix into it maps the copy in document space.
      ctx.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
      this.paintStrokeCoverage(ctx, stroke);
      ctx.restore();
    }
  }

  /** The group scratch, sized like a layer surface; allocated on first use. */
  private ensurePreviewSurface(): HTMLCanvasElement {
    const existing = this.previewSurface;
    if (existing) {
      const doc = this.doc;
      if (doc) {
        resizeCanvas(existing, doc.width * this.rasterScale, doc.height * this.rasterScale);
      }
      return existing;
    }
    const canvas = document.createElement("canvas");
    const doc = this.doc;
    canvas.width = Math.max(1, Math.round((doc?.width ?? 1) * this.rasterScale));
    canvas.height = Math.max(1, Math.round((doc?.height ?? 1) * this.rasterScale));
    this.previewSurface = canvas;
    return canvas;
  }

  /** The 1x1 colour-probe canvas, allocated on first use and reused after. */
  private ensureProbeCanvas(): HTMLCanvasElement {
    const existing = this.probeCanvas;
    if (existing) {
      return existing;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    this.probeCanvas = canvas;
    return canvas;
  }

  /** Rasterizes a layer from its stroke list when its pixels are invalid. */
  private ensureRasterized(layerId: LayerId): LayerSurface {
    const surface = this.surfaces.ensure(layerId);
    if (surface.dirty) {
      this.rasterizeLayer(surface);
    }
    return surface;
  }

  /**
   * Rasterizes a layer from its stroke list when its pixels are invalid.
   *
   * Every element is rasterized into the stroke buffer and blended onto the
   * surface, one element at a time, in painting order. Only the rectangle the
   * element can ink is cleared and blended, so the cost of a rebuild follows
   * the strokes' geometry instead of the document size: a layer of many small
   * strokes costs a few small rectangles, not a few document-sized ones.
   */
  private rasterizeLayer(surface: LayerSurface): void {
    this.surfaces.clear(surface);
    this.surfaces.prepare(surface);
    for (const element of this.strokeSource.listElements(surface.layerId)) {
      if (isFillPatch(element)) {
        this.rasterizeFillPatch(surface, element);
        continue;
      }
      if (isGradient(element)) {
        this.rasterizeGradient(surface, element);
        continue;
      }
      this.rasterizeStrokeToBuffer(element);
      this.compositeStrokeBuffer(
        surface,
        element,
        element.erase === true ? "destination-out" : "source-over",
      );
    }
    surface.dirty = false;
  }

  /**
   * Paints a committed bucket fill onto a layer surface.
   *
   * The mask is document-resolution (one coverage byte per pixel); the surface
   * may be supersampled. Drawing the patch through the surface transform keeps
   * it consistent with every stroke around it - live drawing, undo/redo and a
   * reopened project all go through this one function, so they cannot disagree.
   */
  private rasterizeFillPatch(surface: LayerSurface, patch: FillPatchRecord): void {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, patch.width);
    canvas.height = Math.max(1, patch.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const image = ctx.createImageData(canvas.width, canvas.height);
    const colour = hexToRgb(patch.color) ?? { r: 0, g: 0, b: 0 };
    for (let index = 0; index < patch.mask.length; index += 1) {
      const offset = index * 4;
      image.data[offset] = colour.r;
      image.data[offset + 1] = colour.g;
      image.data[offset + 2] = colour.b;
      image.data[offset + 3] = patch.mask[index];
    }
    ctx.putImageData(image, 0, 0);

    this.surfaces.prepare(surface);
    surface.ctx.globalCompositeOperation = "source-over";
    surface.ctx.globalAlpha = 1;
    surface.ctx.drawImage(canvas, patch.x, patch.y, patch.width, patch.height);
  }

  /**
   * Paints a committed gradient across the whole layer.
   *
   * Gradients are continuous content, so this runs the Canvas gradient shader
   * over the layer's full extent rather than allocating a document-sized patch.
   * Geometry is in document coordinates and the surface transform scales it, so
   * live preview, undo/redo and a reopened project share one rasterization path.
   * Element opacity is applied once through `globalAlpha`.
   */
  private rasterizeGradient(surface: LayerSurface, gradient: GradientRecord): void {
    if (gradient.stops.length === 0 || gradient.opacity <= 0) {
      return;
    }
    const length = Math.hypot(gradient.x2 - gradient.x1, gradient.y2 - gradient.y1);
    if (length <= 0) {
      return;
    }

    this.surfaces.prepare(surface);
    const ctx = surface.ctx;
    const canvasGradient =
      gradient.type === "radial"
        ? ctx.createRadialGradient(
            gradient.x1,
            gradient.y1,
            0,
            gradient.x1,
            gradient.y1,
            length,
          )
        : ctx.createLinearGradient(gradient.x1, gradient.y1, gradient.x2, gradient.y2);

    for (const stop of gradient.stops) {
      if (!hexToRgb(stop.color)) {
        continue;
      }
      canvasGradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = Math.min(1, Math.max(0, gradient.opacity));
    ctx.fillStyle = canvasGradient;
    ctx.fillRect(
      0,
      0,
      this.doc?.width ?? surface.canvas.width,
      this.doc?.height ?? surface.canvas.height,
    );
    ctx.globalAlpha = 1;
  }

  /**
   * Rasterizes one stroke into the stroke buffer, over the rectangle it inks.
   *
   * Only that rectangle is cleared: the buffer is a scratch, and the caller
   * blends the very same rectangle onto the surface, so pixels outside it are
   * never read. A full clear would make every element cost a document-sized
   * `clearRect` for nothing.
   */
  private rasterizeStrokeToBuffer(stroke: StrokeRecord): void {
    const region = this.strokeRegion(stroke);
    if (!region) {
      // A stroke without samples has no coverage to rasterize.
      return;
    }
    this.clearStrokeBufferRegion(region);
    this.prepareStrokeBuffer();
    if (this.isStamped(stroke)) {
      this.rasterizeStampStroke(stroke);
      return;
    }
    rasterizeStroke(this.strokeCtx, stroke, 0);
  }

  /**
   * True when a stroke is drawn as a chain of dabs instead of segments.
   *
   * A filled shape keeps its flat polygon interior, so it is never drawn as
   * dabs: the engine gives shapes the plain segment path in the first place.
   */
  private isStamped(stroke: StrokeRecord): boolean {
    return stroke.brush.stamp === true && stroke.fill !== true;
  }

  /**
   * Paints the dabs the stroke has gained since the last update.
   *
   * The cursor places the new dabs from the path the pointer has just added,
   * and the coverage map keeps their union, so only the new dabs are
   * rasterized. The cursor walks the same path as a full re-rasterization
   * does, so the live preview stays identical to what undo, reopen and export
   * produce for the same samples - the property every other path in the
   * renderer relies on.
   */
  private extendStampStroke(stroke: StrokeRecord): void {
    const coverage = this.stampCoverage;
    const cursor = this.stampCursor;
    if (!coverage || !cursor) {
      return;
    }
    const dabs = cursor.advance(stroke);
    const scale = this.rasterScale;
    const laneWidth = stampTextureLaneWidth(stroke.brush, scale);
    const strength = stroke.brush.stampTexture;
    let dirty: StampRect | null = null;
    for (const dab of dabs) {
      const rect = coverage.paintDab(
        dab.x * scale,
        dab.y * scale,
        dab.radius * scale,
        stroke.brush.stampHardness,
        // The texture rides on the dab's own direction, so the live path and
        // the rebuild path lay the same lanes out over the same pixels.
        strength > 0 ? { angle: dab.angle, laneWidth, strength } : null,
      );
      if (rect) {
        dirty = unionStampRect(dirty, rect);
      }
    }
    if (dirty) {
      this.writeStampCoverage(coverage, dirty, stroke.brush.color);
    }
  }

  /**
   * Rasterizes a whole stamped stroke into the stroke buffer.
   *
   * The rebuild path has no live coverage map to reuse, so the dabs are
   * painted into a scratch map and uploaded in one go. The result is the same
   * coverage the live path produced: the dabs and their union are a pure
   * function of the stroke's samples.
   */
  private rasterizeStampStroke(stroke: StrokeRecord): void {
    const coverage = this.stampScratch;
    coverage.clear();
    const dabs = stampDabs(stroke, stroke.brush);
    const scale = this.rasterScale;
    const laneWidth = stampTextureLaneWidth(stroke.brush, scale);
    const strength = stroke.brush.stampTexture;
    let dirty: StampRect | null = null;
    for (const dab of dabs) {
      const rect = coverage.paintDab(
        dab.x * scale,
        dab.y * scale,
        dab.radius * scale,
        stroke.brush.stampHardness,
        strength > 0 ? { angle: dab.angle, laneWidth, strength } : null,
      );
      if (rect) {
        dirty = unionStampRect(dirty, rect);
      }
    }
    if (dirty) {
      this.writeStampCoverage(coverage, dirty, stroke.brush.color);
    }
  }

  /**
   * Uploads a rectangle of a coverage map to the stroke buffer.
   *
   * The upload is **per coverage tile**, so the buffer it needs is one tile
   * (64 x 64 x 4 = 16 KB) whatever the stroke's size: a document-sized dirty
   * rectangle would be a 256 MiB upload at the raster budget's cap. The map is
   * the authority, so writing a whole tile is always safe - the pixels
   * outside the changed area carry the coverage they already had.
   *
   * `putImageData` writes device pixels and ignores the context transform, so
   * the tiles are placed in the buffer's own pixels.
   */
  private writeStampCoverage(
    coverage: StampCoverage,
    rect: StampRect,
    color: string,
  ): void {
    const rgb = hexToRgb(color) ?? { r: 0, g: 0, b: 0 };
    const image = this.ensureStampUpload();
    const data = image.data;
    const firstTileX = Math.floor(rect.left / COVERAGE_TILE_SIZE);
    const lastTileX = Math.floor((rect.left + rect.width - 1) / COVERAGE_TILE_SIZE);
    const firstTileY = Math.floor(rect.top / COVERAGE_TILE_SIZE);
    const lastTileY = Math.floor((rect.top + rect.height - 1) / COVERAGE_TILE_SIZE);

    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
        const tile = {
          left: tileX * COVERAGE_TILE_SIZE,
          top: tileY * COVERAGE_TILE_SIZE,
          width: COVERAGE_TILE_SIZE,
          height: COVERAGE_TILE_SIZE,
        };
        coverage.writeRect(data, COVERAGE_TILE_SIZE, tile, rgb);
        this.strokeCtx.putImageData(image, tile.left, tile.top);
      }
    }
  }

  /** The reused upload buffer: one coverage tile, never larger. */
  private ensureStampUpload(): ImageData {
    const existing = this.stampUpload;
    if (existing) {
      return existing;
    }
    const created = this.strokeCtx.createImageData(COVERAGE_TILE_SIZE, COVERAGE_TILE_SIZE);
    this.stampUpload = created;
    return created;
  }

  /** Releases the in-flight stroke's coverage map. */
  private dropStampCoverage(): void {
    this.stampCoverage = null;
    this.stampCursor = null;
  }

  /** Clears the part of the stroke buffer a stroke is about to ink. */
  private clearStrokeBufferRegion(region: StrokeRegion): void {
    const { strokeCtx } = this;
    strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
    strokeCtx.globalAlpha = 1;
    strokeCtx.globalCompositeOperation = "source-over";
    strokeCtx.filter = "none";
    strokeCtx.clearRect(region.left, region.top, region.width, region.height);
  }

  /**
   * The padded sample bounds of a stroke, in document coordinates.
   *
   * The padding is the brush radius, the blur spread of a soft edge and one
   * pixel of margin. It is a superset of the rasterized coverage - round caps
   * and joins never reach past the brush radius - and of the region the
   * feather pass reads, so one rectangle serves for all three.
   */
  private strokeSampleBounds(
    stroke: StrokeRecord,
  ): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const radius = strokeFeatherRadius(stroke.brush);
    const spread = strokeDiameter(stroke.brush, 1) / 2 + radius * 3 + 1;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < stroke.xs.length; index += 1) {
      minX = Math.min(minX, stroke.xs[index] - spread);
      minY = Math.min(minY, stroke.ys[index] - spread);
      maxX = Math.max(maxX, stroke.xs[index] + spread);
      maxY = Math.max(maxY, stroke.ys[index] + spread);
    }
    if (minX > maxX || minY > maxY) {
      return null;
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * The device-pixel rectangle a stroke inks, in the stroke buffer.
   *
   * It is clamped to the buffer, so a stroke that leaves the document is
   * clipped exactly like the rasterizer clips it.
   */
  private strokeRegion(stroke: StrokeRecord): StrokeRegion | null {
    const bounds = this.strokeSampleBounds(stroke);
    if (!bounds) {
      return null;
    }
    const scale = this.rasterScale;
    const left = Math.max(0, Math.floor(bounds.minX * scale));
    const top = Math.max(0, Math.floor(bounds.minY * scale));
    const right = Math.min(this.strokeBuffer.width, Math.ceil(bounds.maxX * scale));
    const bottom = Math.min(this.strokeBuffer.height, Math.ceil(bounds.maxY * scale));
    if (right <= left || bottom <= top) {
      return null;
    }
    return { left, top, width: right - left, height: bottom - top };
  }

  /**
   * Paints the stroke buffer onto a layer surface at the stroke's own opacity.
   *
   * `prepare` resets the surface context, so the alpha and the composite
   * operation are set after it and cleared again afterwards: the surface context
   * must not leak state into the next composite. `destination-out` turns the
   * same buffer into an eraser, subtracting the stroke's coverage from whatever
   * is already on the layer. A soft brush submits the feathered copy instead of
   * the raw buffer, so the committed pixels are the ones the user saw.
   */
  private compositeStrokeBuffer(
    surface: LayerSurface,
    stroke: StrokeRecord,
    operation: GlobalCompositeOperation = "source-over",
  ): void {
    const doc = this.doc;
    if (!doc) {
      return;
    }
    const region = this.strokeRegion(stroke);
    this.surfaces.prepare(surface);
    if (!region) {
      // A stroke without samples has no coverage to composite.
      return;
    }
    surface.ctx.globalAlpha = strokeOpacity(stroke.brush, stroke.pressures);
    surface.ctx.globalCompositeOperation = operation;
    this.paintStrokeCoverage(surface.ctx, stroke, region);
    surface.ctx.globalAlpha = 1;
    surface.ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Draws the stroke's coverage into the current (already transformed) context.
   *
   * The caller owns the alpha and the composite operation, so this is the one
   * place that decides between the raw full-coverage buffer and its feathered
   * copy - which is what keeps live drawing, layer commits, rebuilds after
   * undo/redo and export pixel-identical for both a hard and a soft brush.
   *
   * With a `region`, only that rectangle of the buffer is drawn: the surface
   * and the buffer share a pixel grid, so the rectangle is blitted one to one
   * and the pixels outside it - which hold no coverage of this stroke - are
   * never touched. Without one (the display and eraser paths) the whole
   * buffer is drawn, because the viewport clips that for us.
   */
  private paintStrokeCoverage(
    ctx: CanvasRenderingContext2D,
    stroke: StrokeRecord,
    region?: StrokeRegion,
  ): void {
    const doc = this.doc;
    if (!doc) {
      return;
    }
    const radius = strokeFeatherRadius(stroke.brush);
    const texture = Math.min(Math.max(stroke.brush.texture ?? 0, 0), 1);
    if (radius <= 0 && texture <= 0) {
      if (region) {
        // The identity transform keeps the blit on the device pixel grid, so
        // no resampling can shift the coverage by a fraction of a pixel.
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(
          this.strokeBuffer,
          region.left,
          region.top,
          region.width,
          region.height,
          region.left,
          region.top,
          region.width,
          region.height,
        );
        ctx.restore();
        return;
      }
      ctx.drawImage(this.strokeBuffer, 0, 0, doc.width, doc.height);
      return;
    }
    // A zero-radius copy is the scratch path for a hard textured stroke; it
    // keeps the raw stroke buffer untouched for the next extend.
    const feathered = this.featherStroke(stroke, radius);
    if (!feathered) {
      return;
    }
    if (texture > 0) {
      const scale = this.rasterScale;
      this.applyStrokeTexture(
        feathered.canvas,
        Math.round(feathered.x * scale),
        Math.round(feathered.y * scale),
        texture,
      );
    }
    ctx.drawImage(feathered.canvas, feathered.x, feathered.y, feathered.width, feathered.height);
  }

  /**
   * Multiplies a copied stroke's coverage by the document-anchored grain tile.
   *
   * `destination-in` keeps the existing silhouette and only scales its alpha,
   * so the grain cannot bleed outside the stroke or darken at self-overlap.
   * The pattern transform anchors the tile to the document origin rather than
   * the stroke's bounding box, which makes a rebuild at a different bbox or
   * `rasterScale` produce the same grain.
   */
  private applyStrokeTexture(
    canvas: HTMLCanvasElement,
    left: number,
    top: number,
    strength: number,
  ): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const pattern = ctx.createPattern(this.textureTile(strength), "repeat");
    if (!pattern) {
      return;
    }
    const scale = this.rasterScale;
    pattern.setTransform({ a: scale, b: 0, c: 0, d: scale, e: -left, f: -top });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /** Lazily builds (and caches) the white grain tile for one strength. */
  private textureTile(strength: number): HTMLCanvasElement {
    const key = Math.round(Math.min(Math.max(strength, 0), 1) * 20) / 20;
    const cached = this.textureTiles.get(key);
    if (cached) {
      return cached;
    }
    const canvas = document.createElement("canvas");
    canvas.width = TEXTURE_TILE_SIZE;
    canvas.height = TEXTURE_TILE_SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const image = ctx.createImageData(TEXTURE_TILE_SIZE, TEXTURE_TILE_SIZE);
      for (let index = 0; index < TEXTURE_TILE_SIZE * TEXTURE_TILE_SIZE; index += 1) {
        const coverage = textureCoverage(index, key);
        const offset = index * 4;
        image.data[offset] = 255;
        image.data[offset + 1] = 255;
        image.data[offset + 2] = 255;
        image.data[offset + 3] = Math.round(coverage * 255);
      }
      ctx.putImageData(image, 0, 0);
    }
    this.textureTiles.set(key, canvas);
    return canvas;
  }

  /**
   * Blurs the stroke buffer's silhouette by `radius` document pixels and returns
   * it together with the document rectangle it occupies.
   *
   * Only the stroke's padded bounding box is blurred and drawn, so the cost of
   * a soft edge follows the stroke's own footprint instead of the document
   * size. The pad is three blur radii, which is where a Gaussian's contribution
   * has faded out; it also keeps the blur from clipping against the scratch
   * canvas, whose edges then fall on transparent pixels. The blur length is
   * scaled by `rasterScale`, so the soft edge is the same width on screen and in
   * the rasterized layer, and the returned rectangle is in document coordinates
   * so both callers can draw it through their own transform.
   */
  private featherStroke(
    stroke: StrokeRecord,
    radius: number,
  ): { canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number } | null {
    const doc = this.doc;
    if (!doc) {
      return null;
    }

    const scale = this.rasterScale;
    const bounds = this.strokeSampleBounds(stroke);
    if (!bounds) {
      return null;
    }
    const { minX, minY, maxX, maxY } = bounds;

    const left = Math.max(0, Math.floor(minX * scale));
    const top = Math.max(0, Math.floor(minY * scale));
    const right = Math.min(this.strokeBuffer.width, Math.ceil(maxX * scale));
    const bottom = Math.min(this.strokeBuffer.height, Math.ceil(maxY * scale));
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) {
      return null;
    }

    const canvas = this.ensureFeatherBuffer();
    resizeCanvas(canvas, width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = radius > 0 ? `blur(${radius * scale}px)` : "none";
    ctx.drawImage(this.strokeBuffer, left, top, width, height, 0, 0, width, height);
    ctx.filter = "none";

    return { canvas, x: left / scale, y: top / scale, width: width / scale, height: height / scale };
  }

  /** The shared feather scratch canvas, allocated on first use and reused after. */
  private ensureFeatherBuffer(): HTMLCanvasElement {
    const existing = this.featherBuffer;
    if (existing) {
      return existing;
    }
    const canvas = document.createElement("canvas");
    this.featherBuffer = canvas;
    return canvas;
  }

  /**
   * Snapshots the layer an erasing stroke affects.
   *
   * The snapshot is taken once, before the first subtraction, and every update
   * rebuilds the surface from it: `destination-out` applied repeatedly to the
   * same pixels would subtract more each time, so a stroke crossing itself would
   * erase a darker path than the same stroke drawn once - exactly the artifact
   * the full-coverage buffer avoids for painting.
   */
  private beginErase(layerId: LayerId): void {
    const surface = this.ensureRasterized(layerId);
    const base = this.eraseBase ?? document.createElement("canvas");
    resizeCanvas(base, surface.canvas.width, surface.canvas.height);
    const baseCtx = base.getContext("2d");
    if (!baseCtx) {
      this.dropEraseBase();
      return;
    }
    baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    baseCtx.globalAlpha = 1;
    baseCtx.globalCompositeOperation = "source-over";
    baseCtx.clearRect(0, 0, base.width, base.height);
    baseCtx.drawImage(surface.canvas, 0, 0);
    this.eraseBase = base;
    this.eraseLayerId = layerId;
  }

  /** Rebuilds the erasing stroke's layer as `snapshot minus the whole stroke`. */
  private applyErase(stroke: StrokeRecord): void {
    const base = this.eraseBase;
    const doc = this.doc;
    if (!base || !doc) {
      // No snapshot means the layer was dropped and rebuilt underneath the
      // stroke. Subtracting the buffer now would remove coverage from pixels the
      // stroke never saw, so leave the layer alone: `endStroke` marks it dirty
      // and the committed stroke is applied by the next re-rasterization.
      return;
    }
    const surface = this.restoreEraseBase();
    if (!surface) {
      return;
    }
    surface.ctx.globalCompositeOperation = "destination-out";
    surface.ctx.globalAlpha = strokeOpacity(stroke.brush, stroke.pressures);
    this.paintStrokeCoverage(surface.ctx, stroke);
    surface.ctx.globalAlpha = 1;
    surface.ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Puts the erasing layer back to its snapshot pixels and returns the surface.
   *
   * The surface is cleared rather than painted over: compositing the snapshot
   * with `source-over` onto partially erased pixels would not restore them, it
   * would only raise their alpha again (`a + d(1-a)`), leaving a halo exactly
   * where the erase had been.
   */
  private restoreEraseBase(): LayerSurface | null {
    const base = this.eraseBase;
    const layerId = this.eraseLayerId;
    const doc = this.doc;
    if (!base || !layerId || !doc) {
      return null;
    }
    const surface = this.ensureRasterized(layerId);
    this.surfaces.clear(surface);
    this.surfaces.prepare(surface);
    surface.ctx.drawImage(base, 0, 0, doc.width, doc.height);
    surface.dirty = false;
    return surface;
  }

  private dropEraseBase(): void {
    this.eraseBase = null;
    this.eraseLayerId = null;
  }

  /**
   * Forgets the in-flight stroke because the pixels it was drawn against are
   * gone (document resize or raster-scale change). The next sample redraws the
   * whole stroke and takes a fresh snapshot, so the live image keeps matching
   * the stroke list instead of subtracting from rebuilt pixels.
   */
  private abandonStroke(): void {
    this.activeStroke = null;
    this.dropEraseBase();
    this.dropStampCoverage();
    this.dropPreviewSurface();
    this.clearStrokeBuffer();
  }

  /**
   * Releases the grouped-preview scratch.
   *
   * The scratch is a full-resolution surface, so it is only alive while a
   * preview is being composited. Releasing it keeps the peak at the raster
   * budget in `core/document/document.ts`: the erase snapshot and the scratch
   * are alternatives, never neighbours.
   */
  private dropPreviewSurface(): void {
    this.previewSurface = null;
  }

  private prepareStrokeBuffer(): void {
    const { strokeCtx } = this;
    strokeCtx.setTransform(this.rasterScale, 0, 0, this.rasterScale, 0, 0);
    strokeCtx.globalAlpha = 1;
    strokeCtx.globalCompositeOperation = "source-over";
    strokeCtx.filter = "none";
  }

  private clearStrokeBuffer(): void {
    const { strokeCtx, strokeBuffer } = this;
    strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
    strokeCtx.globalAlpha = 1;
    strokeCtx.globalCompositeOperation = "source-over";
    strokeCtx.filter = "none";
    strokeCtx.clearRect(0, 0, strokeBuffer.width, strokeBuffer.height);
  }
}
