/** Default brush configuration and validation. */

import type { BrushSettings, PressureCurvePoint, TaperSettings } from "../../types/brush";
import { hexToRgb, rgbToHex } from "../../utils/color";
import { clamp } from "../../utils/math";
import { asRecord } from "../../utils/record";
import {
  IDENTITY_PRESSURE_CURVE,
  normalizePressureCurve,
  pressureCurvesEqual,
} from "./pressureCurve";
import { DEFAULT_TAPER, normalizeTaper, taperSettingsEqual } from "./taper";

/** The identity pressure response every pre-curve file behaves like. */
export const DEFAULT_PRESSURE_CURVE = IDENTITY_PRESSURE_CURVE;

/** The colour a right-button stroke paints with until the user changes it. */
export const DEFAULT_SECONDARY_COLOR = "#ffffff";

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 512;
export const MIN_SPACING = 0.02;
export const MAX_SPACING = 2;
/**
 * Dab distance, as a fraction of the brush size: 2 % to 100 %.
 *
 * The maximum is the brush's own diameter: beyond it the dabs no longer
 * touch, and the stroke reads as a dotted line rather than a stroke.
 */
export const MIN_STAMP_SPACING = 0.02;
export const MAX_STAMP_SPACING = 1;

/**
 * Defaults are tuned for mouse and pen input on a white document:
 * a small dark stroke whose width follows pressure when a pen provides it.
 */
export const DEFAULT_BRUSH: BrushSettings = {
  size: 6,
  opacity: 1,
  color: "#16181c",
  hardness: 1,
  pressureSize: 0.6,
  pressureOpacity: 0,
  pressureCurve: IDENTITY_PRESSURE_CURVE,
  minSizeRatio: 0.12,
  spacing: 0.12,
  stabilizer: 0,
  texture: 0,
  stamp: false,
  stampSpacing: 0.1,
  stampHardness: 1,
  stampTexture: 0,
  taper: DEFAULT_TAPER,
};

/** Clamps and validates a brush configuration. */
export function normalizeBrush(brush: BrushSettings): BrushSettings {
  return {
    size: clamp(brush.size, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE),
    opacity: clamp(brush.opacity, 0, 1),
    color: brush.color.trim() === "" ? DEFAULT_BRUSH.color : brush.color,
    hardness: clamp(brush.hardness, 0, 1),
    pressureSize: clamp(brush.pressureSize, 0, 1),
    pressureOpacity: clamp(brush.pressureOpacity, 0, 1),
    pressureCurve: normalizePressureCurve(brush.pressureCurve),
    minSizeRatio: clamp(brush.minSizeRatio, 0.02, 1),
    spacing: clamp(brush.spacing, MIN_SPACING, MAX_SPACING),
    stabilizer: clamp(brush.stabilizer, 0, 1),
    texture: clamp(brush.texture, 0, 1),
    stamp: brush.stamp === true,
    stampSpacing: clamp(brush.stampSpacing, MIN_STAMP_SPACING, MAX_STAMP_SPACING),
    stampHardness: clamp(brush.stampHardness, 0, 1),
    stampTexture: clamp(brush.stampTexture, 0, 1),
    taper: normalizeTaper(brush.taper),
  };
}

/* --------------------------------------------------------------------------
 * The brush's fields.
 *
 * Every field of a brush is claimed by exactly one of the three lists below,
 * and `readBrushSettings` walks the lists instead of reading properties one
 * by one. That is deliberate: a hand-written list of property reads is how
 * `stampTexture` was written to the settings file and then read back as the
 * default, because the reader that rebuilt the brush field by field did not
 * mention it.
 * ----------------------------------------------------------------------- */

/** The fields whose value is a number. */
type NumericBrushField = {
  [K in keyof BrushSettings]: BrushSettings[K] extends number ? K : never;
}[keyof BrushSettings];

/** The fields whose value is a flag. */
type FlagBrushField = {
  [K in keyof BrushSettings]: BrushSettings[K] extends boolean ? K : never;
}[keyof BrushSettings];

/** The fields whose value is a colour. */
type ColorBrushField = {
  [K in keyof BrushSettings]: BrushSettings[K] extends string ? K : never;
}[keyof BrushSettings];

/** Every numeric field of a brush. */
export const BRUSH_NUMBER_FIELDS = [
  "size",
  "opacity",
  "hardness",
  "pressureSize",
  "pressureOpacity",
  "minSizeRatio",
  "spacing",
  "stabilizer",
  "texture",
  "stampSpacing",
  "stampHardness",
  "stampTexture",
] as const satisfies readonly NumericBrushField[];

/** Every flag field of a brush. */
export const BRUSH_FLAG_FIELDS = ["stamp"] as const satisfies readonly FlagBrushField[];

/** Every colour field of a brush. */
export const BRUSH_COLOR_FIELDS = ["color"] as const satisfies readonly ColorBrushField[];

/** The fields whose value is a pressure curve. */
type CurveBrushField = {
  [K in keyof BrushSettings]: BrushSettings[K] extends readonly PressureCurvePoint[] ? K : never;
}[keyof BrushSettings];

/** Every curve field of a brush. */
export const BRUSH_CURVE_FIELDS = [
  "pressureCurve",
] as const satisfies readonly CurveBrushField[];

/** The fields whose value is a taper. */
type TaperBrushField = {
  [K in keyof BrushSettings]: BrushSettings[K] extends TaperSettings ? K : never;
}[keyof BrushSettings];

/** Every taper field of a brush. */
export const BRUSH_TAPER_FIELDS = ["taper"] as const satisfies readonly TaperBrushField[];

/** Every field a brush has, according to the lists above. */
type ListedBrushField =
  | (typeof BRUSH_NUMBER_FIELDS)[number]
  | (typeof BRUSH_FLAG_FIELDS)[number]
  | (typeof BRUSH_COLOR_FIELDS)[number]
  | (typeof BRUSH_CURVE_FIELDS)[number]
  | (typeof BRUSH_TAPER_FIELDS)[number];

/** A brush field that no list above claims. */
type UnlistedBrushField = Exclude<keyof BrushSettings, ListedBrushField>;

/**
 * Compile-time guard: every brush field is claimed by a list above.
 *
 * A field added to `BrushSettings` and not to one of the lists makes this
 * line fail to compile, because the reader below would quietly fall back to
 * the default for it and drop it from every file written from that point on.
 */
export const EVERY_BRUSH_FIELD_IS_LISTED: UnlistedBrushField extends never ? true : never = true;

/** A brush whose fields can be written, for the reader that fills it in. */
type MutableBrush = { -readonly [K in keyof BrushSettings]: BrushSettings[K] };

/** Writes one field of a brush, keeping the field's type honest. */
function assign<K extends keyof BrushSettings>(
  target: MutableBrush,
  field: K,
  value: BrushSettings[K],
): void {
  target[field] = value;
}

/**
 * A colour out of an untrusted value, or the fallback.
 *
 * The engine only accepts a hex colour, so a value that is not one is a file
 * that was edited by hand, and the fallback is the honest answer.
 */
function readColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const rgb = hexToRgb(value.trim());
  return rgb === null ? fallback : rgbToHex(rgb);
}

/**
 * Reads a brush out of an untrusted record.
 *
 * This is the one place a brush is rebuilt field by field, so it is driven by
 * the field lists above rather than by a list of property reads: a field that
 * is added to `BrushSettings` is read here as soon as it is claimed by a list,
 * and the compile-time guard fails the build when it is not.
 *
 * A missing or malformed field takes its default, and the result is clamped
 * by `normalizeBrush`, so the returned brush is always usable.
 */
export function readBrushSettings(value: unknown): BrushSettings {
  const record = asRecord(value);
  if (record === null) {
    return DEFAULT_BRUSH;
  }
  const merged: MutableBrush = { ...DEFAULT_BRUSH };
  for (const field of BRUSH_NUMBER_FIELDS) {
    const raw = record[field];
    assign(
      merged,
      field,
      typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_BRUSH[field],
    );
  }
  for (const field of BRUSH_FLAG_FIELDS) {
    assign(merged, field, record[field] === true);
  }
  for (const field of BRUSH_COLOR_FIELDS) {
    assign(merged, field, readColor(record[field], DEFAULT_BRUSH[field]));
  }
  for (const field of BRUSH_CURVE_FIELDS) {
    assign(merged, field, normalizePressureCurve(record[field]));
  }
  for (const field of BRUSH_TAPER_FIELDS) {
    assign(merged, field, normalizeTaper(record[field]));
  }
  return normalizeBrush(merged);
}

export function updateBrushSettings(
  current: BrushSettings,
  patch: Partial<BrushSettings>,
): BrushSettings {
  return normalizeBrush({ ...current, ...patch });
}

/** Field-wise comparison, used to skip no-op updates and their re-renders. */
export function brushSettingsEqual(a: BrushSettings, b: BrushSettings): boolean {
  return (
    a.size === b.size &&
    a.opacity === b.opacity &&
    a.color === b.color &&
    a.hardness === b.hardness &&
    a.pressureSize === b.pressureSize &&
    a.pressureOpacity === b.pressureOpacity &&
    pressureCurvesEqual(a.pressureCurve, b.pressureCurve) &&
    a.minSizeRatio === b.minSizeRatio &&
    a.spacing === b.spacing &&
    a.stabilizer === b.stabilizer &&
    a.texture === b.texture &&
    a.stamp === b.stamp &&
    a.stampSpacing === b.stampSpacing &&
    a.stampHardness === b.stampHardness &&
    a.stampTexture === b.stampTexture &&
    taperSettingsEqual(a.taper, b.taper)
  );
}

/**
 * Steps the brush size for the `[` / `]` shortcuts: one pixel for small
 * brushes, ten percent for larger ones, so the step stays useful at both ends.
 */
export function stepBrushSize(current: number, direction: 1 | -1): number {
  const step = current < 10 ? 1 : Math.max(1, Math.round(current * 0.1));
  return clamp(current + direction * step, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
}
