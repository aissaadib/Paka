/**
 * The brushes that ship with Paka.
 *
 * A bundled preset is **code**, not a file: its brush is written here, so a
 * new build can improve it and every install gets the same one. It is
 * therefore protected - it cannot be renamed, overwritten or deleted, because
 * deleting it would take the feature away rather than the user's data. A user
 * who wants a variation duplicates it, and the copy is theirs.
 *
 * The list is **data**. It is written out in full, in a fixed order, with no
 * randomness and nothing read from the environment: the same build always
 * ships the same brushes, in the same order, with the same values.
 *
 * Identity is the **id**, not a flag in the settings file. A bundled id is
 * stable and readable, because the file refers to it, and a hand-edited file
 * can neither turn one of the user's presets into a protected one nor make a
 * shipped brush editable.
 *
 * The values below are deliberately plain: a hard small pen, a soft round, a
 * flat marker, a faint airbrush, a grainy charcoal and a dotted stamp. They
 * exist so the library is useful on a fresh install, not as artwork.
 */

import type { BrushSettings } from "../../types/brush";
import { DEFAULT_BRUSH } from "./defaults";
import type { BrushPreset } from "./presets";

/** The prefix every bundled id carries, so a shipped entry is recognisable. */
export const BUNDLED_PRESET_ID_PREFIX = "builtin-";

/**
 * The id of a bundled preset.
 *
 * The id is fixed and readable, because the settings file refers to it: a
 * favourite or a last-used stamp is stored against this id, and a file that
 * claims the id gets the brush from here rather than from the file.
 */
export function bundledPresetId(key: string): string {
  return `${BUNDLED_PRESET_ID_PREFIX}${key}`;
}

/** One bundled brush: the default brush with a few fields changed. */
function bundled(key: string, name: string, brush: Partial<BrushSettings>): BrushPreset {
  return {
    id: bundledPresetId(key),
    name,
    brush: { ...DEFAULT_BRUSH, ...brush },
  };
}

/**
 * The built-in brushes, in the order the browser lists them.
 *
 * The order is part of the data: it is written out here rather than sorted at
 * runtime, so the library reads the same way in every build.
 */
export const BUNDLED_PRESETS: readonly BrushPreset[] = [
  bundled("pen", "Pen", {
    size: 3,
    opacity: 1,
    hardness: 1,
    pressureSize: 0.6,
    spacing: 0.08,
  }),
  bundled("soft", "Soft Round", {
    size: 24,
    opacity: 0.9,
    hardness: 0.35,
    spacing: 0.1,
    stabilizer: 0.15,
    texture: 0.15,
  }),
  bundled("marker", "Marker", {
    size: 14,
    opacity: 1,
    hardness: 0.75,
    minSizeRatio: 0.6,
    spacing: 0.06,
  }),
  bundled("airbrush", "Airbrush", {
    size: 48,
    opacity: 0.22,
    hardness: 0,
    spacing: 0.05,
    stabilizer: 0.25,
    texture: 0.1,
  }),
  bundled("charcoal", "Charcoal", {
    size: 20,
    opacity: 1,
    hardness: 0.5,
    spacing: 0.14,
    stabilizer: 0.1,
    texture: 0.65,
  }),
  bundled("stamps", "Stamp Dots", {
    size: 18,
    opacity: 1,
    hardness: 1,
    spacing: 0.1,
    stamp: true,
    stampSpacing: 0.14,
    stampHardness: 0.85,
  }),
];

/** The ids the bundled presets own. A file may not claim one for its own. */
export const BUNDLED_PRESET_IDS: ReadonlySet<string> = new Set(
  BUNDLED_PRESETS.map((preset) => preset.id),
);

/**
 * True when the id belongs to one of the brushes that ship with Paka.
 *
 * This is the one rule that identifies a bundled preset, and it is the id
 * alone: a flag in a file is not consulted, so the file cannot change what
 * ships.
 */
export function isBundledPresetId(id: string): boolean {
  return BUNDLED_PRESET_IDS.has(id);
}
