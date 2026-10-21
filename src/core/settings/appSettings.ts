/**
 * The application settings: the editor preferences that survive a restart.
 *
 * A settings file is **not** a project file. It holds no drawing, it is not in
 * the project format, and it never makes a document dirty: changing a
 * preference changes what the *next* gesture will do, exactly like the brush
 * settings do today, and every committed stroke keeps the settings it was
 * drawn with.
 *
 * The file is small, explicit and versioned. Everything in it is validated on
 * the way in, because the file is on disk and a user (or a bad upgrade, or a
 * half-written file) can put anything in it:
 *
 *  - a **missing** field takes its default;
 *  - an **out-of-range** value is clamped into range, not rejected;
 *  - a **malformed** value takes its default;
 *  - a file from a **newer** version is ignored wholesale, because its meaning
 *    is unknown rather than merely wrong;
 *  - a file that is not valid JSON at all yields the defaults.
 *
 * A corrupt settings file must never stop the editor from starting, so every
 * one of those paths ends in a usable set of settings rather than an error.
 */

import { DEFAULT_BRUSH, brushSettingsEqual, normalizeBrush } from "../brushes/defaults";
import { DEFAULT_GRADIENT_END_COLOR } from "../gradient/gradientRecord";
import { DEFAULT_SHAPE_OPTIONS, normalizeShapeOptions } from "../tools/shapeGeometry";
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions";
import type { BrushSettings } from "../../types/brush";
import type { ToolId } from "../../types/tool";
import { hexToRgb, rgbToHex } from "../../utils/color";
import { clamp } from "../../utils/math";

/** The version of the settings file this build reads and writes. */
export const SETTINGS_VERSION = 1;

/**
 * The persisted editor preferences.
 *
 * Every field is editor state: it describes the *next* gesture, and it is
 * never part of a document.
 */
export interface AppSettings {
  /** The settings-file version. Always {@link SETTINGS_VERSION} after loading. */
  readonly version: typeof SETTINGS_VERSION;
  /** The brush the editor starts with. */
  readonly brush: BrushSettings;
  /** The tool the editor starts with. */
  readonly toolId: ToolId;
  /** Whether the shape tools fill their outline. */
  readonly shapeFill: boolean;
  /** Sides of the next polygon, and points of the next star. */
  readonly shapeSides: number;
  /** The star's inner radius as a fraction of its outer radius. */
  readonly shapeInnerRatio: number;
  /** Rotation of the next polygon or star, in degrees. */
  readonly shapeRotation: number;
  /** Bucket-fill colour tolerance in 8-bit sRGB channel units (0-255). */
  readonly fillTolerance: number;
  /** Whether the next gradient is linear or radial. */
  readonly gradientType: "linear" | "radial";
  /** End colour of the next gradient. */
  readonly gradientEndColor: string;
}

/** The settings a fresh installation starts from. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  brush: DEFAULT_BRUSH,
  toolId: "brush",
  shapeFill: false,
  shapeSides: DEFAULT_SHAPE_OPTIONS.sides,
  shapeInnerRatio: DEFAULT_SHAPE_OPTIONS.innerRatio,
  shapeRotation: DEFAULT_SHAPE_OPTIONS.rotation,
  fillTolerance: 24,
  gradientType: "linear",
  gradientEndColor: DEFAULT_GRADIENT_END_COLOR,
};

const TOOL_IDS = new Set<string>(TOOL_DEFINITIONS.map((definition) => definition.id));

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * The colour of a setting, or the fallback.
 *
 * The engine only ever accepts a hex colour for the gradient's end colour
 * (`setGradientEndColor` resolves it through `hexToRgb`), so a settings file
 * that holds anything else is a file that was edited by hand, and the default
 * is the honest answer.
 */
function colorOr(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const rgb = hexToRgb(value.trim());
  return rgb === null ? fallback : rgbToHex(rgb);
}

function toolIdOr(value: unknown): ToolId {
  return typeof value === "string" && TOOL_IDS.has(value) ? (value as ToolId) : DEFAULT_APP_SETTINGS.toolId;
}

/** A numeric brush field, or its default when it is missing or not a number. */
function brushNumber(record: Record<string, unknown>, key: keyof BrushSettings): number {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const fallback = DEFAULT_BRUSH[key];
  return typeof fallback === "number" ? fallback : 0;
}

/**
 * The brush, validated field by field.
 *
 * `normalizeBrush` does the clamping, but it assumes its input is a real
 * `BrushSettings`; a file that holds `{"size": "big"}` has to be turned into
 * something it can accept first.
 */
function brushOr(value: unknown): BrushSettings {
  const record = asRecord(value);
  if (record === null) {
    return DEFAULT_BRUSH;
  }
  const merged: BrushSettings = {
    ...DEFAULT_BRUSH,
    size: brushNumber(record, "size"),
    opacity: brushNumber(record, "opacity"),
    hardness: brushNumber(record, "hardness"),
    pressureSize: brushNumber(record, "pressureSize"),
    pressureOpacity: brushNumber(record, "pressureOpacity"),
    minSizeRatio: brushNumber(record, "minSizeRatio"),
    spacing: brushNumber(record, "spacing"),
    stabilizer: brushNumber(record, "stabilizer"),
    texture: brushNumber(record, "texture"),
    stampSpacing: brushNumber(record, "stampSpacing"),
    stampHardness: brushNumber(record, "stampHardness"),
    stamp: record.stamp === true,
    color: colorOr(record.color, DEFAULT_BRUSH.color),
  };
  return normalizeBrush(merged);
}

/**
 * Turns whatever was in the file into usable settings.
 *
 * Never throws and never rejects: a value it cannot make sense of takes its
 * default, and a file from a newer version is ignored entirely.
 */
export function normalizeAppSettings(value: unknown): AppSettings {
  const record = asRecord(value);
  if (record === null) {
    return DEFAULT_APP_SETTINGS;
  }

  const version = record.version;
  if (typeof version === "number" && Number.isFinite(version) && version > SETTINGS_VERSION) {
    // A file written by a newer Paka. Its meaning is unknown rather than
    // wrong, so the whole file is ignored and the defaults are used.
    return DEFAULT_APP_SETTINGS;
  }

  const shape = normalizeShapeOptions({
    sides: numberOr(record.shapeSides, DEFAULT_SHAPE_OPTIONS.sides),
    innerRatio: numberOr(record.shapeInnerRatio, DEFAULT_SHAPE_OPTIONS.innerRatio),
    rotation: numberOr(record.shapeRotation, DEFAULT_SHAPE_OPTIONS.rotation),
  });

  return {
    version: SETTINGS_VERSION,
    brush: brushOr(record.brush),
    toolId: toolIdOr(record.toolId),
    shapeFill: booleanOr(record.shapeFill, DEFAULT_APP_SETTINGS.shapeFill),
    shapeSides: shape.sides,
    shapeInnerRatio: shape.innerRatio,
    shapeRotation: shape.rotation,
    fillTolerance: Math.round(
      clamp(numberOr(record.fillTolerance, DEFAULT_APP_SETTINGS.fillTolerance), 0, 255),
    ),
    gradientType: record.gradientType === "radial" ? "radial" : "linear",
    gradientEndColor: colorOr(record.gradientEndColor, DEFAULT_APP_SETTINGS.gradientEndColor),
  };
}

/**
 * Parses a settings file.
 *
 * `null` - no file yet - and a file that is not valid JSON both yield the
 * defaults: a corrupt settings file must not stop the editor from starting.
 */
export function parseAppSettings(text: string | null): AppSettings {
  if (text === null) {
    return DEFAULT_APP_SETTINGS;
  }
  try {
    return normalizeAppSettings(JSON.parse(text));
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

/** Serializes the settings, with a stable key order. */
export function serializeAppSettings(settings: AppSettings): string {
  return `${JSON.stringify(
    {
      version: SETTINGS_VERSION,
      brush: settings.brush,
      toolId: settings.toolId,
      shapeFill: settings.shapeFill,
      shapeSides: settings.shapeSides,
      shapeInnerRatio: settings.shapeInnerRatio,
      shapeRotation: settings.shapeRotation,
      fillTolerance: settings.fillTolerance,
      gradientType: settings.gradientType,
      gradientEndColor: settings.gradientEndColor,
    },
    null,
    2,
  )}\n`;
}

/** Field-wise comparison, so an unchanged setting is never written again. */
export function settingsEqual(a: AppSettings, b: AppSettings): boolean {
  return (
    a.version === b.version &&
    brushSettingsEqual(a.brush, b.brush) &&
    a.toolId === b.toolId &&
    a.shapeFill === b.shapeFill &&
    a.shapeSides === b.shapeSides &&
    a.shapeInnerRatio === b.shapeInnerRatio &&
    a.shapeRotation === b.shapeRotation &&
    a.fillTolerance === b.fillTolerance &&
    a.gradientType === b.gradientType &&
    a.gradientEndColor === b.gradientEndColor
  );
}
