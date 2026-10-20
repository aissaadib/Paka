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
import type { Viewport } from "../../types/viewport";
import { hexToRgb } from "../../utils/color";
import { FrameScheduler } from "./frameScheduler";
import { LayerSurfaceStore, type LayerSurface } from "./layerSurfaceStore";
import { rasterizeStroke, strokeDiameter, strokeFeatherRadius, strokeOpacity } from "./canvas2dStroke";
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

/** Maps a layer blend mode to a Canvas 2D composite operation. */
function compositeOperationFor(mode: LayerBlendMode): GlobalCompositeOperation {
  switch (mode) {
    case "normal":
      return "source-over";
  }
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

export class Canvas2DRenderer implements DrawingRenderer {
  readonly kind: RendererKind = "canvas2d";

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly strokeSource: StrokeSource;
  private readonly scheduler: FrameScheduler;
  private readonly surfaces: LayerSurfaceStore;
  private readonly strokeBuffer: HTMLCanvasElement;
  private readonly strokeCtx: CanvasRenderingContext2D;
  private readonly requestFrame: () => void;

  private doc: DrawingDocument | null = null;
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
  /** Selection overlay: UI chrome, never composited into a surface or an export. */
  private selection: RendererSelection | null = null;
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

  setDocument(doc: DrawingDocument): void {
    if (this.destroyed) {
      return;
    }

    const sizeChanged =
      this.doc === null || this.doc.width !== doc.width || this.doc.height !== doc.height;
    this.doc = doc;

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
    this.requestFrame();
  }

  invalidateLayer(layerId: LayerId): void {
    this.surfaces.markDirty(layerId);
    this.requestFrame();
  }

  beginStroke(stroke: StrokeRecord): void {
    this.activeStroke = stroke;
    this.clearStrokeBuffer();
    if (stroke.erase === true) {
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
      if (stroke.erase === true) {
        this.beginErase(stroke.layerId);
      }
      this.clearStrokeBuffer();
      this.prepareStrokeBuffer();
      rasterizeStroke(this.strokeCtx, stroke, 0);
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
    this.clearStrokeBuffer();
    this.prepareStrokeBuffer();
    rasterizeStroke(this.strokeCtx, stroke, 0);
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
      this.requestFrame();
      return;
    }

    const surface = this.ensureRasterized(stroke.layerId);
    this.compositeStrokeBuffer(surface, stroke);
    this.clearStrokeBuffer();
    this.activeStroke = null;
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
    this.requestFrame();
  }

  setSelection(selection: RendererSelection | null): void {
    if (this.destroyed) {
      return;
    }
    this.selection = selection;
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

    this.paintDocument(ctx);

    if (this.activeStroke && this.activeStroke.erase !== true) {
      // The buffer holds full coverage; the stroke's alpha is applied here, once
      // (and, for a soft brush, its edge is feathered once - never per segment).
      // An erasing stroke is not drawn at all: it was already subtracted from the
      // layer surface, which `paintDocument` just composited.
      ctx.globalAlpha = strokeOpacity(this.activeStroke.brush, this.activeStroke.pressures);
      this.paintStrokeCoverage(ctx, this.activeStroke);
      ctx.globalAlpha = 1;
    }

    this.paintSelection(ctx, scale);

    // Hairline document boundary: exactly one device pixel at any zoom.
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = DOCUMENT_BORDER_COLOR;
    ctx.strokeRect(0, 0, doc.width, doc.height);
  }

  /**
   * Draws the selection overlay: the selected strokes traced in the accent
   * colour, then the rubber-band rectangle.
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
    this.probeCanvas = null;
    this.featherBuffer = null;
  }

  /**
   * Paper plus every visible layer with `opacity > 0`, bottom-first. The caller
   * owns the transform, so display rendering and export share this exactly.
   */
  private paintDocument(ctx: CanvasRenderingContext2D): void {
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
      const surface = this.ensureRasterized(layer.id);
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = compositeOperationFor(layer.blendMode);
      ctx.drawImage(surface.canvas, 0, 0, doc.width, doc.height);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
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

  private rasterizeStrokeToBuffer(stroke: StrokeRecord): void {
    this.clearStrokeBuffer();
    this.prepareStrokeBuffer();
    rasterizeStroke(this.strokeCtx, stroke, 0);
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
    this.surfaces.prepare(surface);
    surface.ctx.globalAlpha = strokeOpacity(stroke.brush, stroke.pressures);
    surface.ctx.globalCompositeOperation = operation;
    this.paintStrokeCoverage(surface.ctx, stroke);
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
   */
  private paintStrokeCoverage(ctx: CanvasRenderingContext2D, stroke: StrokeRecord): void {
    const doc = this.doc;
    if (!doc) {
      return;
    }
    const radius = strokeFeatherRadius(stroke.brush);
    if (radius <= 0) {
      ctx.drawImage(this.strokeBuffer, 0, 0, doc.width, doc.height);
      return;
    }
    const feathered = this.featherStroke(stroke, radius);
    if (feathered) {
      ctx.drawImage(
        feathered.canvas,
        feathered.x,
        feathered.y,
        feathered.width,
        feathered.height,
      );
    }
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
    ctx.filter = `blur(${radius * scale}px)`;
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
    this.clearStrokeBuffer();
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
