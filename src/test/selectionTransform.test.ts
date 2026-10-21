/**
 * The transform geometry.
 *
 * These pin the rules a scale and a rotation are made of: where the centre is,
 * what a factor means, where the clamps are, how the angle snap works and what
 * the selection's frame becomes afterwards. The rules live in a pure module
 * precisely so they can be pinned here, away from a canvas and a pointer.
 *
 * The frame rule is in here too, because the frame is what a transform is
 * *about*: the centre of the frame is the point the content grows or turns
 * around, and the frame after a transform is what the overlay shows.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  boundsCentre,
  clampScaleFactor,
  createRotateTransform,
  createScaleTransform,
  MIN_SCALE_FACTOR,
  normalizeAngle,
  rotateAboutCentre,
  ROTATION_SNAP_DEGREES,
  rotationAngleFor,
  rotationAngleFrom,
  scaleAboutCentre,
  scaleFactorFor,
  scaleFactorFrom,
  selectionFrame,
  snapRotationAngle,
  type SampleTransform,
} from "../core/document/selectionTransform";
import type { StrokeRecord } from "../core/document/types";
import type { Bounds, Point } from "../types/geometry";

const CENTRE: Point = { x: 0, y: 0 };
const STEP = (ROTATION_SNAP_DEGREES * Math.PI) / 180;

let strokeCounter = 0;

function stroke(points: ReadonlyArray<readonly [number, number]>): StrokeRecord {
  strokeCounter += 1;
  return {
    id: `transform-stroke-${strokeCounter}`,
    layerId: "layer-1",
    brush: DEFAULT_BRUSH,
    erase: false,
    xs: points.map(([x]) => x),
    ys: points.map(([, y]) => y),
    pressures: points.map(() => 1),
    times: points.map(() => 0),
    startTime: 0,
  };
}

/** A copy of a stroke with the transform written over its samples. */
function transformed(original: StrokeRecord, transform: SampleTransform): StrokeRecord {
  return {
    ...original,
    xs: original.xs.map((x, index) => transform.mapX(x, original.ys[index])),
    ys: original.ys.map((y, index) => transform.mapY(original.xs[index], y)),
  };
}

describe("the scale about a centre", () => {
  it("moves a point along the ray from the centre", () => {
    expect(scaleAboutCentre({ x: 10, y: 4 }, CENTRE, 2)).toEqual({ x: 20, y: 8 });
    expect(scaleAboutCentre({ x: 10, y: 4 }, { x: 5, y: 5 }, 0.5)).toEqual({ x: 7.5, y: 4.5 });
  });

  it("leaves the centre where it is", () => {
    expect(scaleAboutCentre({ x: 5, y: 5 }, { x: 5, y: 5 }, 3)).toEqual({ x: 5, y: 5 });
  });

  it("maps a sample through the transform", () => {
    const transform = createScaleTransform({ x: 10, y: 10 }, 2);
    expect(transform.mapX(20, 20)).toBe(30);
    expect(transform.mapY(20, 20)).toBe(30);
  });

  it("is uniform: the same factor on both axes", () => {
    const transform = createScaleTransform(CENTRE, 3);
    expect(transform.mapX(7, 100)).toBe(21);
    expect(transform.mapY(100, 7)).toBe(21);
  });
});

describe("the rotation about a centre", () => {
  it("turns the way the screen does", () => {
    // A point straight above the centre ends up to the right of it after a
    // quarter turn: the document's y axis points down, so positive is
    // clockwise.
    const turned = rotateAboutCentre({ x: 0, y: -10 }, CENTRE, Math.PI / 2);
    expect(turned.x).toBeCloseTo(10, 10);
    expect(turned.y).toBeCloseTo(0, 10);
  });

  it("leaves the centre where it is", () => {
    const turned = rotateAboutCentre({ x: 3, y: 3 }, { x: 3, y: 3 }, 1.2);
    expect(turned.x).toBeCloseTo(3, 10);
    expect(turned.y).toBeCloseTo(3, 10);
  });

  it("keeps the distance from the centre", () => {
    const point = { x: 3, y: -7 };
    const turned = rotateAboutCentre(point, { x: 1, y: 2 }, 0.9);
    expect(Math.hypot(turned.x - 1, turned.y - 2)).toBeCloseTo(
      Math.hypot(point.x - 1, point.y - 2),
      10,
    );
  });

  it("turns a full circle back to where it was", () => {
    const point = { x: 3, y: -7 };
    const turned = rotateAboutCentre(point, { x: 1, y: 2 }, Math.PI * 2);
    expect(turned.x).toBeCloseTo(point.x, 10);
    expect(turned.y).toBeCloseTo(point.y, 10);
  });

  it("maps a sample through the transform", () => {
    const transform = createRotateTransform(CENTRE, Math.PI / 2);
    expect(transform.mapX(0, -10)).toBeCloseTo(10, 10);
    expect(transform.mapY(0, -10)).toBeCloseTo(0, 10);
  });
});

describe("the clamps", () => {
  it("refuses to collapse or invert the selection", () => {
    expect(clampScaleFactor(0)).toBe(MIN_SCALE_FACTOR);
    expect(clampScaleFactor(0.001)).toBe(MIN_SCALE_FACTOR);
    expect(clampScaleFactor(-2)).toBe(MIN_SCALE_FACTOR);
  });

  it("leaves a selection that is not a number where it is", () => {
    // A factor that is not a number cannot come from the UI, so the safe
    // answer is the identity: the selection does not move at all.
    expect(clampScaleFactor(Number.NaN)).toBe(1);
    expect(clampScaleFactor(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampScaleFactor(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it("leaves a scale that is big enough alone", () => {
    expect(clampScaleFactor(1)).toBe(1);
    expect(clampScaleFactor(3.5)).toBe(3.5);
  });

  it("clamps the map, not only the number", () => {
    const transform = createScaleTransform(CENTRE, -1);
    expect(transform.mapX(10, 0)).toBeCloseTo(MIN_SCALE_FACTOR * 10, 10);
  });

  it("leaves the map alone when the factor is not a number", () => {
    const transform = createScaleTransform(CENTRE, Number.NaN);
    expect(transform.mapX(10, 0)).toBe(10);
    expect(transform.mapY(0, 10)).toBe(10);
  });
});

describe("the factor a pointer asks for", () => {
  const corner: Point = { x: 10, y: 10 };

  it("measures the pointer along the corner's own direction", () => {
    expect(scaleFactorFor(CENTRE, corner, { x: 20, y: 20 })).toBeCloseTo(2, 10);
    expect(scaleFactorFor(CENTRE, corner, { x: 5, y: 5 })).toBeCloseTo(0.5, 10);
  });

  it("ignores a drag across the diagonal", () => {
    // (20, 0) is the corner's own distance along the diagonal, so the size
    // does not change: only the direction the pointer moved in did.
    expect(scaleFactorFor(CENTRE, corner, { x: 20, y: 0 })).toBeCloseTo(1, 10);
  });

  it("asks for a negative scale past the centre, which the clamp refuses", () => {
    const factor = scaleFactorFor(CENTRE, corner, { x: -5, y: -5 });
    expect(factor).toBeCloseTo(-0.5, 10);
    expect(clampScaleFactor(factor)).toBe(MIN_SCALE_FACTOR);
  });

  it("asks for no change when the corner sits on the centre", () => {
    expect(scaleFactorFor(CENTRE, CENTRE, { x: 5, y: 5 })).toBe(1);
  });
});

describe("the angle a pointer asks for", () => {
  it("is zero when the pointer is straight above the centre", () => {
    expect(rotationAngleFor(CENTRE, { x: 0, y: -10 })).toBeCloseTo(0, 10);
  });

  it("grows clockwise", () => {
    expect(rotationAngleFor(CENTRE, { x: 10, y: 0 })).toBeCloseTo(Math.PI / 2, 10);
    expect(rotationAngleFor(CENTRE, { x: 0, y: 10 })).toBeCloseTo(Math.PI, 10);
    expect(rotationAngleFor(CENTRE, { x: -10, y: 0 })).toBeCloseTo(-Math.PI / 2, 10);
  });
});

describe("the angle snap", () => {
  it("snaps to the nearest 15 degrees", () => {
    expect(snapRotationAngle(0)).toBe(0);
    expect(snapRotationAngle(STEP * 0.4)).toBeCloseTo(0, 10);
    expect(snapRotationAngle(STEP * 0.6)).toBeCloseTo(STEP, 10);
    expect(snapRotationAngle(STEP * 7.5)).toBeCloseTo(STEP * 8, 10);
  });

  it("snaps a negative angle the same way", () => {
    expect(snapRotationAngle(-STEP * 0.6)).toBeCloseTo(-STEP, 10);
  });

  it("breaks a tie the same way in both directions", () => {
    // 7.5 degrees is exactly between two steps. Clockwise and
    // counter-clockwise must land on the same distance from the middle, or a
    // turn and its twin would end up at different angles.
    expect(snapRotationAngle(STEP * 0.5)).toBeCloseTo(STEP, 10);
    expect(snapRotationAngle(-STEP * 0.5)).toBeCloseTo(-STEP, 10);
    expect(snapRotationAngle(STEP * 7.5)).toBeCloseTo(STEP * 8, 10);
    expect(snapRotationAngle(-STEP * 7.5)).toBeCloseTo(-STEP * 8, 10);
  });

  it("snaps a quarter turn exactly", () => {
    expect(snapRotationAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe("the drag measured from the press", () => {
  const corner: Point = { x: 100, y: 100 };

  it("asks for no change where the press landed", () => {
    const press = { x: 8, y: 8 };
    expect(scaleFactorFrom(CENTRE, corner, press, press)).toBeCloseTo(1, 10);
    expect(rotationAngleFrom(CENTRE, press, press)).toBeCloseTo(0, 10);
  });

  it("does not jump when the press missed the handle", () => {
    // The press is four pixels short of the corner along the ray, still
    // inside the grab radius. The absolute rule asks for 0.96 there, and
    // reading it would shrink the content by 4 % before the user has moved.
    const press = { x: 96, y: 96 };
    expect(scaleFactorFor(CENTRE, corner, press)).toBeCloseTo(0.96, 10);
    // At the press the content has not moved at all.
    expect(scaleFactorFrom(CENTRE, corner, press, press)).toBeCloseTo(1, 10);
    // One pixel further along the ray changes the size by one part in a
    // hundred - the same rate the absolute rule has.
    const moved = scaleFactorFrom(CENTRE, corner, press, { x: 97, y: 97 });
    expect(moved).toBeCloseTo(1.01, 10);
  });

  it("grows by the corner's own distance, as the absolute rule does", () => {
    // A press exactly on the corner: dragging one corner-distance further out
    // doubles the size.
    const factor = scaleFactorFrom(CENTRE, corner, corner, { x: 200, y: 200 });
    expect(factor).toBeCloseTo(2, 10);
  });

  it("turns by the change since the press", () => {
    const press = { x: 0, y: -10 };
    // A quarter turn clockwise from where the press landed.
    const turn = rotationAngleFrom(CENTRE, press, { x: 10, y: 0 });
    expect(turn).toBeCloseTo(Math.PI / 2, 10);
  });

  it("takes the shortest way round", () => {
    // Just left of "up" to just right of it is a couple of degrees, not 358.
    const turn = rotationAngleFrom(CENTRE, { x: -0.1, y: -10 }, { x: 0.1, y: -10 });
    expect(turn).toBeCloseTo(2 * Math.atan(0.01), 10);
  });
});

describe("the angle wrap", () => {
  it("keeps an angle in (-π, π]", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 10);
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 10);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(Math.PI, 10);
    expect(normalizeAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 10);
    expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe("the selection's frame", () => {
  const padding = 1;

  it("is the union of the samples, widened by the paint", () => {
    const frame = selectionFrame([stroke([[0, 0], [10, 0]])], () => padding);
    expect(frame).toEqual({ x: -1, y: -1, width: 12, height: 2 });
  });

  it("has no frame without samples", () => {
    expect(selectionFrame([stroke([])], () => padding)).toBeNull();
    expect(selectionFrame([], () => padding)).toBeNull();
  });

  it("takes the centre the transform is about", () => {
    const frame = selectionFrame([stroke([[0, 0], [10, 0]])], () => padding);
    expect(boundsCentre(frame as Bounds)).toEqual({ x: 5, y: 0 });
  });

  it("follows a transform: the samples move, the padding does not", () => {
    const original = stroke([[0, 0], [10, 0]]);
    const before = selectionFrame([original], () => padding) as Bounds;
    const transform = createScaleTransform(boundsCentre(before), 2);

    const after = selectionFrame([transformed(original, transform)], () => padding);
    // The samples doubled: x went from 0..10 to -5..15. The padding is still
    // one pixel, because a transform never changes a stroke's brush, so the
    // frame is 22 wide rather than the 24 a scaled frame would be.
    expect(after).toEqual({ x: -6, y: -1, width: 22, height: 2 });
  });

  it("follows a rotation: the samples turn, the padding does not", () => {
    const original = stroke([[0, 0], [10, 0]]);
    const before = selectionFrame([original], () => padding) as Bounds;
    const transform = createRotateTransform(boundsCentre(before), Math.PI / 2);

    const after = selectionFrame([transformed(original, transform)], () => padding);
    // A quarter turn puts the stroke upright: y now runs from -5 to 5 and x
    // from 0 to 0, so the frame is 2 wide and 12 tall.
    expect(after?.width).toBeCloseTo(2, 10);
    expect(after?.height).toBeCloseTo(12, 10);
  });
});
