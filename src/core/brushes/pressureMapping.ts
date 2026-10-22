/**
 * Pressure mappings: how one brush property answers pressure.
 *
 * A mapping is a straight line between two ends: `min` is the response at
 * zero pressure, `max` the response at full pressure, and the response
 * between them is the interpolation. Both are fractions of the property's own
 * value - the size response is a fraction of the brush's diameter, the
 * opacity response a fraction of the brush's opacity, the flow response a
 * fraction of the ink one dab deposits - so a mapping never changes what a
 * property *is*, only how far pressure moves it.
 *
 * The *shape* of the response is not decided here: it comes from the brush's
 * pressure curve, which every property shares. The chain is
 *
 * ```
 * raw device pressure -> pressure curve -> property response -> property
 * ```
 *
 * The curve and the mapping are applied at the brush's mapping boundary -
 * the rasterizer - and never while a sample is captured. A stored sample
 * keeps the raw pressure the device reported, so the same mapping produces
 * the same picture in live drawing, in a layer rebuild, after undo/redo, in a
 * reopened project and in a PNG export, and it is never applied twice.
 *
 * This module is an independent implementation of an affine response. No
 * third-party source is copied.
 */

import type { BrushSettings, PressureMapping } from "../../types/brush";
import { asRecord } from "../../utils/record";
import { evaluatePressureCurve } from "./pressureCurve";

/**
 * A mapping that does nothing: the property keeps its full value whatever
 * the pressure is.
 */
export const DISABLED_PRESSURE_MAPPING: PressureMapping = Object.freeze({
  enabled: false,
  min: 0,
  max: 1,
});

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The mapping a pre-mapping brush strength stands for.
 *
 * Before the mappings existed, a brush carried one number per property: how
 * strongly pressure modulated it. A strength of `0.6` meant "the response
 * runs from 40 % of the value at no pressure to the full value at full
 * pressure", which is exactly the mapping `{ min: 0.4, max: 1 }`. A strength
 * of `0` meant "pressure does not touch the property", which is the same flat
 * response as `{ min: 1, max: 1 }`.
 *
 * This is what reads a project written by an older build, and what the
 * settings reader uses for a brush saved before the mappings existed.
 */
export function legacyPressureMapping(strength: number): PressureMapping {
  const amount = clamp01(Number.isFinite(strength) ? strength : 0);
  if (amount <= 0) {
    return { enabled: false, min: 1, max: 1 };
  }
  return { enabled: true, min: 1 - amount, max: 1 };
}

/**
 * Normalizes an untrusted mapping.
 *
 * Invalid input never throws: a number is read as a pre-mapping strength, an
 * object is read field by field, and anything else becomes the disabled
 * mapping. Both ends are clamped to `[0, 1]` and swapped when they arrive the
 * wrong way round, so the response is always a rising line between them. A
 * mapping that is switched off keeps its ends, so switching it back on
 * restores the range the user chose.
 */
export function normalizePressureMapping(value: unknown): PressureMapping {
  if (typeof value === "number") {
    return legacyPressureMapping(value);
  }
  const record = asRecord(value);
  if (record === null) {
    return DISABLED_PRESSURE_MAPPING;
  }
  const min = readEnd(record.min, 0);
  const max = readEnd(record.max, 1);
  return {
    enabled: record.enabled === true,
    min: Math.min(min, max),
    max: Math.max(min, max),
  };
}

/** One end of a mapping: a number in `[0, 1]`, or the fallback. */
function readEnd(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clamp01(value);
}

/**
 * The response of one mapping at one pressure.
 *
 * A disabled mapping answers `1`: the property keeps its full value. An
 * enabled mapping interpolates between its two ends, and a pressure outside
 * `[0, 1]` - or one that is not a number at all - is clamped, so the
 * response is always a usable number.
 *
 * The interpolation is written as `max - (max - min) * (1 - pressure)` on
 * purpose: for the mapping a pre-mapping strength stands for, that is the
 * very expression the old formula used, so a project written before the
 * mappings existed is rasterized to the same numbers it always was.
 */
export function evaluatePressureMapping(
  mapping: PressureMapping,
  pressure: number,
): number {
  if (!mapping.enabled) {
    return 1;
  }
  const amount = clamp01(Number.isFinite(pressure) ? pressure : 0);
  const min = clamp01(mapping.min);
  const max = clamp01(mapping.max);
  return max - (max - min) * (1 - amount);
}

/**
 * The response of one property of a brush at one raw pressure.
 *
 * This is the whole chain: the brush's pressure curve turns the raw device
 * pressure into the pressure the brush reacts to, and the mapping turns that
 * into the property's response. Both the renderer and the panel's preview go
 * through here, so the picture and the preview cannot drift apart.
 */
export function pressureResponse(
  brush: BrushSettings,
  mapping: PressureMapping,
  pressure: number,
): number {
  return evaluatePressureMapping(mapping, evaluatePressureCurve(brush.pressureCurve, pressure));
}

/** True when two mappings describe the same response. */
export function pressureMappingsEqual(a: PressureMapping, b: PressureMapping): boolean {
  return a.enabled === b.enabled && a.min === b.min && a.max === b.max;
}
