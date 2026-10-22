/**
 * Reference images: pictures the artist keeps beside the drawing.
 *
 * A reference image is **not** document content. It never becomes a stroke, a
 * layer element or a pixel of the paper; it is drawn on the display canvas
 * only, so a PNG export of the same drawing is identical with and without a
 * reference, and importing one never dirties the document or adds a history
 * step.
 *
 * The placement is in **document coordinates**, exactly like a stroke, a
 * gradient or a composition guide. That is what anchors a reference to the
 * paper: it moves with the document when the viewport is panned and it scales
 * with the document when the viewport is zoomed, so it sits over the same
 * artwork at every zoom and on every window size. Nothing in the model
 * depends on the window, the zoom or the device pixel ratio.
 *
 * The decoded pixels are deliberately *not* part of this model. They are heavy
 * (four bytes per pixel) and they belong to the store, which keeps exactly one
 * decoded copy per reference; what is modelled here is the placement.
 */

import type { LayerBlendMode } from "../document/types";

/**
 * The blend mode a reference is composited with.
 *
 * The reference uses the layer blend modes, unchanged: they are the same
 * separable W3C formulas, and an artist who wants a reference to darken the
 * artwork underneath expects `multiply` to behave exactly as it does on a
 * layer. The closed list lives in `core/document/blendModes.ts`.
 */
export type ReferenceBlendMode = LayerBlendMode;

/** A reference image placed on the document. */
export interface ReferenceImage {
  /** Unique within a session. */
  readonly id: string;
  /** The file name the image was imported from, shown in the panel. */
  readonly name: string;
  /** Left edge, in document pixels. */
  readonly x: number;
  /** Top edge, in document pixels. */
  readonly y: number;
  /** Displayed width, in document pixels. */
  readonly width: number;
  /** Displayed height, in document pixels. */
  readonly height: number;
  /** Width of the decoded image, in its own pixels. */
  readonly naturalWidth: number;
  /** Height of the decoded image, in its own pixels. */
  readonly naturalHeight: number;
  /** How opaque the reference is drawn, `0..1`. */
  readonly opacity: number;
  /**
   * The blend mode the reference is composited with.
   *
   * It applies to whatever the reference is drawn over: the paper, when the
   * reference sits behind the artwork, and the artwork itself, when it sits
   * over it.
   */
  readonly blendMode: ReferenceBlendMode;
  /**
   * Whether the reference is drawn **behind** the artwork.
   *
   * `true` puts the reference under the drawing's pixels, so the artwork is
   * drawn on top of it; `false` puts the reference over the artwork. The flag
   * is per reference, not a global mode: an artist may keep one photograph
   * under the line work and another over it.
   */
  readonly behind: boolean;
  /**
   * Whether the reference is drawn.
   *
   * A hidden reference is not drawn *and* not sampled: it is not on the
   * canvas, so a press under it belongs to the artwork underneath.
   */
  readonly visible: boolean;
}

/** The fields of a reference a user action may change. */
export type ReferenceImagePatch = Partial<
  Pick<
    ReferenceImage,
    "name" | "x" | "y" | "width" | "height" | "opacity" | "blendMode" | "behind" | "visible"
  >
>;

/**
 * One reference and the pixels to draw it with.
 *
 * The seam with the renderer: the renderer is handed the placement and a
 * drawable source, and never the bytes.
 */
export interface ReferenceOverlayItem {
  readonly reference: ReferenceImage;
  readonly source: CanvasImageSource;
}

/**
 * The references the renderer paints, in draw order.
 *
 * Overlay only, like the selection and the guides: it is drawn on the display
 * canvas and never reaches a layer surface, the document or
 * `composeDocumentImage`, so an export is identical whether a reference was
 * shown or not.
 */
export interface ReferenceOverlay {
  /** The references to draw, back to front. */
  readonly items: readonly ReferenceOverlayItem[];
  /** The reference the user selected, framed on the canvas. */
  readonly selectedId: string | null;
}
