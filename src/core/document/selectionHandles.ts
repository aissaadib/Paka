/**
 * The handles a selected group of strokes offers.
 *
 * Nine handles make up the transform: four **corner** handles, four **edge**
 * handles and one **rotation** handle above the frame. They are the affordance
 * of the transform: the user grabs one of them and drags, and the selection
 * follows.
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
 * The four corners are named by the quadrant they sit in; the four edges by
 * the side they sit on; the rotation handle is named for what it does.
 */
export type SelectionHandleId =
  | "scale-nw"
  | "scale-ne"
  | "scale-se"
  | "scale-sw"
  | "scale-n"
  | "scale-e"
  | "scale-s"
  | "scale-w"
  | "rotate";

/**
 * What a handle does when it is dragged.
 *
 * The three kinds are the three transforms the selection offers, and each one
 * has its own geometry (see `core/document/selectionTransform.ts`):
 *
 *  - a **corner** scales the selection, uniformly by default;
 *  - an **edge** scales one axis of the selection, freely by default;
 *  - the **rotation** handle turns the selection about its frame's centre.
 */
export type SelectionHandleKind = "corner" | "edge" | "rotate";

/** The handles of a selection, in document space. */
export interface SelectionHandles {
  /**
   * The four corner handles, in the order north-west, north-east,
   * south-east, south-west.
   */
  readonly corners: readonly Point[];
  /**
   * The four edge handles, in the order north, east, south, west.
   *
   * An edge handle sits at the **middle** of its side, so it never competes
   * with the corner handles for the same press.
   */
  readonly edges: readonly Point[];
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
 * How far, in screen pixels, the side handles sit outside the frame.
 *
 * The side handles are **outside** the frame, not on its edges, and that is a
 * deliberate choice: a handle on the edge would sit inside the frame, where
 * a press moves the content. A thin selection - a single horizontal stroke -
 * would then be impossible to move by its middle, because the handle above
 * it would take the press. Outside the frame the two gestures never
 * compete, exactly as the rotation handle already does.
 *
 * The distance is **larger than the grab radius** on purpose: a press inside
 * the frame is then never close enough to a side handle to grab it, so the
 * interior of the frame is always a move.
 */
export const EDGE_HANDLE_OFFSET_PX = 12;

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
 * says which way the corner will drag; the edge cursors are the horizontal
 * and vertical resize cursors, which say the same for a side. The rotation
 * handle gets a grab cursor, which is the usual "this thing turns" hint.
 */
export const HANDLE_CURSORS: Record<SelectionHandleId, string> = {
  "scale-nw": "nwse-resize",
  "scale-ne": "nesw-resize",
  "scale-se": "nwse-resize",
  "scale-sw": "nesw-resize",
  "scale-n": "ns-resize",
  "scale-e": "ew-resize",
  "scale-s": "ns-resize",
  "scale-w": "ew-resize",
  rotate: "grab",
};

/**
 * The cursor shown over the selection's frame, away from any handle.
 *
 * A press there moves the selection, so the pointer says so: the four-way
 * move arrow. It is the same affordance a drag of the content itself has.
 */
export const MOVE_CURSOR = "move";

/** The corner handles, in the order the layout lists them. */
export const CORNER_HANDLE_IDS: readonly SelectionHandleId[] = [
  "scale-nw",
  "scale-ne",
  "scale-se",
  "scale-sw",
];

/** The edge handles, in the order the layout lists them. */
export const EDGE_HANDLE_IDS: readonly SelectionHandleId[] = [
  "scale-n",
  "scale-e",
  "scale-s",
  "scale-w",
];

/** Which axis an edge handle pulls along. */
export type ScaleAxis = "x" | "y";

/** Which end of that axis the handle sits on. */
export type ScaleSide = "start" | "end";

/**
 * What a handle does, by name.
 */
export function handleKind(handle: SelectionHandleId): SelectionHandleKind {
  if (handle === "rotate") {
    return "rotate";
  }
  return CORNER_HANDLE_IDS.includes(handle) ? "corner" : "edge";
}

/**
 * The axis and the end an edge handle pulls, or `null` for another kind.
 *
 * The axis is the one the handle moves the frame along; the end is the side
 * of the frame it sits on, which is the side the opposite edge is measured
 * against.
 */
export function edgeAxis(handle: SelectionHandleId): {
  readonly axis: ScaleAxis;
  readonly side: ScaleSide;
} | null {
  switch (handle) {
    case "scale-n":
      return { axis: "y", side: "start" };
    case "scale-e":
      return { axis: "x", side: "end" };
    case "scale-s":
      return { axis: "y", side: "end" };
    case "scale-w":
      return { axis: "x", side: "start" };
    default:
      return null;
  }
}

/**
 * The handles of a frame, or `null` when the frame has no area.
 *
 * A frame with no width *and* no height is a single point; there is no
 * corner to pull and no direction to scale along, so there are no handles.
 *
 * `offset` is the distance from the frame's top edge to the rotation handle
 * and `edgeOffset` the distance the side handles sit outside the frame, both
 * in **document units**. The caller converts them from screen pixels with the
 * live zoom, so the handles keep their distance on screen at any zoom - which
 * is why neither has a default here: a screen-pixel constant is not a
 * document-unit one.
 */
export function selectionHandles(
  bounds: Bounds,
  offset: number,
  edgeOffset: number,
): SelectionHandles | null {
  if (bounds.width <= 0 && bounds.height <= 0) {
    return null;
  }
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;
  return {
    corners: [
      { x: bounds.x, y: bounds.y },
      { x: right, y: bounds.y },
      { x: right, y: bottom },
      { x: bounds.x, y: bottom },
    ],
    edges: [
      { x: midX, y: bounds.y - edgeOffset },
      { x: right + edgeOffset, y: midY },
      { x: midX, y: bottom + edgeOffset },
      { x: bounds.x - edgeOffset, y: midY },
    ],
    rotate: { x: midX, y: bounds.y - offset },
  };
}

/**
 * The handle a press grabs, or `null` when it grabs none.
 *
 * The nearest handle within the grab radius wins, so a press near two
 * handles still picks the one the user aimed at. The corners are tested
 * first, then the edges, then the rotation handle, and a later handle only
 * wins by being *strictly* nearer - so the outcome never depends on the
 * order the handles happen to be listed in.
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
  const consider = (id: SelectionHandleId, point: Point): void => {
    const distance = Math.hypot(point.x - docX, point.y - docY);
    if (distance <= radius && distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  };
  for (let index = 0; index < handles.corners.length; index += 1) {
    consider(CORNER_HANDLE_IDS[index], handles.corners[index]);
  }
  for (let index = 0; index < handles.edges.length; index += 1) {
    consider(EDGE_HANDLE_IDS[index], handles.edges[index]);
  }
  consider("rotate", handles.rotate);
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
  const index = CORNER_HANDLE_IDS.indexOf(handle);
  return index < 0 ? null : handles.corners[index];
}
