/**
 * The bundled brush presets: the brushes that ship with Paka.
 *
 * The properties pinned down here are the ones a user would notice: the
 * library is data - the same brushes, in the same order, in every build -
 * every shipped brush is a valid brush that comes back from the settings
 * reader with no field lost, a shipped brush keeps its identity when the file
 * claims its id, and a preset the user saved always wins a name.
 */

import { describe, expect, it } from "vitest";
import {
  BUNDLED_PRESETS,
  BUNDLED_PRESET_IDS,
  BUNDLED_PRESET_ID_PREFIX,
  bundledPresetId,
  isBundledPresetId,
} from "../core/brushes/bundledPresets";
import { DEFAULT_BRUSH, normalizeBrush, readBrushSettings } from "../core/brushes/defaults";
import {
  isBundledPreset,
  mergeBundledPresets,
  type BrushPreset,
} from "../core/brushes/presets";
import type { BrushSettings } from "../types/brush";

/**
 * The shipped brushes, exactly as the source writes them.
 *
 * This is the pin on the data: the ids and their order are what the library
 * looks like, and the brush of each one is the default brush with the listed
 * fields changed. A value that is changed in the source without being changed
 * here fails the test, which is the point - a shipped brush reaches every
 * user, so changing one is a deliberate, visible edit.
 */
const SHIPPED: readonly {
  readonly id: string;
  readonly name: string;
  readonly brush: Partial<BrushSettings>;
}[] = [
  {
    id: "builtin-pen",
    name: "Pen",
    brush: { size: 3, opacity: 1, hardness: 1, pressureSize: 0.6, spacing: 0.08 },
  },
  {
    id: "builtin-soft",
    name: "Soft Round",
    brush: {
      size: 24,
      opacity: 0.9,
      hardness: 0.35,
      spacing: 0.1,
      stabilizer: 0.15,
      texture: 0.15,
    },
  },
  {
    id: "builtin-marker",
    name: "Marker",
    brush: { size: 14, opacity: 1, hardness: 0.75, minSizeRatio: 0.6, spacing: 0.06 },
  },
  {
    id: "builtin-airbrush",
    name: "Airbrush",
    brush: {
      size: 48,
      opacity: 0.22,
      hardness: 0,
      spacing: 0.05,
      stabilizer: 0.25,
      texture: 0.1,
    },
  },
  {
    id: "builtin-charcoal",
    name: "Charcoal",
    brush: {
      size: 20,
      opacity: 1,
      hardness: 0.5,
      spacing: 0.14,
      stabilizer: 0.1,
      texture: 0.65,
    },
  },
  {
    id: "builtin-stamps",
    name: "Stamp Dots",
    brush: {
      size: 18,
      opacity: 1,
      hardness: 1,
      spacing: 0.1,
      stamp: true,
      stampSpacing: 0.14,
      stampHardness: 0.85,
    },
  },
];

/** Every field a brush has, taken from the brush itself. */
function everyBrushField(): (keyof BrushSettings)[] {
  return Object.keys(DEFAULT_BRUSH) as (keyof BrushSettings)[];
}

/** A preset of the user's own: a fresh id and a brush of their choosing. */
function userPreset(
  id: string,
  name: string,
  brush: Partial<BrushSettings> = {},
): BrushPreset {
  return { id, name, brush: { ...DEFAULT_BRUSH, ...brush } };
}

/** The entry of the merged list with this id, or `undefined`. */
function mergedEntry(
  merged: readonly BrushPreset[],
  id: string,
): BrushPreset | undefined {
  return merged.find((preset) => preset.id === id);
}

describe("the bundled list", () => {
  it("ships a fixed set of brushes, in a fixed order", () => {
    expect(BUNDLED_PRESETS.map((preset) => preset.id)).toEqual(SHIPPED.map((entry) => entry.id));
    expect(BUNDLED_PRESETS.map((preset) => preset.name)).toEqual(SHIPPED.map((entry) => entry.name));
  });

  it("gives every shipped brush the brush the source writes", () => {
    for (let index = 0; index < SHIPPED.length; index++) {
      const expected = SHIPPED[index];
      const preset = BUNDLED_PRESETS[index];

      expect(preset).toBeDefined();
      expect(preset.brush, `the brush of "${expected.name}"`).toEqual({
        ...DEFAULT_BRUSH,
        ...expected.brush,
      });
    }
  });

  it("gives every shipped brush a stable, readable id", () => {
    const ids = BUNDLED_PRESETS.map((preset) => preset.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith(BUNDLED_PRESET_ID_PREFIX)).toBe(true);
      expect(isBundledPresetId(id)).toBe(true);
    }
    expect(bundledPresetId("pen")).toBe("builtin-pen");
    expect([...BUNDLED_PRESET_IDS].sort()).toEqual([...ids].sort());
  });

  it("is data, not behaviour: the same list comes back every time", () => {
    const first = mergeBundledPresets([]);
    const second = mergeBundledPresets([]);

    expect(first).toEqual(second);
    expect(first.map((preset) => preset.id)).toEqual(BUNDLED_PRESETS.map((preset) => preset.id));
  });
});

describe("every shipped brush is a valid brush", () => {
  it("needs no clamping: the data is already inside the bounds", () => {
    for (const preset of BUNDLED_PRESETS) {
      expect(normalizeBrush(preset.brush), `the brush of "${preset.name}"`).toEqual(preset.brush);
    }
  });

  it("keeps every field of the brush through the settings reader", () => {
    for (const preset of BUNDLED_PRESETS) {
      const read = readBrushSettings(preset.brush);

      expect(read, `the brush of "${preset.name}"`).toEqual(preset.brush);
      for (const field of everyBrushField()) {
        expect(read[field], `the reader dropped "${String(field)}" of "${preset.name}"`).toEqual(
          preset.brush[field],
        );
      }
    }
  });

  it("has no field missing from the default brush", () => {
    for (const preset of BUNDLED_PRESETS) {
      expect(Object.keys(preset.brush).sort()).toEqual(Object.keys(DEFAULT_BRUSH).sort());
    }
  });
});

describe("identifying a bundled preset", () => {
  it("knows the shipped brushes by their id", () => {
    for (const preset of BUNDLED_PRESETS) {
      expect(isBundledPreset(preset)).toBe(true);
      expect(isBundledPresetId(preset.id)).toBe(true);
    }
  });

  it("does not claim a preset of the user's own", () => {
    const own = userPreset("preset-1", "Ink");

    expect(isBundledPreset(own)).toBe(false);
    expect(isBundledPresetId(own.id)).toBe(false);
  });

  it("does not claim a user's preset that borrows a shipped name", () => {
    const own = userPreset("preset-1", "Pen");

    expect(isBundledPreset(own)).toBe(false);
  });
});

describe("merging the bundled list with the user's", () => {
  it("keeps the shipped brushes and the user's own", () => {
    const own = userPreset("preset-1", "Ink", { size: 30 });

    const merged = mergeBundledPresets([own]);

    expect(merged.map((preset) => preset.id)).toEqual([
      ...BUNDLED_PRESETS.map((preset) => preset.id),
      "preset-1",
    ]);
    expect(mergedEntry(merged, "preset-1")?.brush).toEqual(own.brush);
  });

  it("gives a shipped brush the brush the code writes, not the one in the file", () => {
    // A file that claims a shipped id cannot change what ships.
    const claimed = userPreset("builtin-pen", "Hijacked", { size: 200, stamp: true });

    const merged = mergeBundledPresets([claimed]);
    const shipped = mergedEntry(merged, "builtin-pen");

    expect(shipped).toBeDefined();
    expect(shipped?.brush).toEqual({
      ...DEFAULT_BRUSH,
      ...SHIPPED[0].brush,
    });
    expect(shipped?.brush.size).not.toBe(200);
    expect(merged.filter((preset) => preset.id === "builtin-pen")).toHaveLength(1);
  });

  it("keeps a shipped brush's identity: its id and its name", () => {
    const claimed = userPreset("builtin-pen", "Hijacked");

    const shipped = mergedEntry(mergeBundledPresets([claimed]), "builtin-pen");

    expect(shipped?.id).toBe("builtin-pen");
    expect(shipped?.name).toBe(SHIPPED[0].name);
  });

  it("lets a user's preset win a name it shares with a shipped brush", () => {
    const own = userPreset("preset-1", "Pen", { size: 30 });

    const merged = mergeBundledPresets([own]);
    const mine = mergedEntry(merged, "preset-1");
    const shipped = mergedEntry(merged, "builtin-pen");

    expect(mine?.name).toBe("Pen");
    expect(mine?.brush).toEqual(own.brush);
    expect(shipped?.name).not.toBe("Pen");
    expect(shipped?.name).toBe("Pen (2)");
  });

  it("gives every entry in the merged list a name of its own", () => {
    const own = [
      userPreset("preset-1", "Pen"),
      userPreset("preset-2", "Soft Round"),
      userPreset("preset-3", "Ink"),
    ];

    const merged = mergeBundledPresets(own);
    const names = merged.map((preset) => preset.name.toLowerCase());

    expect(new Set(names).size).toBe(names.length);
    expect(mergedEntry(merged, "builtin-pen")?.name).toBe("Pen (2)");
    expect(mergedEntry(merged, "builtin-soft")?.name).toBe("Soft Round (2)");
    expect(mergedEntry(merged, "preset-1")?.name).toBe("Pen");
    expect(mergedEntry(merged, "preset-2")?.name).toBe("Soft Round");
  });

  it("changes nothing of the user's own entries", () => {
    const own = userPreset("preset-1", "Pen", { size: 30 });
    const before = { ...own, brush: { ...own.brush } };

    mergeBundledPresets([own]);

    expect(own).toEqual(before);
  });

  it("merges the same list the same way twice", () => {
    const own = [userPreset("preset-1", "Pen"), userPreset("preset-2", "Ink")];

    const once = mergeBundledPresets(own);
    const twice = mergeBundledPresets(once);

    expect(twice).toEqual(once);
  });
});
