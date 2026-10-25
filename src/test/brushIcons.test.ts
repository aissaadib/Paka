/**
 * The brush icons: the vector art and the icon every brush is drawn as.
 *
 * The icons are code, so what can be checked is the code: every brush in the
 * library gets a picture, the tile is the same for all of them, every colour is
 * a colour and every coordinate is inside the icon, the same settings always
 * draw the same picture, and the six built-in brushes draw six different ones.
 *
 * The generated set is checked by what a user would notice: a chisel brush does
 * not look like a nib, a red brush marks the tile red where a black one marks
 * it grey, a wide brush leaves a longer mark than a narrow one, a translucent
 * brush leaves a fainter one, pressure tapers the mark, and a widely spaced
 * stamp leaves a dotted one.
 */

import { describe, expect, it } from "vitest";
import { BUNDLED_PRESETS } from "../core/brushes/bundledPresets";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { KRITA_DEFAULT_PRESET_ENTRIES } from "../core/brushes/kritaDefaults";
import type { BrushPreset } from "../core/brushes/presets";
import type { BrushSettings } from "../types/brush";
import { hexToRgb } from "../utils/color";
import {
  BRUSH_ICON_LABELS,
  BRUSH_ICON_SIZE,
  BRUSH_PALETTES,
  type BrushIcon,
} from "../features/brushes/brushIcons";
import {
  brushGlyphId,
  brushIconForPreset,
  brushIconFromBrush,
  brushIconPalette,
  brushMark,
} from "../features/brushes/brushIconFromBrush";

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

/** Every colour a path can carry, as the renderer receives it. */
function colours(icon: BrushIcon): string[] {
  return icon.paths.flatMap((path) =>
    [path.fill, path.stroke].filter((colour): colour is string => colour !== undefined),
  );
}

/** The numbers in a path, in the order they appear. */
function numbers(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
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

describe("the icons", () => {
  it("draws a picture for every preset in the library", () => {
    expect(KRITA_PRESETS).toHaveLength(81);
    for (const entry of ALL_PRESETS) {
      const icon = brushIconForPreset(entry);
      // The tile, its sheen and its shade, the mark, and a subject.
      expect(icon.paths.length, `${entry.name} draws ${icon.paths.length} paths`).toBeGreaterThan(8);
      expect(icon.label).toBe(BRUSH_ICON_LABELS[icon.id]);
      for (const path of icon.paths) {
        expect(path.d, `${entry.name} has an empty path`).not.toBe("");
        expect(path.d.startsWith("M"), `${entry.name}: ${path.d}`).toBe(true);
        expect(path.d).not.toContain("NaN");
      }
    }
  });

  it("keeps every coordinate inside the icon", () => {
    for (const entry of ALL_PRESETS) {
      const icon = brushIconForPreset(entry);
      for (const path of icon.paths) {
        for (const value of numbers(path.d)) {
          expect(value, `${entry.name}: ${path.d}`).toBeGreaterThanOrEqual(0);
          expect(value, `${entry.name}: ${path.d}`).toBeLessThanOrEqual(BRUSH_ICON_SIZE);
        }
      }
    }
  });

  it("paints every path in a colour the renderer can read", () => {
    for (const entry of ALL_PRESETS) {
      const icon = brushIconForPreset(entry);
      expect(colours(icon).length, `${entry.name} paints nothing`).toBeGreaterThan(4);
      for (const colour of colours(icon)) {
        expect(colour, `${entry.name} paints ${colour}`).toMatch(
          /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\))$/i,
        );
      }
      for (const path of icon.paths) {
        if (path.stroke !== undefined) {
          expect(path.strokeWidth, `${entry.name} strokes with no width`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("frames every icon in the same tile", () => {
    const [first] = ALL_PRESETS.map(brushIconForPreset);
    for (const entry of ALL_PRESETS) {
      const icon = brushIconForPreset(entry);
      // The tile is the first path, and it is the same shape for every brush.
      expect(icon.paths[0].d).toBe(first.paths[0].d);
      expect(icon.paths[0].fill).toBe(BRUSH_PALETTES[icon.id].tile);
      expect(icon.paths[0].stroke).toBe(BRUSH_PALETTES[icon.id].edge);
    }
  });

  it("gives the six built-in brushes six different pictures", () => {
    const pictures = BUNDLED_PRESETS.map((entry) =>
      JSON.stringify(brushIconForPreset(entry).paths),
    );
    expect(new Set(pictures).size).toBe(BUNDLED_PRESETS.length);
  });

  it("keeps the six built-in brushes' own subjects", () => {
    const kinds: Record<string, string> = {
      "builtin-pen": "pen",
      "builtin-soft": "soft",
      "builtin-marker": "marker",
      "builtin-airbrush": "airbrush",
      "builtin-charcoal": "charcoal",
      "builtin-stamps": "stamps",
    };
    for (const bundled of BUNDLED_PRESETS) {
      // The curated subject is what the name promises, even where the settings
      // alone would say something else (the Marker paints round, but is drawn
      // as a chisel).
      expect(brushIconForPreset(bundled).id, bundled.name).toBe(kinds[bundled.id]);
      // Everything else about the icon is still the brush's settings.
      const fromSettings = brushIconFromBrush(bundled.brush);
      expect(brushIconForPreset(bundled).paths[3]).toEqual(fromSettings.paths[3]);
    }
  });

  it("draws the same picture for the same settings, whatever the name", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, size: 40, hardness: 0.3 };
    const first = brushIconForPreset({ id: "one", name: "One", brush });
    const second = brushIconForPreset({ id: "two", name: "A different name", brush });
    expect(first.paths).toEqual(second.paths);
    expect(first.palette).toEqual(second.palette);
  });
});

describe("the kind of brush", () => {
  it("reads the kind from the settings", () => {
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

  it("gives every kind its own subject and its own tile", () => {
    const tiles = new Set<string>();
    const subjects = new Set<string>();
    for (const kind of Object.keys(BRUSH_PALETTES) as (keyof typeof BRUSH_PALETTES)[]) {
      tiles.add(BRUSH_PALETTES[kind].tile);
      // The subject is everything the frame and the mark do not draw.
      const icon = brushIconFromBrush({ ...DEFAULT_BRUSH, ...settingsFor(kind) });
      expect(icon.id).toBe(kind);
      subjects.add(JSON.stringify(icon.paths.slice(3)));
    }
    expect(tiles.size).toBe(Object.keys(BRUSH_PALETTES).length);
    expect(subjects.size).toBe(Object.keys(BRUSH_PALETTES).length);
  });

  it("gives a chisel brush a different picture from a nib", () => {
    const nib = brushIconForPreset(preset("nib", { hardness: 1 }));
    const chisel = brushIconForPreset(preset("chisel", { stamp: true, tip: "chisel" }));
    expect(chisel.paths).not.toEqual(nib.paths);
    expect(nib.id).toBe("pen");
    expect(chisel.id).toBe("marker");
  });

  it("takes the tile's colour from the kind and the mark's from the ink", () => {
    const pen = brushIconForPreset(preset("pen", { hardness: 1, size: 6 }));
    const redPen = brushIconForPreset(
      preset("red-pen", { hardness: 1, size: 6, color: "#cc2222" }),
    );
    // The tile belongs to the kind, so two pens share it however they paint...
    expect(redPen.palette.tile).toBe(pen.palette.tile);
    expect(redPen.palette.tile).toBe(BRUSH_PALETTES.pen.tile);
    // ...and the mark carries the brush's own ink.
    const redMark = brushMark({ ...DEFAULT_BRUSH, color: "#cc2222" });
    const blackMark = brushMark(DEFAULT_BRUSH);
    expect(redMark.color).not.toBe(blackMark.color);
    const mark = hexToRgb(redMark.color);
    expect(mark?.r ?? 0).toBeGreaterThan(mark?.b ?? 0);

    // Another kind is drawn in another palette.
    const charcoal = brushIconForPreset(preset("charcoal", { texture: 0.8 }));
    expect(charcoal.palette.tile).not.toBe(pen.palette.tile);
    expect(brushIconPalette({ ...DEFAULT_BRUSH, texture: 0.8 })).toBe(charcoal.palette);
  });
});

/** Settings that paint each kind, for the kind's own tests. */
function settingsFor(kind: keyof typeof BRUSH_PALETTES): Partial<BrushSettings> {
  switch (kind) {
    case "pen":
      return { hardness: 1, size: 6 };
    case "soft":
      return { hardness: 0.5 };
    case "marker":
      return { stamp: true, tip: "chisel" };
    case "airbrush":
      return { hardness: 0 };
    case "charcoal":
      return { texture: 0.8 };
    case "stamps":
      return { stamp: true, tip: "round" };
    case "round":
      return { hardness: 1, size: 40 };
    case "bristle":
      return { stamp: true, tip: "bristle" };
    case "felt":
      return { stamp: true, tip: "felt" };
  }
}

describe("the mark", () => {
  it("leaves a longer mark for a wider brush", () => {
    const narrow = brushMark({ ...DEFAULT_BRUSH, size: 3 });
    const wide = brushMark({ ...DEFAULT_BRUSH, size: 200 });
    expect(narrow.length).toBeGreaterThan(0);
    expect(wide.length).toBeGreaterThan(narrow.length);
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it("leaves a fainter mark for a translucent brush", () => {
    const opaque = brushMark({ ...DEFAULT_BRUSH, opacity: 1 });
    const faint = brushMark({ ...DEFAULT_BRUSH, opacity: 0.2 });
    expect(faint.opacity).toBeLessThan(opaque.opacity);
    // The mark is the ink over the tile: less opacity, less distance from it.
    const tile = BRUSH_PALETTES[brushGlyphId(DEFAULT_BRUSH)].tile;
    expect(distance(faint.color, tile) * faint.opacity).toBeLessThan(
      distance(opaque.color, tile) * opaque.opacity,
    );
  });

  it("tapers the mark when pressure changes the width", () => {
    const band = brushMark({ ...DEFAULT_BRUSH, size: 60, pressureSize: 0 });
    const taper = brushMark({ ...DEFAULT_BRUSH, size: 60, pressureSize: 0.9 });
    expect(band.shape).toBe("band");
    expect(taper.shape).toBe("taper");
    expect(taper.d).not.toBe(band.d);
  });

  it("leaves a dotted mark when a stamped brush spaces its dabs far apart", () => {
    const tight = brushMark({
      ...DEFAULT_BRUSH,
      stamp: true,
      tip: "round",
      stampSpacing: 0.1,
      pressureSize: 0,
    });
    const sparse = brushMark({
      ...DEFAULT_BRUSH,
      stamp: true,
      tip: "round",
      stampSpacing: 0.8,
      pressureSize: 0,
    });
    expect(tight.shape).toBe("band");
    expect(sparse.shape).toBe("dots");
    // A row of dabs is several closed sub-paths, not one.
    expect(sparse.d.split("M").length - 1).toBeGreaterThan(2);
    expect(tight.d.split("M").length - 1).toBe(1);
  });

  it("draws the mark under the subject", () => {
    const icon = brushIconForPreset(preset("pen", { hardness: 1 }));
    const mark = brushMark({ ...DEFAULT_BRUSH, hardness: 1 });
    // The frame is three paths; the mark is the one after them.
    expect(icon.paths[3].d).toBe(mark.d);
    expect(icon.paths[3].fill).toBe(mark.color);
    expect(icon.paths[3].opacity).toBe(mark.opacity);
  });
});

describe("the translated Krita brushes", () => {
  it("draw more than one kind of icon", () => {
    const kinds = new Set(KRITA_PRESETS.map((entry) => brushGlyphId(entry.brush)));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it("are drawn from their settings like any other brush", () => {
    for (const entry of KRITA_PRESETS) {
      expect(brushIconForPreset(entry).id).toBe(brushGlyphId(entry.brush));
    }
  });
});
