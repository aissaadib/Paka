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
 * that has to be provable, so it is unit tested away from a browser.
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
 * The handles of a frame, or `null` when the frame has no area.
 *
 * A frame with no width *and* no height is a single point; there is no
 * corner to pull and no direction to scale along, so there are no handles.
 *
 * `offset` is the distance from the frame's top edge to the rotation handle,
 * in document units. The caller converts it from screen pixels with the
 * live zoom, so the handle keeps its distance on screen at any zoom.
 */
export function selectionHandles(bounds: Bounds, offset: number): SelectionHandles | null {
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
  const ids: SelectionHandleId[] = ["scale-nw", "scale-ne", "scale-se", "scale-sw"];
  let best: SelectionHandleId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < handles.corners.length; index += 1) {
    const corner = handles.corners[index];
    const distance = Math.hypot(corner.x - docX, corner.y - docY);
    if (distance <= radius && distance < bestDistance) {
      best = ids[index];
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
 * The corner a scale handle stands for.
 *
 * The corner's position at the moment the gesture starts is what the scale
 * is measured against, so it is looked up by name rather than by index.
 */
export function cornerOf(
  handles: SelectionHandles,
  handle: SelectionHandleId,
): Point | null {
  const ids: SelectionHandleId[] = ["scale-nw", "scale-ne", "scale-se", "scale-sw"];
  const index = ids.indexOf(handle);
  return index < 0 ? null : handles.corners[index];
}
