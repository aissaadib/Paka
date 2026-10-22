/**
 * The geometry of a reference image.
 *
 * Every rule here is pure and works in **document coordinates**, the same
 * space a stroke, a gradient or a composition guide uses. Nothing in this
 * module knows about the window, the zoom or the device pixel ratio, which is
 * what keeps a reference anchored to the paper: the same numbers mean the same
 * place on the drawing at every zoom, on every window size, on every machine.
 *
 * Two rules shape the module:
 *
 *  - **the document owns the placement.** A reference is placed in document
 *    pixels, so it moves with the paper when the viewport is panned and it
 *    scales with the paper when the viewport is zoomed. The screen rectangle
 *    in {@link referenceScreenRect} is the only place the viewport appears,
 *    and it is derived, never stored.
 *  - **the document rectangle clips it.** A reference may hang over the edge of
 *    the paper - that is how an artist pins a photo half off the page - but
 *    only the part that lies on the paper is ever drawn. {@link
 *    referenceVisibleRect} is the clipped rectangle the renderer draws.
 */

import type { Bounds, Point, Size } from "../../types/geometry";
import type { Viewport } from "../../types/viewport";
import { clamp } from "../../utils/math";
import { docToScreen } from "../rendering/viewport";
import type { ReferenceImage } from "./types";

/**
 * The smallest a reference may be scaled to, in document pixels.
 *
 * A reference that can be scaled to nothing cannot be grabbed again, so the
 * scale is clamped rather than allowed to reach zero. The clamp is on the
 * *longest* side, because the sides keep their ratio: the shorter side
 * follows it down.
 */
export const MIN_REFERENCE_SIZE = 8;

/** The rectangle a reference occupies, in document coordinates. */
export function referenceRect(reference: ReferenceImage): Bounds {
  return {
    x: reference.x,
    y: reference.y,
    width: reference.width,
    height: reference.height,
  };
}

/**
 * The part of a rectangle that lies on the paper.
 *
 * The document rectangle is the origin and the document's size. The result is
 * `null` when the rectangle misses the paper entirely: there is then nothing
 * to draw. The far edges are exclusive, so a rectangle that ends exactly on
 * the paper's edge is not one pixel wider than the paper.
 */
export function clipRectToDocument(rect: Bounds, document: Size): Bounds | null {
  if (!Number.isFinite(document.width) || !Number.isFinite(document.height)) {
    return null;
  }
  if (document.width <= 0 || document.height <= 0) {
    return null;
  }
  const left = Math.max(rect.x, 0);
  const top = Math.max(rect.y, 0);
  const right = Math.min(rect.x + rect.width, document.width);
  const bottom = Math.min(rect.y + rect.height, document.height);
  if (right <= left || bottom <= top) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The part of a reference that lies on the paper, in document coordinates.
 *
 * This is the rectangle the renderer draws: a reference that hangs over the
 * edge of the paper is cut off there, and one that lies entirely off it is
 * not drawn at all.
 */
export function referenceVisibleRect(reference: ReferenceImage, document: Size): Bounds | null {
  return clipRectToDocument(referenceRect(reference), document);
}

/** True when a document point lies inside the reference's rectangle. */
export function referenceContains(reference: ReferenceImage, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }
  return (
    x >= reference.x &&
    y >= reference.y &&
    x < reference.x + reference.width &&
    y < reference.y + reference.height
  );
}

/**
 * True when a document point lies on the part of the reference that is drawn.
 *
 * The clipped rectangle is used rather than the placed one, so a point on the
 * paper under the overhang of a reference is *not* on the reference: the
 * overhang is not drawn there.
 */
export function referenceVisibleContains(
  reference: ReferenceImage,
  x: number,
  y: number,
  document: Size,
): boolean {
  const visible = referenceVisibleRect(reference, document);
  if (!visible) {
    return false;
  }
  return (
    x >= visible.x &&
    y >= visible.y &&
    x < visible.x + visible.width &&
    y < visible.y + visible.height
  );
}

/**
 * The pixel of the decoded image under a document point.
 *
 * The reference is drawn from its decoded pixels into a rectangle, so the
 * mapping back is the inverse of that placement: the offset within the
 * rectangle, divided by its size, times the image's own size. The result is
 * floored, so it names the pixel the point falls in rather than a position
 * between pixels.
 *
 * Returns `null` when the point is outside the reference, or when the
 * reference has no area (a zero-sized placement has no pixels to name).
 */
export function referenceSourcePoint(
  reference: ReferenceImage,
  x: number,
  y: number,
): Point | null {
  if (reference.width <= 0 || reference.height <= 0) {
    return null;
  }
  const u = ((x - reference.x) / reference.width) * reference.naturalWidth;
  const v = ((y - reference.y) / reference.height) * reference.naturalHeight;
  if (u < 0 || v < 0 || u >= reference.naturalWidth || v >= reference.naturalHeight) {
    return null;
  }
  return { x: Math.floor(u), y: Math.floor(v) };
}

/**
 * How large the reference is drawn relative to its own pixels.
 *
 * `1` means the image is drawn at its natural size; `0.5` means it is drawn at
 * half that. One image pixel is one document pixel at scale `1`.
 */
export function referenceScale(reference: ReferenceImage): number {
  if (reference.naturalWidth <= 0) {
    return 1;
  }
  return reference.width / reference.naturalWidth;
}

/** Moves a reference by a document delta. */
export function moveReference(
  reference: ReferenceImage,
  dx: number,
  dy: number,
): ReferenceImage {
  return {
    ...reference,
    x: reference.x + dx,
    y: reference.y + dy,
  };
}

/** Moves a reference to an absolute document position. */
export function setReferencePosition(
  reference: ReferenceImage,
  x: number,
  y: number,
): ReferenceImage {
  return { ...reference, x, y };
}

/**
 * Scales a reference about an anchor point.
 *
 * The anchor stays where it is and the reference grows around it, which is
 * what a corner handle does. The scale is uniform, so the image keeps its
 * aspect ratio, and it is clamped: a reference that shrank to nothing could
 * not be grabbed again. The clamp is applied to the *result*, so the anchor
 * still holds when the scale was out of reach.
 */
export function scaleReference(
  reference: ReferenceImage,
  factor: number,
  anchor: Point,
): ReferenceImage {
  if (!Number.isFinite(factor) || factor <= 0) {
    return reference;
  }
  const longest = Math.max(reference.width, reference.height);
  const applied = longest > 0 ? Math.max(factor, MIN_REFERENCE_SIZE / longest) : factor;
  return {
    ...reference,
    x: anchor.x - (anchor.x - reference.x) * applied,
    y: anchor.y - (anchor.y - reference.y) * applied,
    width: reference.width * applied,
    height: reference.height * applied,
  };
}

/**
 * Sets the displayed size of a reference, in document pixels.
 *
 * The size is clamped to the smallest usable one, because a reference with no
 * area cannot be seen, grabbed or sampled. A non-finite size is ignored: it
 * comes from an untrusted value and must not blank the reference.
 */
export function setReferenceSize(
  reference: ReferenceImage,
  width: number,
  height: number,
): ReferenceImage {
  const safeWidth = Number.isFinite(width) ? Math.max(MIN_REFERENCE_SIZE, width) : reference.width;
  const safeHeight = Number.isFinite(height) ? Math.max(MIN_REFERENCE_SIZE, height) : reference.height;
  return { ...reference, width: safeWidth, height: safeHeight };
}

/** Sets how opaque a reference is drawn. */
export function setReferenceOpacity(reference: ReferenceImage, opacity: number): ReferenceImage {
  return { ...reference, opacity: clamp(opacity, 0, 1) };
}

/**
 * Scales a reference so the whole image fits on the paper, and centres it.
 *
 * The fit is measured against the image's *natural* size, so "fit" means the
 * whole picture is visible, not the current placement. The aspect ratio is
 * kept, and a margin keeps it off the very edge of the paper.
 */
export function fitReferenceToDocument(
  reference: ReferenceImage,
  document: Size,
  margin = 0,
): ReferenceImage {
  if (reference.naturalWidth <= 0 || reference.naturalHeight <= 0) {
    return reference;
  }
  const availableWidth = Math.max(1, document.width - margin * 2);
  const availableHeight = Math.max(1, document.height - margin * 2);
  const factor = Math.min(
    availableWidth / reference.naturalWidth,
    availableHeight / reference.naturalHeight,
  );
  const width = reference.naturalWidth * factor;
  const height = reference.naturalHeight * factor;
  return {
    ...reference,
    x: (document.width - width) / 2,
    y: (document.height - height) / 2,
    width,
    height,
  };
}

/**
 * The rectangle a reference covers on the screen.
 *
 * This is the only function in the module that looks at the viewport, and it
 * derives the screen rectangle from the document rectangle rather than
 * storing it. The reference therefore moves with the paper when the viewport
 * is panned and scales with it when the viewport is zoomed, while its
 * document rectangle never changes.
 */
export function referenceScreenRect(reference: ReferenceImage, viewport: Viewport): Bounds {
  const topLeft = docToScreen(viewport, reference.x, reference.y);
  const bottomRight = docToScreen(viewport, reference.x + reference.width, reference.y + reference.height);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}
