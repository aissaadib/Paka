/**
 * Renderer abstraction.
 *
 * The rest of the application talks to `DrawingRenderer` only, which is what
 * keeps Canvas 2D replaceable by a WebGL/WebGPU backend later. The renderer
 * owns *pixels*: layer surfaces, the in-progress stroke buffer and the display
 * canvas. It never owns tool state, history or React state.
 */

import type { DrawingDocument, LayerId, StrokeRecord, StrokeSource } from "../document/types";
import type { GridSettings } from "../document/grid";
import type { SymmetrySettings } from "../document/symmetry";
import type { RulerSettings } from "./rulers";
import type { SelectionHandles } from "../document/selectionHandles";
import type { GradientHandleId } from "../gradient/gradientHandles";
import type { ReferenceOverlay } from "../reference/types";
import type { Viewport } from "../../types/viewport";
import type { Bounds, Point } from "../../types/geometry";
import type { Rgb } from "../../utils/color";

export type RendererKind = "canvas2d" | "webgl" | "webgpu";

/**
 * What the renderer draws *on top of* the document to show a selection: the
 * marquee rectangle, the strokes it currently holds and the transform handles
 * they offer.
 *
 * This is UI overlay, not document content - it never appears in an export, and
 * the renderer owns no selection state of its own: the engine decides what is
 * selected and hands it over. Strokes are passed as data (not ids) so the
 * renderer can trace them without indexing the stroke store per frame.
 */
export interface RendererSelection {
  /** Rubber-band rectangle in document space, or `null` when none is dragged. */
  readonly bounds: Bounds | null;
  /** Strokes to trace as an accent overlay. */
  readonly strokes: readonly StrokeRecord[];
  /**
   * The transform handles, in document space, or `null` when the selection
   * offers none.
   *
   * Overlay only, like the frame and the trace: they are painted on the
   * display canvas and never reach a layer surface, the document or
   * `composeDocumentImage`.
   */
  readonly handles?: SelectionHandles | null;
}

/**
 * What the renderer draws *on top of* the document to show the gradient the
 * gradient tool has selected: the two handles and the line between them.
 *
 * The positions are in document space, so the handles sit on the gradient's own
 * points at any zoom; the sizes are in screen pixels, so they stay the same
 * size on screen. A linear gradient draws its axis; a radial one draws the
 * circle its radius makes, plus the radius line.
 *
 * Overlay only, like the selection: the handles never reach a layer surface,
 * the document or `composeDocumentImage`, so an export of a document with a
 * gradient selected is byte-identical to one without.
 */
export interface RendererGradientOverlay {
  /** Which geometry the overlay draws: an axis or a circle. */
  readonly type: "linear" | "radial";
  /** The axis start (linear) or the centre (radial), in document space. */
  readonly start: Point;
  /** The axis end (linear) or the radius handle (radial), in document space. */
  readonly end: Point;
  /** The handle the pointer is dragging, or `null` when none is. */
  readonly activeHandle: GradientHandleId | null;
}

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

/**
 * A display target: one canvas the document is painted into.
 *
 * A target is a **window on the document**, not a copy of it. Several targets
 * can be attached to the same renderer at once, and they all read the same
 * layer surfaces, the same stroke buffer and the same document: what differs
 * is only the view transform each one applies. That is what makes a second
 * view of the same canvas cheap - there is one set of rasterized pixels and
 * one history, and every target is another projection of them.
 */
export interface DisplayTargetOptions {
  /** Identifies the target; the engine uses it to address the target later. */
  readonly id: string;
  /** The canvas the target paints into. */
  readonly canvas: HTMLCanvasElement;
  /** The transform from document space to this target's screen space. */
  readonly viewport: Viewport;
}

/**
 * Which layers a composite read may see.
 *
 * `null` - the default - reads **every visible layer**, which is the merged
 * composite the user sees. A list reads only those layers, so the bucket can
 * measure its region against one layer instead of the whole picture. A hidden
 * layer never contributes, whatever the list says: the user cannot see it, so
 * it cannot bound a region either.
 */
export interface CompositeReadOptions {
  readonly layerIds?: readonly LayerId[] | null;
}

export interface DrawingRenderer {
  readonly kind: RendererKind;
  /** Updates document metadata and resizes surfaces when dimensions change. */
  setDocument(document: DrawingDocument): void;
  setViewport(viewport: Viewport): void;
  /** Sets the CSS size of the drawing surface plus its device pixel ratio. */
  setDisplaySize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  /**
   * Adds a display target: a second canvas showing the same document.
   *
   * The target shares the renderer's document, layer surfaces and stroke
   * buffer, so it costs a projection rather than a second rasterization of the
   * artwork. A target that already exists under the same id is replaced.
   *
   * Optional: a renderer that paints into a single canvas simply has one
   * view, and the engine leaves it alone.
   */
  addDisplayTarget?(target: DisplayTargetOptions): void;
  /**
   * Removes a display target and forgets its canvas.
   *
   * The document, the surfaces and the history are untouched: a closed view
   * takes nothing away from the document it was showing.
   */
  removeDisplayTarget?(id: string): void;
  /** Sets the view transform of one display target. */
  setDisplayTargetViewport?(id: string, viewport: Viewport): void;
  /** Sets the CSS size and device pixel ratio of one display target. */
  setDisplayTargetSize?(
    id: string,
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio: number,
  ): void;
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
   * Sets the selection overlay - the marquee rectangle and the traced strokes -
   * or clears it with `null`.
   *
   * Overlay only: it is drawn above the layers on the display canvas and never
   * reaches a layer surface, the document or `composeDocumentImage`.
   */
  setSelection(selection: RendererSelection | null): void;
  /**
   * Sets the gradient overlay - the handles and the line of the gradient the
   * gradient tool has selected - or clears it with `null`.
   *
   * Overlay only: it is drawn above the layers on the display canvas and never
   * reaches a layer surface, the document or `composeDocumentImage`, so an
   * export is identical whether a gradient is selected or not.
   */
  setGradientOverlay(overlay: RendererGradientOverlay | null): void;
  /**
   * Marks a composition guide as the selected one, or clears the selection.
   *
   * Overlay only, like the selection: the guide is drawn in the selection
   * accent on the display canvas and never reaches a layer surface, the
   * document or `composeDocumentImage`. The guides themselves are document
   * state and arrive with `setDocument`; only the selection is an overlay
   * concern.
   */
  setSelectedGuide(guideId: string | null): void;
  /**
   * Sets the grid display settings.
   *
   * Display only, like the guides: the grid is painted on the display canvas
   * and never reaches a layer surface or `composeDocumentImage`, so an export
   * is identical whether the grid is on or off. The settings are editor state
   * and do not travel with the document.
   */
  setGrid(grid: GridSettings): void;
  /**
   * Sets the ruler display settings.
   *
   * Display only, like the grid: the ruler strips are painted on the display
   * canvas and never reach a layer surface or `composeDocumentImage`, so an
   * export is identical whether the rulers were shown or not.
   */
  setRulers(rulers: RulerSettings): void;
  /**
   * Sets the symmetry the in-progress stroke is repeated around.
   *
   * The symmetry has two display jobs: the overlay shows the axes and the
   * centre marker, and the in-progress stroke is painted once per copy so the
   * user sees the symmetric result while they draw. The copies themselves are
   * ordinary strokes the engine commits to the layer, so nothing here reaches
   * a layer surface or an export.
   */
  setSymmetry(symmetry: SymmetrySettings): void;
  /**
   * Sets the reference overlay - the images the artist keeps beside the
   * canvas - or clears it with `null`.
   *
   * Overlay only, like the selection and the grid: the references are painted
   * on the display canvas in **workspace space** (the canvas' own CSS pixels,
   * not document pixels), so they stay where the artist put them while the
   * artwork is zoomed and panned underneath. They never reach a layer surface,
   * the document or `composeDocumentImage`, so a PNG export is identical
   * whether a reference was shown or not.
   */
  setReferenceOverlay(overlay: ReferenceOverlay | null): void;
  /**
   * Composites paper and visible layers into a **new** canvas at document pixel
   * size (no viewport, no border, no in-progress stroke). Used by PNG export, so
   * it must not disturb the display, the document or the layer surfaces.
   */
  composeDocumentImage(): HTMLCanvasElement;
  /**
   * Composites a small overview of the document into a **new** canvas.
   *
   * The overview is the paper plus every visible layer at its opacity and
   * blend mode, scaled into `maxWidth` x `maxHeight` device pixels. It is what
   * a navigator panel draws, so the caller picks a size that already matches
   * the document's aspect ratio and the image lands in the panel undistorted.
   *
   * A read, like the other composite methods: no document pixel changes,
   * nothing enters history and nothing reaches an export. The layer surfaces
   * it draws from are the cached ones, so an overview costs a downscale rather
   * than a re-rasterization of the document.
   *
   * Returns `null` when there is no document to show.
   */
  renderOverview(maxWidth: number, maxHeight: number): HTMLCanvasElement | null;
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
  /**
   * Reads the whole composite the user sees at document resolution, for tools
   * that need a region rather than one pixel (the bucket fill).
   *
   * Same rules as `readCompositePixel`: paper plus visible layers at their
   * opacity, no viewport, no border, no in-progress stroke. Returns `null` when
   * there is no document. This is a read: it changes no pixels and enters no
   * history.
   *
   * `options.layerIds` narrows the read to a set of layers, so the bucket can
   * sample the active layer or one chosen layer instead of the merged
   * composite.
   */
  readCompositeImage(options?: CompositeReadOptions): ImageData | null;
  render(): void;
  requestRender(): void;
  destroy(): void;
}
