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
import { isFillPatch, isGradient, isShape } from "../document/types";
import { strokeFromShape } from "../document/shapeRecord";
import type { SelectionHandles } from "../document/selectionHandles";
import { referenceHandles } from "../reference/geometry";
import type { GridSettings } from "../document/grid";
import { DEFAULT_GRID_SETTINGS, gridLinesBetween } from "../document/grid";
import { overlaysForLayer, type OverlayPaintContext } from "../shell/overlayRegistry";
import { flattenLayers } from "../document/layerGroups";
import type { Bounds } from "../../types/geometry";
import type { BrushTipShape } from "../../types/brush";
import type { Viewport } from "../../types/viewport";
import { hexToRgb } from "../../utils/color";
import { FrameScheduler } from "./frameScheduler";
import { LayerSurfaceStore, type LayerSurface } from "./layerSurfaceStore";
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
import { normalizeBrushTip, type BrushTipFrame } from "./brushTip";
import type {
  DrawingRenderer,
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
 * The grid, deliberately fainter than the guides.
 *
 * A grid is a background reference: it has to be readable without competing
 * with the guides or the artwork, so it uses a low-alpha neutral rather than
 * the guides' accent hue.
 */
const GRID_COLOR = "rgba(70, 84, 104, 0.22)";
/**
 * The closest two grid lines may be on screen before the grid is hidden, in
 * device pixels.
 *
 * Below roughly this gap the lines merge into a wash and cost a stroke per
 * line for nothing. Hiding the grid at that density keeps a 2 px spacing usable
 * when zoomed in and quiet when zoomed out.
 */
const MIN_GRID_GAP_PX = 3;

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
 * A stroke's padded footprint in document coordinates.
 *
 * The padding is the brush radius, the blur spread of a soft edge and one
 * pixel of margin, so it is a superset of everything the rasterizer, the
 * feather pass and the dab engine can touch.
 */
interface StrokeBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
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
 * The frame a dab is masked with, or `null` for the plain round dab.
 *
 * The tip belongs to the stroke's own brush, so the mask is the same in live
 * drawing, in a layer rebuild, after undo/redo, in a reopened project and in
 * a PNG export: the tip is read from the stroke, never from editor state.
 * The round tip - and a brush written before tips existed - leave the dab
 * exactly as it was, byte for byte.
 */
function tipFrame(
  tip: BrushTipShape,
  angle: number,
  radius: number,
): BrushTipFrame | null {
  if (tip === "round") {
    return null;
  }
  return {
    shape: tip,
    directionX: Math.cos(angle),
    directionY: Math.sin(angle),
    radius,
  };
}

export class Canvas2DRenderer implements DrawingRenderer {
  readonly kind: RendererKind = "canvas2d";

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly strokeSource: StrokeSource;
  private readonly scheduler: FrameScheduler;
  private readonly surfaces: LayerSurfaceStore;
  private readonly strokeBuffer: HTMLCanvasElement;
  private readonly strokeCtx: CanvasRenderingContext2D;
  /**
   * The device-pixel rectangle of the stroke buffer that may hold ink.
   *
   * The buffer is a scratch the size of the document, so clearing all of it on
   * every press, every re-rasterization and every release is a full-document
   * memory pass - the dominant cost of a stroke on a large document. Only the
   * pixels a stroke has actually inked are tracked here, and only those are
   * cleared. Every write into the buffer goes through `markStrokeInk`, so this
   * rectangle is always a superset of the coverage, and `null` means the buffer
   * is empty. It is reset whenever the canvas is resized, because a resize
   * discards the pixels without going through a clear.
   */
  private strokeBufferInk: StrokeRegion | null = null;
  private readonly requestFrame: () => void;
  /** Grain tiles keyed by quantized strength; generated once and reused. */
  private readonly textureTiles = new Map<number, HTMLCanvasElement>();

  private doc: DrawingDocument | null = null;
  /**
   * The decoded picture of each reference, keyed by reference id.
   *
   * The document says which references exist and where they sit; this map
   * says which of them have pixels to draw. A reference without an entry (its
   * picture has not decoded yet) is simply not painted.
   */
  private referenceSources: ReadonlyMap<string, CanvasImageSource> = new Map();
  /** The reference the reference tool has framed, if any. */
  private selectedReferenceId: string | null = null;
  private viewport: Viewport = { zoom: 1, offsetX: 0, offsetY: 0 };
  private devicePixelRatio = 1;
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
   * Isolated scratch surfaces for groups with a non-default opacity or blend
   * mode, one per nesting depth.
   *
   * A normal, fully opaque group is flattened into its parent, which is byte-
   * identical and costs no canvas. Isolation is only needed when the group
   * itself has to be composited as one unit, and the scratch is reused across
   * frames. Default groups (the common case) never allocate one.
   */
  private readonly groupSurfaces: HTMLCanvasElement[] = [];
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
  private rasterScale: number;
  private destroyed = false;

  constructor(options: Canvas2DRendererOptions) {
    const ctx = options.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D rendering is not available in this environment.");
    }

    this.canvas = options.canvas;
    this.ctx = ctx;
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

    this.requestFrame = () => {
      this.scheduler.schedule(() => {
        this.render();
      });
    };
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
    // the first time they are composited. Child layers of a group are layers
    // too: the whole tree is retained, not just the root list.
    this.surfaces.retain(flattenLayers(doc.layers).map((layer) => layer.id));
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  setDisplaySize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    if (this.destroyed) {
      return;
    }
    this.devicePixelRatio = devicePixelRatio > 0 ? devicePixelRatio : 1;
    resizeCanvas(this.canvas, cssWidth * this.devicePixelRatio, cssHeight * this.devicePixelRatio);
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
    this.groupSurfaces.length = 0;
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
        this.markStrokeInk(this.strokeSampleBounds(stroke));
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
      this.markStrokeInk(this.strokeSampleBounds(stroke));
    } else {
      this.prepareStrokeBuffer();
      rasterizeStroke(this.strokeCtx, stroke, fromIndex);
      // A segment joins the new sample to the one before it, so the segment's
      // own footprint starts one sample back.
      this.markStrokeInk(this.strokeSampleBounds(stroke, fromIndex - 1));
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
      this.markStrokeInk(this.strokeSampleBounds(stroke));
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
      // The stroke is over: discarding the buffer's whole texture is cheaper
      // than preserving it with a partial clear, and the next stroke starts
      // from an empty canvas either way.
      this.resetStrokeBuffer();
      this.activeStroke = null;
      this.dropStampCoverage();
      this.dropPreviewSurface();
      this.requestFrame();
      return;
    }

    const surface = this.ensureRasterized(stroke.layerId);
    this.compositeStrokeBuffer(surface, stroke);
    this.resetStrokeBuffer();
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
    // A cancelled stroke leaves nothing to preserve, so the buffer's texture is
    // discarded rather than patched (see `endStroke`).
    this.resetStrokeBuffer();
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
   * Sets the decoded pictures of the document's references.
   *
   * Display only, like the guides: the pictures are drawn on the display
   * canvas, never into a layer surface, and `composeDocumentImage` never asks
   * for them. The map is replaced rather than mutated, so a stale entry cannot
   * outlive the reference it belonged to.
   */
  setReferenceSources(sources: ReadonlyMap<string, CanvasImageSource>): void {
    if (this.destroyed) {
      return;
    }
    this.referenceSources = sources;
    this.requestFrame();
  }

  /** Frames a reference on the canvas, or clears the frame with `null`. */
  setSelectedReference(referenceId: string | null): void {
    if (this.destroyed || referenceId === this.selectedReferenceId) {
      return;
    }
    this.selectedReferenceId = referenceId;
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

  render(): void {
    if (this.destroyed) {
      return;
    }

    const ctx = this.ctx;
    const pixelWidth = this.canvas.width;
    const pixelHeight = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);

    const doc = this.doc;
    if (!doc || pixelWidth === 0 || pixelHeight === 0) {
      return;
    }

    const { viewport, devicePixelRatio } = this;
    const scale = devicePixelRatio * viewport.zoom;
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      viewport.offsetX * devicePixelRatio,
      viewport.offsetY * devicePixelRatio,
    );

    this.paintOverlays(ctx, "under", scale);

    this.paintDocument(
      ctx,
      this.activeStroke?.erase === true ? null : this.activeStroke,
      true,
    );

    this.paintGrid(ctx, scale);

    this.paintGuides(ctx, scale);

    this.paintSelection(ctx, scale);

    this.paintReferenceSelection(ctx, scale);

    // Hairline document boundary: exactly one device pixel at any zoom.
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = DOCUMENT_BORDER_COLOR;
    ctx.strokeRect(0, 0, doc.width, doc.height);

    this.paintOverlays(ctx, "over", scale);
  }

  /**
   * Paints the registered overlays for one layer.
   *
   * The registry is the list of chrome that is not the document: a module
   * registers an overlay and the renderer paints it here, so a new overlay
   * needs no new line in this paint sequence. The overlays are display only by
   * construction - they are handed the display context and nothing else, so
   * they cannot reach a layer surface or `composeDocumentImage`, and an export
   * is identical whether they are on or off.
   */
  private paintOverlays(
    ctx: CanvasRenderingContext2D,
    layer: "under" | "over",
    scale: number,
  ): void {
    const doc = this.doc;
    if (!doc) {
      return;
    }
    const overlays = overlaysForLayer(layer);
    if (overlays.length === 0) {
      return;
    }
    const context: OverlayPaintContext = {
      ctx,
      viewport: this.viewport,
      documentWidth: doc.width,
      documentHeight: doc.height,
      scale,
      selectionBounds: this.selection?.bounds ?? null,
      devicePixelRatio: this.devicePixelRatio,
    };
    for (const overlay of overlays) {
      overlay.paint?.(context);
    }
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
  private paintGrid(ctx: CanvasRenderingContext2D, scale: number): void {
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

    const { zoom, offsetX, offsetY } = this.viewport;
    const viewWidth = this.canvas.width / this.devicePixelRatio;
    const viewHeight = this.canvas.height / this.devicePixelRatio;
    const left = 0 - offsetX / zoom;
    const top = 0 - offsetY / zoom;
    const right = left + viewWidth / zoom;
    const bottom = top + viewHeight / zoom;

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
  private paintGuides(ctx: CanvasRenderingContext2D, scale: number): void {
    const doc = this.doc;
    if (!doc || doc.guides.length === 0) {
      return;
    }

    const { zoom, offsetX, offsetY } = this.viewport;
    const viewWidth = this.canvas.width / this.devicePixelRatio;
    const viewHeight = this.canvas.height / this.devicePixelRatio;
    // The viewport in document space: what the user can see right now. The
    // subtraction is written as `0 - x` so an edge at the origin is `+0`
    // rather than the `-0` a plain negation would produce.
    const left = 0 - offsetX / zoom;
    const top = 0 - offsetY / zoom;
    const right = left + viewWidth / zoom;
    const bottom = top + viewHeight / zoom;

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

    const path = selection.path;
    if (path && path.length >= 2) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([SELECTION_MARQUEE_DASH[0] / scale, SELECTION_MARQUEE_DASH[1] / scale]);
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let index = 1; index < path.length; index += 1) {
        ctx.lineTo(path[index].x, path[index].y);
      }
      // The lasso closes implicitly: the region it selects is the closed path.
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const frame = selection.frame;
    if (frame && frame.length >= 2) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([SELECTION_MARQUEE_DASH[0] / scale, SELECTION_MARQUEE_DASH[1] / scale]);
      ctx.beginPath();
      ctx.moveTo(frame[0].x, frame[0].y);
      for (let index = 1; index < frame.length; index += 1) {
        ctx.lineTo(frame[index].x, frame[index].y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const outline = selection.outline;
    if (outline && outline.length >= 2) {
      ctx.globalAlpha = SELECTION_TRACE_ALPHA;
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = SELECTION_TRACE_WIDTH / scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(outline[0].x, outline[0].y);
      for (let index = 1; index < outline.length; index += 1) {
        ctx.lineTo(outline[index].x, outline[index].y);
      }
      ctx.stroke();
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
   * Composites the document - paper plus every visible layer - into a fresh
   * canvas at document pixel size.
   *
   * This is the export path, so it deliberately differs from `render()`: no
   * viewport transform, no border, no in-progress stroke, and a resolution that
   * is exactly the document size regardless of `rasterScale`. The display
   * canvas and the document itself are untouched, which is what lets a PNG be
   * exported mid-session without altering what is being edited.
   */
  composeDocumentImage(): HTMLCanvasElement {
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
    this.paintDocument(ctx);

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

    this.paintLayerNodes(ctx, doc.layers, {
      preview: null,
      depth: 0,
      probeOffset: {
        x: -Math.floor(docX * this.rasterScale),
        y: -Math.floor(docY * this.rasterScale),
      },
    });

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    return { r: pixel[0], g: pixel[1], b: pixel[2] };
  }

  requestRender(): void {
    this.requestFrame();
  }

  /** Reads the whole composite at document resolution for the bucket fill. */
  readCompositeImage(): ImageData | null {
    const doc = this.doc;
    if (this.destroyed || !doc) {
      return null;
    }
    const canvas = this.composeDocumentImage();
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
    this.activeStroke = null;
    this.dropEraseBase();
    this.dropStampCoverage();
    this.probeCanvas = null;
    this.featherBuffer = null;
    this.previewSurface = null;
    this.groupSurfaces.length = 0;
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
   */
  private paintDocument(
    ctx: CanvasRenderingContext2D,
    preview: StrokeRecord | null = null,
    /**
     * Whether the reference images are painted around the layers.
     *
     * Only `render()` passes `true`. The export path (`composeDocumentImage`)
     * leaves it off, so a reference is excluded from a PNG **by construction**
     * rather than by a flag someone has to remember to clear.
     */
    includeReferences = false,
  ): void {
    const doc = this.doc;
    if (!doc) {
      return;
    }

    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);

    if (includeReferences) {
      this.paintReferences(ctx, doc, true);
    }

    this.paintLayerNodes(ctx, doc.layers, {
      preview,
      depth: 0,
      probeOffset: null,
    });

    if (includeReferences) {
      this.paintReferences(ctx, doc, false);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Paints the references on one side of the artwork.
   *
   * The paper clip is applied once for the whole pass: a reference may hang
   * over the edge, but only the part on the paper is drawn. The placement is
   * the model's rectangle, turned about its centre; the decoded picture is
   * stretched into that rectangle exactly as it is on screen, so the reference
   * sits over the same artwork at every zoom.
   *
   * This method is only reachable from `render()` (through the
   * `includeReferences` flag), so it can never write into a layer surface or
   * into the export composite.
   */
  private paintReferences(
    ctx: CanvasRenderingContext2D,
    doc: DrawingDocument,
    behind: boolean,
  ): void {
    const items = doc.references.filter(
      (reference) => reference.behind === behind && reference.visible,
    );
    if (items.length === 0) {
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, doc.width, doc.height);
    ctx.clip();
    for (const reference of items) {
      const source = this.referenceSources.get(reference.id);
      if (!source) {
        continue;
      }
      ctx.save();
      ctx.globalAlpha = reference.opacity;
      ctx.globalCompositeOperation = compositeOperationFor(reference.blendMode);
      ctx.translate(reference.x + reference.width / 2, reference.y + reference.height / 2);
      if (reference.rotation !== 0) {
        ctx.rotate((reference.rotation * Math.PI) / 180);
      }
      ctx.drawImage(
        source,
        -reference.width / 2,
        -reference.height / 2,
        reference.width,
        reference.height,
      );
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Frames the selected reference: its rotated outline, a square on each
   * corner and the rotation handle beyond the top edge.
   *
   * Overlay only, like the stroke selection: it is painted on the display
   * canvas and never reaches a layer surface or an export.
   */
  private paintReferenceSelection(ctx: CanvasRenderingContext2D, scale: number): void {
    const doc = this.doc;
    const id = this.selectedReferenceId;
    if (!doc || id === null) {
      return;
    }
    const reference = doc.references.find((item) => item.id === id);
    if (!reference) {
      return;
    }
    // A hidden reference is not on the canvas, so it must not leave a frame
    // and handles floating over the artwork either: the chrome follows the
    // picture it belongs to.
    if (!reference.visible) {
      return;
    }
    const handles = referenceHandles(reference, this.viewport);
    const size = HANDLE_SIZE_PX / scale;
    const radius = ROTATION_HANDLE_RADIUS_PX / scale;
    const corners = handles.corners;

    ctx.save();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.fillStyle = HANDLE_FILL_COLOR;
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let index = 1; index < corners.length; index += 1) {
      ctx.lineTo(corners[index].x, corners[index].y);
    }
    ctx.closePath();
    ctx.stroke();

    const topMid = {
      x: (corners[0].x + corners[1].x) / 2,
      y: (corners[0].y + corners[1].y) / 2,
    };
    ctx.beginPath();
    ctx.moveTo(topMid.x, topMid.y);
    ctx.lineTo(handles.rotation.x, handles.rotation.y);
    ctx.stroke();

    for (const corner of corners) {
      ctx.beginPath();
      ctx.rect(corner.x - size / 2, corner.y - size / 2, size, size);
      ctx.fill();
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(handles.rotation.x, handles.rotation.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Paints a list of layer-tree nodes, depth-first and bottom-first.
   *
   * This is the one painter the display, the export, the colour probe and the
   * bucket-fill composite read all use, so they cannot disagree about what a
   * group means:
   *
   *  - a hidden node takes its whole subtree with it;
   *  - a normal, fully opaque group is flattened into its parent (the common
   *    case, and byte-identical to painting its children directly);
   *  - a group with opacity < 1 or a non-normal blend is composited through
   *    an isolated scratch surface, so its children blend with each other
   *    before the group blends with the backdrop;
   *  - a paintable layer draws its surface, and the in-flight preview in its
   *    own slot when `preview` names it.
   *
   * `probeOffset` switches to the 1x1 colour-probe space: layer surfaces are
   * drawn at that pixel offset and group scratches are 1x1 as well, so a
   * sample reads exactly the pixel the composite would show.
   */
  private paintLayerNodes(
    ctx: CanvasRenderingContext2D,
    nodes: readonly Layer[],
    options: {
      readonly preview: StrokeRecord | null;
      readonly depth: number;
      readonly probeOffset: { readonly x: number; readonly y: number } | null;
    },
  ): void {
    const doc = this.doc;
    if (!doc) {
      return;
    }

    for (const node of nodes) {
      if (!isComposited(node)) {
        continue;
      }

      if (node.kind === "group") {
        const isolated = node.opacity < 1 || node.blendMode !== "normal";
        if (!isolated) {
          this.paintLayerNodes(ctx, node.children, options);
          continue;
        }
        const scratch = this.beginGroupSurface(options.depth, options.probeOffset !== null);
        if (!scratch) {
          continue;
        }
        this.paintLayerNodes(scratch.ctx, node.children, {
          ...options,
          depth: options.depth + 1,
        });
        ctx.save();
        ctx.globalAlpha = node.opacity;
        ctx.globalCompositeOperation = compositeOperationFor(node.blendMode);
        if (options.probeOffset) {
          ctx.drawImage(scratch.canvas, 0, 0);
        } else {
          ctx.drawImage(scratch.canvas, 0, 0, doc.width, doc.height);
        }
        ctx.restore();
        continue;
      }

      const surface = this.ensureRasterized(node.id);

      if (options.probeOffset) {
        ctx.globalAlpha = node.opacity;
        ctx.globalCompositeOperation = compositeOperationFor(node.blendMode);
        ctx.drawImage(surface.canvas, options.probeOffset.x, options.probeOffset.y);
        continue;
      }

      const previewHere = options.preview !== null && options.preview.layerId === node.id;
      if (previewHere && (node.opacity < 1 || node.blendMode !== "normal")) {
        // Group first, then apply the layer's opacity and blend once: the same
        // order a commit takes. A hidden or zero-opacity layer was skipped
        // above, so its preview is hidden with it.
        const group = this.buildPreviewGroup(surface, options.preview as StrokeRecord);
        if (group) {
          ctx.globalAlpha = node.opacity;
          ctx.globalCompositeOperation = compositeOperationFor(node.blendMode);
          ctx.drawImage(group, 0, 0, doc.width, doc.height);
          continue;
        }
      }

      ctx.globalAlpha = node.opacity;
      ctx.globalCompositeOperation = compositeOperationFor(node.blendMode);
      ctx.drawImage(surface.canvas, 0, 0, doc.width, doc.height);

      if (previewHere) {
        // An opaque `normal` layer needs no scratch: source-over is associative,
        // so painting the preview straight after its layer is identical to
        // grouping the two first. This is the common case and costs no canvas.
        // The buffer holds full coverage; the stroke's alpha is applied here,
        // once (and, for a soft brush, its edge is feathered once - never per
        // segment).
        const preview = options.preview as StrokeRecord;
        ctx.globalAlpha = strokeOpacity(preview.brush, preview.pressures);
        ctx.globalCompositeOperation = "source-over";
        this.paintStrokeCoverage(ctx, preview);
      }
    }
  }

  /**
   * Clears and prepares the isolated scratch for a group at `depth`.
   *
   * One surface per nesting depth is enough: a group's children are painted
   * before its surface is composited into the parent, so siblings reuse it.
   * The probe uses a 1x1 surface and no transform; display and export use the
   * same raster resolution as a layer surface.
   */
  private beginGroupSurface(
    depth: number,
    probe: boolean,
  ): { readonly canvas: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D } | null {
    const doc = this.doc;
    if (!doc) {
      return null;
    }
    let canvas = this.groupSurfaces[depth];
    if (!canvas) {
      canvas = document.createElement("canvas");
      this.groupSurfaces[depth] = canvas;
    }
    resizeCanvas(
      canvas,
      probe ? 1 : doc.width * this.rasterScale,
      probe ? 1 : doc.height * this.rasterScale,
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!probe) {
      ctx.setTransform(this.rasterScale, 0, 0, this.rasterScale, 0, 0);
    }
    return { canvas, ctx };
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
    this.paintStrokeCoverage(ctx, stroke);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    return canvas;
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
      // A native shape is drawn by expanding it to the very outline the shape
      // tool previewed and feeding that through the stroke rasterizer. There is
      // one rasterizer, so a shape and a legacy baked shape cannot diverge.
      const stroke = isShape(element) ? strokeFromShape(element) : element;
      this.rasterizeStrokeToBuffer(stroke);
      this.compositeStrokeBuffer(
        surface,
        stroke,
        stroke.erase === true ? "destination-out" : "source-over",
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
      this.markStrokeInk(this.strokeSampleBounds(stroke));
      return;
    }
    rasterizeStroke(this.strokeCtx, stroke, 0);
    this.markStrokeInk(this.strokeSampleBounds(stroke));
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
    const tip = normalizeBrushTip(stroke.brush.tip);
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
        // The tip rides on the same frame, for the same reason.
        tipFrame(tip, dab.angle, dab.radius * scale),
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
    const tip = normalizeBrushTip(stroke.brush.tip);
    let dirty: StampRect | null = null;
    for (const dab of dabs) {
      const rect = coverage.paintDab(
        dab.x * scale,
        dab.y * scale,
        dab.radius * scale,
        stroke.brush.stampHardness,
        strength > 0 ? { angle: dab.angle, laneWidth, strength } : null,
        tipFrame(tip, dab.angle, dab.radius * scale),
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
    // The upload is device-pixel work, so the ink rectangle is grown from the
    // same rectangle the tiles were written over.
    this.markStrokeInkRect(rect.left, rect.top, rect.left + rect.width, rect.top + rect.height);
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
   * Records a document-space rectangle as written to the stroke buffer.
   *
   * Every write into the buffer goes through this or `markStrokeInkRect`, which
   * is what makes the tracked rectangle a superset of the coverage and lets a
   * clear be bounded by the stroke instead of the document.
   */
  private markStrokeInk(bounds: StrokeBounds | null): void {
    if (!bounds) {
      return;
    }
    const scale = this.rasterScale;
    this.markStrokeInkRect(
      Math.floor(bounds.minX * scale),
      Math.floor(bounds.minY * scale),
      Math.ceil(bounds.maxX * scale),
      Math.ceil(bounds.maxY * scale),
    );
  }

  /** Records a device-pixel rectangle as written to the stroke buffer. */
  private markStrokeInkRect(left: number, top: number, right: number, bottom: number): void {
    const clampedLeft = Math.max(0, left);
    const clampedTop = Math.max(0, top);
    const clampedRight = Math.min(this.strokeBuffer.width, right);
    const clampedBottom = Math.min(this.strokeBuffer.height, bottom);
    if (clampedRight <= clampedLeft || clampedBottom <= clampedTop) {
      return;
    }
    const current = this.strokeBufferInk;
    if (!current) {
      this.strokeBufferInk = {
        left: clampedLeft,
        top: clampedTop,
        width: clampedRight - clampedLeft,
        height: clampedBottom - clampedTop,
      };
      return;
    }
    const minLeft = Math.min(current.left, clampedLeft);
    const minTop = Math.min(current.top, clampedTop);
    const maxRight = Math.max(current.left + current.width, clampedRight);
    const maxBottom = Math.max(current.top + current.height, clampedBottom);
    this.strokeBufferInk = {
      left: minLeft,
      top: minTop,
      width: maxRight - minLeft,
      height: maxBottom - minTop,
    };
  }

  /**
   * The padded sample bounds of a stroke, in document coordinates.
   *
   * The padding is the brush radius, the blur spread of a soft edge and one
   * pixel of margin. It is a superset of the rasterized coverage - round caps
   * and joins never reach past the brush radius - and of the region the
   * feather pass reads, so one rectangle serves for all three.
   *
   * `from` and `to` narrow it to a range of samples. The live path uses that to
   * grow the buffer's ink rectangle by the samples it just appended, instead of
   * rescanning the whole stroke on every pointer event.
   */
  private strokeSampleBounds(
    stroke: StrokeRecord,
    from = 0,
    to = stroke.xs.length,
  ): StrokeBounds | null {
    const radius = strokeFeatherRadius(stroke.brush);
    const spread = strokeDiameter(stroke.brush, 1) / 2 + radius * 3 + 1;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = Math.max(0, from); index < to; index += 1) {
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
        //
        // The source rectangle is given explicitly rather than expressed as a
        // clip: clipping is marginally cheaper in Chromium (0.63 ms against
        // 1.04 ms), but the repository's pixel harness implements `drawImage`
        // and not `clip`, so a clipped blit could not be verified against real
        // pixels. A measurable gain is not worth an unverifiable path.
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
    // The stroke's own footprint is the only part of the layer an eraser can
    // have touched: samples are append-only, so every pixel subtracted so far
    // is inside the current bounds. Bounding the subtraction by that rectangle
    // keeps an eraser's per-sample cost proportional to the stroke rather than
    // to the document.
    const region = this.strokeRegion(stroke);
    if (!region) {
      return;
    }
    const surface = this.restoreEraseBase();
    if (!surface) {
      return;
    }
    surface.ctx.globalCompositeOperation = "destination-out";
    surface.ctx.globalAlpha = strokeOpacity(stroke.brush, stroke.pressures);
    this.paintStrokeCoverage(surface.ctx, stroke, region);
    surface.ctx.globalAlpha = 1;
    surface.ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Puts the erasing layer back to its snapshot pixels and returns the surface.
   *
   * The whole layer is restored, not just the stroke's rectangle. A partial
   * restore is *slower* on the browsers this ships on, not faster: clearing a
   * sub-rectangle preserves the canvas texture with a copy-on-write, while a
   * full `clearRect` simply discards it (measured 0.14 ms against 1.27 ms for
   * the same layer on Chromium 156). The subtraction that follows is bounded by
   * the stroke, which is where the cost actually scales.
   *
   * The surface is cleared rather than painted over: compositing the snapshot
   * with `source-over` onto partially erased pixels would not restore them, it
   * would only raise their alpha again (`a + d(1-a)`), leaving a halo exactly
   * where the erase had been.
   *
   * `prepare` runs between the clear and the blit because it is what installs
   * the raster-scale transform: the snapshot is drawn in document coordinates,
   * so without it a HiDPI surface would only be restored in its top-left
   * quarter.
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
    // The buffer's pixels were discarded by the resize that brought us here, so
    // the tracked rectangle is stale: reset both together rather than clearing
    // a rectangle that may describe the old raster scale.
    this.resetStrokeBuffer();
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

  /**
   * Empties the stroke buffer.
   *
   * Only the pixels a stroke inked are cleared: the buffer is a scratch that is
   * empty between strokes, so a document-sized `clearRect` would be a
   * full-document memory pass for nothing. `strokeBufferInk` is the authority
   * on what is dirty; when it is `null` there is nothing to clear.
   */
  private clearStrokeBuffer(): void {
    const ink = this.strokeBufferInk;
    if (!ink) {
      return;
    }
    this.clearStrokeBufferRegion(ink);
    this.strokeBufferInk = null;
  }

  /**
   * Empties the whole stroke buffer and forgets what was inked.
   *
   * Used where the pixels are discarded wholesale - a new document, a different
   * raster scale - so the tracked rectangle can never disagree with the canvas
   * after a resize that did not change the dimensions.
   */
  private resetStrokeBuffer(): void {
    const { strokeCtx, strokeBuffer } = this;
    strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
    strokeCtx.globalAlpha = 1;
    strokeCtx.globalCompositeOperation = "source-over";
    strokeCtx.filter = "none";
    strokeCtx.clearRect(0, 0, strokeBuffer.width, strokeBuffer.height);
    this.strokeBufferInk = null;
  }
}
