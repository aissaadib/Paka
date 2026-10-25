/**
 * The built-in brushes' icons.
 *
 * The icons are code, so what can be checked is the code: every built-in
 * brush has one, every grid is square and uses only colours its palette
 * defines, the tile frame is the same for all of them, and the runs the
 * renderer turns into rectangles cover exactly the pixels the grid paints -
 * no gap, no overlap, no rectangle that mixes two colours.
 */

import { describe, expect, it } from "vitest";
import { BUNDLED_PRESETS } from "../core/brushes/bundledPresets";
import {
  BRUSH_ICONS,
  BRUSH_ICON_BY_PRESET_ID,
  BRUSH_ICON_SIZE,
  brushIconForPreset,
  brushIconRuns,
} from "../features/brushes/brushIcons";

/** The pixels a grid paints, in row-major order. */
function painted(icon: (typeof BRUSH_ICONS)[number]): string[] {
  return icon.grid.flatMap((row, y) =>
    [...row].flatMap((key, x) => (key === "." ? [] : [`${x},${y}`])),
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

  it("maps a preset id to its icon, and gives every other preset none", () => {
    expect(BRUSH_ICON_BY_PRESET_ID["builtin-pen"]?.id).toBe("pen");
    expect(brushIconForPreset("builtin-charcoal")?.id).toBe("charcoal");
    expect(brushIconForPreset("preset-1")).toBeNull();
    expect(brushIconForPreset("builtin-nothing")).toBeNull();
    expect(brushIconForPreset("")).toBeNull();
  });
});

describe("the icon runs", () => {
  it("covers every painted pixel once, in single-colour rows", () => {
    for (const icon of BRUSH_ICONS) {
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
});
