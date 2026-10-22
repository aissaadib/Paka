import { describe, expect, it, vi } from "vitest";
import type { EditorSnapshot } from "../core/engine/DrawingEngine";
import type { EditorActions } from "../state/editorStore";
import type { ToolId } from "../types/tool";
import {
  findToolOption,
  toolOptionsFor,
  visibleToolOptions,
  type SliderToolOption,
  type ToggleToolOption,
  type ToolOption,
} from "../core/shell/toolOptions";
import {
  DEFAULT_SHAPE_OPTIONS,
  MAX_SHAPE_SIDES,
  MIN_SHAPE_SIDES,
  normalizeShapeOptions,
  outlineExtent,
  shapeOutline,
  type ShapeDrag,
  type ShapeOptions,
  type ShapePoint,
} from "../core/tools/shapeGeometry";
import {
  DEFAULT_SHAPE_FILL,
  MAX_SHAPE_INNER_RATIO,
  MIN_SHAPE_INNER_RATIO,
  SHAPE_INNER_RATIO_STEP,
  findShapeOptionField,
  shapeOptionFieldsFor,
  shapeOptionLabel,
  type ShapeNumberOption,
} from "../core/tools/shapeOptions";
// The built-in schema is evaluated first, the way the app loads it: the
// options bar's schema registers the shape options, and the shape tools then
// append the ones the model adds. The order matters, so it is written down.
import "../features/options/toolOptionSchema";
import { registerShapeToolOptions } from "../core/tools/shapeToolOptions";
import { TOOL_DEFINITIONS } from "../core/tools/toolDefinitions";

function drag(overrides: Partial<ShapeDrag> = {}): ShapeDrag {
  return {
    anchor: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    shift: false,
    alt: false,
    ...overrides,
  };
}

function options(overrides: Partial<ShapeOptions> = {}): ShapeOptions {
  return { sides: 5, innerRatio: 0.5, rotation: 0, ...overrides };
}

function bounds(points: readonly ShapePoint[]) {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/**
 * The centre of an outline: the mean of its vertices.
 *
 * Not the centre of its bounding box - a regular pentagon inscribed in a
 * circle does not have a symmetric bounding box, so its box centre is not the
 * shape's centre. The vertices' mean is: the angles of a regular polygon sum
 * to zero around the centre, so the mean is the centre itself.
 */
function centreOf(points: readonly ShapePoint[]) {
  const vertices = points.slice(0, -1);
  return {
    x: vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length,
    y: vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length,
  };
}

function distance(a: ShapePoint, b: ShapePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The polar angle of a point about a centre, in radians. */
function angleOf(point: ShapePoint, centre: ShapePoint): number {
  return Math.atan2(point.y - centre.y, point.x - centre.x);
}

/**
 * Turns a point about a centre, in radians.
 *
 * Written out here on purpose: the test says what a rigid rotation *is*
 * rather than calling the implementation's own helper.
 */
function rotate(point: ShapePoint, centre: ShapePoint, degrees: number): ShapePoint {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

/**
 * True when two segments cross or touch.
 *
 * Used to prove that an outline is a *simple* loop: no two of its edges may
 * meet anywhere except at a shared vertex.
 */
function segmentsMeet(a: ShapePoint, b: ShapePoint, c: ShapePoint, d: ShapePoint): boolean {
  const cross = (o: ShapePoint, p: ShapePoint, q: ShapePoint): number =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const epsilon = 1e-9;
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (
    d1 * d2 < -epsilon &&
    d3 * d4 < -epsilon
  ) {
    return true;
  }
  // Collinear or touching counts too: a loop that touches itself is not simple.
  const onSegment = (o: ShapePoint, p: ShapePoint, q: ShapePoint): boolean =>
    Math.abs(cross(o, p, q)) <= epsilon &&
    q.x >= Math.min(o.x, p.x) - epsilon &&
    q.x <= Math.max(o.x, p.x) + epsilon &&
    q.y >= Math.min(o.y, p.y) - epsilon &&
    q.y <= Math.max(o.y, p.y) + epsilon;
  return (
    onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
  );
}

/**
 * True when the closed outline crosses itself.
 *
 * Two edges that share a vertex are neighbours and are allowed to meet; any
 * other meeting means the outline is not a simple loop.
 */
function selfIntersects(points: readonly ShapePoint[]): boolean {
  const edges = points.slice(0, -1).map((from, index) => ({ from, to: points[index + 1] }));
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const neighbours =
        j === i + 1 ||
        (i === 0 && j === edges.length - 1) ||
        (j === 0 && i === edges.length - 1);
      if (neighbours) {
        continue;
      }
      if (segmentsMeet(edges[i].from, edges[i].to, edges[j].from, edges[j].to)) {
        return true;
      }
    }
  }
  return false;
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

describe("shape geometry: polygon", () => {
  it("is a closed polygon with one point per side", () => {
    const points = shapeOutline(
      "polygon",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } }),
      options({ sides: 5 }),
    );
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual(points[5]);
    // The closing repeat is the same point, not a copy with a rounding error.
    expect(points[0].x).toBe(points[5].x);
    expect(points[0].y).toBe(points[5].y);
  });

  it("puts the first vertex at the top of the box", () => {
    const points = shapeOutline(
      "polygon",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } }),
      options({ sides: 5 }),
    );
    // The box is 0..100 by 0..50, so the centre is (50, 25) and the top of the
    // ellipse is (50, 0).
    expect(points[0].x).toBeCloseTo(50, 9);
    expect(points[0].y).toBeCloseTo(0, 9);
  });

  it("inscribes the vertices in the ellipse of the box", () => {
    const points = shapeOutline(
      "polygon",
      drag({ anchor: { x: 10, y: 20 }, current: { x: 110, y: 70 } }),
      options({ sides: 7 }),
    );
    const centerX = 60;
    const centerY = 45;
    const radiusX = 50;
    const radiusY = 25;
    for (const point of points.slice(0, -1)) {
      const onEllipse =
        ((point.x - centerX) / radiusX) ** 2 + ((point.y - centerY) / radiusY) ** 2;
      expect(onEllipse).toBeCloseTo(1, 9);
    }
    // The box is not square, so the outline is on an **ellipse** and not on a
    // circle: the vertices are not all the same distance from the centre.
    const radii = points
      .slice(0, -1)
      .map((point) => distance(point, { x: centerX, y: centerY }));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(1);
  });

  it("turns a non-square box's polygon rigidly about the centre", () => {
    // A 100 x 50 box: the two ways of applying a rotation differ here, so
    // this is the case that tells a rigid turn from a morph.
    const box = drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } });
    const centre = { x: 50, y: 25 };
    const plain = shapeOutline("polygon", box, options({ sides: 5, rotation: 0 }));
    const turned = shapeOutline("polygon", box, options({ sides: 5, rotation: 90 }));

    // A rigid turn changes where the shape is, not what it is: the side
    // lengths are the same.
    for (let index = 0; index < plain.length - 1; index += 1) {
      expect(distance(turned[index], turned[index + 1])).toBeCloseTo(
        distance(plain[index], plain[index + 1]),
        6,
      );
    }
    // And every vertex is the unrotated one turned about the centre.
    for (let index = 0; index < plain.length - 1; index += 1) {
      const expected = rotate(plain[index], centre, 90);
      expect(turned[index].x).toBeCloseTo(expected.x, 6);
      expect(turned[index].y).toBeCloseTo(expected.y, 6);
    }
  });

  it("puts the first vertex at -90 degrees plus the rotation", () => {
    const box = drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } });
    const centre = { x: 50, y: 25 };
    const turned = shapeOutline("polygon", box, options({ sides: 5, rotation: 45 }));
    // The first vertex starts at the top of the ellipse and is turned with the
    // rest of the outline, so it ends up at -90 + 45 = -45 degrees.
    //
    // 45 degrees on purpose: at 90 degrees the *old* (parametric) rotation
    // happened to put the first vertex at 0 degrees too, so that angle could
    // not tell a rigid turn from a morph. At 45 degrees the old code puts it
    // at -26.57 degrees.
    expect(angleOf(turned[0], centre)).toBeCloseTo(-Math.PI / 4, 9);
  });

  it("is regular when Shift squares the box", () => {
    const points = shapeOutline(
      "polygon",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 40 }, shift: true }),
      options({ sides: 5 }),
    );
    const centre = centreOf(points);
    const radii = points.slice(0, -1).map((point) => distance(point, centre));
    for (const radius of radii) {
      expect(radius).toBeCloseTo(50, 6);
    }
  });

  it("grows from the anchor under Alt", () => {
    const points = shapeOutline(
      "polygon",
      drag({ anchor: { x: 100, y: 100 }, current: { x: 130, y: 110 }, alt: true }),
      options({ sides: 5 }),
    );
    const centre = centreOf(points);
    expect(centre.x).toBeCloseTo(100, 6);
    expect(centre.y).toBeCloseTo(100, 6);
  });

  it("clamps the side count", () => {
    const tooFew = shapeOutline(
      "polygon",
      drag({ current: { x: 100, y: 100 } }),
      options({ sides: 1 }),
    );
    expect(tooFew).toHaveLength(MIN_SHAPE_SIDES + 1);
    const tooMany = shapeOutline(
      "polygon",
      drag({ current: { x: 100, y: 100 } }),
      options({ sides: 99 }),
    );
    expect(tooMany).toHaveLength(MAX_SHAPE_SIDES + 1);
  });

  it("turns the outline about the centre of the box", () => {
    const square = drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 100 } });
    const points = shapeOutline("polygon", square, options({ sides: 5, rotation: 45 }));
    const centre = centreOf(points);
    expect(centre.x).toBeCloseTo(50, 6);
    expect(centre.y).toBeCloseTo(50, 6);
    // The first vertex moves from the top (-90 degrees) to -45 degrees.
    expect(angleOf(points[0], centre)).toBeCloseTo(-Math.PI / 4, 9);
  });

  it("gives a zero-height box a sliver, like a zero-height rectangle", () => {
    const points = shapeOutline(
      "polygon",
      drag({ anchor: { x: 0, y: 30 }, current: { x: 100, y: 30 } }),
      options({ sides: 5 }),
    );
    for (const point of points) {
      expect(point.y).toBeCloseTo(30, 9);
    }
  });

  it("is deterministic", () => {
    const shape = drag({ anchor: { x: 3, y: 7 }, current: { x: 91, y: 43 } });
    const first = shapeOutline("polygon", shape, options({ sides: 6, rotation: 30 }));
    const second = shapeOutline("polygon", shape, options({ sides: 6, rotation: 30 }));
    expect(first).toEqual(second);
  });
});

describe("shape geometry: star", () => {
  it("is a closed star with two points per tip", () => {
    const points = shapeOutline(
      "star",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 100 } }),
      options({ sides: 5 }),
    );
    expect(points).toHaveLength(11);
    expect(points[0]).toEqual(points[10]);
  });

  it("puts the inner radius at the ratio of the outer", () => {
    const points = shapeOutline(
      "star",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 100 } }),
      options({ sides: 5, innerRatio: 0.4 }),
    );
    const centre = centreOf(points);
    const outer = distance(points[0], centre);
    // The even points are the tips, the odd ones the valleys.
    for (let index = 1; index < points.length - 1; index += 2) {
      expect(distance(points[index], centre)).toBeCloseTo(outer * 0.4, 6);
    }
  });

  it("alternates a tip and a valley", () => {
    const points = shapeOutline(
      "star",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 100 } }),
      options({ sides: 5 }),
    );
    const centre = centreOf(points);
    const step = Math.PI / 5;
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = angleOf(points[index - 1], centre);
      const current = angleOf(points[index], centre);
      let delta = current - previous;
      if (delta < 0) {
        delta += 2 * Math.PI;
      }
      expect(delta).toBeCloseTo(step, 9);
    }
  });

  it("never crosses itself, even at the smallest inner ratio", () => {
    const points = shapeOutline(
      "star",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 100 } }),
      options({ sides: 5, innerRatio: 0.05 }),
    );
    // A simple loop is what makes the non-zero fill fill the star rather than
    // a blob of crossed edges.
    expect(selfIntersects(points)).toBe(false);
  });

  it("grows from the anchor under Alt", () => {
    const points = shapeOutline(
      "star",
      drag({ anchor: { x: 100, y: 100 }, current: { x: 130, y: 110 }, alt: true }),
      options({ sides: 5 }),
    );
    const centre = centreOf(points);
    expect(centre.x).toBeCloseTo(100, 6);
    expect(centre.y).toBeCloseTo(100, 6);
  });

  it("turns the outline about the centre of the box", () => {
    const square = drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 100 } });
    const points = shapeOutline("star", square, options({ sides: 5, rotation: 45 }));
    const centre = centreOf(points);
    expect(angleOf(points[0], centre)).toBeCloseTo(-Math.PI / 4, 9);
  });

  it("pins its absolute placement in the box's ellipse", () => {
    // A 100 x 50 box: the tips sit on the ellipse the polygon uses, and the
    // valleys on the same ellipse scaled by the inner ratio. Without this a
    // star drawn at the wrong size would pass every other test.
    const points = shapeOutline(
      "star",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } }),
      options({ sides: 5, innerRatio: 0.4 }),
    );
    const centre = { x: 50, y: 25 };
    const radiusX = 50;
    const radiusY = 25;
    const sides = 5;
    for (let index = 0; index < points.length - 1; index += 1) {
      const isTip = index % 2 === 0;
      const step = Math.floor(index / 2);
      // The tip is on the box's ellipse, the valley half a step further round
      // and on the same ellipse scaled by the inner ratio.
      const angle = -Math.PI / 2 + (2 * Math.PI * (step + (isTip ? 0 : 0.5))) / sides;
      const scale = isTip ? 1 : 0.4;
      expect(points[index].x).toBeCloseTo(
        centre.x + radiusX * scale * Math.cos(angle),
        6,
      );
      expect(points[index].y).toBeCloseTo(
        centre.y + radiusY * scale * Math.sin(angle),
        6,
      );
      // The radius from the centre is the ellipse's polar radius in that
      // direction, scaled by the inner ratio for a valley.
      const polarRadius = Math.hypot(radiusX * Math.cos(angle), radiusY * Math.sin(angle));
      expect(distance(points[index], centre)).toBeCloseTo(polarRadius * scale, 6);
    }
  });

  it("turns a non-square box's star rigidly about the centre", () => {
    const box = drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } });
    const centre = { x: 50, y: 25 };
    const plain = shapeOutline("star", box, options({ sides: 5, rotation: 0 }));
    const turned = shapeOutline("star", box, options({ sides: 5, rotation: 90 }));

    // The edge lengths are the same: the star turned, it did not morph.
    for (let index = 0; index < plain.length - 1; index += 1) {
      expect(distance(turned[index], turned[index + 1])).toBeCloseTo(
        distance(plain[index], plain[index + 1]),
        6,
      );
    }
    for (let index = 0; index < plain.length - 1; index += 1) {
      const expected = rotate(plain[index], centre, 90);
      expect(turned[index].x).toBeCloseTo(expected.x, 6);
      expect(turned[index].y).toBeCloseTo(expected.y, 6);
    }
  });

  it("is deterministic", () => {
    const shape = drag({ anchor: { x: 3, y: 7 }, current: { x: 91, y: 43 } });
    const first = shapeOutline("star", shape, options({ sides: 7, innerRatio: 0.3 }));
    const second = shapeOutline("star", shape, options({ sides: 7, innerRatio: 0.3 }));
    expect(first).toEqual(second);
  });
});

describe("shape geometry: the degenerate drag", () => {
  it("has no extent when the drag never moved", () => {
    for (const kind of ["polygon", "star"] as const) {
      const points = shapeOutline(kind, drag(), options());
      expect(outlineExtent(points)).toBe(0);
    }
  });

  it("has no extent for a drag smaller than half a pixel", () => {
    const points = shapeOutline(
      "polygon",
      drag({ current: { x: 0.2, y: 0.2 } }),
      options(),
    );
    expect(outlineExtent(points)).toBeLessThan(0.5);
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

/* -------------------------------------------------------------- the model */

describe("shape options: the one model", () => {
  it("gives every shape kind the options it has", () => {
    // The line's angle is the drag itself, so it has no options at all.
    expect(shapeOptionFieldsFor("line").map((field) => field.id)).toEqual([]);
    expect(shapeOptionFieldsFor("rectangle").map((field) => field.id)).toEqual([
      "shapeRotation",
      "shapeFill",
    ]);
    expect(shapeOptionFieldsFor("ellipse").map((field) => field.id)).toEqual([
      "shapeRotation",
      "shapeFill",
    ]);
    expect(shapeOptionFieldsFor("polygon").map((field) => field.id)).toEqual([
      "shapeSides",
      "shapeRotation",
      "shapeFill",
    ]);
    expect(shapeOptionFieldsFor("star").map((field) => field.id)).toEqual([
      "shapeSides",
      "shapeInnerRatio",
      "shapeRotation",
      "shapeFill",
    ]);
  });

  it("labels the shared count by the kind that uses it", () => {
    const sides = findShapeOptionField("shapeSides");
    expect(sides).toBeDefined();
    // One number serves both tools: the polygon's sides are the star's points.
    expect(shapeOptionLabel(sides!, "polygon")).toBe("Sides");
    expect(shapeOptionLabel(sides!, "star")).toBe("Points");
  });

  it("keeps the ranges the geometry clamps to", () => {
    const sides = findShapeOptionField("shapeSides") as ShapeNumberOption;
    expect(sides.min).toBe(MIN_SHAPE_SIDES);
    expect(sides.max).toBe(MAX_SHAPE_SIDES);
    expect(sides.step).toBe(1);
    const inner = findShapeOptionField("shapeInnerRatio") as ShapeNumberOption;
    expect(inner.min).toBe(MIN_SHAPE_INNER_RATIO);
    expect(inner.max).toBe(MAX_SHAPE_INNER_RATIO);
    expect(inner.step).toBe(SHAPE_INNER_RATIO_STEP);
    const rotation = findShapeOptionField("shapeRotation") as ShapeNumberOption;
    expect(rotation.min).toBe(0);
    expect(rotation.max).toBe(360);
  });

  it("fills exactly the tools the definitions call fillable", () => {
    const fillable = TOOL_DEFINITIONS.filter((definition) => definition.fillable)
      .map((definition) => definition.id)
      .sort();
    const kinds = [...findShapeOptionField("shapeFill")!.kinds].sort();
    // A line's outline bounds no interior, so it is not one of them.
    expect(kinds).toEqual(fillable);
    expect(fillable).not.toContain("line");
  });

  it("starts from the documented defaults", () => {
    expect(DEFAULT_SHAPE_OPTIONS).toEqual({ sides: 5, innerRatio: 0.5, rotation: 0 });
    expect(DEFAULT_SHAPE_FILL).toBe(false);
    expect(findShapeOptionField("shapeSides")!.defaultValue).toBe(
      DEFAULT_SHAPE_OPTIONS.sides,
    );
    expect(findShapeOptionField("shapeInnerRatio")!.defaultValue).toBe(
      DEFAULT_SHAPE_OPTIONS.innerRatio,
    );
    expect(findShapeOptionField("shapeRotation")!.defaultValue).toBe(
      DEFAULT_SHAPE_OPTIONS.rotation,
    );
  });

  it("clamps the options into their ranges", () => {
    expect(
      normalizeShapeOptions({ sides: 1, innerRatio: 0, rotation: -30 }),
    ).toEqual({
      sides: MIN_SHAPE_SIDES,
      innerRatio: MIN_SHAPE_INNER_RATIO,
      rotation: 0,
    });
    expect(
      normalizeShapeOptions({ sides: 99, innerRatio: 4, rotation: 400 }),
    ).toEqual({
      sides: MAX_SHAPE_SIDES,
      innerRatio: MAX_SHAPE_INNER_RATIO,
      rotation: 360,
    });
    // The counts are whole numbers; the ratio is not.
    expect(normalizeShapeOptions({ sides: 7.6, innerRatio: 0.25, rotation: 45.4 })).toEqual({
      sides: 8,
      innerRatio: 0.25,
      rotation: 45,
    });
  });
});

/* ------------------------------------------------------------ the controls */

/** Narrows an option to the kind a test expects, so a wrong kind fails loudly. */
function asSlider(option: ToolOption | undefined): SliderToolOption {
  if (!option || option.kind !== "slider") {
    throw new Error(`expected a slider, got "${option?.kind ?? "nothing"}"`);
  }
  return option;
}

function asToggle(option: ToolOption | undefined): ToggleToolOption {
  if (!option || option.kind !== "toggle") {
    throw new Error(`expected a toggle, got "${option?.kind ?? "nothing"}"`);
  }
  return option;
}

/** The ids a tool shows, with any group flattened. */
function optionIds(toolId: ToolId): string[] {
  const ids: string[] = [];
  for (const option of toolOptionsFor(toolId)) {
    if (option.kind === "group") {
      ids.push(...option.children.map((child) => child.id));
    } else {
      ids.push(option.id);
    }
  }
  return ids;
}

function snapshotFor(toolId: ToolId): EditorSnapshot {
  return {
    toolId,
    shapeFill: true,
    shapeSides: 7,
    shapeInnerRatio: 0.42,
    shapeRotation: 33,
  } as unknown as EditorSnapshot;
}

function recorder() {
  const calls: Array<[string, unknown]> = [];
  const actions = {
    setShapeFill: vi.fn((value: boolean) => calls.push(["setShapeFill", value])),
    setShapeSides: vi.fn((value: number) => calls.push(["setShapeSides", value])),
    setShapeInnerRatio: vi.fn((value: number) => calls.push(["setShapeInnerRatio", value])),
    setShapeRotation: vi.fn((value: number) => calls.push(["setShapeRotation", value])),
  } as unknown as EditorActions;
  return { actions, calls };
}

describe("shape options: the controls", () => {
  it("registers the model's options for every shape tool", () => {
    // Registering twice is harmless: the contract ignores an option whose id
    // is already registered for that tool.
    registerShapeToolOptions();
    registerShapeToolOptions();
    expect(new Set(optionIds("rectangle"))).toEqual(new Set(["shapeFill", "shapeRotation"]));
    expect(new Set(optionIds("ellipse"))).toEqual(new Set(["shapeFill", "shapeRotation"]));
    expect(new Set(optionIds("polygon"))).toEqual(
      new Set(["shapeSides", "shapeRotation", "shapeFill"]),
    );
    expect(new Set(optionIds("star"))).toEqual(
      new Set(["shapeSides", "shapeInnerRatio", "shapeRotation", "shapeFill"]),
    );
    // The line's angle is the drag, so it has no options.
    expect(optionIds("line")).toEqual([]);
  });

  it("gives every control the range the model declares", () => {
    for (const kind of ["rectangle", "ellipse", "polygon", "star"] as const) {
      for (const field of shapeOptionFieldsFor(kind)) {
        const option = findToolOption(kind, field.id);
        expect(option, `${kind} is missing ${field.id}`).toBeDefined();
        if (field.control === "number") {
          const slider = asSlider(option);
          expect(slider.min).toBe(field.min);
          expect(slider.max).toBe(field.max);
          expect(slider.step).toBe(field.step);
        }
      }
    }
  });

  it("reads the value the engine published", () => {
    const snapshot = snapshotFor("star");
    expect(asSlider(findToolOption("star", "shapeSides")).read(snapshot)).toBe(7);
    expect(asSlider(findToolOption("star", "shapeInnerRatio")).read(snapshot)).toBe(0.42);
    expect(asSlider(findToolOption("star", "shapeRotation")).read(snapshot)).toBe(33);
    expect(asToggle(findToolOption("star", "shapeFill")).read(snapshot)).toBe(true);
    // The rectangle's and the ellipse's new control reads the same value.
    expect(asSlider(findToolOption("rectangle", "shapeRotation")).read(snapshot)).toBe(33);
    expect(asSlider(findToolOption("ellipse", "shapeRotation")).read(snapshot)).toBe(33);
  });

  it("writes through the engine's action, snapped to the step", () => {
    const { actions, calls } = recorder();
    asSlider(findToolOption("star", "shapeInnerRatio")).write(actions, 0.333);
    // The step is 0.05: 0.333 snaps to 0.35, the nearest reachable ratio.
    expect(calls[0][0]).toBe("setShapeInnerRatio");
    expect(calls[0][1]).toBeCloseTo(0.35, 10);

    const rotation = recorder();
    asSlider(findToolOption("rectangle", "shapeRotation")).write(rotation.actions, 45.4);
    expect(rotation.calls).toEqual([["setShapeRotation", 45]]);
  });

  it("labels the shared count by the active tool", () => {
    const polygon = visibleToolOptions("polygon", snapshotFor("polygon"));
    const star = visibleToolOptions("star", snapshotFor("star"));
    const polygonSides = polygon.find((option) => option.id === "shapeSides");
    const starSides = star.find((option) => option.id === "shapeSides");
    expect(polygonSides?.label).toBeDefined();
    expect(starSides?.label).toBeDefined();
    const label = (option: ToolOption | undefined, snapshot: EditorSnapshot): string => {
      if (!option) {
        throw new Error("the sides control is missing");
      }
      return typeof option.label === "function" ? option.label(snapshot) : option.label;
    };
    expect(label(polygonSides, snapshotFor("polygon"))).toBe("Sides");
    expect(label(starSides, snapshotFor("star"))).toBe("Points");
  });
});

/* --------------------------------------- the rectangle and the ellipse turn */

describe("shape geometry: the rectangle and the ellipse turn rigidly", () => {
  it("turns a non-square rectangle about the centre of its box", () => {
    // A 100 x 50 box: the two ways of applying a rotation differ here, so
    // this is the case that tells a rigid turn from a morph.
    const box = drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } });
    const centre = { x: 50, y: 25 };
    const plain = shapeOutline("rectangle", box, options({ rotation: 0 }));
    const turned = shapeOutline("rectangle", box, options({ rotation: 45 }));

    // Every corner is the unrotated one turned about the centre.
    for (let index = 0; index < plain.length - 1; index += 1) {
      const expected = rotate(plain[index], centre, 45);
      expect(turned[index].x).toBeCloseTo(expected.x, 6);
      expect(turned[index].y).toBeCloseTo(expected.y, 6);
    }
  });

  it("keeps the rectangle's side lengths when it turns", () => {
    const box = drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } });
    const plain = shapeOutline("rectangle", box, options({ rotation: 0 }));
    const turned = shapeOutline("rectangle", box, options({ rotation: 45 }));
    for (let index = 0; index < plain.length - 1; index += 1) {
      expect(distance(turned[index], turned[index + 1])).toBeCloseTo(
        distance(plain[index], plain[index + 1]),
        6,
      );
    }
  });

  it("turns a non-square ellipse about the centre of its box", () => {
    const box = drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } });
    const centre = { x: 50, y: 25 };
    const plain = shapeOutline("ellipse", box, options({ rotation: 0 }));
    const turned = shapeOutline("ellipse", box, options({ rotation: 45 }));
    for (let index = 0; index < plain.length - 1; index += 1) {
      const expected = rotate(plain[index], centre, 45);
      expect(turned[index].x).toBeCloseTo(expected.x, 6);
      expect(turned[index].y).toBeCloseTo(expected.y, 6);
    }
  });

  it("closes the turned outline on the turned first point", () => {
    const box = drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } });
    for (const kind of ["rectangle", "ellipse"] as const) {
      const turned = shapeOutline(kind, box, options({ rotation: 45 }));
      expect(turned[0]).toEqual(turned[turned.length - 1]);
    }
  });

  it("leaves the default rectangle exactly as it was", () => {
    const points = shapeOutline(
      "rectangle",
      drag({ anchor: { x: 10, y: 20 }, current: { x: 40, y: 50 } }),
      options({ rotation: 0 }),
    );
    // Exactly, not approximately: a whole turn is the identity and must not
    // move a single digit.
    expect(points).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 50 },
      { x: 10, y: 50 },
      { x: 10, y: 20 },
    ]);
  });

  it("leaves the default ellipse exactly as it was", () => {
    const points = shapeOutline(
      "ellipse",
      drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } }),
      options({ rotation: 0 }),
    );
    expect(points[0]).toEqual({ x: 100, y: 25 });
    expect(points[points.length - 1]).toEqual(points[0]);
  });

  it("treats a whole turn as the identity", () => {
    const box = drag({ anchor: { x: 0, y: 0 }, current: { x: 100, y: 50 } });
    for (const kind of ["rectangle", "ellipse"] as const) {
      expect(shapeOutline(kind, box, options({ rotation: 360 }))).toEqual(
        shapeOutline(kind, box, options({ rotation: 0 })),
      );
    }
  });
});
