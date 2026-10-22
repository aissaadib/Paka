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

/**
 * A named shape for the pressure response.
 *
 * The presets are the three shapes an artist reaches for: the response is
 * straight, it starts late, or it starts early. They are *curves*, not
 * mappings - a preset says how hard the brush reacts to a given pressure, and
 * every property that answers pressure then follows it.
 */
export interface PressureCurvePreset {
  readonly id: string;
  readonly label: string;
  /** What the preset does, in one sentence, for the control's tooltip. */
  readonly description: string;
  readonly curve: readonly PressureCurvePoint[];
}

/**
 * The named pressure responses.
 *
 * `linear` is the identity: the pressure the brush uses is the pressure the
 * device reported. `soft` starts late - a light touch barely marks and the
 * brush only grows near the top of the range. `firm` starts early - a light
 * touch already marks and the top of the range flattens out.
 */
export const PRESSURE_CURVE_PRESETS: readonly PressureCurvePreset[] = Object.freeze([
  Object.freeze({
    id: "linear",
    label: "Linear",
    description: "The pressure the brush uses is the pressure the device reported.",
    curve: IDENTITY_PRESSURE_CURVE,
  }),
  Object.freeze({
    id: "soft",
    label: "Soft",
    description: "A light touch barely marks; the brush grows near the top of the range.",
    curve: Object.freeze([
      Object.freeze({ x: 0, y: 0 }),
      Object.freeze({ x: 0.5, y: 0.25 }),
      Object.freeze({ x: 1, y: 1 }),
    ]),
  }),
  Object.freeze({
    id: "firm",
    label: "Firm",
    description: "A light touch already marks; the top of the range flattens out.",
    curve: Object.freeze([
      Object.freeze({ x: 0, y: 0 }),
      Object.freeze({ x: 0.5, y: 0.75 }),
      Object.freeze({ x: 1, y: 1 }),
    ]),
  }),
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

/** Smallest distance the editor keeps between two points. */
export const MIN_PRESSURE_CURVE_GAP = 0.005;

/**
 * Moves one point, keeping the x order and the fixed endpoints.
 *
 * The first point stays at x=0 and the last at x=1; their response (`y`) is
 * free. A middle point is clamped between its neighbours so the list never has
 * to be re-sorted while the pointer is down. Returns the same array when the
 * point did not move, so a caller can skip a commit.
 */
export function movePressureCurvePoint(
  curve: readonly PressureCurvePoint[],
  index: number,
  x: number,
  y: number,
): readonly PressureCurvePoint[] {
  if (index < 0 || index >= curve.length) {
    return curve;
  }
  const isFirst = index === 0;
  const isLast = index === curve.length - 1;
  const lower = isFirst ? 0 : curve[index - 1].x + MIN_PRESSURE_CURVE_GAP;
  const upper = isLast ? 1 : curve[index + 1].x - MIN_PRESSURE_CURVE_GAP;
  const boundedX = lower > upper ? (lower + upper) / 2 : Math.min(Math.max(x, lower), upper);
  const nextX = isFirst ? 0 : isLast ? 1 : clamp01(boundedX);
  const nextY = clamp01(y);
  if (curve[index].x === nextX && curve[index].y === nextY) {
    return curve;
  }
  const next = curve.slice();
  next[index] = { x: nextX, y: nextY };
  return next;
}

/**
 * Inserts a point between its neighbours.
 *
 * A click past the last middle point lands before the fixed end stop. Returns
 * the same array when the list is full or the gap is too small, so the editor
 * can ignore a no-op click.
 */
export function addPressureCurvePoint(
  curve: readonly PressureCurvePoint[],
  x: number,
  y: number,
): readonly PressureCurvePoint[] {
  if (curve.length >= MAX_PRESSURE_CURVE_POINTS) {
    return curve;
  }
  const clampedX = Math.min(Math.max(x, MIN_PRESSURE_CURVE_GAP), 1 - MIN_PRESSURE_CURVE_GAP);
  let insertAt = curve.findIndex((point) => point.x > clampedX);
  if (insertAt === -1) {
    insertAt = curve.length;
  }
  const before = curve[insertAt - 1];
  const after = curve[insertAt] ?? { x: 1, y: 1 };
  if (!before || after.x - before.x < MIN_PRESSURE_CURVE_GAP * 2) {
    return curve;
  }
  const next = curve.slice();
  next.splice(insertAt, 0, {
    x: Math.min(Math.max(clampedX, before.x + MIN_PRESSURE_CURVE_GAP), after.x - MIN_PRESSURE_CURVE_GAP),
    y: clamp01(y),
  });
  return next;
}

/** Removes a middle point; the endpoints are fixed and cannot be removed. */
export function removePressureCurvePoint(
  curve: readonly PressureCurvePoint[],
  index: number,
): readonly PressureCurvePoint[] {
  if (index <= 0 || index >= curve.length - 1) {
    return curve;
  }
  return curve.filter((_, pointIndex) => pointIndex !== index);
}
