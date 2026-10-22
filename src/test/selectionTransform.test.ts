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
  clampStretchFactor,
  cornerScale,
  createRotateTransform,
  createScaleTransform,
  createStretchTransform,
  edgeScale,
  MIN_SCALE_FACTOR,
  MIN_STRETCH_SIZE,
  normalizeAngle,
  oppositeCorner,
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

describe("the one-axis stretch of a side handle", () => {
  const FRAME: Bounds = { x: 100, y: 200, width: 80, height: 40 };
  const PRESS: Point = { x: 180, y: 220 };
  const FREE = { proportional: false, fromCentre: false } as const;

  it("moves the dragged edge with the pointer and leaves the other edge alone", () => {
    const scale = edgeScale(FRAME, "x", "end", PRESS, { x: 200, y: 220 }, FREE);
    // The left edge is the anchor: it does not move.
    expect(scale.anchorX).toBe(100);
    // Twenty pixels of travel on an eighty-pixel frame is a quarter more.
    expect(scale.factorX).toBeCloseTo(1.25, 10);
    // The other axis is untouched: a side handle stretches one side only.
    expect(scale.factorY).toBe(1);

    const transform = createStretchTransform(scale);
    expect(transform.mapX(180, 220)).toBeCloseTo(200, 10);
    expect(transform.mapX(100, 220)).toBeCloseTo(100, 10);
    expect(transform.mapY(220, 200)).toBeCloseTo(200, 10);
  });

  it("grows on both sides when the anchor is the centre", () => {
    const scale = edgeScale(FRAME, "x", "end", PRESS, { x: 200, y: 220 }, {
      proportional: false,
      fromCentre: true,
    });
    // The centre is the anchor, so the frame grows on both sides.
    expect(scale.anchorX).toBe(140);
    // The dragged edge still follows the pointer one for one.
    const transform = createStretchTransform(scale);
    expect(transform.mapX(180, 220)).toBeCloseTo(200, 10);
    expect(transform.mapX(100, 220)).toBeCloseTo(80, 10);
  });

  it("locks the aspect ratio when the proportional modifier is held", () => {
    const scale = edgeScale(FRAME, "x", "end", PRESS, { x: 200, y: 220 }, {
      proportional: true,
      fromCentre: false,
    });
    // Both axes grow by the same factor, so the proportions are kept: an
    // eighty-by-forty frame becomes a hundred-by-fifty one.
    expect(scale.factorX).toBeCloseTo(1.25, 10);
    expect(scale.factorY).toBeCloseTo(1.25, 10);

    const transform = createStretchTransform(scale);
    expect(transform.mapX(180, 220)).toBeCloseTo(200, 10);
    // The frame's vertical centre does not move, and the height follows: the
    // top edge was 20 above the centre and is 25 above it now.
    expect(transform.mapY(140, 220)).toBeCloseTo(220, 10);
    expect(transform.mapY(140, 200)).toBeCloseTo(195, 10);
  });

  it("asks for no change where the press landed", () => {
    const scale = edgeScale(FRAME, "x", "end", PRESS, PRESS, FREE);
    expect(scale.factorX).toBe(1);
    expect(scale.factorY).toBe(1);
  });

  it("never squashes a side to nothing", () => {
    // A drag far past the opposite edge would invert the frame; the clamp
    // stops the side at one document pixel instead.
    const scale = edgeScale(FRAME, "x", "end", PRESS, { x: -500, y: 220 }, FREE);
    expect(scale.factorX * FRAME.width).toBeCloseTo(MIN_STRETCH_SIZE, 10);
    expect(scale.factorX).toBeGreaterThan(0);
  });

  it("stretches the other axis for a north or south handle", () => {
    // The north handle is the low end of the y axis, so it travels against
    // the pointer: dragging it **up** makes the frame taller.
    const scale = edgeScale(FRAME, "y", "start", { x: 140, y: 200 }, { x: 140, y: 180 }, FREE);
    // The bottom edge is the anchor, so it does not move.
    expect(scale.anchorY).toBe(240);
    expect(scale.factorY).toBeCloseTo(1.5, 10);
    expect(scale.factorX).toBe(1);

    const transform = createStretchTransform(scale);
    // The top edge followed the pointer up to 180.
    expect(transform.mapY(140, 200)).toBeCloseTo(180, 10);
    expect(transform.mapY(140, 240)).toBeCloseTo(240, 10);
  });
});

describe("the clamp of a free stretch", () => {
  it("keeps the stretched side at least a pixel wide", () => {
    expect(clampStretchFactor(0, 100)).toBeCloseTo(MIN_STRETCH_SIZE / 100, 10);
    expect(clampStretchFactor(-3, 100)).toBeCloseTo(MIN_STRETCH_SIZE / 100, 10);
  });

  it("leaves a factor that is big enough alone", () => {
    expect(clampStretchFactor(1, 100)).toBe(1);
    expect(clampStretchFactor(2.5, 100)).toBe(2.5);
  });

  it("leaves a stretch that is not a number where it is", () => {
    expect(clampStretchFactor(Number.NaN, 100)).toBe(1);
    expect(clampStretchFactor(2, Number.NaN)).toBe(1);
    expect(clampStretchFactor(2, 0)).toBe(1);
  });
});

describe("the corner scale and its anchor", () => {
  const FRAME: Bounds = { x: 100, y: 200, width: 80, height: 40 };
  const CORNER: Point = { x: 180, y: 240 };

  it("scales uniformly about the anchor", () => {
    const scale = cornerScale(CORNER, boundsCentre(FRAME), CORNER, { x: 200, y: 260 });
    // The corner is not on the diagonal, so the factor is the projection of
    // the travel along the corner's own ray: 1.6, not 1.5.
    expect(scale.factorX).toBeCloseTo(1.6, 10);
    expect(scale.factorY).toBeCloseTo(1.6, 10);
    expect(scale.anchorX).toBe(140);
    expect(scale.anchorY).toBe(220);
  });

  it("leaves the anchor where it is", () => {
    const scale = cornerScale(CORNER, boundsCentre(FRAME), CORNER, { x: 200, y: 260 });
    const transform = createStretchTransform(scale);
    expect(transform.mapX(140, 220)).toBeCloseTo(140, 10);
    expect(transform.mapY(140, 220)).toBeCloseTo(220, 10);
  });

  it("asks for no change where the press landed", () => {
    const scale = cornerScale(CORNER, boundsCentre(FRAME), CORNER, CORNER);
    expect(scale.factorX).toBe(1);
  });
});

describe("the opposite corner", () => {
  const FRAME: Bounds = { x: 100, y: 200, width: 80, height: 40 };

  it("is the corner on the other side and the other row", () => {
    expect(oppositeCorner(FRAME, { x: 100, y: 200 })).toEqual({ x: 180, y: 240 });
    expect(oppositeCorner(FRAME, { x: 180, y: 240 })).toEqual({ x: 100, y: 200 });
    expect(oppositeCorner(FRAME, { x: 180, y: 200 })).toEqual({ x: 100, y: 240 });
    expect(oppositeCorner(FRAME, { x: 100, y: 240 })).toEqual({ x: 180, y: 200 });
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
