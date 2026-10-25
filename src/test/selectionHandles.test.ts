/**
 * The transform handles.
 *
 * These pin where the handles sit, when they are shown, what a press grabs
 * and what the overlay does while a transform runs. The handles are the
 * affordance of a scale and a rotation, so their geometry has to be exact:
 * the corners are the frame's corners, the rotation handle is on the ray
 * straight up from the frame's centre, and a press grabs the *nearest*
 * handle within the grab radius and nothing else.
 *
 * The last block pins the three defects the first review of the feature
 * found. They are kept here as regressions because each of them is a
 * property of the handles *and* the gesture they drive, not of one
 * function:
 *
 *  - the handles were painted on the **marquee's rubber band**, and they
 *    appeared with **nothing selected**;
 *  - the transform was **absolute** rather than relative to the grab point,
 *    so a press 6 px off the rotation handle moved the ink by 27 document
 *    pixels before the user had moved anything;
 *  - the 15 degree snap **tie-broke asymmetrically** - +7.5 degrees snapped
 *    to +15 while -7.5 degrees snapped to 0 - so a turn and its
 *    counter-clockwise twin landed on different angles.
 *
 * The geometry the handles drive is not re-derived here: the frame, the
 * scale and the rotation live in `selectionTransform.ts`, and these tests
 * compose the two pure modules rather than forking them.
 */

import { describe, expect, it } from "vitest";
import {
  cornerOf,
  findSelectionHandle,
  handleCursorAt,
  handleGrabRadius,
  handlesWithGrabbedHandle,
  HANDLE_CURSORS,
  HANDLE_GRAB_RADIUS_PX,
  ROTATION_HANDLE_OFFSET_PX,
  rotationHandleOffset,
  selectionHandles,
  visibleSelectionHandles,
  type SelectionHandleId,
  type SelectionHandles,
} from "../core/document/selectionHandles";
import {
  boundsCentre,
  rotateAboutCentre,
  rotationAngleFor,
  rotationAngleFrom,
  ROTATION_SNAP_DEGREES,
  scaleFactorFor,
  scaleFactorFrom,
  snapRotationAngle,
} from "../core/document/selectionTransform";
import type { Bounds, Point } from "../types/geometry";

const FRAME: Bounds = { x: 10, y: 20, width: 100, height: 40 };
/** The rotation handle sits this far above the frame, in document units. */
const OFFSET = 24;

function handles(): SelectionHandles {
  const layout = selectionHandles(FRAME, OFFSET);
  if (!layout) {
    throw new Error("the frame has handles");
  }
  return layout;
}

describe("the handle layout", () => {
  it("puts a corner on each corner of the frame", () => {
    expect(handles().corners).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 60 },
      { x: 10, y: 60 },
    ]);
  });

  it("puts the rotation handle above the frame, on the centre's ray", () => {
    expect(handles().rotate).toEqual({ x: 60, y: 20 - OFFSET });
  });

  it("has no handles for a frame with no area", () => {
    expect(selectionHandles({ x: 5, y: 5, width: 0, height: 0 }, OFFSET)).toBeNull();
  });

  it("has handles for a frame that is only wide", () => {
    const layout = selectionHandles({ x: 5, y: 5, width: 10, height: 0 }, OFFSET);
    expect(layout).not.toBeNull();
    expect(layout?.corners).toHaveLength(4);
  });

  it("names the corner a scale handle stands for", () => {
    const layout = handles();
    expect(cornerOf(layout, "scale-nw")).toEqual({ x: 10, y: 20 });
    expect(cornerOf(layout, "scale-ne")).toEqual({ x: 110, y: 20 });
    expect(cornerOf(layout, "scale-se")).toEqual({ x: 110, y: 60 });
    expect(cornerOf(layout, "scale-sw")).toEqual({ x: 10, y: 60 });
    expect(cornerOf(layout, "rotate")).toBeNull();
  });

  it("refuses a frame that is not a number", () => {
    // A frame that is not a number would put the handles nowhere; an
    // overlay that lies about where the selection is is worse than none.
    expect(selectionHandles({ x: Number.NaN, y: 20, width: 100, height: 40 }, OFFSET)).toBeNull();
    expect(
      selectionHandles({ x: 10, y: 20, width: Number.POSITIVE_INFINITY, height: 40 }, OFFSET),
    ).toBeNull();
  });

  it("refuses a frame that is the wrong way round", () => {
    expect(selectionHandles({ x: 10, y: 20, width: -100, height: 40 }, OFFSET)).toBeNull();
    expect(selectionHandles({ x: 10, y: 20, width: 100, height: -40 }, OFFSET)).toBeNull();
  });

  it("refuses a distance that is not a number", () => {
    expect(selectionHandles(FRAME, Number.NaN)).toBeNull();
    expect(selectionHandles(FRAME, -1)).toBeNull();
  });

  it("leaves the frame it was given alone", () => {
    // The overlay reads the document; it never writes to it.
    const frame: Bounds = { x: 10, y: 20, width: 100, height: 40 };
    selectionHandles(frame, OFFSET);
    expect(frame).toEqual({ x: 10, y: 20, width: 100, height: 40 });
  });
});

describe("when the handles are shown", () => {
  it("shows the handles of a real selection", () => {
    const layout = visibleSelectionHandles(FRAME, null, OFFSET);
    expect(layout?.corners).toEqual(handles().corners);
    expect(layout?.rotate).toEqual(handles().rotate);
  });

  it("shows no handles with nothing selected", () => {
    expect(visibleSelectionHandles(null, null, OFFSET)).toBeNull();
  });

  it("shows no handles on the marquee's rubber band", () => {
    // The band owns the overlay while it is being dragged: the handles
    // belong to the committed selection, never to a rectangle that is about
    // to be replaced.
    const band: Bounds = { x: 0, y: 0, width: 30, height: 30 };
    expect(visibleSelectionHandles(FRAME, band, OFFSET)).toBeNull();
  });

  it("shows no handles for a frame with no area", () => {
    expect(visibleSelectionHandles({ x: 5, y: 5, width: 0, height: 0 }, null, OFFSET)).toBeNull();
  });
});

describe("the grabbed handle follows the pointer", () => {
  it("moves the grabbed corner and leaves the others alone", () => {
    const layout = handles();
    const pointer: Point = { x: 130, y: 40 };
    const dragged = handlesWithGrabbedHandle(layout, "scale-se", pointer);
    expect(dragged.corners[2]).toEqual(pointer);
    expect(dragged.corners[0]).toEqual(layout.corners[0]);
    expect(dragged.corners[1]).toEqual(layout.corners[1]);
    expect(dragged.corners[3]).toEqual(layout.corners[3]);
    expect(dragged.rotate).toEqual(layout.rotate);
  });

  it("moves the rotation handle and leaves the corners alone", () => {
    const layout = handles();
    const pointer: Point = { x: 90, y: -30 };
    const dragged = handlesWithGrabbedHandle(layout, "rotate", pointer);
    expect(dragged.rotate).toEqual(pointer);
    expect(dragged.corners).toEqual(layout.corners);
  });

  it("leaves the layout alone for an id that names no handle", () => {
    const layout = handles();
    const dragged = handlesWithGrabbedHandle(layout, "scale-nw-east" as SelectionHandleId, {
      x: 0,
      y: 0,
    });
    expect(dragged).toBe(layout);
  });
});

describe("the grab radius and the rotation handle's distance", () => {
  it("are screen distances, so they shrink as the zoom grows", () => {
    expect(handleGrabRadius(1)).toBe(HANDLE_GRAB_RADIUS_PX);
    expect(handleGrabRadius(4)).toBe(HANDLE_GRAB_RADIUS_PX / 4);
    expect(rotationHandleOffset(1)).toBe(ROTATION_HANDLE_OFFSET_PX);
    expect(rotationHandleOffset(4)).toBe(ROTATION_HANDLE_OFFSET_PX / 4);
  });

  it("fall back to the screen distance when the zoom is not a number", () => {
    expect(handleGrabRadius(0)).toBe(HANDLE_GRAB_RADIUS_PX);
    expect(handleGrabRadius(Number.NaN)).toBe(HANDLE_GRAB_RADIUS_PX);
    expect(rotationHandleOffset(-1)).toBe(ROTATION_HANDLE_OFFSET_PX);
    expect(rotationHandleOffset(Number.NaN)).toBe(ROTATION_HANDLE_OFFSET_PX);
  });

  it("keeps the same ten pixels around a handle at any zoom", () => {
    const layout = selectionHandles(FRAME, rotationHandleOffset(4)) as SelectionHandles;
    // Four times the zoom, a quarter of the document distance: the press is
    // still ten screen pixels wide.
    expect(findSelectionHandle(layout, 12.5, 20, handleGrabRadius(4))).toBe("scale-nw");
    expect(findSelectionHandle(layout, 13, 20, handleGrabRadius(4))).toBeNull();
  });

  it("keeps the rotation handle the same distance above the frame", () => {
    const layout = selectionHandles(FRAME, rotationHandleOffset(4));
    // Six document pixels above the frame is twenty-four screen pixels.
    expect(layout?.rotate).toEqual({ x: 60, y: 14 });
  });
});

describe("the cursor under the pointer", () => {
  it("asks for the diagonal resize cursor on a corner", () => {
    const layout = handles();
    expect(handleCursorAt(layout, 10, 20, 5)).toBe("nwse-resize");
    expect(handleCursorAt(layout, 110, 20, 5)).toBe("nesw-resize");
    expect(handleCursorAt(layout, 110, 60, 5)).toBe("nwse-resize");
    expect(handleCursorAt(layout, 10, 60, 5)).toBe("nesw-resize");
  });

  it("asks for the grab cursor on the rotation handle", () => {
    expect(handleCursorAt(handles(), 60, 20 - OFFSET, 5)).toBe("grab");
  });

  it("says nothing away from the handles", () => {
    expect(handleCursorAt(handles(), 200, 200, 5)).toBeNull();
  });

  it("names a cursor for every handle", () => {
    expect(Object.keys(HANDLE_CURSORS).sort()).toEqual([
      "rotate",
      "scale-ne",
      "scale-nw",
      "scale-se",
      "scale-sw",
    ]);
  });
});

describe("grabbing a handle", () => {
  it("grabs the corner under the pointer", () => {
    const layout = handles();
    expect(findSelectionHandle(layout, 10, 20, 5)).toBe("scale-nw");
    expect(findSelectionHandle(layout, 110, 60, 5)).toBe("scale-se");
  });

  it("grabs the rotation handle", () => {
    expect(findSelectionHandle(handles(), 60, 20 - OFFSET, 5)).toBe("rotate");
  });

  it("grabs nothing outside the radius", () => {
    const layout = handles();
    // A hair away from the corner is still a miss.
    expect(findSelectionHandle(layout, 11, 21, 0.5)).toBeNull();
    expect(findSelectionHandle(layout, 200, 200, 5)).toBeNull();
  });

  it("grabs a corner the pointer is exactly on", () => {
    expect(findSelectionHandle(handles(), 10, 20, 0)).toBe("scale-nw");
  });

  it("takes the nearest handle when two are close", () => {
    const layout = handles();
    // Just inside the north-west corner, but nearer the north-east one.
    expect(findSelectionHandle(layout, 20, 20, 100)).toBe("scale-nw");
    expect(findSelectionHandle(layout, 100, 20, 100)).toBe("scale-ne");
  });

  it("uses a radius in document units, so the caller decides the zoom", () => {
    const layout = handles();
    // Ten screen pixels at half zoom is five document pixels.
    expect(findSelectionHandle(layout, 14, 20, HANDLE_GRAB_RADIUS_PX / 2)).toBe("scale-nw");
    expect(findSelectionHandle(layout, 16, 20, HANDLE_GRAB_RADIUS_PX / 2)).toBeNull();
  });
});

describe("the three defects the first review found", () => {
  /**
   * A wide, flat selection: its frame's top edge runs through the centre,
   * so the rotation handle sits exactly 24 document pixels above the
   * centre - the closest it can ever sit.
   */
  const FLAT: Bounds = { x: -110, y: 0, width: 220, height: 0 };
  const CENTRE: Point = { x: 0, y: 0 };
  /** The ink at the frame's far end: 110 document pixels from the centre. */
  const INK: Point = { x: 110, y: 0 };

  /** A point at a compass angle (clockwise from up) and a radius. */
  function polar(radius: number, degrees: number): Point {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: CENTRE.x + radius * Math.sin(radians),
      y: CENTRE.y - radius * Math.cos(radians),
    };
  }

  it("puts the handles on the committed selection, never on the rubber band", () => {
    const band: Bounds = { x: -20, y: -20, width: 40, height: 40 };
    // The band owns the overlay while it is dragged, so the handles wait.
    expect(visibleSelectionHandles(FLAT, band, ROTATION_HANDLE_OFFSET_PX)).toBeNull();
    // And with nothing selected there is nothing to transform.
    expect(visibleSelectionHandles(null, null, ROTATION_HANDLE_OFFSET_PX)).toBeNull();
  });

  it("grabs the rotation handle when the press misses it by six pixels", () => {
    const layout = selectionHandles(FLAT, ROTATION_HANDLE_OFFSET_PX) as SelectionHandles;
    const press = { x: layout.rotate.x + 6, y: layout.rotate.y };
    expect(findSelectionHandle(layout, press.x, press.y, HANDLE_GRAB_RADIUS_PX)).toBe("rotate");
  });

  it("does not move the ink at a press that missed the rotation handle", () => {
    const layout = selectionHandles(FLAT, ROTATION_HANDLE_OFFSET_PX) as SelectionHandles;
    const press = { x: layout.rotate.x + 6, y: layout.rotate.y };
    expect(boundsCentre(FLAT)).toEqual(CENTRE);

    // The turn since the press is nothing, so the ink has not moved.
    const turn = rotationAngleFrom(CENTRE, press, press);
    expect(turn).toBeCloseTo(0, 10);
    const moved = rotateAboutCentre(INK, CENTRE, turn);
    expect(moved.x).toBeCloseTo(INK.x, 10);
    expect(moved.y).toBeCloseTo(INK.y, 10);

    // The absolute reading - what the review called the bug - turned the
    // selection by the press's own angle and threw the ink 27 document
    // pixels across the canvas before the user had moved anything.
    const absolute = rotateAboutCentre(INK, CENTRE, rotationAngleFor(CENTRE, press));
    const thrown = Math.hypot(absolute.x - INK.x, absolute.y - INK.y);
    expect(thrown).toBeCloseTo(27, 0);
  });

  it("turns the content by the pointer's change since the press", () => {
    const layout = selectionHandles(FLAT, ROTATION_HANDLE_OFFSET_PX) as SelectionHandles;
    const pressOn = layout.rotate;
    const pressOff = { x: pressOn.x + 6, y: pressOn.y };
    const twenty = (20 * Math.PI) / 180;

    // Twenty degrees further round the circle than the press was, from a
    // press on the handle and from a press six pixels beside it.
    const radiusOn = Math.hypot(pressOn.x - CENTRE.x, pressOn.y - CENTRE.y);
    const radiusOff = Math.hypot(pressOff.x - CENTRE.x, pressOff.y - CENTRE.y);
    const angleOn = (rotationAngleFor(CENTRE, pressOn) * 180) / Math.PI;
    const angleOff = (rotationAngleFor(CENTRE, pressOff) * 180) / Math.PI;

    expect(
      rotationAngleFrom(CENTRE, pressOn, polar(radiusOn, angleOn + 20)),
    ).toBeCloseTo(twenty, 10);
    expect(
      rotationAngleFrom(CENTRE, pressOff, polar(radiusOff, angleOff + 20)),
    ).toBeCloseTo(twenty, 10);
  });

  it("does not shrink the selection at a press that missed a corner", () => {
    const layout = selectionHandles(FLAT, ROTATION_HANDLE_OFFSET_PX) as SelectionHandles;
    const corner = cornerOf(layout, "scale-ne") as Point;
    // Six pixels short of the corner, along the ray from the centre.
    const reach = Math.hypot(corner.x - CENTRE.x, corner.y - CENTRE.y);
    const press = {
      x: corner.x - (6 * (corner.x - CENTRE.x)) / reach,
      y: corner.y - (6 * (corner.y - CENTRE.y)) / reach,
    };

    // At the press the size has not changed at all.
    expect(scaleFactorFrom(CENTRE, corner, press, press)).toBeCloseTo(1, 10);
    // The absolute reading would have shrunk the selection by six per cent
    // the moment the pointer went down.
    expect(scaleFactorFor(CENTRE, corner, press)).toBeLessThan(0.95);
  });

  it("breaks the fifteen degree tie the same way in both directions", () => {
    const half = (ROTATION_SNAP_DEGREES * Math.PI) / 180 / 2;
    // Seven and a half degrees is exactly between two steps. The first
    // review found the tie breaking one way and not the other - +7.5
    // degrees snapped to +15 while -7.5 degrees snapped to 0 - so a turn
    // and its counter-clockwise twin landed on different angles. The tie
    // breaks away from zero now, so the two directions are mirror images.
    expect(snapRotationAngle(half)).toBeCloseTo(2 * half, 10);
    expect(snapRotationAngle(-half)).toBeCloseTo(-2 * half, 10);
  });

  it("snaps a turn the same way clockwise and counter-clockwise", () => {
    const layout = selectionHandles(FLAT, ROTATION_HANDLE_OFFSET_PX) as SelectionHandles;
    const press = layout.rotate;
    const radius = Math.hypot(press.x - CENTRE.x, press.y - CENTRE.y);
    const sevenAndAHalf = 7.5;

    const clockwise = rotationAngleFrom(CENTRE, press, polar(radius, sevenAndAHalf));
    const anticlockwise = rotationAngleFrom(CENTRE, press, polar(radius, -sevenAndAHalf));

    expect(snapRotationAngle(clockwise)).toBeCloseTo((15 * Math.PI) / 180, 10);
    expect(snapRotationAngle(anticlockwise)).toBeCloseTo((-15 * Math.PI) / 180, 10);
  });
});
