/**
 * The stroke taper: the width ramp at the start and the end of a stroke.
 *
 * The taper is a property of the brush and is captured per stroke, like every
 * other appearance field. It is a **pure** module: the width factor of every
 * sample is a function of the samples and the brush alone, so live drawing, a
 * layer rebuild, undo/redo, a reopened project and a PNG export all agree.
 *
 * The model is deliberately predictable:
 *
 *  - The ramp's length is a fraction of the brush's nominal size, so a taper
 *    means the same thing at every brush size, at every zoom and at every
 *    `rasterScale`.
 *  - The strength is how much narrower the stroke is at the tip, as a
 *    fraction of its full width: `0` is no taper at all, `1` is a point.
 *  - The width ramps linearly along the path, measured as arc length, so a
 *    fast stroke and a slow one taper over the same distance.
 *  - Where the two ramps overlap - a stroke shorter than the two ramps put
 *    together - the narrower of the two wins. A short stroke is therefore a
 *    lens rather than a bow tie, and a stroke that is exactly one ramp long
 *    is a single triangle.
 *
 * A stroke with no path (a tap) or no length at all cannot taper: there is no
 * distance for a ramp to run along, so the factor list is empty and the
 * stroke is drawn at its full width.
 */

import type { TaperSettings } from "../../types/brush";
import { clamp } from "../../utils/math";
import { asRecord } from "../../utils/record";

/** The taper every brush has until the user asks for one. */
export const DEFAULT_TAPER: TaperSettings = {
  enabled: false,
  startLength: 0,
  startStrength: 0,
  endLength: 0,
  endStrength: 0,
};

/**
 * The longest ramp, as a fraction of the brush size.
 *
 * A ramp longer than the brush's own diameter is already a very long
 * gradient; twice the diameter is the ceiling, and it keeps the slider's
 * range bounded.
 */
export const MAX_TAPER_LENGTH = 2;

/** Reads a number out of an untrusted record, or takes the fallback. */
function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clamp(value, min, max);
}

/**
 * Normalizes an untrusted taper.
 *
 * A value that is not an object at all becomes the default taper, and every
 * field is clamped, so the result is always usable. This is the same shape as
 * `normalizePressureCurve`: the readers in the settings file and in the
 * project file both go through it.
 */
export function normalizeTaper(value: unknown): TaperSettings {
  const record = asRecord(value);
  if (record === null) {
    return DEFAULT_TAPER;
  }
  return {
    enabled: record.enabled === true,
    startLength: readNumber(record.startLength, DEFAULT_TAPER.startLength, 0, MAX_TAPER_LENGTH),
    startStrength: readNumber(record.startStrength, DEFAULT_TAPER.startStrength, 0, 1),
    endLength: readNumber(record.endLength, DEFAULT_TAPER.endLength, 0, MAX_TAPER_LENGTH),
    endStrength: readNumber(record.endStrength, DEFAULT_TAPER.endStrength, 0, 1),
  };
}

/** Field-wise comparison, used to skip no-op updates and their re-renders. */
export function taperSettingsEqual(a: TaperSettings, b: TaperSettings): boolean {
  return (
    a.enabled === b.enabled &&
    a.startLength === b.startLength &&
    a.startStrength === b.startStrength &&
    a.endLength === b.endLength &&
    a.endStrength === b.endStrength
  );
}

/**
 * True when the taper narrows the stroke.
 *
 * A taper that is switched on but does not narrow anything - no ramp, or a
 * ramp that ends at the full width - changes no pixel, so the stroke keeps
 * the plain path and pays nothing for it.
 */
export function taperIsActive(taper: TaperSettings): boolean {
  if (!taper.enabled) {
    return false;
  }
  const startNarrows = taper.startLength > 0 && taper.startStrength > 0;
  const endNarrows = taper.endLength > 0 && taper.endStrength > 0;
  return startNarrows || endNarrows;
}

/**
 * The width factor of every sample, in `[0, 1]`.
 *
 * `1` is the stroke's full width, `0` is a point. The list is empty when the
 * taper does not apply: the taper is off, it narrows nothing, the stroke has
 * no samples, or the stroke has no length (a tap, or a pointer that did not
 * move). An empty list is the signal that the stroke is drawn the plain way.
 *
 * The factors are measured along the path, so the ramp covers the same
 * distance whatever the pointer did.
 */
export function taperWidthFactors(
  taper: TaperSettings,
  size: number,
  xs: readonly number[],
  ys: readonly number[],
): number[] {
  const count = Math.min(xs.length, ys.length);
  if (!taperIsActive(taper) || count === 0) {
    return [];
  }

  const startLength = taper.startLength * size;
  const endLength = taper.endLength * size;

  // The arc length along the path: the distance a ramp runs along.
  const lengths = new Float64Array(count);
  for (let index = 1; index < count; index += 1) {
    lengths[index] =
      lengths[index - 1] + Math.hypot(xs[index] - xs[index - 1], ys[index] - ys[index - 1]);
  }
  const total = lengths[count - 1];
  if (!(total > 0)) {
    // A stroke without a length has no distance to taper over: it is drawn
    // at its full width, like a tap.
    return [];
  }

  const factors = new Array<number>(count);
  const startTip = 1 - taper.startStrength;
  const endTip = 1 - taper.endStrength;
  for (let index = 0; index < count; index += 1) {
    const travelled = lengths[index];
    let factor = 1;
    if (startLength > 0 && travelled < startLength) {
      const ramp = startTip + (1 - startTip) * (travelled / startLength);
      factor = Math.min(factor, ramp);
    }
    if (endLength > 0 && total - travelled < endLength) {
      const ramp = endTip + (1 - endTip) * ((total - travelled) / endLength);
      factor = Math.min(factor, ramp);
    }
    factors[index] = clamp(factor, 0, 1);
  }
  return factors;
}
