/**
 * Reference images: pictures the artist keeps beside the canvas.
 *
 * A reference image is **not** document content. It never becomes a stroke, a
 * layer element or a pixel of the paper; it is drawn on the display canvas
 * only, so a PNG export of the same drawing is byte-identical with and without
 * a reference, and importing one never dirties the document or adds a history
 * step.
 *
 * The placement is in **workspace space** - the canvas' own CSS pixels - and
 * not in document space. That is what makes a reference a *reference*: it stays
 * where the artist put it while the artwork is zoomed and panned underneath
 * it, so moving or scaling it can never disturb the drawing. It is also why
 * the transform of a reference is independent of the document: nothing in this
 * module knows what a document is.
 *
 * The decoded pixels are deliberately *not* part of this model. They are heavy
 * (four bytes per pixel) and they belong to the store, which keeps exactly one
 * decoded copy per reference; what is modelled here is the placement.
 */

import type { Rgb } from "../../utils/color";

/** A reference image placed on the workspace. */
export interface ReferenceImage {
  /** Unique within a session. */
  readonly id: string;
  /** The file name the image was imported from, shown in the panel. */
  readonly name: string;
  /** Left edge, in workspace pixels (canvas-local CSS pixels). */
  readonly x: number;
  /** Top edge, in workspace pixels. */
  readonly y: number;
  /** Displayed width, in workspace pixels. */
  readonly width: number;
  /** Displayed height, in workspace pixels. */
  readonly height: number;
  /** Width of the decoded image, in its own pixels. */
  readonly naturalWidth: number;
  /** Height of the decoded image, in its own pixels. */
  readonly naturalHeight: number;
  /**
   * Whether the reference is drawn.
   *
   * A hidden reference is not drawn *and* not sampled: it is not on the
   * canvas, so a press under it belongs to the artwork underneath.
   */
  readonly visible: boolean;
  /** How opaque the reference is drawn, `0..1`. */
  readonly opacity: number;
}

/** What the reference panel shows. */
export interface ReferenceState {
  /**
   * The references, in the order they were added.
   *
   * The last one is drawn on top, and the topmost visible reference under the
   * pointer is the one that is sampled.
   */
  readonly references: readonly ReferenceImage[];
  /** The reference the user selected, or `null`. */
  readonly selectedId: string | null;
  /** True while an image is being decoded. */
  readonly busy: boolean;
  /** A message about the last import, or `null`. */
  readonly notice: string | null;
}

/** A reference and the pixels to draw it with. */
export interface ReferenceOverlayItem {
  readonly reference: ReferenceImage;
  readonly source: CanvasImageSource;
}

/**
 * The reference overlay the renderer paints.
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
  /** The reference under the pointer, outlined on the canvas. */
  readonly hoveredId: string | null;
}

/**
 * The seam between the reference store and the engine.
 *
 * The engine never owns the references: it asks this source for the overlay
 * it paints and for the pixel under the pointer, and it tells the source how
 * big the workspace is so a reference can be placed in it. The store keeps the
 * decoded pixels, so the engine never holds a bitmap.
 */
export interface ReferenceSource {
  /** The references, in draw order (the last one is on top). */
  readonly references: readonly ReferenceImage[];
  /** The reference the user selected, or `null`. */
  readonly selectedId: string | null;
  /** The decoded pixels of one reference, or `null` when it has none. */
  sourceFor(id: string): CanvasImageSource | null;
  /** Subscribes to changes; the listener runs after every change. */
  subscribe(listener: () => void): () => void;
  /** Tells the source how big the workspace is, in workspace pixels. */
  setViewportSize(width: number, height: number): void;
  /** The topmost visible reference under a workspace point, or `null`. */
  hitTest(x: number, y: number): ReferenceImage | null;
  /** The colour of the reference pixel under a workspace point, or `null`. */
  sampleAt(x: number, y: number): Rgb | null;
}
