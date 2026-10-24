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
import type { ReferenceImage, ReferenceImagePatch } from "./types";

/**
 * The smallest a reference may be scaled to, in document pixels.
 *
 * A reference that can be scaled to nothing cannot be grabbed again, so the
 * scale is clamped rather than allowed to reach zero. The clamp is on the
 * *longest* side, because the sides keep their ratio: the shorter side
 * follows it down.
 */
export const MIN_REFERENCE_SIZE = 8;

/**
 * The radius a selection handle is grabbed within, in CSS pixels.
 *
 * Screen-space, like the guide's grab radius: a handle is equally easy to grab
 * at 2 % and at 6400 %.
 */
export const REFERENCE_HANDLE_RADIUS_PX = 8;

/** How far the rotation handle sits from the top edge, in CSS pixels. */
export const REFERENCE_ROTATION_HANDLE_OFFSET_PX = 26;

/** The handles a selected reference shows. */
export type ReferenceHandleId = "nw" | "ne" | "se" | "sw" | "rotate";

/** The CSS cursor each handle asks for. */
export const REFERENCE_HANDLE_CURSORS: Record<ReferenceHandleId, string> = {
  nw: "nwse-resize",
  ne: "nesw-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
  rotate: "grab",
};

/** The four corners and the rotation handle of a selected reference. */
export interface ReferenceHandles {
  /** Top-left, top-right, bottom-right, bottom-left, rotated with the picture. */
  readonly corners: readonly [Point, Point, Point, Point];
  /** The grab point that turns the picture. */
  readonly rotation: Point;
}

/** The centre of a reference's rectangle, in document coordinates. */
export function referenceCentre(reference: ReferenceImage): Point {
  return {
    x: reference.x + reference.width / 2,
    y: reference.y + reference.height / 2,
  };
}

/**
 * Turns a point about a centre by a number of degrees.
 *
 * The document's y axis points down, so a positive angle turns clockwise on
 * screen - the direction the model documents for `rotation`.
 */
export function rotatePointAbout(point: Point, centre: Point, degrees: number): Point {
  if (!Number.isFinite(degrees) || degrees === 0) {
    return point;
  }
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

/** Normalizes an angle into `[0, 360)`. */
export function normalizeReferenceRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** The four corners of a reference, in document coordinates, rotated. */
export function referenceCorners(
  reference: ReferenceImage,
): readonly [Point, Point, Point, Point] {
  const centre = referenceCentre(reference);
  const left = reference.x;
  const top = reference.y;
  const right = reference.x + reference.width;
  const bottom = reference.y + reference.height;
  return [
    rotatePointAbout({ x: left, y: top }, centre, reference.rotation),
    rotatePointAbout({ x: right, y: top }, centre, reference.rotation),
    rotatePointAbout({ x: right, y: bottom }, centre, reference.rotation),
    rotatePointAbout({ x: left, y: bottom }, centre, reference.rotation),
  ];
}

/**
 * The axis-aligned box a rotated reference covers.
 *
 * Rotation makes the covered area larger than the placement rectangle: this is
 * the smallest box that holds all four corners, which is what the paper clip
 * and the navigator need.
 */
export function referenceBounds(reference: ReferenceImage): Bounds {
  const corners = referenceCorners(reference);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * A document point in the reference's own unrotated frame.
 *
 * The result is relative to the placement rectangle's top-left, so
 * `0..width` and `0..height` name the picture. This is the inverse of the
 * rotation the renderer applies, which is what keeps hit-testing and sampling
 * in agreement with what is drawn.
 */
export function referenceLocalPoint(reference: ReferenceImage, x: number, y: number): Point {
  const centre = referenceCentre(reference);
  const unrotated = rotatePointAbout({ x, y }, centre, -reference.rotation);
  return { x: unrotated.x - reference.x, y: unrotated.y - reference.y };
}

/** Sets a reference's rotation, in degrees clockwise, wrapped to `[0, 360)`. */
export function setReferenceRotation(reference: ReferenceImage, degrees: number): ReferenceImage {
  if (!Number.isFinite(degrees)) {
    return reference;
  }
  return { ...reference, rotation: normalizeReferenceRotation(degrees) };
}

/** Turns a reference by a relative angle, in degrees clockwise. */
export function rotateReference(reference: ReferenceImage, degrees: number): ReferenceImage {
  if (!Number.isFinite(degrees)) {
    return reference;
  }
  return setReferenceRotation(reference, reference.rotation + degrees);
}

/**
 * The handles a selected reference shows, in document coordinates.
 *
 * The corners follow the rotation; the rotation handle sits a fixed number of
 * **CSS pixels** beyond the top edge, so it stays grabbable at every zoom.
 */
export function referenceHandles(
  reference: ReferenceImage,
  viewport: Viewport,
): ReferenceHandles {
  const corners = referenceCorners(reference);
  const topMid = {
    x: (corners[0].x + corners[1].x) / 2,
    y: (corners[0].y + corners[1].y) / 2,
  };
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  const offset = REFERENCE_ROTATION_HANDLE_OFFSET_PX / zoom;
  const radians = (reference.rotation * Math.PI) / 180;
  // The outward normal of the top edge: (0, -1) turned with the picture.
  return {
    corners,
    rotation: {
      x: topMid.x + Math.sin(radians) * offset,
      y: topMid.y - Math.cos(radians) * offset,
    },
  };
}

/** The handle a document point grabs, or `null` when it grabs none. */
export function findReferenceHandle(
  reference: ReferenceImage,
  viewport: Viewport,
  x: number,
  y: number,
  radiusPx = REFERENCE_HANDLE_RADIUS_PX,
): ReferenceHandleId | null {
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  const radius = radiusPx / zoom;
  const handles = referenceHandles(reference, viewport);
  const ids: readonly ReferenceHandleId[] = ["nw", "ne", "se", "sw"];
  for (let index = 0; index < handles.corners.length; index += 1) {
    const corner = handles.corners[index];
    if (Math.hypot(corner.x - x, corner.y - y) <= radius) {
      return ids[index];
    }
  }
  if (Math.hypot(handles.rotation.x - x, handles.rotation.y - y) <= radius) {
    return "rotate";
  }
  return null;
}

/**
 * Resizes a reference from one of its corners, keeping its aspect ratio.
 *
 * The opposite corner is the anchor: it stays exactly where it is while the
 * dragged corner follows the pointer. The drag is measured in the reference's
 * own rotated frame, so a turned picture resizes along its own edges rather
 * than along the screen's axes.
 */
export function resizeReferenceFromCorner(
  reference: ReferenceImage,
  corner: Exclude<ReferenceHandleId, "rotate">,
  x: number,
  y: number,
): ReferenceImage {
  const width = reference.width;
  const height = reference.height;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return reference;
  }
  const centre = referenceCentre(reference);
  const local = rotatePointAbout({ x, y }, centre, -reference.rotation);
  const left = reference.x;
  const top = reference.y;
  const right = left + width;
  const bottom = top + height;
  const anchor =
    corner === "nw"
      ? { x: right, y: bottom }
      : corner === "ne"
        ? { x: left, y: bottom }
        : corner === "se"
          ? { x: left, y: top }
          : { x: right, y: top };

  const aspect = width / height;
  let nextWidth = Math.abs(local.x - anchor.x);
  let nextHeight = Math.abs(local.y - anchor.y);
  // The dominant axis wins, so the picture follows the pointer without
  // distorting: the other side is derived from the aspect ratio.
  if (nextWidth / aspect >= nextHeight) {
    nextHeight = nextWidth / aspect;
  } else {
    nextWidth = nextHeight * aspect;
  }
  const longest = Math.max(nextWidth, nextHeight);
  if (!(longest > 0)) {
    return reference;
  }
  if (longest < MIN_REFERENCE_SIZE) {
    const grow = MIN_REFERENCE_SIZE / longest;
    nextWidth *= grow;
    nextHeight *= grow;
  }

  const signX = local.x >= anchor.x ? 1 : -1;
  const signY = local.y >= anchor.y ? 1 : -1;
  const anchorDoc = rotatePointAbout(anchor, centre, reference.rotation);
  const halfX = rotatePointAbout(
    { x: (signX * nextWidth) / 2, y: 0 },
    { x: 0, y: 0 },
    reference.rotation,
  );
  const halfY = rotatePointAbout(
    { x: 0, y: (signY * nextHeight) / 2 },
    { x: 0, y: 0 },
    reference.rotation,
  );
  const nextCentre = {
    x: anchorDoc.x + halfX.x + halfY.x,
    y: anchorDoc.y + halfX.y + halfY.y,
  };
  return {
    ...reference,
    x: nextCentre.x - nextWidth / 2,
    y: nextCentre.y - nextHeight / 2,
    width: nextWidth,
    height: nextHeight,
  };
}

/**
 * Applies a user patch to a reference, clamping the fields that have limits.
 *
 * One place for the rules, so a slider, a gesture and a project file cannot
 * disagree about what an opacity or a size may be.
 */
export function applyReferencePatch(
  reference: ReferenceImage,
  patch: ReferenceImagePatch,
): ReferenceImage {
  const next: ReferenceImage = { ...reference, ...patch };
  return {
    ...next,
    rotation: normalizeReferenceRotation(next.rotation),
    opacity: clamp(next.opacity, 0, 1),
    width: Number.isFinite(next.width) ? Math.max(MIN_REFERENCE_SIZE, next.width) : reference.width,
    height: Number.isFinite(next.height)
      ? Math.max(MIN_REFERENCE_SIZE, next.height)
      : reference.height,
  };
}

/** True when two references would draw the very same picture. */
export function referenceEqual(a: ReferenceImage, b: ReferenceImage): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.naturalWidth === b.naturalWidth &&
    a.naturalHeight === b.naturalHeight &&
    a.rotation === b.rotation &&
    a.opacity === b.opacity &&
    a.blendMode === b.blendMode &&
    a.behind === b.behind &&
    a.visible === b.visible &&
    a.source === b.source
  );
}

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
  return clipRectToDocument(referenceBounds(reference), document);
}

/** True when a document point lies inside the reference's rotated rectangle. */
export function referenceContains(reference: ReferenceImage, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }
  const local = referenceLocalPoint(reference, x, y);
  return local.x >= 0 && local.y >= 0 && local.x < reference.width && local.y < reference.height;
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
  if (!referenceContains(reference, x, y)) {
    return false;
  }
  return x >= 0 && y >= 0 && x < document.width && y < document.height;
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
  const local = referenceLocalPoint(reference, x, y);
  const u = (local.x / reference.width) * reference.naturalWidth;
  const v = (local.y / reference.height) * reference.naturalHeight;
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
  const bounds = referenceBounds(reference);
  const topLeft = docToScreen(viewport, bounds.x, bounds.y);
  const bottomRight = docToScreen(viewport, bounds.x + bounds.width, bounds.y + bounds.height);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}
