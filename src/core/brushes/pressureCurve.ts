/**
 * Pressure-response curves.
 *
 * A curve is a short list of points in the unit square, sorted by raw pressure
 * (`x`) and read as a piecewise-linear mapping to the pressure the brush uses
 * (`y`). It is deliberately not a spline: a pen's response is a user-tuned
 * lookup table, and a polyline is predictable, easy to draw and cheap to
 * evaluate in the rasterization loop.
 *
 * This is an independent implementation from the documented behaviour of a
 * piecewise-linear mapping. No third-party source is copied.
 */

import type { PressureCurvePoint } from "../../types/brush";

/** Upper bound on points in one curve, so a project file cannot bloat. */
export const MAX_PRESSURE_CURVE_POINTS = 32;

/** The identity mapping, shared so equality checks can be cheap. */
export const IDENTITY_PRESSURE_CURVE: readonly PressureCurvePoint[] = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 1, y: 1 }),
]);

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The mapped pressure for a raw pressure.
 *
 * Clamps outside the curve's endpoint x values to the endpoint y values, so a
 * curve that starts at x=0.2 has a flat response below 0.2 rather than an
 * extrapolated one. Allocation-free: this runs for every stored sample in a
 * stroke rebuild.
 */
export function evaluatePressureCurve(
  curve: readonly PressureCurvePoint[],
  pressure: number,
): number {
  const x = clamp01(Number.isFinite(pressure) ? pressure : 0);
  const count = curve.length;
  if (count === 0) {
    return x;
  }
  const first = curve[0];
  if (x <= first.x) {
    return clamp01(first.y);
  }
  const last = curve[count - 1];
  if (x >= last.x) {
    return clamp01(last.y);
  }
  for (let index = 1; index < count; index += 1) {
    const right = curve[index];
    if (x <= right.x) {
      const left = curve[index - 1];
      const span = right.x - left.x;
      if (span <= 0) {
        return clamp01(right.y);
      }
      const t = (x - left.x) / span;
      return clamp01(left.y + (right.y - left.y) * t);
    }
  }
  return clamp01(last.y);
}

function isIdentity(curve: readonly PressureCurvePoint[]): boolean {
  return (
    curve.length === 2 &&
    curve[0].x === 0 &&
    curve[0].y === 0 &&
    curve[1].x === 1 &&
    curve[1].y === 1
  );
}

/**
 * Normalizes an untrusted curve.
 *
 * Invalid input never throws: a non-array, fewer than two usable points, or a
 * curve whose x values collapse to one value becomes the identity. Valid points
 * have both coordinates clamped to `[0, 1]`, are sorted by x, and keep the first
 * point when two share an x. Missing endpoints are added with a flat extension
 * of the nearest segment, and the list is capped at
 * `MAX_PRESSURE_CURVE_POINTS` by dropping middle points.
 */
export function normalizePressureCurve(value: unknown): readonly PressureCurvePoint[] {
  if (!Array.isArray(value)) {
    return IDENTITY_PRESSURE_CURVE;
  }

  const points: PressureCurvePoint[] = [];
  for (const raw of value) {
    if (points.length >= MAX_PRESSURE_CURVE_POINTS) {
      break;
    }
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const record = raw as { readonly x?: unknown; readonly y?: unknown };
    if (
      typeof record.x !== "number" ||
      typeof record.y !== "number" ||
      !Number.isFinite(record.x) ||
      !Number.isFinite(record.y)
    ) {
      continue;
    }
    points.push({ x: clamp01(record.x), y: clamp01(record.y) });
  }

  if (points.length < 2) {
    return IDENTITY_PRESSURE_CURVE;
  }

  points.sort((a, b) => a.x - b.x);

  // Strictly increasing x: the first point at a given pressure wins.
  const deduped: PressureCurvePoint[] = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (previous && point.x <= previous.x) {
      continue;
    }
    deduped.push(point);
  }
  if (deduped.length < 2) {
    return IDENTITY_PRESSURE_CURVE;
  }

  if (deduped[0].x > 0) {
    deduped.unshift({ x: 0, y: deduped[0].y });
  }
  if (deduped[deduped.length - 1].x < 1) {
    deduped.push({ x: 1, y: deduped[deduped.length - 1].y });
  }

  while (deduped.length > MAX_PRESSURE_CURVE_POINTS) {
    // Keep both endpoints; drop a middle point.
    deduped.splice(Math.floor(deduped.length / 2), 1);
  }

  return isIdentity(deduped) ? IDENTITY_PRESSURE_CURVE : deduped;
}

/** True when two curves describe the same mapping. */
export function pressureCurvesEqual(
  a: readonly PressureCurvePoint[],
  b: readonly PressureCurvePoint[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].x !== b[index].x || a[index].y !== b[index].y) {
      return false;
    }
  }
  return true;
}
