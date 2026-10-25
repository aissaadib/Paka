/**
 * The brush icons: the hand-drawn built-in set and the generated one.
 *
 * The icons are code, so what can be checked is the code: every built-in
 * brush has its own picture and keeps it, every other brush gets one drawn
 * from its settings, every grid is square and uses only colours its palette
 * defines, the tile frame is the same for all of them, and the paths the
 * renderer draws cover exactly the pixels the grid paints - no gap, no
 * overlap, no path that mixes two colours.
 *
 * The generated set is checked by what a user would notice: a chisel brush
 * does not look like a nib, a red brush marks the tile red where a black one
 * marks it grey, a wide brush leaves a longer mark than a narrow one, a
 * translucent brush leaves a fainter one, pressure tapers the mark, and a
 * widely spaced stamp leaves a dotted one.
 */

import { describe, expect, it } from "vitest";
import { BUNDLED_PRESETS } from "../core/brushes/bundledPresets";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { KRITA_DEFAULT_PRESET_ENTRIES } from "../core/brushes/kritaDefaults";
import type { BrushPreset } from "../core/brushes/presets";
import type { BrushSettings } from "../types/brush";
import { hexToRgb } from "../utils/color";
import {
  BRUSH_ICONS,
  BRUSH_ICON_BY_PRESET_ID,
  BRUSH_ICON_SIZE,
  brushIconForBuiltIn,
  brushIconPaths,
  brushIconRuns,
} from "../features/brushes/brushIcons";
import {
  brushGlyphId,
  brushIconForPreset,
  brushIconPalette,
} from "../features/brushes/brushIconFromBrush";

/** The pixels a grid paints, in row-major order. */
function painted(icon: (typeof BRUSH_ICONS)[number]): string[] {
  return icon.grid.flatMap((row, y) =>
    [...row].flatMap((key, x) => (key === "." ? [] : [`${x},${y}`])),
  );
}

/** A preset built from the default brush with a few fields changed. */
function preset(id: string, brush: Partial<BrushSettings>): BrushPreset {
  return { id, name: id, brush: { ...DEFAULT_BRUSH, ...brush } };
}

/** The Krita presets as the importer would add them. */
const KRITA_PRESETS: readonly BrushPreset[] = KRITA_DEFAULT_PRESET_ENTRIES.map(
  (entry, index) => ({ id: `krita-${index}`, name: entry.name, brush: entry.brush }),
);

/** Every preset the app can list: the built-ins and the translated Krita set. */
const ALL_PRESETS: readonly BrushPreset[] = [...BUNDLED_PRESETS, ...KRITA_PRESETS];

/** The two rows a generated icon's mark occupies, inside its frame. */
function swash(icon: { readonly grid: readonly string[] }): string {
  return icon.grid[12] + icon.grid[13];
}

/** How far apart two hex colours are, summed over the three channels. */
function distance(a: string, b: string): number {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  if (!first || !second) {
    throw new Error(`${a} and ${b} must be hex colours`);
  }
  return (
    Math.abs(first.r - second.r) +
    Math.abs(first.g - second.g) +
    Math.abs(first.b - second.b)
  );
}

describe("the built-in brush icons", () => {
  it("gives every built-in brush one icon and no other", () => {
    const icons = BRUSH_ICONS.map((icon) => `builtin-${icon.id}`).sort();
    const brushes = BUNDLED_PRESETS.map((preset) => preset.id).sort();
    expect(icons).toEqual(brushes);
  });

  it("keeps every grid square and inside its palette", () => {
    for (const icon of BRUSH_ICONS) {
      expect(icon.grid).toHaveLength(BRUSH_ICON_SIZE);
      for (const row of icon.grid) {
        expect(row).toHaveLength(BRUSH_ICON_SIZE);
        for (const key of row) {
          if (key === ".") {
            continue;
          }
          expect(icon.palette[key], `${icon.id} uses ${key}`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  it("frames every icon in the same tile, with transparent corners", () => {
    for (const icon of BRUSH_ICONS) {
      expect(icon.grid[0]).toBe(`..${"k".repeat(12)}..`);
      expect(icon.grid[BRUSH_ICON_SIZE - 1]).toBe(`..${"k".repeat(12)}..`);
      expect(icon.grid[1]).toBe(`.k${"b".repeat(12)}k.`);
      expect(icon.grid[BRUSH_ICON_SIZE - 2]).toBe(`.k${"b".repeat(12)}k.`);
      for (const y of [0, BRUSH_ICON_SIZE - 1]) {
        for (const x of [0, 1, BRUSH_ICON_SIZE - 2, BRUSH_ICON_SIZE - 1]) {
          expect(icon.grid[y][x]).toBe(".");
        }
      }
    }
  });

  it("gives every icon its own picture, in a handful of colours", () => {
    const pictures = new Set(BRUSH_ICONS.map((icon) => icon.grid.join("\n")));
    expect(pictures.size).toBe(BRUSH_ICONS.length);
    for (const icon of BRUSH_ICONS) {
      const colours = new Set(brushIconRuns(icon).map((run) => run.color));
      expect(colours.size, `${icon.id} has ${colours.size} colours`).toBeGreaterThanOrEqual(5);
    }
  });

  it("maps a built-in preset id to its icon, and gives every other preset none", () => {
    expect(BRUSH_ICON_BY_PRESET_ID["builtin-pen"]?.id).toBe("pen");
    expect(brushIconForBuiltIn("builtin-charcoal")?.id).toBe("charcoal");
    expect(brushIconForBuiltIn("preset-1")).toBeNull();
    expect(brushIconForBuiltIn("builtin-nothing")).toBeNull();
    expect(brushIconForBuiltIn("")).toBeNull();
  });

  it("keeps the hand-drawn icon when the preset is a built-in one", () => {
    for (const bundled of BUNDLED_PRESETS) {
      expect(brushIconForPreset(bundled)).toBe(BRUSH_ICON_BY_PRESET_ID[bundled.id]);
    }
  });
});

describe("the icon runs", () => {
  it("covers every painted pixel once, in single-colour rows", () => {
    for (const icon of [...BRUSH_ICONS, ...ALL_PRESETS.map(brushIconForPreset)]) {
      const runs = brushIconRuns(icon);
      const covered: string[] = [];
      for (const run of runs) {
        expect(run.width).toBeGreaterThan(0);
        expect(run.y).toBeGreaterThanOrEqual(0);
        expect(run.y).toBeLessThan(BRUSH_ICON_SIZE);
        expect(run.x + run.width).toBeLessThanOrEqual(BRUSH_ICON_SIZE);
        for (let x = run.x; x < run.x + run.width; x += 1) {
          covered.push(`${x},${run.y}`);
          const key = icon.grid[run.y][x];
          expect(icon.palette[key], `${icon.id} paints ${key}`).toBe(run.color);
        }
      }
      expect(new Set(covered).size).toBe(covered.length);
      expect(covered.sort()).toEqual(painted(icon).sort());
    }
  });

  it("merges a row's neighbours instead of drawing a rectangle per pixel", () => {
    for (const icon of BRUSH_ICONS) {
      const runs = brushIconRuns(icon);
      expect(runs.length).toBeLessThan(icon.grid.length * 6);
    }
  });

  it("groups the runs into one path per colour, losing nothing", () => {
    for (const icon of [...BRUSH_ICONS, ...ALL_PRESETS.map(brushIconForPreset)]) {
      const runs = brushIconRuns(icon);
      const paths = brushIconPaths(icon);
      const colours = new Set(runs.map((run) => run.color));
      expect(paths).toHaveLength(colours.size);
      for (const path of paths) {
        expect(colours.has(path.color)).toBe(true);
        expect(path.d.startsWith("M")).toBe(true);
      }
      const segments = paths.reduce((total, path) => total + path.d.split("M").length - 1, 0);
      expect(segments).toBe(runs.length);
    }
  });
});

describe("the generated icons", () => {
  it("draws an icon for every preset in the library, framed like the built-ins", () => {
    expect(KRITA_PRESETS).toHaveLength(81);
    for (const entry of ALL_PRESETS) {
      const icon = brushIconForPreset(entry);
      expect(icon.grid).toHaveLength(BRUSH_ICON_SIZE);
      for (const row of icon.grid) {
        expect(row).toHaveLength(BRUSH_ICON_SIZE);
        for (const key of row) {
          if (key === ".") {
            continue;
          }
          expect(icon.palette[key], `${entry.name} uses ${key}`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
      expect(icon.grid[0]).toBe(`..${"k".repeat(12)}..`);
      expect(icon.grid[1]).toBe(`.k${"b".repeat(12)}k.`);
      // A picture, not an empty tile.
      expect(brushIconRuns(icon).length, `${entry.name} draws nothing`).toBeGreaterThan(8);
    }
  });

  it("draws the same picture for the same settings, whatever the name", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, size: 40, hardness: 0.3 };
    const first = brushIconForPreset({ id: "one", name: "One", brush });
    const second = brushIconForPreset({ id: "two", name: "A different name", brush });
    expect(first.grid).toEqual(second.grid);
    expect(first.palette).toEqual(second.palette);
  });

  it("reads the kind of brush from the settings", () => {
    const kind = (brush: Partial<BrushSettings>) => brushGlyphId({ ...DEFAULT_BRUSH, ...brush });
    expect(kind({ stamp: true, tip: "chisel" })).toBe("marker");
    expect(kind({ stamp: true, tip: "bristle" })).toBe("bristle");
    expect(kind({ stamp: true, tip: "felt" })).toBe("felt");
    expect(kind({ stamp: true, tip: "blot" })).toBe("charcoal");
    expect(kind({ stamp: true, tip: "round" })).toBe("stamps");
    expect(kind({ texture: 0.85 })).toBe("charcoal");
    expect(kind({ hardness: 0 })).toBe("airbrush");
    expect(kind({ hardness: 0.5 })).toBe("soft");
    expect(kind({ hardness: 1, size: 6 })).toBe("pen");
    expect(kind({ hardness: 1, size: 40 })).toBe("round");
    // The tip is only read when the brush is stamped: a plain round brush with
    // a chisel tip paints a round stroke, so it must not draw a chisel.
    expect(kind({ tip: "chisel", stamp: false })).toBe("pen");
  });

  it("gives a chisel brush a different picture from a nib", () => {
    const nib = brushIconForPreset(preset("nib", { hardness: 1 }));
    const chisel = brushIconForPreset(preset("chisel", { stamp: true, tip: "chisel" }));
    expect(chisel.grid).not.toEqual(nib.grid);
    expect(nib.id).toBe("pen");
    expect(chisel.id).toBe("marker");
  });

  it("takes the tile's colours from the kind and the mark's from the ink", () => {
    const pen = brushIconForPreset(preset("pen", { hardness: 1, size: 6 }));
    const redPen = brushIconForPreset(
      preset("red-pen", { hardness: 1, size: 6, color: "#cc2222" }),
    );
    // The tile belongs to the kind, so two pens share it however they paint...
    expect(redPen.palette.B).toBe(pen.palette.B);
    expect(redPen.palette.B).toBe(BRUSH_ICON_BY_PRESET_ID["builtin-pen"]?.palette.B);
    // ...and the mark carries the brush's own ink.
    expect(redPen.palette.s).not.toBe(pen.palette.s);
    const mark = hexToRgb(redPen.palette.s);
    expect(mark?.r ?? 0).toBeGreaterThan(mark?.b ?? 0);

    // Another kind is drawn in another palette.
    const charcoal = brushIconForPreset(preset("charcoal", { texture: 0.8 }));
    expect(charcoal.palette.B).not.toBe(pen.palette.B);
    expect(charcoal.palette.B).toMatch(/^#[0-9a-f]{6}$/i);
    expect(brushIconPalette({ ...DEFAULT_BRUSH, texture: 0.8 }).B).toBe(charcoal.palette.B);
  });

  it("leaves a longer mark for a wider brush", () => {
    const mark = (size: number) => swash(brushIconForPreset(preset("s", { size })));
    const narrow = mark(3).split("s").length - 1;
    const wide = mark(200).split("s").length - 1;
    expect(narrow).toBeGreaterThan(0);
    expect(wide).toBeGreaterThan(narrow);
  });

  it("leaves a fainter mark for a translucent brush", () => {
    const opaque = brushIconForPreset(preset("opaque", { opacity: 1 }));
    const faint = brushIconForPreset(preset("faint", { opacity: 0.2 }));
    // The mark is the ink over the tile: less opacity, less distance from it.
    expect(distance(faint.palette.s, faint.palette.B)).toBeLessThan(
      distance(opaque.palette.s, opaque.palette.B),
    );
  });

  it("tapers the mark when pressure changes the width", () => {
    const count = (row: string) => row.split("s").length - 1;
    const band = brushIconForPreset(preset("band", { size: 60, pressureSize: 0 }));
    const taper = brushIconForPreset(preset("taper", { size: 60, pressureSize: 0.9 }));
    // A band keeps its width on both rows; a taper narrows on the second.
    expect(count(band.grid[13])).toBeGreaterThan(0);
    expect(count(taper.grid[13])).toBeGreaterThan(0);
    expect(count(taper.grid[13])).toBeLessThan(count(band.grid[13]));
  });

  it("leaves a dotted mark when a stamped brush spaces its dabs far apart", () => {
    const tight = brushIconForPreset(
      preset("tight", { stamp: true, tip: "round", stampSpacing: 0.1 }),
    );
    const sparse = brushIconForPreset(
      preset("sparse", { stamp: true, tip: "round", stampSpacing: 0.8 }),
    );
    // The frame turns the gaps into the tile's colour, so a gap is `sB`.
    expect(swash(tight)).toContain("ss");
    expect(swash(sparse)).not.toContain("ss");
    expect(swash(sparse)).toContain("sB");
  });

  it("gives the translated Krita brushes more than one kind of icon", () => {
    const kinds = new Set(KRITA_PRESETS.map((entry) => brushGlyphId(entry.brush)));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });
});
