/**
 * Selecting strokes with a rectangle or a lasso.
 *
 * The unit of selection in this engine is the **stroke**, not the pixel: layer
 * pixels are a cache rasterized from the stroke list (see
 * `docs/ARCHITECTURE.md`), so a marquee decides which strokes a transform will
 * move, and nothing is ever baked. That keeps moving undoable, re-rasterizable
 * and reproducible from a reopened file, at the cost of being explicit about it
 * here.
 *
 * Two regions are supported: an axis-aligned rectangle and a freehand polygon
 * (the lasso). Both apply the same rule - a stroke counts as selected when its
 * centreline meets the region, widened by half the stroke's painted width
 * (`padding`). Widening is what makes the rule match what the user sees: the
 * pixels of a stroke on the very edge of the region reach inside it, so the
 * stroke selects. The padding is passed in rather than computed here so this
 * module stays free of brush and rendering knowledge; the caller supplies half
 * the stroke's diameter.
 */

import type { Bounds, Point } from "../../types/geometry";
import type { StrokeRecord } from "./types";

/**
 * Axis-aligned rectangle between two drag corners, in any direction.
 *
 * A drag that never moved yields a zero-size rectangle, which is exactly what a
 * click should mean: hit-test the strokes under that point.
 */
export function boundsFromCorners(a: Point, b: Point): Bounds {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  return {
    x: minX,
    y: minY,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** True when the point lies inside or on the rectangle's edge. */
export function boundsContainPoint(bounds: Bounds, x: number, y: number): boolean {
  return (
    x >= bounds.x &&
    y >= bounds.y &&
    x <= bounds.x + bounds.width &&
    y <= bounds.y + bounds.height
  );
}

/** Grows a rectangle by `padding` on every side. */
export function inflateBounds(bounds: Bounds, padding: number): Bounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

/**
 * True when a line segment touches the rectangle.
 *
 * Liang-Barsky parametric clipping: the segment is walked as `p(t) = p0 + t*d`
 * and the range of `t` that stays inside each edge's half-plane is narrowed.
 * The range starts as `[0, 1]` - the segment itself - and a segment that misses
 * the rectangle on any edge collapses it. This is exact for the continuous
 * segment, which matters because samples are sparse relative to the marquee: a
 * fast diagonal stroke can cross a marquee with every stored sample outside it,
 * and a point-only test would silently leave it unselected.
 */
export function segmentIntersectsBounds(p0: Point, p1: Point, bounds: Bounds): boolean {
  const minX = bounds.x;
  const maxX = bounds.x + bounds.width;
  const minY = bounds.y;
  const maxY = bounds.y + bounds.height;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) {
      // Parallel to this edge: inside only when the segment is not fully outside.
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) {
        return false;
      }
      if (r > t0) {
        t0 = r;
      }
    } else {
      if (r < t0) {
        return false;
      }
      if (r < t1) {
        t1 = r;
      }
    }
    return true;
  };

  return (
    clip(-dx, p0.x - minX) &&
    clip(dx, maxX - p0.x) &&
    clip(-dy, p0.y - minY) &&
    clip(dy, maxY - p0.y)
  );
}

/**
 * True when a stroke's centreline, widened by `padding`, meets the rectangle.
 *
 * Single-sample strokes are tested as points; longer ones are tested as a
 * polyline, so a segment that crosses the rectangle is enough even when no
 * sample falls inside it.
 */
export function strokeIntersectsBounds(
  stroke: StrokeRecord,
  bounds: Bounds,
  padding = 0,
): boolean {
  const count = stroke.xs.length;
  if (count === 0) {
    return false;
  }
  const area = padding > 0 ? inflateBounds(bounds, padding) : bounds;

  if (boundsContainPoint(area, stroke.xs[0], stroke.ys[0])) {
    return true;
  }
  if (count === 1) {
    return false;
  }
  for (let index = 1; index < count; index += 1) {
    const previousInside = boundsContainPoint(
      area,
      stroke.xs[index - 1],
      stroke.ys[index - 1],
    );
    const currentInside = boundsContainPoint(area, stroke.xs[index], stroke.ys[index]);
    if (previousInside || currentInside) {
      return true;
    }
    const p0: Point = { x: stroke.xs[index - 1], y: stroke.ys[index - 1] };
    const p1: Point = { x: stroke.xs[index], y: stroke.ys[index] };
    if (segmentIntersectsBounds(p0, p1, area)) {
      return true;
    }
  }
  return false;
}

/** A tolerance for the polygon tests: points this close count as touching. */
const POLYGON_EPSILON = 1e-9;

/** True when `value` is within the polygon tolerance of zero. */
function nearZero(value: number): boolean {
  return Math.abs(value) <= POLYGON_EPSILON;
}

/**
 * True when the point lies inside the polygon or on one of its edges.
 *
 * Ray casting: a horizontal ray from the point is cast to the right and every
 * edge it crosses flips the answer. The edge test comes first so a point that
 * sits exactly on the boundary is **inside** - a click on the lasso's own line
 * should select rather than miss because of a floating-point tie.
 */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  const count = polygon.length;
  if (count < 3) {
    return false;
  }
  for (let index = 0; index < count; index += 1) {
    if (distancePointToSegment(point, polygon[index], polygon[(index + 1) % count]) <= POLYGON_EPSILON) {
      return true;
    }
  }

  let inside = false;
  for (let index = 0, previous = count - 1; index < count; previous = index, index += 1) {
    const a = polygon[previous];
    const b = polygon[index];
    if (a.y > point.y !== b.y > point.y) {
      const crossingX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < crossingX) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * True when two line segments touch or cross.
 *
 * The orientation test covers proper crossings; the collinear case falls back
 * to the bounding box of each point on the other segment, which is what makes
 * a lasso whose edge runs along a stroke's own segment select it.
 */
export function segmentsIntersect(
  a0: Point,
  a1: Point,
  b0: Point,
  b1: Point,
): boolean {
  const d1 = orientation(a0, a1, b0);
  const d2 = orientation(a0, a1, b1);
  const d3 = orientation(b0, b1, a0);
  const d4 = orientation(b0, b1, a1);

  if (d1 !== d2 && d3 !== d4) {
    return true;
  }
  if (d1 === 0 && pointOnSegment(b0, a0, a1)) {
    return true;
  }
  if (d2 === 0 && pointOnSegment(b1, a0, a1)) {
    return true;
  }
  if (d3 === 0 && pointOnSegment(a0, b0, b1)) {
    return true;
  }
  if (d4 === 0 && pointOnSegment(a1, b0, b1)) {
    return true;
  }
  return false;
}

/** The signed area sign of the triangle `a, b, c`: -1, 0 or 1. */
function orientation(a: Point, b: Point, c: Point): -1 | 0 | 1 {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (nearZero(cross)) {
    return 0;
  }
  return cross > 0 ? 1 : -1;
}

/** True when `point`, known to be collinear with `a` and `b`, lies between them. */
function pointOnSegment(point: Point, a: Point, b: Point): boolean {
  return (
    point.x >= Math.min(a.x, b.x) - POLYGON_EPSILON &&
    point.x <= Math.max(a.x, b.x) + POLYGON_EPSILON &&
    point.y >= Math.min(a.y, b.y) - POLYGON_EPSILON &&
    point.y <= Math.max(a.y, b.y) + POLYGON_EPSILON
  );
}

/** The shortest distance from `point` to the segment `a`-`b`. */
export function distancePointToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** The axis-aligned box around a polygon, or `null` when it has no points. */
export function polygonBounds(polygon: readonly Point[]): Bounds | null {
  if (polygon.length === 0) {
    return null;
  }
  let minX = polygon[0].x;
  let maxX = minX;
  let minY = polygon[0].y;
  let maxY = minY;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * True when a stroke's centreline, widened by `padding`, meets the polygon.
 *
 * A stroke counts when a sample is inside the lasso, when a segment crosses an
 * edge (a fast diagonal can cross with every stored sample outside), or - with
 * padding - when the painted width reaches the boundary from outside. The
 * polygon's own box rejects distant strokes before the edge tests.
 */
export function strokeIntersectsPolygon(
  stroke: StrokeRecord,
  polygon: readonly Point[],
  padding = 0,
): boolean {
  const count = stroke.xs.length;
  if (count === 0 || polygon.length < 3) {
    return false;
  }
  const box = polygonBounds(polygon);
  if (!box) {
    return false;
  }
  const area = inflateBounds(box, padding);
  let strokeMinX = stroke.xs[0];
  let strokeMaxX = stroke.xs[0];
  let strokeMinY = stroke.ys[0];
  let strokeMaxY = stroke.ys[0];
  for (let index = 1; index < count; index += 1) {
    strokeMinX = Math.min(strokeMinX, stroke.xs[index]);
    strokeMaxX = Math.max(strokeMaxX, stroke.xs[index]);
    strokeMinY = Math.min(strokeMinY, stroke.ys[index]);
    strokeMaxY = Math.max(strokeMaxY, stroke.ys[index]);
  }
  if (
    strokeMaxX < area.x ||
    strokeMinX > area.x + area.width ||
    strokeMaxY < area.y ||
    strokeMinY > area.y + area.height
  ) {
    return false;
  }

  for (let index = 0; index < count; index += 1) {
    if (pointInPolygon({ x: stroke.xs[index], y: stroke.ys[index] }, polygon)) {
      return true;
    }
  }

  const edgeCount = polygon.length;
  for (let index = 1; index < count; index += 1) {
    const a0: Point = { x: stroke.xs[index - 1], y: stroke.ys[index - 1] };
    const a1: Point = { x: stroke.xs[index], y: stroke.ys[index] };
    for (let edge = 0; edge < edgeCount; edge += 1) {
      const b0 = polygon[edge];
      const b1 = polygon[(edge + 1) % edgeCount];
      if (segmentsIntersect(a0, a1, b0, b1)) {
        return true;
      }
    }
  }

  if (padding <= 0) {
    return false;
  }

  // The widened stroke can reach the lasso without either centreline touching
  // it: a sample near an edge, or an edge's own corner near a stroke segment.
  for (let index = 0; index < count; index += 1) {
    const point: Point = { x: stroke.xs[index], y: stroke.ys[index] };
    for (let edge = 0; edge < edgeCount; edge += 1) {
      if (distancePointToSegment(point, polygon[edge], polygon[(edge + 1) % edgeCount]) <= padding) {
        return true;
      }
    }
  }
  for (const vertex of polygon) {
    for (let index = 1; index < count; index += 1) {
      const a0: Point = { x: stroke.xs[index - 1], y: stroke.ys[index - 1] };
      const a1: Point = { x: stroke.xs[index], y: stroke.ys[index] };
      if (distancePointToSegment(vertex, a0, a1) <= padding) {
        return true;
      }
    }
  }
  return false;
}
