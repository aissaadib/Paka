import { describe, expect, it } from "vitest";
import {
  outlineExtent,
  shapeOutline,
  type ShapeDrag,
  type ShapePoint,
} from "../core/tools/shapeGeometry";

function drag(overrides: Partial<ShapeDrag> = {}): ShapeDrag {
  return {
    anchor: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    shift: false,
    alt: false,
    ...overrides,
  };
}

function bounds(points: readonly ShapePoint[]) {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

describe("shape geometry: line", () => {
  it("is the anchor and the current point", () => {
    expect(shapeOutline("line", drag({ anchor: { x: 10, y: 20 }, current: { x: 30, y: 50 } }))).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 50 },
    ]);
  });

  it("snaps to the nearest 45 degrees under Shift", () => {
    const horizontal = shapeOutline(
      "line",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 10 }, shift: true }),
    );
    expect(horizontal[1].y).toBeCloseTo(0, 10);
    expect(horizontal[1].x).toBeCloseTo(Math.hypot(100, 10), 6);

    const diagonal = shapeOutline(
      "line",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 90 }, shift: true }),
    );
    // 42 degrees rounds to 45: equal x and y, both positive.
    expect(diagonal[1].x).toBeGreaterThan(0);
    expect(diagonal[1].x).toBeCloseTo(diagonal[1].y, 6);
  });

  it("treats the anchor as the midpoint under Alt", () => {
    const points = shapeOutline(
      "line",
      drag({ anchor: { x: 100, y: 100 }, current: { x: 120, y: 110 }, alt: true }),
    );
    expect(points).toEqual([
      { x: 80, y: 90 },
      { x: 120, y: 110 },
    ]);
  });
});

describe("shape geometry: rectangle", () => {
  it("is a closed box with four corners", () => {
    const points = shapeOutline(
      "rectangle",
      drag({ anchor: { x: 10, y: 20 }, current: { x: 40, y: 50 } }),
    );
    expect(points).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 50 },
      { x: 10, y: 50 },
      { x: 10, y: 20 },
    ]);
  });

  it("is a square under Shift", () => {
    const points = shapeOutline(
      "rectangle",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 40 }, shift: true }),
    );
    const box = bounds(points);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  });

  it("grows from the anchor under Alt", () => {
    const points = shapeOutline(
      "rectangle",
      drag({ anchor: { x: 100, y: 100 }, current: { x: 130, y: 110 }, alt: true }),
    );
    expect(bounds(points)).toEqual({ minX: 70, minY: 90, maxX: 130, maxY: 110 });
  });
});

describe("shape geometry: ellipse", () => {
  it("is a closed polyline inside its box", () => {
    const points = shapeOutline(
      "ellipse",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } }),
    );
    expect(points.length).toBeGreaterThan(24);
    expect(points[0]).toEqual(points[points.length - 1]);
    const box = bounds(points);
    // A vertex sits on each axis, so the outline touches the box exactly.
    expect(box.minX).toBeCloseTo(0, 6);
    expect(box.maxX).toBeCloseTo(100, 6);
    expect(box.minY).toBeCloseTo(0, 6);
    expect(box.maxY).toBeCloseTo(50, 6);
  });

  it("is centred on the anchor under Alt", () => {
    const points = shapeOutline(
      "ellipse",
      drag({ anchor: { x: 50, y: 50 }, current: { x: 80, y: 70 }, alt: true }),
    );
    const box = bounds(points);
    expect(box.minX).toBeCloseTo(20, 6);
    expect(box.maxX).toBeCloseTo(80, 6);
    expect(box.minY).toBeCloseTo(30, 6);
    expect(box.maxY).toBeCloseTo(70, 6);
  });

  it("keeps the sample count bounded for tiny and huge ellipses", () => {
    const tiny = shapeOutline("ellipse", drag({ current: { x: 2, y: 2 } }));
    expect(tiny.length).toBe(25);
    const huge = shapeOutline("ellipse", drag({ current: { x: 4000, y: 4000 } }));
    expect(huge.length).toBe(181);
  });
});

describe("outline extent", () => {
  it("is zero for an empty or single-point outline", () => {
    expect(outlineExtent([])).toBe(0);
    expect(outlineExtent([{ x: 5, y: 5 }])).toBe(0);
  });

  it("is the bounding-box diagonal", () => {
    expect(
      outlineExtent([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBe(5);
  });
});
