/**
 * The selection modes.
 *
 * These pin the model the select tool reads: the closed set of modes, the
 * rules that decide which mode a press starts in, and the geometry each mode
 * is measured with. The rules are pure, so they are pinned here rather than
 * through a pointer - and the geometry they reuse is the geometry the
 * selection transform already has, so a mode never forges a second one.
 *
 * The two invariants that matter are pinned too: a transform moves the
 * selected strokes' **samples and nothing else**, and the rotation's snap
 * breaks its tie the same way in both directions.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { copyStrokeSamples, transformStrokeSamples } from "../core/commands/strokeEditCommand";
import {
  isSelectionMode,
  marqueeGeometry,
  modeForHandle,
  moveGeometry,
  resolveSelectionMode,
  rotateGeometry,
  scaleGeometry,
  SELECTION_MODES,
  selectionGeometry,
  startsHandleMode,
  startsMarquee,
  type SelectionGestureGeometry,
  type SelectionPress,
} from "../core/document/selectionModes";
import {
  MIN_SCALE_FACTOR,
  ROTATION_SNAP_DEGREES,
  type SampleTransform,
} from "../core/document/selectionTransform";
import type { StrokeRecord } from "../core/document/types";
import type { Point } from "../types/geometry";

/** The centre of the selection's frame in these tests. */
const CENTRE: Point = { x: 50, y: 50 };
/** The north-west corner of that frame: the handle a scale pulls. */
const CORNER: Point = { x: 0, y: 0 };
/** The rotation handle's place: straight above the centre. */
const ROTATE_PRESS: Point = { x: 50, y: 0 };

const SCALE_ANCHOR = { centre: CENTRE, corner: CORNER, press: CORNER };
const ROTATE_ANCHOR = { centre: CENTRE, press: ROTATE_PRESS };

const STEP = (ROTATION_SNAP_DEGREES * Math.PI) / 180;

/** A press that found nothing, so a test only states what it cares about. */
function press(overrides: Partial<SelectionPress> = {}): SelectionPress {
  return { handle: null, insideSelection: false, ...overrides };
}

/** The pointer's place for a turn of `degrees` clockwise from "up". */
function pointerAt(degrees: number, radius = 50): Point {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: CENTRE.x + Math.sin(radians) * radius,
    y: CENTRE.y - Math.cos(radians) * radius,
  };
}

/** The scale's geometry, or a failure that says what came instead. */
function scaleOf(geometry: SelectionGestureGeometry): {
  readonly factor: number;
  readonly transform: SampleTransform;
} {
  if (geometry.mode !== "scale") {
    throw new Error(`expected a scale, got ${geometry.mode}`);
  }
  return geometry;
}

/** The rotation's geometry, or a failure that says what came instead. */
function rotateOf(geometry: SelectionGestureGeometry): {
  readonly angle: number;
  readonly transform: SampleTransform;
} {
  if (geometry.mode !== "rotate") {
    throw new Error(`expected a rotation, got ${geometry.mode}`);
  }
  return geometry;
}

let strokeCounter = 0;

function makeStroke(points: ReadonlyArray<readonly [number, number]>): StrokeRecord {
  strokeCounter += 1;
  return {
    id: `modes-stroke-${strokeCounter}`,
    layerId: "layer-1",
    brush: DEFAULT_BRUSH,
    erase: false,
    xs: points.map(([x]) => x),
    ys: points.map(([, y]) => y),
    pressures: points.map((_, index) => 0.25 + index * 0.5),
    times: points.map((_, index) => 10 + index * 10),
    startTime: 10,
  };
}

describe("the closed set of modes", () => {
  it("holds exactly the four modes a selection gesture can be in", () => {
    expect(SELECTION_MODES).toEqual(["marquee", "move", "scale", "rotate"]);
  });

  it("recognises a mode and refuses anything else", () => {
    for (const mode of SELECTION_MODES) {
      expect(isSelectionMode(mode)).toBe(true);
    }
    expect(isSelectionMode("flip")).toBe(false);
    expect(isSelectionMode("")).toBe(false);
    expect(isSelectionMode(null)).toBe(false);
    expect(isSelectionMode(undefined)).toBe(false);
    expect(isSelectionMode(3)).toBe(false);
  });
});

describe("the mode a handle resolves to", () => {
  it("scales from a corner", () => {
    expect(modeForHandle("scale-nw")).toBe("scale");
    expect(modeForHandle("scale-ne")).toBe("scale");
    expect(modeForHandle("scale-se")).toBe("scale");
    expect(modeForHandle("scale-sw")).toBe("scale");
  });

  it("rotates from the handle above the frame", () => {
    expect(modeForHandle("rotate")).toBe("rotate");
  });
});

describe("the mode a press starts in", () => {
  it("starts the handle's mode when the press grabs a handle", () => {
    expect(resolveSelectionMode(press({ handle: "scale-ne" })).mode).toBe("scale");
    expect(resolveSelectionMode(press({ handle: "rotate" })).mode).toBe("rotate");
  });

  it("carries the handle the transform is measured against", () => {
    expect(resolveSelectionMode(press({ handle: "scale-sw" }))).toEqual({
      mode: "scale",
      handle: "scale-sw",
    });
    expect(resolveSelectionMode(press({ handle: "rotate" }))).toEqual({
      mode: "rotate",
      handle: "rotate",
    });
  });

  it("starts a move when the press lands inside the selection", () => {
    expect(resolveSelectionMode(press({ insideSelection: true })).mode).toBe("move");
  });

  it("starts a marquee on empty canvas", () => {
    expect(resolveSelectionMode(press()).mode).toBe("marquee");
  });

  it("lets the handle win over the move", () => {
    // The handles sit on the frame's corners, which are inside the frame, so a
    // press on one would otherwise start a move.
    expect(resolveSelectionMode(press({ handle: "rotate", insideSelection: true })).mode).toBe(
      "rotate",
    );
  });

  it("names the two rules the press is held to", () => {
    expect(startsHandleMode(press({ handle: "scale-nw" }))).toBe(true);
    expect(startsHandleMode(press())).toBe(false);
    expect(startsMarquee(press())).toBe(true);
    expect(startsMarquee(press({ insideSelection: true }))).toBe(false);
    expect(startsMarquee(press({ handle: "scale-nw" }))).toBe(false);
  });
});

describe("the marquee's geometry", () => {
  it("is the rectangle between the press and the pointer", () => {
    expect(marqueeGeometry({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual({
      mode: "marquee",
      bounds: { x: 10, y: 20, width: 30, height: 40 },
    });
  });

  it("is a zero-size rectangle at the press, which is a click", () => {
    expect(marqueeGeometry({ x: 10, y: 20 }, { x: 10, y: 20 })).toEqual({
      mode: "marquee",
      bounds: { x: 10, y: 20, width: 0, height: 0 },
    });
  });

  it("grows the same way whichever way the pointer travels", () => {
    expect(marqueeGeometry({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual({
      mode: "marquee",
      bounds: { x: 10, y: 20, width: 30, height: 40 },
    });
  });
});

describe("the move's geometry", () => {
  it("is the delta between the press and the pointer", () => {
    expect(moveGeometry({ x: 10, y: 20 }, { x: 40, y: 5 })).toEqual({
      mode: "move",
      dx: 30,
      dy: -15,
    });
  });

  it("is nothing at the press", () => {
    expect(moveGeometry({ x: 10, y: 20 }, { x: 10, y: 20 })).toEqual({
      mode: "move",
      dx: 0,
      dy: 0,
    });
  });
});

describe("the scale's geometry", () => {
  it("asks for no scale at the press, so a missed handle does not jump", () => {
    expect(scaleGeometry(SCALE_ANCHOR, CORNER)).toMatchObject({ mode: "scale", factor: 1 });
  });

  it("grows with the pointer along the corner's ray", () => {
    // One corner-distance further out doubles the selection.
    expect(scaleGeometry(SCALE_ANCHOR, { x: -50, y: -50 })).toMatchObject({ factor: 2 });
  });

  it("shrinks as the pointer comes towards the centre", () => {
    expect(scaleGeometry(SCALE_ANCHOR, { x: 25, y: 25 })).toMatchObject({ factor: 0.5 });
  });

  it("never collapses or inverts the selection", () => {
    // Past the centre the drag asks for a negative factor, which is a mirror -
    // a flip, not a scale. The clamp refuses it and keeps the smallest size.
    const geometry = scaleOf(scaleGeometry(SCALE_ANCHOR, { x: 200, y: 200 }));
    expect(geometry.factor).toBe(MIN_SCALE_FACTOR);
    expect(geometry.factor).toBeGreaterThan(0);
  });

  it("scales about the centre and leaves the centre alone", () => {
    const geometry = scaleOf(scaleGeometry(SCALE_ANCHOR, { x: -50, y: -50 }));
    expect(geometry.transform.mapX(50, 50)).toBe(50);
    expect(geometry.transform.mapY(50, 50)).toBe(50);
    // The corner at (0, 0) is a corner-distance from the centre, so it lands
    // a corner-distance the other side.
    expect(geometry.transform.mapX(0, 0)).toBe(-50);
    expect(geometry.transform.mapY(0, 0)).toBe(-50);
  });
});

describe("the rotation's geometry", () => {
  it("asks for no turn at the press", () => {
    expect(rotateGeometry(ROTATE_ANCHOR, ROTATE_PRESS)).toMatchObject({ angle: 0 });
  });

  it("turns about the centre, clockwise like the screen", () => {
    const geometry = rotateOf(rotateGeometry(ROTATE_ANCHOR, pointerAt(90)));
    expect(geometry.angle).toBeCloseTo(Math.PI / 2, 10);
    // The handle above the centre ends up to the right of it after a quarter
    // turn: the document's y axis points down, so positive is clockwise.
    expect(geometry.transform.mapX(50, 0)).toBeCloseTo(100, 10);
    expect(geometry.transform.mapY(50, 0)).toBeCloseTo(50, 10);
  });

  it("snaps to 15 degrees while the pointer is held down", () => {
    const geometry = rotateOf(rotateGeometry(ROTATE_ANCHOR, pointerAt(10)));
    expect(geometry.angle).toBeCloseTo(STEP, 10);
    expect(rotateOf(rotateGeometry(ROTATE_ANCHOR, pointerAt(5))).angle).toBeCloseTo(0, 10);
  });

  it("keeps the free angle when the snap is turned off", () => {
    // Shift turns the snap off, so the turn follows the pointer exactly.
    const geometry = rotateOf(rotateGeometry(ROTATE_ANCHOR, pointerAt(10), { snap: false }));
    expect(geometry.angle).toBeCloseTo((10 * Math.PI) / 180, 10);
  });

  it("breaks the tie between two steps the same way in both directions", () => {
    // 7.5 degrees is exactly between two steps. The tie breaks away from zero
    // in both directions, so +7.5 lands on +15 and -7.5 on -15: the two turns
    // are mirror images. (JavaScript's own `Math.round` would send -7.5 to 0,
    // which is why the tie is broken on the magnitude and the sign is put
    // back afterwards.)
    const up = rotateOf(rotateGeometry(ROTATE_ANCHOR, pointerAt(7.5)));
    const down = rotateOf(rotateGeometry(ROTATE_ANCHOR, pointerAt(-7.5)));
    expect(up.angle).toBeCloseTo(STEP, 10);
    expect(down.angle).toBeCloseTo(-STEP, 10);
    expect(up.angle).toBeCloseTo(-down.angle, 10);
  });
});

describe("the geometry of a gesture, whichever mode it is in", () => {
  it("answers for every mode", () => {
    expect(selectionGeometry({ mode: "marquee", anchor: { x: 0, y: 0 } }, { x: 10, y: 10 }).mode).toBe(
      "marquee",
    );
    expect(selectionGeometry({ mode: "move", anchor: { x: 0, y: 0 } }, { x: 10, y: 10 }).mode).toBe(
      "move",
    );
    expect(selectionGeometry({ mode: "scale", anchor: SCALE_ANCHOR }, CORNER).mode).toBe("scale");
    expect(selectionGeometry({ mode: "rotate", anchor: ROTATE_ANCHOR }, ROTATE_PRESS).mode).toBe(
      "rotate",
    );
  });

  it("passes the snap option on to the rotation", () => {
    const pointer = pointerAt(10);
    const snapped = selectionGeometry({ mode: "rotate", anchor: ROTATE_ANCHOR }, pointer);
    const free = selectionGeometry({ mode: "rotate", anchor: ROTATE_ANCHOR }, pointer, {
      snap: false,
    });
    expect(rotateOf(snapped).angle).toBeCloseTo(STEP, 10);
    expect(rotateOf(free).angle).toBeCloseTo((10 * Math.PI) / 180, 10);
  });
});

describe("the transform is baked on apply", () => {
  it("moves the samples and nothing else", () => {
    const stroke = makeStroke([
      [10, 10],
      [20, 20],
    ]);
    const original = copyStrokeSamples(stroke);
    const geometry = scaleOf(scaleGeometry(SCALE_ANCHOR, { x: -50, y: -50 }));
    transformStrokeSamples(stroke, original, geometry.transform);
    // The samples moved about the frame's centre.
    expect(stroke.xs).toEqual([-30, -10]);
    expect(stroke.ys).toEqual([-30, -10]);
    // The brush, the pressure and the time are the stroke's own, untouched.
    expect(stroke.brush).toBe(DEFAULT_BRUSH);
    expect(stroke.pressures).toEqual([0.25, 0.75]);
    expect(stroke.times).toEqual([10, 20]);
    expect(stroke.id).toBe("modes-stroke-1");
    expect(stroke.layerId).toBe("layer-1");
  });

  it("turns the samples about the centre and nothing else", () => {
    const stroke = makeStroke([
      [50, 0],
      [50, 20],
    ]);
    const original = copyStrokeSamples(stroke);
    const geometry = rotateOf(rotateGeometry(ROTATE_ANCHOR, pointerAt(90)));
    transformStrokeSamples(stroke, original, geometry.transform);
    expect(stroke.xs[0]).toBeCloseTo(100, 10);
    expect(stroke.ys[0]).toBeCloseTo(50, 10);
    expect(stroke.pressures).toEqual([0.25, 0.75]);
    expect(stroke.brush).toBe(DEFAULT_BRUSH);
  });

  it("names the history step after the mode", () => {
    // One gesture is one step, and the step says what it was.
    expect(scaleOf(scaleGeometry(SCALE_ANCHOR, CORNER)).transform.label).toBe("Scale");
    expect(rotateOf(rotateGeometry(ROTATE_ANCHOR, ROTATE_PRESS)).transform.label).toBe("Rotate");
  });
});
