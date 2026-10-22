/**
 * Selecting strokes with a rectangle.
 *
 * The unit of selection in this engine is the **stroke**, not the pixel: layer
 * pixels are a cache rasterized from the stroke list (see
 * `docs/ARCHITECTURE.md`), so a marquee decides which strokes a transform will
 * move, and nothing is ever baked. That keeps moving undoable, re-rasterizable
 * and reproducible from a reopened file, at the cost of being explicit about it
 * here.
 *
 * A stroke counts as selected when its centreline meets the marquee, widened by
 * half the stroke's painted width (`padding`). Widening is what makes the rule
 * match what the user sees: the pixels of a stroke on the very edge of the
 * marquee reach inside it, so the stroke selects. The padding is passed in
 * rather than computed here so this module stays free of brush and rendering
 * knowledge; the caller supplies half the stroke's diameter.
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
 * True when the stroke's own bounding box reaches the rectangle.
 *
 * A stroke is a polyline, so every point of it lies inside its bounding box:
 * when the box does not reach the rectangle, no part of the stroke can meet
 * it either. The check is one cheap pass over the samples, where the segment
 * test below costs a division per edge per segment, so it is what keeps a
 * marquee over a busy layer affordable.
 */
function boundsMeetStrokeBox(area: Bounds, stroke: StrokeRecord): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < stroke.xs.length; index += 1) {
    const x = stroke.xs[index];
    const y = stroke.ys[index];
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return (
    maxX >= area.x &&
    minX <= area.x + area.width &&
    maxY >= area.y &&
    minY <= area.y + area.height
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
  // The cheap rejection first: most strokes of a layer are nowhere near the
  // band, and the box answers that without a segment test.
  if (!boundsMeetStrokeBox(area, stroke)) {
    return false;
  }

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
