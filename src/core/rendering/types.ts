/**
 * Renderer abstraction.
 *
 * The rest of the application talks to `DrawingRenderer` only, which is what
 * keeps Canvas 2D replaceable by a WebGL/WebGPU backend later. The renderer
 * owns *pixels*: layer surfaces, the in-progress stroke buffer and the display
 * canvas. It never owns tool state, history or React state.
 */

import type { DrawingDocument, LayerId, StrokeRecord, StrokeSource } from "../document/types";
import type { Viewport } from "../../types/viewport";
import type { Rgb } from "../../utils/color";

export type RendererKind = "canvas2d" | "webgl" | "webgpu";

/**
 * The 8-bit sRGB colour a composite read returns. Re-exported here because it
 * is part of the renderer contract; the canonical definition lives in
 * `utils/color` with the conversions.
 */
export type { Rgb };

/**
 * Read-only access to the stroke data a renderer needs to re-rasterize.
 * Re-exported from the document model, which owns the stroke list.
 */
export type { StrokeSource };

export interface DrawingRenderer {
  readonly kind: RendererKind;
  /** Updates document metadata and resizes surfaces when dimensions change. */
  setDocument(document: DrawingDocument): void;
  setViewport(viewport: Viewport): void;
  /** Sets the CSS size of the drawing surface plus its device pixel ratio. */
  setDisplaySize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /** Surface resolution multiplier (HiDPI supersampling); never changes document size. */
  setRasterScale(scale: number): void;
  /** Marks a layer for re-rasterization from its stroke list. */
  invalidateLayer(layerId: LayerId): void;
  beginStroke(stroke: StrokeRecord): void;
  /** Rasterizes new samples appended since `fromIndex` into the stroke buffer. */
  extendStroke(stroke: StrokeRecord, fromIndex: number): void;
  /**
   * Redraws the whole stroke buffer from the stroke's current samples.
   *
   * Shape tools replace their geometry on every move instead of appending, so
   * the buffer must be rebuilt rather than extended. Coverage is full, like
   * every other rasterization; the stroke's opacity is applied when the buffer
   * composites (`render`/`endStroke`).
   */
  replaceStroke(stroke: StrokeRecord): void;
  /** Composites the finished stroke buffer onto its layer surface. */
  endStroke(stroke: StrokeRecord): void;
  cancelStroke(): void;
  /**
   * Composites paper and visible layers into a **new** canvas at document pixel
   * size (no viewport, no border, no in-progress stroke). Used by PNG export, so
   * it must not disturb the display, the document or the layer surfaces.
   */
  composeDocumentImage(): HTMLCanvasElement;
  /**
   * Samples the composite the user sees - paper plus visible layers at their
   * opacity, bottom-first - at a document point, returning its 8-bit sRGB
   * colour or `null` when there is no document.
   *
   * This is a read, not an edit: no pixel changes and nothing enters history.
   * The precision is the surfaces' - 8 bits per channel - so the colour is the
   * one on screen, not a value that was mathematically authored.
   */
  readCompositePixel(docX: number, docY: number): Rgb | null;
  render(): void;
  requestRender(): void;
  destroy(): void;
}
