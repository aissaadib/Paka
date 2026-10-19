/**
 * Marquee hit-testing.
 *
 * These pin the rule that decides what a selection contains, which is the one
 * part of selection that has nothing to do with pixels, history or the UI: a
 * rectangle in document space against the centrelines of the strokes. The cases
 * that matter most are the ones a naive point test gets wrong - a segment that
 * crosses the rectangle with both ends outside it, and a stroke whose painted
 * width (not its centreline) is what reaches into the rectangle.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  boundsContainPoint,
  boundsFromCorners,
  inflateBounds,
  segmentIntersectsBounds,
  strokeIntersectsBounds,
} from "../core/document/strokeSelection";
import type { StrokeRecord } from "../core/document/types";
import type { Bounds } from "../types/geometry";

const RECT: Bounds = { x: 0, y: 0, width: 10, height: 10 };

let strokeCounter = 0;

function stroke(points: ReadonlyArray<readonly [number, number]>): StrokeRecord {
  strokeCounter += 1;
  return {
    id: `selection-stroke-${strokeCounter}`,
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

describe("selection bounds", () => {
  it("normalizes a drag in any direction", () => {
    expect(boundsFromCorners({ x: 10, y: 20 }, { x: 4, y: 5 })).toEqual({
      x: 4,
      y: 5,
      width: 6,
      height: 15,
    });
    expect(boundsFromCorners({ x: 4, y: 5 }, { x: 10, y: 20 })).toEqual({
      x: 4,
      y: 5,
      width: 6,
      height: 15,
    });
    // A press that never moved is a zero-size rectangle, not an error.
    expect(boundsFromCorners({ x: 7, y: 7 }, { x: 7, y: 7 })).toEqual({
      x: 7,
      y: 7,
      width: 0,
      height: 0,
    });
  });

  it("includes points on the edges", () => {
    expect(boundsContainPoint(RECT, 0, 0)).toBe(true);
    expect(boundsContainPoint(RECT, 10, 10)).toBe(true);
    expect(boundsContainPoint(RECT, 5, 5)).toBe(true);
    expect(boundsContainPoint(RECT, -0.01, 5)).toBe(false);
    expect(boundsContainPoint(RECT, 5, 10.01)).toBe(false);
  });

  it("inflates by the given amount", () => {
    expect(inflateBounds(RECT, 2)).toEqual({ x: -2, y: -2, width: 14, height: 14 });
    expect(inflateBounds(RECT, 0)).toEqual(RECT);
  });
});

describe("segment against a rectangle", () => {
  it("detects a crossing in any direction", () => {
    expect(segmentIntersectsBounds({ x: 5, y: -5 }, { x: 5, y: 15 }, RECT)).toBe(true);
    expect(segmentIntersectsBounds({ x: -5, y: 5 }, { x: 15, y: 5 }, RECT)).toBe(true);
    expect(segmentIntersectsBounds({ x: -4, y: -4 }, { x: 14, y: 14 }, RECT)).toBe(true);
  });

  it("detects a segment that lies entirely inside", () => {
    expect(segmentIntersectsBounds({ x: 2, y: 2 }, { x: 8, y: 8 }, RECT)).toBe(true);
  });

  it("counts a segment that only touches an edge", () => {
    expect(segmentIntersectsBounds({ x: -2, y: 10 }, { x: 12, y: 10 }, RECT)).toBe(true);
    expect(segmentIntersectsBounds({ x: 10, y: 10 }, { x: 20, y: 20 }, RECT)).toBe(true);
  });

  it("rejects a segment wholly outside, including a parallel one", () => {
    expect(segmentIntersectsBounds({ x: 12, y: 2 }, { x: 20, y: 8 }, RECT)).toBe(false);
    expect(segmentIntersectsBounds({ x: 0, y: -5 }, { x: 10, y: -5 }, RECT)).toBe(false);
    expect(segmentIntersectsBounds({ x: -5, y: 0 }, { x: -5, y: 10 }, RECT)).toBe(false);
  });

  it("rejects a segment whose bounding box overlaps but whose line misses", () => {
    const away: Bounds = { x: 10, y: 10, width: 10, height: 10 };
    // Runs below and to the left of the rectangle: it reaches x = 10 only at
    // y = 45, and y = 20 only at x = -20. A bounding-box test would accept it
    // (the boxes do overlap between x 10..20 and y 15..20), the line does not.
    expect(segmentIntersectsBounds({ x: -10, y: 15 }, { x: 20, y: 45 }, away)).toBe(false);
  });

  it("treats a zero-length segment as a point", () => {
    expect(segmentIntersectsBounds({ x: 5, y: 5 }, { x: 5, y: 5 }, RECT)).toBe(true);
    expect(segmentIntersectsBounds({ x: 20, y: 20 }, { x: 20, y: 20 }, RECT)).toBe(false);
  });
});

describe("stroke against a rectangle", () => {
  it("ignores a stroke with no samples", () => {
    expect(strokeIntersectsBounds(stroke([]), RECT)).toBe(false);
  });

  it("selects a single-sample stroke inside and rejects one outside", () => {
    expect(strokeIntersectsBounds(stroke([[5, 5]]), RECT)).toBe(true);
    expect(strokeIntersectsBounds(stroke([[50, 50]]), RECT)).toBe(false);
  });

  it("selects a stroke whose segment crosses even with every sample outside", () => {
    // The rectangle is the middle of a long diagonal; no stored sample is in it.
    const diagonal = stroke([
      [-50, -50],
      [60, 60],
    ]);
    expect(strokeIntersectsBounds(diagonal, RECT)).toBe(true);
  });

  it("rejects a stroke that passes near but not through", () => {
    const parallel = stroke([
      [-20, 30],
      [30, 30],
    ]);
    expect(strokeIntersectsBounds(parallel, RECT)).toBe(false);
  });

  it("lets padding bridge a near miss, which is what painted width means", () => {
    const above = stroke([
      [-20, -3],
      [30, -3],
    ]);
    // Three pixels above the edge: not selected on the centreline alone...
    expect(strokeIntersectsBounds(above, RECT)).toBe(false);
    // ...but a stroke eight pixels wide reaches into the rectangle.
    expect(strokeIntersectsBounds(above, RECT, 4)).toBe(true);
  });

  it("selects on an endpoint that lies on the edge", () => {
    expect(strokeIntersectsBounds(stroke([[0, 0], [-10, -10]]), RECT)).toBe(true);
  });
});
