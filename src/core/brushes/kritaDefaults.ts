/**
 * Krita 4's default brush presets, translated into Paka brushes.
 *
 * **Provenance.** The list is derived from `Krita_4_Default_Resources.bundle`
 * in the Krita 4.4.8 source tree (`krita/data/bundles/`). The bundle's
 * `meta.xml` names Deevad with derivations by Ramon Miranda, Razvanc,
 * Radian, Wolthera, Storm, Scottyp and others, and declares
 * `license = CC-0`. Only the preset **names** and the **numeric settings**
 * were used: no tip image, pattern, texture or other binary asset from Krita
 * is copied or shipped. Every brush here is Paka's own rasterization of those
 * numbers, using only fields Paka actually implements.
 *
 * **What is included.** The bundle holds 95 presets. The 69 that use an engine
 * Paka can represent are here: `paintbrush`, `roundmarker`, `sketchbrush`,
 * `spraybrush` and `hairybrush`. The 26 that are left out need engines Paka
 * does not have (colour smudge, deform, duplicate, curve, grid, tangent
 * normal, hatching, experiment) or are erasers.
 *
 * **What is approximate.** Paka has no per-sensor curves, no brush engines and
 * no image tips. A Krita preset is therefore carried over as its diameter,
 * opacity, spacing, pressure response, edge hardness and grain, plus a stamped
 * tip shape chosen from the tip's mask type and file name. The strokes read
 * like the Krita brushes, not identically.
 *
 * The entries are imported as the user's own presets - named `Krita - ...` -
 * so they can be edited or deleted like any other user brush.
 */

import type { BrushSettings, BrushTipShape } from "../../types/brush";
import type { PresetLibraryEntry } from "./presetTransfer";

/** The colour the translated brushes paint with until the user changes it. */
const KRITA_INK = "#16181c";

/** The identity pressure response. */
const IDENTITY_CURVE = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
] as const;

/** One translated preset, before it becomes a full {@link BrushSettings}. */
interface KritaPresetSpec {
  readonly name: string;
  readonly size: number;
  readonly opacity: number;
  readonly hardness: number;
  readonly spacing: number;
  readonly stamp: boolean;
  readonly tip: BrushTipShape;
  readonly texture: number;
  readonly stampTexture: number;
  readonly pressureSize: boolean;
  readonly pressureOpacity: boolean;
}

/** The presets, in the order they are imported. */
const KRITA_PRESET_SPECS: readonly KritaPresetSpec[] = [
  { name: "Krita - Airbrush Soft", size: 512, opacity: 1, hardness: 0.05, spacing: 0.1, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: false, pressureOpacity: true },
  { name: "Krita - Basic-1", size: 40, opacity: 1, hardness: 1, spacing: 0.1, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Basic-2 Opacity", size: 40, opacity: 1, hardness: 0.75, spacing: 0.1, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Basic-5 Size", size: 40, opacity: 1, hardness: 1, spacing: 0.1, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Basic-6 Details", size: 8, opacity: 1, hardness: 1, spacing: 0.02, stamp: true, tip: "chisel", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Bristles-1 Details", size: 16, opacity: 0.4, hardness: 1, spacing: 0.04, stamp: true, tip: "bristle", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Bristles-2 Flat Rough", size: 40, opacity: 1, hardness: 1, spacing: 0.04, stamp: true, tip: "chisel", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Bristles-4 Glaze", size: 70, opacity: 1, hardness: 1, spacing: 0.1, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Chalk Details", size: 60, opacity: 1, hardness: 1, spacing: 0.04, stamp: true, tip: "chisel", texture: 0.85, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Chalk Grainy", size: 90, opacity: 1, hardness: 1, spacing: 0.12, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Chalk Soft", size: 135, opacity: 1, hardness: 1, spacing: 0.06, stamp: true, tip: "bristle", texture: 0.85, stampTexture: 0.35, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Charcoal Pencil Large", size: 32, opacity: 1, hardness: 0.5, spacing: 0.2, stamp: false, tip: "round", texture: 0.85, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Charcoal Pencil Medium", size: 12, opacity: 1, hardness: 0.5, spacing: 0.2, stamp: false, tip: "round", texture: 0.85, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Charcoal Pencil Thin", size: 6, opacity: 1, hardness: 0.5, spacing: 0.2, stamp: false, tip: "round", texture: 0.85, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Charcoal Rock Soft", size: 85, opacity: 1, hardness: 1, spacing: 0.1, stamp: true, tip: "chisel", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Dry Bristles", size: 130, opacity: 1, hardness: 1, spacing: 0.08, stamp: true, tip: "chisel", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Dry Bristles Eroded", size: 120, opacity: 1, hardness: 1, spacing: 0.16, stamp: true, tip: "chisel", texture: 0, stampTexture: 0.35, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Dry Brushing", size: 70, opacity: 1, hardness: 1, spacing: 0.1, stamp: true, tip: "blot", texture: 0.85, stampTexture: 0.35, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Dry Roller", size: 110, opacity: 1, hardness: 1, spacing: 0.1, stamp: true, tip: "chisel", texture: 0.85, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Dry Textured Creases", size: 110, opacity: 1, hardness: 1, spacing: 0.07, stamp: true, tip: "blot", texture: 0.85, stampTexture: 0.35, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Ink-1 Precision", size: 3, opacity: 1, hardness: 0.1, spacing: 0.15, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Ink-3 Gpen", size: 5, opacity: 0.6, hardness: 1, spacing: 0.1, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Ink-7 Brush Rough", size: 25, opacity: 1, hardness: 1, spacing: 0.1, stamp: false, tip: "round", texture: 0.85, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Ink-8 Sumi-e", size: 60, opacity: 1, hardness: 1, spacing: 0.5, stamp: true, tip: "bristle", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Marker Chisel Smooth", size: 60, opacity: 1, hardness: 0.75, spacing: 0.04, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Pencil-1 Hard", size: 10, opacity: 0.24, hardness: 0.25, spacing: 0.2, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Pencil-2", size: 10, opacity: 1, hardness: 0.25, spacing: 0.2, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Pencil-4 Soft", size: 16, opacity: 1, hardness: 1, spacing: 0.2, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Pencil-5 Tilted", size: 40, opacity: 1, hardness: 1, spacing: 0.1, stamp: true, tip: "blot", texture: 0.85, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Pencil-6 Quick Shade", size: 60, opacity: 1, hardness: 1, spacing: 0.2, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Pixel Art", size: 1, opacity: 1, hardness: 1, spacing: 0.1, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Pixel Art Dithering", size: 12, opacity: 1, hardness: 0.05, spacing: 0.05, stamp: false, tip: "round", texture: 0.85, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Pixel Art Fill", size: 32, opacity: 1, hardness: 0.75, spacing: 0.2, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Screentone Pressure", size: 55, opacity: 1, hardness: 0.05, spacing: 0.18, stamp: false, tip: "round", texture: 0.85, stampTexture: 0, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Screentones Regular", size: 40, opacity: 1, hardness: 1, spacing: 0.1, stamp: false, tip: "round", texture: 0.85, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Shapes Mecha", size: 360, opacity: 1, hardness: 1, spacing: 0.18, stamp: true, tip: "chisel", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Shapes Rounded", size: 360, opacity: 1, hardness: 1, spacing: 0.25, stamp: true, tip: "chisel", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Shapes Spikes", size: 360, opacity: 1, hardness: 1, spacing: 0.41, stamp: true, tip: "chisel", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Shapes Square", size: 60, opacity: 1, hardness: 1, spacing: 0.05, stamp: false, tip: "chisel", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Sketching-1 Chrome Thin", size: 60, opacity: 1, hardness: 0.5, spacing: 0.1, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Sketching-2 Chrome Large", size: 60, opacity: 1, hardness: 0.5, spacing: 0.1, stamp: false, tip: "round", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Bokeh", size: 384, opacity: 1, hardness: 1, spacing: 0.61, stamp: true, tip: "blot", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Floor", size: 300, opacity: 1, hardness: 1, spacing: 0.5, stamp: true, tip: "blot", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Grass", size: 125, opacity: 1, hardness: 1, spacing: 0.64, stamp: true, tip: "bristle", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Grass Patch", size: 320, opacity: 1, hardness: 1, spacing: 0.8, stamp: true, tip: "bristle", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Hearts", size: 500, opacity: 0.9, hardness: 1, spacing: 0.25, stamp: true, tip: "blot", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Herbals", size: 201, opacity: 1, hardness: 1, spacing: 0.4, stamp: true, tip: "bristle", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Leaves", size: 165, opacity: 1, hardness: 1, spacing: 0.24, stamp: true, tip: "blot", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Mountains Distant", size: 360, opacity: 1, hardness: 1, spacing: 0.92, stamp: true, tip: "blot", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Shoujo Bubbles", size: 80, opacity: 0.9, hardness: 0.05, spacing: 0.1, stamp: true, tip: "round", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: true },
  { name: "Krita - Stamp Sparkles", size: 512, opacity: 0.9, hardness: 1, spacing: 0.99, stamp: true, tip: "blot", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Stylised Tree", size: 130, opacity: 1, hardness: 1, spacing: 0.1, stamp: true, tip: "bristle", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Vegetal", size: 70, opacity: 1, hardness: 1, spacing: 0.6, stamp: true, tip: "bristle", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Stamp Water", size: 220, opacity: 1, hardness: 1, spacing: 0.56, stamp: true, tip: "blot", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Texture Big", size: 435, opacity: 1, hardness: 1, spacing: 0.25, stamp: true, tip: "chisel", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Texture Crackles", size: 385, opacity: 1, hardness: 1, spacing: 0.75, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Texture Hair", size: 70, opacity: 1, hardness: 1, spacing: 0.04, stamp: true, tip: "bristle", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Texture Impressionism", size: 80, opacity: 1, hardness: 1, spacing: 0.1, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Texture Large Splat", size: 200, opacity: 1, hardness: 1, spacing: 0.11, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Texture Noise", size: 120, opacity: 1, hardness: 1, spacing: 0.1, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Texture Random Particles", size: 175, opacity: 1, hardness: 1, spacing: 0.37, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Texture Snow Pile", size: 130, opacity: 1, hardness: 1, spacing: 0.22, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Texture Spines", size: 130, opacity: 1, hardness: 1, spacing: 0.25, stamp: true, tip: "chisel", texture: 0, stampTexture: 0.35, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Texture Splat", size: 135, opacity: 1, hardness: 1, spacing: 0.33, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Texture Spray", size: 82, opacity: 1, hardness: 1, spacing: 0.06, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Texture Wood Fiber", size: 82, opacity: 1, hardness: 1, spacing: 0.14, stamp: true, tip: "chisel", texture: 0.85, stampTexture: 0.35, pressureSize: false, pressureOpacity: false },
  { name: "Krita - Watercolor Texture", size: 220, opacity: 1, hardness: 1, spacing: 0.75, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Waterpaint Hard Edges", size: 100, opacity: 1, hardness: 1, spacing: 0.2, stamp: true, tip: "blot", texture: 0, stampTexture: 0.35, pressureSize: true, pressureOpacity: false },
  { name: "Krita - Waterpaint Soft Edges", size: 96, opacity: 1, hardness: 1, spacing: 0.02, stamp: true, tip: "chisel", texture: 0, stampTexture: 0, pressureSize: true, pressureOpacity: false },
];

/**
 * Builds a complete brush from one translated preset.
 *
 * `stampSpacing` follows the preset's own spacing for a stamped brush, so the
 * dab distance is the one Krita used; the sample `spacing` stays the same, so
 * the path is sampled densely enough to draw the same stroke.
 */
function brushFromSpec(spec: KritaPresetSpec): BrushSettings {
  return {
    size: spec.size,
    opacity: spec.opacity,
    color: KRITA_INK,
    hardness: spec.hardness,
    pressureSize: spec.pressureSize ? 0.8 : 0,
    pressureOpacity: spec.pressureOpacity ? 0.8 : 0,
    pressureCurve: IDENTITY_CURVE,
    minSizeRatio: 0.12,
    spacing: spec.spacing,
    stabilizer: 0,
    texture: spec.texture,
    stamp: spec.stamp,
    stampSpacing: spec.stamp ? spec.spacing : 0.1,
    stampHardness: spec.hardness,
    stampTexture: spec.stamp ? spec.stampTexture : 0,
    tip: spec.tip,
  };
}

/** The display name of the set, for the browser's button and its message. */
export const KRITA_DEFAULT_PRESET_SOURCE = "Krita 4";

/** The `Krita - ` prefix every imported preset carries. */
export const KRITA_DEFAULT_PRESET_PREFIX = "Krita - ";

/** The brushes the one-click import adds, in import order. */
export const KRITA_DEFAULT_PRESET_ENTRIES: readonly PresetLibraryEntry[] =
  KRITA_PRESET_SPECS.map((spec) => ({
    name: spec.name,
    brush: brushFromSpec(spec),
    favorite: false,
  }));

/**
 * The entries that are not already in the library, by name.
 *
 * This is what the browser's button imports, so clicking it twice cannot
 * bury the user's library in duplicate copies; a brush the user deleted is
 * added back on the next click.
 */
export function missingKritaPresets(
  existingNames: readonly string[],
): readonly PresetLibraryEntry[] {
  const existing = new Set(existingNames);
  return KRITA_DEFAULT_PRESET_ENTRIES.filter((entry) => !existing.has(entry.name));
}
