/**
 * The geometry of a reference image.
 *
 * Every rule here is pure and works in **workspace space** - the canvas' own
 * CSS pixels. Nothing in this module knows about the document, the viewport or
 * the zoom, which is what keeps a reference transform independent of the
 * artwork: the same numbers mean the same place on the screen whatever the
 * drawing is doing underneath.
 *
 * The one piece of arithmetic worth reading twice is {@link referenceSourcePoint}:
 * it maps a point on the screen back to a pixel of the decoded image, which is
 * what makes the colour picker read the pixel the artist is actually pointing
 * at rather than the pixel the image would have at its own size.
 */

import { clamp } from "../../utils/math";
import type { ReferenceImage } from "./types";

/** A rectangle in workspace space. */
export interface WorkspaceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point in workspace space. */
export interface WorkspacePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The smallest a reference may be scaled to, in workspace pixels.
 *
 * A reference that can be scaled to nothing cannot be grabbed again, so the
 * scale is clamped rather than allowed to reach zero.
 */
export const MIN_REFERENCE_SIZE = 8;

/** The workspace rectangle a reference occupies. */
export function referenceRect(reference: ReferenceImage): WorkspaceRect {
  return {
    x: reference.x,
    y: reference.y,
    width: reference.width,
    height: reference.height,
  };
}

/** True when a workspace point lies inside the reference's rectangle. */
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
 * The pixel of the decoded image under a workspace point.
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
): WorkspacePoint | null {
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
 * half that.
 */
export function referenceScale(reference: ReferenceImage): number {
  if (reference.naturalWidth <= 0) {
    return 1;
  }
  return reference.width / reference.naturalWidth;
}

/** Moves a reference by a workspace delta. */
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

/** Moves a reference to an absolute workspace position. */
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
  anchor: WorkspacePoint,
): ReferenceImage {
  if (!Number.isFinite(factor) || factor <= 0) {
    return reference;
  }
  const width = Math.max(MIN_REFERENCE_SIZE, reference.width * factor);
  const height = Math.max(MIN_REFERENCE_SIZE, reference.height * factor);
  const appliedX = reference.width > 0 ? width / reference.width : factor;
  const appliedY = reference.height > 0 ? height / reference.height : factor;
  return {
    ...reference,
    x: anchor.x - (anchor.x - reference.x) * appliedX,
    y: anchor.y - (anchor.y - reference.y) * appliedY,
    width,
    height,
  };
}

/**
 * Sets the displayed size of a reference.
 *
 * The size is clamped to the smallest usable one, because a reference with no
 * area cannot be seen, grabbed or sampled.
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
 * Sets how large a reference is drawn relative to its own pixels.
 *
 * A scale of `1` is the natural size, `0.5` is half that. The reference grows
 * about its **centre**, so a size slider does not make the image crawl away
 * from where the artist put it.
 */
export function setReferenceScale(
  reference: ReferenceImage,
  scale: number,
): ReferenceImage {
  if (!Number.isFinite(scale) || scale <= 0) {
    return reference;
  }
  const width = Math.max(MIN_REFERENCE_SIZE, reference.naturalWidth * scale);
  const height = Math.max(MIN_REFERENCE_SIZE, reference.naturalHeight * scale);
  const centreX = reference.x + reference.width / 2;
  const centreY = reference.y + reference.height / 2;
  return {
    ...reference,
    x: centreX - width / 2,
    y: centreY - height / 2,
    width,
    height,
  };
}

/**
 * Fits a reference into a workspace rectangle, keeping its aspect ratio.
 *
 * The image is scaled so that both of its sides fit inside the rectangle, and
 * it is centred in it. A margin keeps it off the very edge of the canvas.
 */
export function fitReference(
  reference: ReferenceImage,
  view: { readonly width: number; readonly height: number },
  margin = 16,
): ReferenceImage {
  if (reference.naturalWidth <= 0 || reference.naturalHeight <= 0) {
    return reference;
  }
  const availableWidth = Math.max(1, view.width - margin * 2);
  const availableHeight = Math.max(1, view.height - margin * 2);
  const factor = Math.min(
    availableWidth / reference.naturalWidth,
    availableHeight / reference.naturalHeight,
  );
  const width = reference.naturalWidth * factor;
  const height = reference.naturalHeight * factor;
  return {
    ...reference,
    x: (view.width - width) / 2,
    y: (view.height - height) / 2,
    width,
    height,
  };
}

/** Centres a reference in a workspace rectangle, keeping its size. */
export function centerReference(
  reference: ReferenceImage,
  view: { readonly width: number; readonly height: number },
): ReferenceImage {
  return {
    ...reference,
    x: (view.width - reference.width) / 2,
    y: (view.height - reference.height) / 2,
  };
}
