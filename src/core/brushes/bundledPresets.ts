/**
 * The brushes that ship with Paka.
 *
 * A bundled preset is **code**, not a file: its brush is written here, so a
 * new build can improve it and every install gets the same one. It is
 * therefore protected - it cannot be renamed, overwritten or deleted, because
 * deleting it would take the feature away rather than the user's data. A user
 * who wants a variation duplicates it, and the copy is theirs.
 *
 * The favourite flag and the last-used stamp of a bundled preset *are* the
 * user's, so they are kept in the settings file while the brush itself stays
 * here. `mergeBundledPresets` is what joins the two.
 *
 * The values below are deliberately plain: a hard small pen, a soft round, a
 * flat marker, a faint airbrush, a grainy charcoal and a dotted stamp. They
 * exist so the library is useful on a fresh install, not as artwork.
 */

import { DEFAULT_BRUSH } from "./defaults";
import type { BrushPreset } from "./presets";

/**
 * A bundled preset.
 *
 * The id is fixed and readable, because the settings file refers to it: a
 * favourite or a last-used stamp is stored against this id, and a file that
 * claims the id gets the brush from here rather than from the file.
 */
function bundled(id: string, name: string, brush: Partial<typeof DEFAULT_BRUSH>): BrushPreset {
  return {
    id: `builtin-${id}`,
    name,
    brush: { ...DEFAULT_BRUSH, ...brush },
    favorite: false,
    builtin: true,
    lastUsedAt: null,
  };
}

/** The built-in brushes, in the order the browser lists them. */
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
