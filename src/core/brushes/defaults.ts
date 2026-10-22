/** Default brush configuration and validation. */

import type {
  BrushSettings,
  PressureCurvePoint,
  StampTextureMode,
  StampTipKind,
} from "../../types/brush";
import { hexToRgb, rgbToHex } from "../../utils/color";
import { clamp } from "../../utils/math";
import { asRecord } from "../../utils/record";
import {
  IDENTITY_PRESSURE_CURVE,
  normalizePressureCurve,
  pressureCurvesEqual,
} from "./pressureCurve";

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
 * The tip's minor axis as a fraction of its major axis: 5 % to 100 %.
 *
 * The floor keeps a tip from collapsing into a line: a dab thinner than a
 * twentieth of its length stops reading as a mark and starts reading as a
 * scratch.
 */
export const MIN_STAMP_ASPECT = 0.05;
export const MAX_STAMP_ASPECT = 1;

/** The tip shapes a brush can use.
 *
 * A closed list, so a file that names a tip this build does not know falls
 * back to the round one instead of being drawn as something else.
 */
export const STAMP_TIP_KINDS: readonly StampTipKind[] = ["round", "ellipse", "square"];

/** The tip every brush starts with: the plain round disc. */
export const DEFAULT_STAMP_TIP: StampTipKind = "round";

/**
 * The texture profiles a brush can use.
 *
 * A closed list, like the tips: a file that names a profile this build does
 * not know falls back to the bristles instead of being drawn as something
 * else.
 */
export const STAMP_TEXTURE_MODES: readonly StampTextureMode[] = ["bristles", "ridges"];

/** The texture profile every brush starts with: irregular bristles. */
export const DEFAULT_STAMP_TEXTURE_MODE: StampTextureMode = "bristles";

/**
 * How many bristle lanes there are across the brush, as a multiple of the
 * default four: a quarter to four times as many.
 *
 * The floor keeps the lanes wide enough to read - a lane a fraction of a
 * pixel wide is noise, not texture - and the ceiling keeps them from turning
 * the brush into a grey wash.
 */
export const MIN_STAMP_TEXTURE_SCALE = 0.25;
export const MAX_STAMP_TEXTURE_SCALE = 4;

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
  stampTextureMode: DEFAULT_STAMP_TEXTURE_MODE,
  stampTextureScale: 1,
  stampTextureContrast: 1,
  stampTip: DEFAULT_STAMP_TIP,
  stampAspect: 1,
  stampAngle: 0,
  stampAngleFollow: true,
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
    stampTextureMode: normalizeStampTextureMode(brush.stampTextureMode),
    stampTextureScale: clamp(brush.stampTextureScale, MIN_STAMP_TEXTURE_SCALE, MAX_STAMP_TEXTURE_SCALE),
    stampTextureContrast: clamp(brush.stampTextureContrast, 0, 1),
    stampTip: normalizeStampTip(brush.stampTip),
    stampAspect: clamp(brush.stampAspect, MIN_STAMP_ASPECT, MAX_STAMP_ASPECT),
    stampAngle: normalizeStampAngle(brush.stampAngle),
    stampAngleFollow: brush.stampAngleFollow === true,
  };
}

/**
 * A tip shape out of an untrusted value, or the fallback.
 *
 * The list of shapes is closed, so a name this build does not know - a file
 * written by a newer Paka, or a hand-edited one - falls back to the round
 * disc rather than being drawn as an unknown shape.
 */
export function normalizeStampTip(
  value: unknown,
  fallback: StampTipKind = DEFAULT_STAMP_TIP,
): StampTipKind {
  return typeof value === "string" && (STAMP_TIP_KINDS as readonly string[]).includes(value)
    ? (value as StampTipKind)
    : fallback;
}

/**
 * An angle in degrees, wrapped into `[0, 360)`.
 *
 * The tip's angle is a direction, not a magnitude: `-90` and `270` are the
 * same direction, and a tip that has been turned round twice is back where it
 * started.
 */
export function normalizeStampAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * A texture profile out of an untrusted value, or the fallback.
 *
 * The list of profiles is closed, like the list of tips, so a name this build
 * does not know falls back to the bristles rather than being drawn as
 * something else.
 */
export function normalizeStampTextureMode(
  value: unknown,
  fallback: StampTextureMode = DEFAULT_STAMP_TEXTURE_MODE,
): StampTextureMode {
  return typeof value === "string" && (STAMP_TEXTURE_MODES as readonly string[]).includes(value)
    ? (value as StampTextureMode)
    : fallback;
}

/* --------------------------------------------------------------------------
 * The brush's fields.
 *
 * Every field of a brush is claimed by exactly one of the lists below,
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

/**
 * The fields whose value is a colour.
 *
 * The tip's and the texture profile's names are strings too, but they are
 * closed sets of shapes rather than colours, so they are excluded here and
 * read by their own lists below.
 */
type ColorBrushField = {
  [K in keyof BrushSettings]: BrushSettings[K] extends string
    ? BrushSettings[K] extends StampTipKind | StampTextureMode
      ? never
      : K
    : never;
}[keyof BrushSettings];

/**
 * The fields whose value is a tip shape.
 *
 * A tip is one name out of a closed list, so it is read by its own reader
 * rather than by the colour one, which would reject every name but a hex.
 */
type TipBrushField = {
  [K in keyof BrushSettings]: BrushSettings[K] extends StampTipKind ? K : never;
}[keyof BrushSettings];

/**
 * The fields whose value is a texture profile.
 *
 * A profile is one name out of a closed list, like a tip, so it is read by
 * its own reader rather than by the colour one.
 */
type TextureModeBrushField = {
  [K in keyof BrushSettings]: BrushSettings[K] extends StampTextureMode ? K : never;
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
  "stampAspect",
  "stampAngle",
  "stampTextureScale",
  "stampTextureContrast",
] as const satisfies readonly NumericBrushField[];

/** Every flag field of a brush. */
export const BRUSH_FLAG_FIELDS = [
  "stamp",
  "stampAngleFollow",
] as const satisfies readonly FlagBrushField[];

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

/** Every tip field of a brush. */
export const BRUSH_TIP_FIELDS = ["stampTip"] as const satisfies readonly TipBrushField[];

/** Every texture-profile field of a brush. */
export const BRUSH_TEXTURE_MODE_FIELDS = [
  "stampTextureMode",
] as const satisfies readonly TextureModeBrushField[];

/** Every field a brush has, according to the lists above. */
type ListedBrushField =
  | (typeof BRUSH_NUMBER_FIELDS)[number]
  | (typeof BRUSH_FLAG_FIELDS)[number]
  | (typeof BRUSH_COLOR_FIELDS)[number]
  | (typeof BRUSH_CURVE_FIELDS)[number]
  | (typeof BRUSH_TIP_FIELDS)[number]
  | (typeof BRUSH_TEXTURE_MODE_FIELDS)[number];

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
  for (const field of BRUSH_TIP_FIELDS) {
    assign(merged, field, normalizeStampTip(record[field], DEFAULT_BRUSH[field]));
  }
  for (const field of BRUSH_TEXTURE_MODE_FIELDS) {
    assign(
      merged,
      field,
      normalizeStampTextureMode(record[field], DEFAULT_BRUSH[field]),
    );
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
    a.stampTextureMode === b.stampTextureMode &&
    a.stampTextureScale === b.stampTextureScale &&
    a.stampTextureContrast === b.stampTextureContrast &&
    a.stampTip === b.stampTip &&
    a.stampAspect === b.stampAspect &&
    a.stampAngle === b.stampAngle &&
    a.stampAngleFollow === b.stampAngleFollow
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
