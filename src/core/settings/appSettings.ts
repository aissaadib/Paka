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
 *
 * The file is a **document**: the engine's own fields at the top level, and
 * one key per **section** beside them. A section is state that belongs in the
 * file but not in the engine - which panels are hidden, what the workspace
 * looks like - and it is added without touching this file's reader. See
 * `settingsSection.ts` for the contract a section implements and
 * `settingsStore.ts` for how the store reads, watches and writes them.
 */

import { DEFAULT_BRUSH, brushSettingsEqual, readBrushSettings } from "../brushes/defaults";
import { DEFAULT_GRADIENT_END_COLOR } from "../gradient/gradientRecord";
import {
  brushPresetsEqual,
  normalizeBrushPresets,
  type BrushPreset,
} from "../brushes/presets";
import { DEFAULT_GRID_SETTINGS, normalizeGridSpacing } from "../document/grid";
import { DEFAULT_SHAPE_OPTIONS, normalizeShapeOptions } from "../tools/shapeGeometry";
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions";
import type { BrushSettings } from "../../types/brush";
import type { ToolId } from "../../types/tool";
import { hexToRgb, rgbToHex } from "../../utils/color";
import { clamp } from "../../utils/math";
import { asRecord } from "../../utils/record";
import type { SettingsDocument } from "./settingsSection";

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
  /** Named brush presets. Missing in older files, which load as an empty list. */
  readonly presets: readonly BrushPreset[];
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
  /**
   * Whether the grid overlay is drawn over the paper.
   *
   * A view preference, like the brush: it describes what the screen shows, not
   * what the document holds, so it is never part of a project file.
   */
  readonly gridVisible: boolean;
  /** The distance between grid lines, in document pixels. */
  readonly gridSpacing: number;
  /** Whether a drawing sample follows the guides and the grid lines. */
  readonly gridSnapping: boolean;
}

/** The settings a fresh installation starts from. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  brush: DEFAULT_BRUSH,
  presets: [],
  toolId: "brush",
  shapeFill: false,
  shapeSides: DEFAULT_SHAPE_OPTIONS.sides,
  shapeInnerRatio: DEFAULT_SHAPE_OPTIONS.innerRatio,
  shapeRotation: DEFAULT_SHAPE_OPTIONS.rotation,
  fillTolerance: 24,
  gradientType: "linear",
  gradientEndColor: DEFAULT_GRADIENT_END_COLOR,
  gridVisible: DEFAULT_GRID_SETTINGS.visible,
  gridSpacing: DEFAULT_GRID_SETTINGS.spacing,
  gridSnapping: DEFAULT_GRID_SETTINGS.snap,
};

const TOOL_IDS = new Set<string>(TOOL_DEFINITIONS.map((definition) => definition.id));

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

/**
 * The brush, validated field by field.
 *
 * `readBrushSettings` does the work: it walks the brush's own field lists, so
 * no field can be dropped from the round trip, and it clamps what it reads.
 * A file that holds `{"size": "big"}` becomes a usable brush rather than an
 * error.
 */
function brushOr(value: unknown): BrushSettings {
  return readBrushSettings(value);
}

/**
 * The preset library, validated entry by entry.
 *
 * A missing or non-array `presets` is an empty list, so files written before
 * presets existed load unchanged. The entries themselves are read by
 * `normalizeBrushPresets`, which is the same reader the engine uses: one
 * malformed entry (not an object, no usable name) is skipped rather than
 * allowed to lose the rest, a bad field inside a preset's brush takes its
 * default, duplicate or missing ids are replaced, and duplicate names get a
 * numeric suffix, so the picker always has distinct entries.
 */
function presetsOr(value: unknown): readonly BrushPreset[] {
  return normalizeBrushPresets(value);
}

/**
 * Whether a document was written by a newer build.
 *
 * A file from a newer version is ignored wholesale, because its meaning is
 * unknown rather than merely wrong. The check lives here so the reader and
 * the store agree on which files are "newer": the store has to know, because
 * a newer file's *other* keys must not be written back as if they were
 * understood.
 */
export function isFutureSettingsDocument(document: SettingsDocument): boolean {
  const version = document.version;
  return typeof version === "number" && Number.isFinite(version) && version > SETTINGS_VERSION;
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

  if (isFutureSettingsDocument(record)) {
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
    presets: presetsOr(record.presets),
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
    // The grid fields are additive: a settings file written before the grid
    // existed simply has none of them, and each one takes its default.
    gridVisible: booleanOr(record.gridVisible, DEFAULT_APP_SETTINGS.gridVisible),
    gridSpacing: normalizeGridSpacing(
      numberOr(record.gridSpacing, DEFAULT_APP_SETTINGS.gridSpacing),
    ),
    gridSnapping: booleanOr(record.gridSnapping, DEFAULT_APP_SETTINGS.gridSnapping),
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
  return serializeSettingsDocument(settingsDocument(settings));
}

/**
 * The settings as a plain document.
 *
 * The document is what a settings file holds: the object the serializer
 * stringifies. It is exposed so a **section** of the file that the engine
 * does not own - the panel layout, the workspace, the shell's preferences -
 * can live in the same document instead of in a second file. See
 * `settingsSection.ts` for the contract a section implements.
 *
 * The engine's own fields keep their names, their defaults and their
 * meanings: a document is the flat list of fields it always was, plus any
 * number of section keys beside them.
 */
export function settingsDocument(settings: AppSettings): SettingsDocument {
  return {
    version: SETTINGS_VERSION,
    brush: settings.brush,
    presets: settings.presets,
    toolId: settings.toolId,
    shapeFill: settings.shapeFill,
    shapeSides: settings.shapeSides,
    shapeInnerRatio: settings.shapeInnerRatio,
    shapeRotation: settings.shapeRotation,
    fillTolerance: settings.fillTolerance,
    gradientType: settings.gradientType,
    gradientEndColor: settings.gradientEndColor,
    gridVisible: settings.gridVisible,
    gridSpacing: settings.gridSpacing,
    gridSnapping: settings.gridSnapping,
  };
}

/** Serializes a settings document, with a stable key order. */
export function serializeSettingsDocument(document: SettingsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * The parsed settings document.
 *
 * `null` - no file yet - a file that is not valid JSON and a file that is
 * not an object all yield an empty document: a corrupt settings file must
 * not stop the editor from starting.
 *
 * The document is returned as it was found, keys the build does not know
 * included, so a section another builder owns is not lost by a rewrite.
 */
export function parseSettingsDocument(text: string | null): SettingsDocument {
  if (text === null) {
    return {};
  }
  try {
    return asRecord(JSON.parse(text)) ?? {};
  } catch {
    return {};
  }
}

/** Field-wise comparison, so an unchanged setting is never written again. */
export function settingsEqual(a: AppSettings, b: AppSettings): boolean {
  return (
    a.version === b.version &&
    brushSettingsEqual(a.brush, b.brush) &&
    brushPresetsEqual(a.presets, b.presets) &&
    a.toolId === b.toolId &&
    a.shapeFill === b.shapeFill &&
    a.shapeSides === b.shapeSides &&
    a.shapeInnerRatio === b.shapeInnerRatio &&
    a.shapeRotation === b.shapeRotation &&
    a.fillTolerance === b.fillTolerance &&
    a.gradientType === b.gradientType &&
    a.gradientEndColor === b.gradientEndColor &&
    a.gridVisible === b.gridVisible &&
    a.gridSpacing === b.gridSpacing &&
    a.gridSnapping === b.gridSnapping
  );
}
