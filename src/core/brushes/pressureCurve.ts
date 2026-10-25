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

/** Smallest distance the editor keeps between two points. */
export const MIN_PRESSURE_CURVE_GAP = 0.005;

/**
 * Moves one point, keeping the x order and the fixed endpoints.
 *
 * The first point stays at x=0 and the last at x=1; their response (`y`) is
 * free. A middle point is clamped between its neighbours so the list never has
 * to be re-sorted while the pointer is down. Two neighbours closer than two
 * gaps leave the point nowhere to go: it then keeps its `x` and only its
 * response moves, so a drag can never break the minimum gap. Returns the same
 * array when the point did not move, so a caller can skip a commit.
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
  const hasRoom = lower <= upper;
  const boundedX = hasRoom ? Math.min(Math.max(x, lower), upper) : curve[index].x;
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

/** Whether every two neighbouring points are at least a gap apart. */
export function hasMinimumPressureCurveGap(curve: readonly PressureCurvePoint[]): boolean {
  for (let index = 1; index < curve.length; index += 1) {
    if (curve[index].x - curve[index - 1].x < MIN_PRESSURE_CURVE_GAP) {
      return false;
    }
  }
  return true;
}

/* --------------------------------------------------------------------------
 * The pressure response.
 *
 * A curve is a mapping. A *response* is that mapping with a name, so it can
 * be registered, chosen and compared. The response is the model of the
 * pressure mapping: the brush reads it, and it is evaluated exactly once per
 * sample, on the raw device pressure, at the mapping boundary.
 * ----------------------------------------------------------------------- */

/**
 * A named pressure response: the model of how a device's raw pressure becomes
 * the pressure the brush reacts to.
 *
 * The response carries no strength of its own. How strongly the pressure
 * moves the size and the opacity is the brush's business (`pressureSize` and
 * `pressureOpacity`); the response only decides *which* pressure the brush
 * reads.
 */
export interface PressureResponse {
  /** Stable id, unique across the registry. */
  readonly id: string;
  /** The name the controls show. */
  readonly label: string;
  /** The mapping, from the raw device pressure to the brush pressure. */
  readonly curve: readonly PressureCurvePoint[];
}

/**
 * The response that changes nothing: the raw pressure is the brush pressure.
 *
 * It maps every pressure in `[0, 1]` to itself exactly, so a stroke drawn
 * with it is the stroke that was drawn before the curve existed.
 */
export const DEFAULT_PRESSURE_RESPONSE: PressureResponse = Object.freeze({
  id: "linear",
  label: "Linear",
  curve: IDENTITY_PRESSURE_CURVE,
});

/** A response that builds the size up slowly: a light press stays light. */
export const SOFT_PRESSURE_RESPONSE: PressureResponse = Object.freeze({
  id: "soft",
  label: "Soft",
  curve: Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: 0.5, y: 0.35 }),
    Object.freeze({ x: 1, y: 1 }),
  ]),
});

/** A response that reaches the full size early: a firm, bold line. */
export const HARD_PRESSURE_RESPONSE: PressureResponse = Object.freeze({
  id: "hard",
  label: "Hard",
  curve: Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: 0.5, y: 0.85 }),
    Object.freeze({ x: 1, y: 1 }),
  ]),
});

/**
 * Builds a response from a curve, normalising the curve on the way in.
 *
 * A response always holds a usable curve: the points are sorted, clamped and
 * given their endpoints, so the mapping can be evaluated without any further
 * checks. An empty id becomes `custom`, because a response with no name is
 * still a response.
 */
export function createPressureResponse(
  id: string,
  label: string,
  curve: unknown,
): PressureResponse {
  const trimmedId = id.trim();
  const trimmedLabel = label.trim();
  return {
    id: trimmedId === "" ? "custom" : trimmedId,
    label: trimmedLabel === "" ? (trimmedId === "" ? "Custom" : trimmedId) : trimmedLabel,
    curve: normalizePressureCurve(curve),
  };
}

/**
 * Reads a response out of an untrusted value.
 *
 * Nothing here throws: a value that is not a response falls back to the
 * default one, and a malformed curve falls back to the identity curve.
 */
export function normalizePressureResponse(value: unknown): PressureResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_PRESSURE_RESPONSE;
  }
  const record = value as { readonly id?: unknown; readonly label?: unknown; readonly curve?: unknown };
  const id =
    typeof record.id === "string" && record.id.trim() !== ""
      ? record.id
      : DEFAULT_PRESSURE_RESPONSE.id;
  const label = typeof record.label === "string" && record.label.trim() !== "" ? record.label : id;
  return { id, label, curve: normalizePressureCurve(record.curve) };
}

/** True when two responses are the same model: the same name and mapping. */
export function pressureResponsesEqual(a: PressureResponse, b: PressureResponse): boolean {
  return a.id === b.id && a.label === b.label && pressureCurvesEqual(a.curve, b.curve);
}

/**
 * Whether a response changes the raw pressure at all.
 *
 * Only the exact identity curve is inert: it maps every pressure to itself,
 * so a stroke drawn with it is the stroke that was drawn before the curve
 * existed. A curve that is collinear but split into more points maps the
 * same numbers, yet it is not the identity curve and is not reported as
 * inert - the model reports what it holds, not what it happens to compute.
 */
export function pressureResponseIsInert(response: PressureResponse): boolean {
  return pressureCurvesEqual(response.curve, IDENTITY_PRESSURE_CURVE);
}

/**
 * Maps a raw device pressure to the pressure the brush reacts to.
 *
 * This is the mapping boundary. It is called with the raw pressure the
 * device reported and it is called once: the stored samples keep the raw
 * pressure, so the same mapping runs in live drawing, in a layer rebuild,
 * after undo/redo, in a reopened project and in an export, and a mapped
 * pressure is never fed back in as if it were a raw one.
 *
 * The identity response returns the raw pressure unchanged, exactly.
 */
export function mapPressure(response: PressureResponse, rawPressure: number): number {
  return evaluatePressureCurve(response.curve, rawPressure);
}

/**
 * Maps a stroke's stored raw pressures, once each.
 *
 * The input array is never written to: the samples keep the raw pressure and
 * the mapped values live in a new array, so nothing downstream can mistake a
 * mapped pressure for a raw one.
 */
export function mapPressures(
  response: PressureResponse,
  pressures: readonly number[],
): number[] {
  const mapped = new Array<number>(pressures.length);
  for (let index = 0; index < pressures.length; index += 1) {
    mapped[index] = mapPressure(response, pressures[index]);
  }
  return mapped;
}

/**
 * Adds a point to a response's curve.
 *
 * The rules are the curve's own: the new point keeps a gap from both of its
 * neighbours, the endpoints stay where they are, and a click that cannot
 * honour the gap changes nothing. Returns the same response when nothing
 * changed, so a caller can skip a commit.
 */
export function addPressureResponsePoint(
  response: PressureResponse,
  x: number,
  y: number,
): PressureResponse {
  const curve = addPressureCurvePoint(response.curve, x, y);
  if (curve === response.curve) {
    return response;
  }
  return { ...response, curve };
}

/**
 * Moves a point of a response's curve.
 *
 * The endpoints keep their `x`, a middle point is kept between its
 * neighbours with the minimum gap intact, and the response (`y`) is free.
 * Returns the same response when nothing changed.
 */
export function movePressureResponsePoint(
  response: PressureResponse,
  index: number,
  x: number,
  y: number,
): PressureResponse {
  const curve = movePressureCurvePoint(response.curve, index, x, y);
  if (curve === response.curve) {
    return response;
  }
  return { ...response, curve };
}

/**
 * Removes a middle point of a response's curve.
 *
 * The endpoints are fixed and cannot be removed. Returns the same response
 * when nothing changed.
 */
export function removePressureResponsePoint(
  response: PressureResponse,
  index: number,
): PressureResponse {
  const curve = removePressureCurvePoint(response.curve, index);
  if (curve === response.curve) {
    return response;
  }
  return { ...response, curve };
}

const responses = new Map<string, PressureResponse>();

/** Adds a response, or replaces the one already registered under the same id. */
export function registerPressureResponse(response: PressureResponse): PressureResponse {
  if (response.id.trim() === "") {
    throw new Error("a pressure response needs a non-empty id");
  }
  responses.set(response.id, response);
  return response;
}

/** Removes a response. Returns whether one was there. */
export function unregisterPressureResponse(id: string): boolean {
  return responses.delete(id);
}

/** Every registered response, in registration order. */
export function listPressureResponses(): readonly PressureResponse[] {
  return [...responses.values()];
}

/** One response by id, or `undefined`. */
export function findPressureResponse(id: string): PressureResponse | undefined {
  return responses.get(id);
}

/**
 * Empties the registry.
 *
 * Only for tests: the built-in responses register themselves when their
 * module is evaluated.
 */
export function resetPressureResponses(): void {
  responses.clear();
}

registerPressureResponse(DEFAULT_PRESSURE_RESPONSE);
registerPressureResponse(SOFT_PRESSURE_RESPONSE);
registerPressureResponse(HARD_PRESSURE_RESPONSE);
