/**
 * Composition guides: geometry, hit-testing and the pure document operations.
 *
 * Everything here is free of DOM and renderer state, so the rules that decide
 * where a guide lands and which one a press grabs can be unit tested without a
 * canvas - the same split `strokeSelection.ts` and `shapeGeometry.ts` already
 * use.
 *
 * Two spaces are in play and the module keeps them apart:
 *
 *  - a guide's **position** is document space, so it means the same thing at
 *    every zoom and on every machine;
 *  - a guide's **grab radius** is screen space, because a press is made with a
 *    finger or a mouse: a fixed document radius would make a guide
 *    ungrabbable when zoomed out and impossible to miss when zoomed in.
 */

import type { DrawingDocument, Guide, GuideAxis } from "./types";

/**
 * How close a press has to be to a guide, in CSS pixels on screen.
 *
 * The same size as a toolbar target, so a guide can be grabbed with the same
 * care as a button.
 */
export const GUIDE_GRAB_RADIUS_PX = 8;

/**
 * The axis a drag creates: the dominant direction of the drag.
 *
 * A vertical guide comes from a drag that is wider than it is tall, a
 * horizontal one from a drag that is taller than it is wide. A perfectly
 * diagonal drag is a horizontal guide, so the rule never leaves the user
 * without a guide.
 */
export function guideAxisFromDrag(dx: number, dy: number): GuideAxis {
  return Math.abs(dx) > Math.abs(dy) ? "vertical" : "horizontal";
}

/**
 * Rounds a document position to a whole document pixel.
 *
 * A guide is a registration mark: a fractional position would draw a soft,
 * blurry edge at some zooms. The rounding is to the nearest pixel, so a drag
 * to 120.4 lands on 120.
 */
export function roundGuidePosition(value: number): number {
  const rounded = Math.round(value);
  // `Math.round(-0.4)` is `-0`, which is a number that compares equal to `0`
  // but is not the same value: it would write `-0` into a project file.
  return rounded === 0 ? 0 : rounded;
}

/**
 * The grab radius in document units, for a given zoom.
 *
 * The screen-space radius divided by the zoom: at 1x it is 8 document pixels,
 * at 0.25x it is 32, and at 64x it is an eighth of a pixel.
 */
export function guideGrabRadius(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return GUIDE_GRAB_RADIUS_PX;
  }
  return GUIDE_GRAB_RADIUS_PX / zoom;
}

/**
 * The perpendicular distance from a document point to a guide, in document
 * units.
 *
 * A guide spans the whole viewport, so only the coordinate across its axis
 * matters: the distance to a vertical guide is the horizontal distance.
 */
export function guideDistance(guide: Guide, docX: number, docY: number): number {
  return guide.axis === "vertical"
    ? Math.abs(docX - guide.position)
    : Math.abs(docY - guide.position);
}

/**
 * The guide a press grabs, or `null` when it grabs none.
 *
 * The nearest guide within the screen-space grab radius wins. On an exact tie
 * the vertical guide wins, so the outcome never depends on the order the
 * guides happen to be listed in.
 */
export function findGuideAt(
  guides: readonly Guide[],
  docX: number,
  docY: number,
  zoom: number,
): Guide | null {
  const radius = guideGrabRadius(zoom);
  let best: Guide | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const guide of guides) {
    const distance = guideDistance(guide, docX, docY);
    if (distance > radius) {
      continue;
    }
    const wins =
      best === null ||
      distance < bestDistance ||
      (distance === bestDistance && guide.axis === "vertical" && best.axis !== "vertical");
    if (wins) {
      best = guide;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * True when another guide already sits at this axis position.
 *
 * Two guides on the same axis at the same position are legal in the file
 * format but pointless on screen, so the editor refuses to create one. The
 * guide being moved is ignored, so a guide can be dropped back where it was.
 */
export function isDuplicateGuide(
  guides: readonly Guide[],
  axis: GuideAxis,
  position: number,
  ignoreId?: string,
): boolean {
  return guides.some(
    (guide) => guide.id !== ignoreId && guide.axis === axis && guide.position === position,
  );
}

/** The guide with this id, or `undefined`. */
export function findGuide(guides: readonly Guide[], id: string): Guide | undefined {
  return guides.find((guide) => guide.id === id);
}

/**
 * True when two guide lists hold exactly the same guides.
 *
 * A drag that ends where it started produces the same guides in a *different*
 * array, so the document objects are not identical even though nothing
 * changed. This is what tells "the gesture changed nothing" from "the gesture
 * changed the list".
 */
export function guidesEqual(a: readonly Guide[], b: readonly Guide[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every(
    (guide, index) =>
      guide.id === b[index]?.id &&
      guide.axis === b[index]?.axis &&
      guide.position === b[index]?.position,
  );
}

/** A new document that carries `guide` in addition to the ones it has. */
export function addGuideToDocument(document: DrawingDocument, guide: Guide): DrawingDocument {
  return { ...document, guides: [...document.guides, guide] };
}

/**
 * A new document whose guide `id` sits at `position`.
 *
 * The document is returned unchanged when the guide is unknown or when it is
 * already at that position, so a caller can tell a real move from a no-op.
 */
export function setGuidePosition(
  document: DrawingDocument,
  id: string,
  position: number,
): DrawingDocument {
  if (!document.guides.some((guide) => guide.id === id)) {
    return document;
  }
  const guides = document.guides.map((guide) =>
    guide.id === id ? { ...guide, position } : guide,
  );
  return { ...document, guides };
}

/**
 * A new document without the guide `id`.
 *
 * The document is returned unchanged when the guide is unknown, so a caller
 * can tell a real removal from a no-op.
 */
export function removeGuideFromDocument(document: DrawingDocument, id: string): DrawingDocument {
  if (!document.guides.some((guide) => guide.id === id)) {
    return document;
  }
  return { ...document, guides: document.guides.filter((guide) => guide.id !== id) };
}
