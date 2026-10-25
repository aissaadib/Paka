/**
 * The handles a selected group of strokes offers.
 *
 * Four **corner** handles scale the selection and one **rotation** handle
 * above the frame turns it. They are the affordance of the transform: the
 * user grabs one of them and drags, and the selection follows.
 *
 * The handles are **display-only**, like the frame and the traced strokes
 * they sit on: the renderer paints them on the display canvas, and they never
 * reach a layer surface, the document or a PNG export.
 *
 * Two spaces meet here, and the module is careful about which is which:
 *
 *  - the handle **positions** are in document space, so a handle sits exactly
 *    on the selection's corner at any zoom;
 *  - the handle **sizes** and the **grab radius** are in screen pixels, so a
 *    handle is the same size on screen and equally easy to grab at 2 % and at
 *    6400 %.
 *
 * The module is pure and DOM-free: the geometry of the handles is the part
 * that has to be provable, so it is unit tested away from a browser. The
 * transform the handles drive is a separate pure module
 * (`selectionTransform.ts`): this one says **where the handles are** and
 * **which one a press grabs**, and it never forks that geometry.
 */

import type { Bounds, Point } from "../../types/geometry";

/**
 * Which handle a press grabbed.
 *
 * The four corners are named by the quadrant they sit in; the rotation
 * handle is named for what it does.
 */
export type SelectionHandleId = "scale-nw" | "scale-ne" | "scale-se" | "scale-sw" | "rotate";

/** The handles of a selection, in document space. */
export interface SelectionHandles {
  /**
   * The four corner handles, in the order north-west, north-east,
   * south-east, south-west.
   */
  readonly corners: readonly Point[];
  /** The rotation handle, above the frame's top edge. */
  readonly rotate: Point;
}

/**
 * The corner ids, in the order the corners are listed.
 *
 * One list, so the id of a corner and the corner of an id can never drift
 * apart: the hit-test, the cursor and the corner lookup all read this.
 */
const CORNER_IDS: readonly SelectionHandleId[] = ["scale-nw", "scale-ne", "scale-se", "scale-sw"];

/**
 * How far, in screen pixels, the rotation handle sits above the frame.
 *
 * Far enough that it never sits on the content it turns, close enough that
 * it reads as part of the frame.
 */
export const ROTATION_HANDLE_OFFSET_PX = 24;

/**
 * How far, in screen pixels, a press may miss a handle and still grab it.
 *
 * The same radius the composition guides use, so grabbing a guide and
 * grabbing a handle feel like the same gesture.
 */
export const HANDLE_GRAB_RADIUS_PX = 10;

/**
 * The CSS cursor each handle shows.
 *
 * The corner cursors are the diagonal resize cursors, so the cursor itself
 * says which way the corner will drag; the rotation handle gets a grab
 * cursor, which is the usual "this thing turns" hint.
 */
export const HANDLE_CURSORS: Record<SelectionHandleId, string> = {
  "scale-nw": "nwse-resize",
  "scale-ne": "nesw-resize",
  "scale-se": "nwse-resize",
  "scale-sw": "nesw-resize",
  rotate: "grab",
};

/**
 * The rotation handle's distance above the frame, in document units, at a
 * given zoom.
 *
 * The distance is a **screen** distance, so it is divided by the zoom: the
 * handle keeps the same distance above the frame on screen at any zoom, and
 * it stays clear of the content it turns.
 *
 * A zoom that is not a number, or not positive, has no meaningful scale, so
 * the screen distance is used as it is. The overlay then draws the handle
 * where the pixels put it rather than throwing the pointer's world away.
 */
export function rotationHandleOffset(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return ROTATION_HANDLE_OFFSET_PX;
  }
  return ROTATION_HANDLE_OFFSET_PX / zoom;
}

/**
 * The grab radius in document units, at a given zoom.
 *
 * The radius is a **screen** distance too: a handle is equally easy to grab
 * at 2 % and at 6400 %, because the same ten pixels around it are worth the
 * same whatever the zoom.
 *
 * A zoom that is not a number, or not positive, falls back to the screen
 * radius, exactly like the rotation handle's offset.
 */
export function handleGrabRadius(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return HANDLE_GRAB_RADIUS_PX;
  }
  return HANDLE_GRAB_RADIUS_PX / zoom;
}

/**
 * The handles of a frame, or `null` when the frame has no area.
 *
 * A frame with no width *and* no height is a single point; there is no
 * corner to pull and no direction to scale along, so there are no handles.
 *
 * `offset` is the distance from the frame's top edge to the rotation handle,
 * in document units. The caller converts it from screen pixels with the
 * live zoom (`rotationHandleOffset`), so the handle keeps its distance on
 * screen at any zoom.
 *
 * A frame that is not a number, or that is the wrong way round, and a
 * distance that is not a number, are all **refused**: there are no handles
 * rather than handles at a NaN, because an overlay drawn from a NaN lands
 * nowhere and a wrong-looking one lies about where the selection is.
 */
export function selectionHandles(bounds: Bounds, offset: number): SelectionHandles | null {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return null;
  }
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    return null;
  }
  if (bounds.width < 0 || bounds.height < 0) {
    return null;
  }
  if (!Number.isFinite(offset) || offset < 0) {
    return null;
  }
  if (bounds.width <= 0 && bounds.height <= 0) {
    return null;
  }
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return {
    corners: [
      { x: bounds.x, y: bounds.y },
      { x: right, y: bounds.y },
      { x: right, y: bottom },
      { x: bounds.x, y: bottom },
    ],
    rotate: { x: bounds.x + bounds.width / 2, y: bounds.y - offset },
  };
}

/**
 * The handles the selection overlay shows, or `null` when it shows none.
 *
 * This is the rule that decides **when** the handles are on screen, and it
 * is the rule the first review of the feature found broken:
 *
 *  - the handles belong to the **committed selection**, never to the
 *    marquee's rubber band. While a band is being dragged the overlay shows
 *    the band, and the handles wait for the drag to end - otherwise the
 *    handles would sit on a rectangle that is about to be replaced;
 *  - there are **no handles without a selection**, so an empty canvas never
 *    shows a frame's worth of squares.
 *
 * `frame` is the committed selection's frame, or `null` when nothing is
 * selected; `marquee` is the rubber band, or `null` when no band is being
 * dragged. `offset` is the rotation handle's distance above the frame, in
 * document units.
 */
export function visibleSelectionHandles(
  frame: Bounds | null,
  marquee: Bounds | null,
  offset: number,
): SelectionHandles | null {
  if (marquee !== null) {
    // The rubber band owns the overlay while it is being dragged.
    return null;
  }
  if (frame === null) {
    // Nothing is selected, so there is nothing to transform.
    return null;
  }
  return selectionHandles(frame, offset);
}

/**
 * The handles as they are drawn while a transform gesture runs.
 *
 * The grabbed handle **follows the pointer**, so the drag feels attached to
 * the cursor: the corner that is being pulled sits under the pointer, and
 * the rotation handle sits where the pointer is turning the selection. The
 * other handles stay where they are, because they are not what the pointer
 * is holding.
 *
 * An id that names no handle leaves the layout alone.
 */
export function handlesWithGrabbedHandle(
  handles: SelectionHandles,
  handle: SelectionHandleId,
  pointer: Point,
): SelectionHandles {
  if (handle === "rotate") {
    return { corners: handles.corners, rotate: pointer };
  }
  const index = CORNER_IDS.indexOf(handle);
  if (index < 0) {
    return handles;
  }
  const corners = [...handles.corners];
  corners[index] = pointer;
  return { corners, rotate: handles.rotate };
}

/**
 * The handle a press grabs, or `null` when it grabs none.
 *
 * The nearest handle within the grab radius wins, so a press near two
 * handles still picks the one the user aimed at. The corners are tested
 * first, in a fixed order, so the outcome never depends on the order the
 * handles happen to be listed in.
 *
 * `radius` is the grab radius in document units.
 */
export function findSelectionHandle(
  handles: SelectionHandles,
  docX: number,
  docY: number,
  radius: number,
): SelectionHandleId | null {
  let best: SelectionHandleId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < handles.corners.length; index += 1) {
    const corner = handles.corners[index];
    const distance = Math.hypot(corner.x - docX, corner.y - docY);
    if (distance <= radius && distance < bestDistance) {
      best = CORNER_IDS[index];
      bestDistance = distance;
    }
  }
  const rotateDistance = Math.hypot(handles.rotate.x - docX, handles.rotate.y - docY);
  if (rotateDistance <= radius && rotateDistance < bestDistance) {
    best = "rotate";
  }
  return best;
}

/**
 * The cursor to show at a document position, or `null` when the pointer is
 * not over a handle.
 *
 * The cursor is the cheapest way of saying what a press will do: a corner
 * handle asks for the diagonal resize cursor, the rotation handle for the
 * grab cursor. Off the handles there is nothing to say, so the caller keeps
 * the tool's own cursor.
 *
 * `radius` is the grab radius in document units, the same radius the
 * hit-test uses.
 */
export function handleCursorAt(
  handles: SelectionHandles,
  docX: number,
  docY: number,
  radius: number,
): string | null {
  const handle = findSelectionHandle(handles, docX, docY, radius);
  return handle === null ? null : HANDLE_CURSORS[handle];
}

/**
 * The corner a scale handle stands for.
 *
 * The corner's position at the moment the gesture starts is what the scale
 * is measured against, so it is looked up by name rather than by index.
 */
export function cornerOf(
  handles: SelectionHandles,
  handle: SelectionHandleId,
): Point | null {
  const index = CORNER_IDS.indexOf(handle);
  return index < 0 ? null : handles.corners[index];
}
