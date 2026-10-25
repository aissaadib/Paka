/**
 * The translated Krita 4 presets.
 *
 * The set is generated from Krita's `Krita_4_Default_Resources.bundle`
 * (CC-0, see `core/brushes/kritaDefaults.ts`). These tests hold the
 * translation to the contract the rest of the brush system expects: every
 * brush is complete and in bounds, every name is usable and unique, and the
 * whole set survives the library file and the browser's import path.
 */

import { describe, expect, it, vi } from "vitest";
import {
  MAX_BRUSH_SIZE,
  MAX_SPACING,
  MAX_STAMP_SPACING,
  MIN_BRUSH_SIZE,
  MIN_SPACING,
  MIN_STAMP_SPACING,
  brushSettingsEqual,
  readBrushSettings,
} from "../core/brushes/defaults";
import {
  KRITA_DEFAULT_PRESET_ENTRIES,
  KRITA_DEFAULT_PRESET_PREFIX,
  KRITA_DEFAULT_PRESET_SOURCE,
  missingKritaPresets,
} from "../core/brushes/kritaDefaults";
import {
  DEFAULT_PRESET_BROWSER_STATE,
  runPresetAction,
  type PresetLibrary,
  type PresetLibraryPort,
} from "../core/brushes/presetBrowser";
import { MAX_PRESET_NAME_LENGTH, type BrushPreset } from "../core/brushes/presets";
import {
  parsePresetLibrary,
  serializePresetLibrary,
} from "../core/brushes/presetTransfer";

const ENTRY_NAMES = KRITA_DEFAULT_PRESET_ENTRIES.map((entry) => entry.name);

function preset(id: string, name: string, brush: BrushPreset["brush"]): BrushPreset {
  return { id, name, brush };
}

function createPort(): PresetLibraryPort {
  return {
    save: vi.fn(() => null),
    rename: vi.fn(() => null),
    duplicate: vi.fn(() => null),
    remove: vi.fn(() => false),
    apply: vi.fn(() => true),
    import: vi.fn((added: readonly BrushPreset[]) => added),
  };
}

describe("the Krita 4 preset set", () => {
  it("holds the 81 presets Paka can represent", () => {
    expect(KRITA_DEFAULT_PRESET_ENTRIES).toHaveLength(81);
  });

  it("uses a name that is unique, prefixed and short enough for the browser", () => {
    expect(new Set(ENTRY_NAMES).size).toBe(ENTRY_NAMES.length);
    for (const name of ENTRY_NAMES) {
      expect(name.startsWith(KRITA_DEFAULT_PRESET_PREFIX)).toBe(true);
      expect(name.length).toBeGreaterThan(KRITA_DEFAULT_PRESET_PREFIX.length);
      expect(name.length).toBeLessThanOrEqual(MAX_PRESET_NAME_LENGTH);
    }
  });

  it("names the set the button asks for", () => {
    expect(KRITA_DEFAULT_PRESET_SOURCE).toBe("Krita 4");
    expect(KRITA_DEFAULT_PRESET_PREFIX).toBe("Krita - ");
  });

  it("builds every brush in bounds and keeps it through the brush reader", () => {
    for (const entry of KRITA_DEFAULT_PRESET_ENTRIES) {
      const brush = entry.brush;
      expect(brush.size).toBeGreaterThanOrEqual(MIN_BRUSH_SIZE);
      expect(brush.size).toBeLessThanOrEqual(MAX_BRUSH_SIZE);
      expect(brush.opacity).toBeGreaterThanOrEqual(0);
      expect(brush.opacity).toBeLessThanOrEqual(1);
      expect(brush.hardness).toBeGreaterThanOrEqual(0);
      expect(brush.hardness).toBeLessThanOrEqual(1);
      expect(brush.spacing).toBeGreaterThanOrEqual(MIN_SPACING);
      expect(brush.spacing).toBeLessThanOrEqual(MAX_SPACING);
      expect(brush.stampSpacing).toBeGreaterThanOrEqual(MIN_STAMP_SPACING);
      expect(brush.stampSpacing).toBeLessThanOrEqual(MAX_STAMP_SPACING);
      expect(brush.texture).toBeGreaterThanOrEqual(0);
      expect(brush.texture).toBeLessThanOrEqual(1);
      expect(brush.stampTexture).toBeGreaterThanOrEqual(0);
      expect(brush.stampTexture).toBeLessThanOrEqual(1);

      // The one reader every file goes through must not change what the
      // translation built: no field is out of bounds and none is dropped.
      expect(brushSettingsEqual(readBrushSettings(brush), brush)).toBe(true);
    }
  });

  it("keeps the brushes Paka users will look for", () => {
    for (const name of [
      "Krita - Airbrush Soft",
      "Krita - Basic-3 Flow",
      "Krita - Basic-5 Size",
      "Krita - Basic-5 Size Opacity",
      "Krita - Pencil-1 Hard",
      "Krita - Pencil-3 Large 4B",
      "Krita - Ink-1 Precision",
      "Krita - Ink-2 Fineliner",
      "Krita - Marker Chisel Smooth",
      "Krita - Marker Dry",
      "Krita - Bristles-1 Details",
      "Krita - Bristles-5 Flat",
      "Krita - Stamp Bokeh",
      "Krita - Shapes Square",
      "Krita - Pixel Art",
      "Krita - Texture Noise",
      "Krita - Texture Reptile",
    ]) {
      expect(ENTRY_NAMES).toContain(name);
    }
  });

  it("covers the ways a Paka brush can mark the canvas", () => {
    const brushes = KRITA_DEFAULT_PRESET_ENTRIES.map((entry) => entry.brush);
    const tips = new Set(brushes.map((brush) => brush.tip));

    expect(brushes.some((brush) => brush.stamp)).toBe(true);
    expect(brushes.some((brush) => !brush.stamp)).toBe(true);
    expect(brushes.some((brush) => brush.pressureSize > 0)).toBe(true);
    expect(brushes.some((brush) => brush.pressureSize === 0)).toBe(true);
    expect(brushes.some((brush) => brush.texture > 0)).toBe(true);
    expect(brushes.some((brush) => brush.texture === 0)).toBe(true);
    expect(tips).toEqual(new Set(["round", "chisel", "blot", "bristle"]));
  });
});

describe("the Krita 4 import helper", () => {
  it("offers every entry to an empty library", () => {
    expect(missingKritaPresets([])).toHaveLength(81);
  });

  it("adds only the brushes that are not there yet", () => {
    const existing = ENTRY_NAMES.slice(0, 80);
    const missing = missingKritaPresets(existing);

    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe(ENTRY_NAMES[80]);
  });

  it("has nothing to add when the whole set is already there", () => {
    expect(missingKritaPresets(ENTRY_NAMES)).toHaveLength(0);
    expect(missingKritaPresets([...ENTRY_NAMES, "My own brush"])).toHaveLength(0);
  });

  it("matches by name, not by position, so a renamed or edited entry is left alone", () => {
    expect(missingKritaPresets(["Krita - Basic-5 Size"])).toHaveLength(80);
  });
});

describe("importing the Krita 4 set", () => {
  it("adds all 81 brushes through the browser's import action", () => {
    const library: PresetLibrary = { presets: [], bundled: [] };
    const port = createPort();

    const result = runPresetAction(
      library,
      DEFAULT_PRESET_BROWSER_STATE,
      port,
      { kind: "import", entries: KRITA_DEFAULT_PRESET_ENTRIES },
    );

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Imported 81 brushes.");
    const added = (port.import as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as BrushPreset[];
    expect(added.map((entry) => entry.name)).toEqual(ENTRY_NAMES);
    // Fresh ids, so the same set can be imported again without replacing.
    expect(new Set(added.map((entry) => entry.id)).size).toBe(81);
  });

  it("survives the library file export and import unchanged", () => {
    const library: PresetLibrary = {
      presets: KRITA_DEFAULT_PRESET_ENTRIES.map((entry, index) =>
        preset(`krita-${index}`, entry.name, entry.brush),
      ),
      bundled: [],
    };
    const text = serializePresetLibrary(library.presets);

    const read = parsePresetLibrary(text);

    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.skipped).toBe(0);
    expect(read.entries).toHaveLength(81);
    expect(read.entries.map((entry) => entry.name)).toEqual(ENTRY_NAMES);
    for (let index = 0; index < read.entries.length; index += 1) {
      expect(brushSettingsEqual(read.entries[index].brush, library.presets[index].brush)).toBe(
        true,
      );
    }
  });
});
