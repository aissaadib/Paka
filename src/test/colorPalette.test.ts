/**
 * The colour palette.
 *
 * These cover the model - the names, the colours, the bound - the engine seam
 * that adds, renames and removes swatches, the way a swatch becomes the ink
 * of a real stroke, a shape and a fill, and the palette's survival across a
 * restart through the settings file.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  DEFAULT_PALETTE,
  MAX_PALETTE_SWATCHES,
  addPaletteSwatch,
  findPaletteSwatch,
  findSwatchByColor,
  normalizePalette,
  paletteEqual,
  removePaletteSwatch,
  renamePaletteSwatch,
  uniqueSwatchName,
} from "../core/color/palette";
import { createDocument } from "../core/document/document";
import { isFillPatch, isShape } from "../core/document/types";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import type { DrawingRenderer, Rgb } from "../core/rendering/types";
import {
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  serializeAppSettings,
} from "../core/settings/appSettings";
import type { PointerSample } from "../types/pointer";
import { createStubRenderer, flatImage } from "./support/stubRenderer";

function createSample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    phase: "move",
    pointerId: 1,
    kind: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: 0,
    docY: 0,
    screenX: 0,
    screenY: 0,
    pressure: 0.7,
    hasPressure: true,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    ...overrides,
  };
}

/** A renderer that answers the bucket's composite read with a flat colour. */
function createFlatRenderer(color: Rgb): DrawingRenderer {
  return createStubRenderer({
    pixel: color,
    image: flatImage(40, 40, color),
  });
}

function createEngine(renderer?: DrawingRenderer) {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 40, height: 40 }),
    ...(renderer ? { renderer } : {}),
  });
}

describe("the palette model", () => {
  it("starts with the shipped palette", () => {
    expect(DEFAULT_PALETTE.length).toBeGreaterThan(0);
    for (const swatch of DEFAULT_PALETTE) {
      expect(swatch.name).not.toBe("");
      expect(swatch.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("gives a duplicate name a numeric suffix", () => {
    const existing = [{ id: "a", name: "Ink" }];

    expect(uniqueSwatchName("Ink", existing)).toBe("Ink (2)");
    expect(uniqueSwatchName("Ink", existing, "a")).toBe("Ink");
    expect(uniqueSwatchName("  ", existing)).toBe("");
  });

  it("adds a colour and names it after its own hex", () => {
    const change = addPaletteSwatch([], "#123456");

    expect(change).not.toBeNull();
    expect(change?.swatch.color).toBe("#123456");
    expect(change?.swatch.name).toBe("#123456");
    expect(change?.palette).toHaveLength(1);
  });

  it("adds a colour under a name the artist chose", () => {
    const change = addPaletteSwatch([], "#123456", "  Deep   sea  ");

    expect(change?.swatch.name).toBe("Deep sea");
  });

  it("does not add the same colour twice", () => {
    const first = addPaletteSwatch([], "#123456");
    const second = addPaletteSwatch(first?.palette ?? [], "#123456");

    expect(second?.palette).toHaveLength(1);
    expect(second?.swatch.id).toBe(first?.swatch.id);
  });

  it("refuses a colour that is not a colour", () => {
    expect(addPaletteSwatch([], "not a colour")).toBeNull();
    expect(addPaletteSwatch([], "")).toBeNull();
  });

  it("refuses to add past the cap", () => {
    const full = Array.from({ length: MAX_PALETTE_SWATCHES }, (_, index) => ({
      id: `swatch-${index}`,
      name: `Swatch ${index}`,
      color: `#${index.toString(16).padStart(6, "0")}`,
    }));

    expect(addPaletteSwatch(full, "#ffffff")).toBeNull();
  });

  it("renames a swatch and keeps the names distinct", () => {
    const palette = normalizePalette([
      { id: "a", name: "Ink", color: "#111111" },
      { id: "b", name: "Paper", color: "#ffffff" },
    ]);

    const renamed = renamePaletteSwatch(palette, "b", "Ink");

    expect(renamed?.swatch.name).toBe("Ink (2)");
    expect(renamed?.palette[1].name).toBe("Ink (2)");
  });

  it("refuses to rename a swatch that is not there or to an empty name", () => {
    const palette = normalizePalette([{ id: "a", name: "Ink", color: "#111111" }]);

    expect(renamePaletteSwatch(palette, "missing", "New")).toBeNull();
    expect(renamePaletteSwatch(palette, "a", "   ")).toBeNull();
  });

  it("removes a swatch and refuses to remove one that is not there", () => {
    const palette = normalizePalette([
      { id: "a", name: "Ink", color: "#111111" },
      { id: "b", name: "Paper", color: "#ffffff" },
    ]);

    expect(removePaletteSwatch(palette, "a")).toHaveLength(1);
    expect(removePaletteSwatch(palette, "missing")).toBeNull();
  });

  it("reads an untrusted list and skips the broken entries", () => {
    const palette = normalizePalette([
      { id: "a", name: "Ink", color: "#111111" },
      { name: "No id", color: "#222222" },
      { id: "c", name: "No colour" },
      { id: "d", name: "   ", color: "#444444" },
      "not an object",
      null,
      { id: "e", name: "Fine", color: "#ABC" },
    ]);

    expect(palette.map((swatch) => swatch.name)).toEqual(["Ink", "No id", "Fine"]);
    expect(palette[2].color).toBe("#aabbcc");
  });

  it("gives a duplicate id a fresh one", () => {
    const palette = normalizePalette([
      { id: "same", name: "One", color: "#111111" },
      { id: "same", name: "Two", color: "#222222" },
    ]);

    expect(palette[0].id).not.toBe(palette[1].id);
  });

  it("reads a value that is not a list as an empty palette", () => {
    expect(normalizePalette(undefined)).toEqual([]);
    expect(normalizePalette({ swatches: [] })).toEqual([]);
  });

  it("compares two palettes field by field", () => {
    const a = normalizePalette([{ id: "a", name: "Ink", color: "#111111" }]);
    const b = normalizePalette([{ id: "a", name: "Ink", color: "#111111" }]);
    const c = normalizePalette([{ id: "a", name: "Ink", color: "#222222" }]);

    expect(paletteEqual(a, b)).toBe(true);
    expect(paletteEqual(a, c)).toBe(false);
  });

  it("finds a swatch by its id and by its colour", () => {
    const palette = normalizePalette([{ id: "a", name: "Ink", color: "#111111" }]);

    expect(findPaletteSwatch(palette, "a")?.name).toBe("Ink");
    expect(findSwatchByColor(palette, "#111111")?.id).toBe("a");
    expect(findSwatchByColor(palette, "#222222")).toBeNull();
  });
});

describe("the engine keeps the palette", () => {
  it("adds, renames and removes swatches", () => {
    const engine = createEngine();

    const swatch = engine.addPaletteSwatch("#123456", "Deep sea");
    expect(swatch?.name).toBe("Deep sea");
    expect(engine.getState().palette).toHaveLength(DEFAULT_PALETTE.length + 1);

    const renamed = engine.renamePaletteSwatch(swatch?.id ?? "", "Ocean");
    expect(renamed?.name).toBe("Ocean");
    expect(
      engine.getState().palette.find((entry) => entry.id === swatch?.id)?.name,
    ).toBe("Ocean");

    expect(engine.removePaletteSwatch(swatch?.id ?? "")).toBe(true);
    expect(engine.getState().palette).toHaveLength(DEFAULT_PALETTE.length);
  });

  it("refuses a swatch it cannot store", () => {
    const engine = createEngine();

    expect(engine.addPaletteSwatch("not a colour")).toBeNull();
    expect(engine.renamePaletteSwatch("missing", "Nope")).toBeNull();
    expect(engine.removePaletteSwatch("missing")).toBe(false);
    expect(engine.getState().palette).toHaveLength(DEFAULT_PALETTE.length);
  });

  it("never dirties the document or adds a history step", () => {
    const engine = createEngine();
    const swatch = engine.addPaletteSwatch("#123456");

    engine.renamePaletteSwatch(swatch?.id ?? "", "Ocean");
    engine.removePaletteSwatch(swatch?.id ?? "");

    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("does not add the same colour twice", () => {
    const engine = createEngine();

    const first = engine.addPaletteSwatch("#123456");
    const second = engine.addPaletteSwatch("#123456");

    expect(second?.id).toBe(first?.id);
    expect(engine.getState().palette).toHaveLength(DEFAULT_PALETTE.length + 1);
  });
});

describe("a swatch becomes the colour the artist paints with", () => {
  it("paints a stroke in the swatch colour", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    const swatch = engine.addPaletteSwatch("#123456");

    engine.setTool("brush");
    engine.setBrush({ color: swatch?.color ?? "#000000" });
    engine.handlePointerSample(createSample({ phase: "down", docX: 4, docY: 4 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 12, docY: 12 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 12, docY: 12 }));

    expect(engine.listStrokes(layerId)[0].brush.color).toBe("#123456");
  });

  it("paints a shape in the swatch colour", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    const swatch = engine.addPaletteSwatch("#123456");

    engine.setTool("rectangle");
    engine.setBrush({ color: swatch?.color ?? "#000000" });
    engine.handlePointerSample(createSample({ phase: "down", docX: 4, docY: 4 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 20, docY: 20 }));

    // A shape is its own kind of element, not a stroke: the rectangle the
    // gesture left behind carries the brush it was drawn with.
    const shape = engine.listElements(layerId).find(isShape);
    expect(shape?.brush.color).toBe("#123456");
  });

  it("paints a fill in the swatch colour", () => {
    const engine = createEngine(
      createFlatRenderer({ r: 255, g: 255, b: 255 }),
    );
    const layerId = engine.getState().document.activeLayerId as string;
    const swatch = engine.addPaletteSwatch("#123456");

    engine.setTool("bucket");
    engine.setBrush({ color: swatch?.color ?? "#000000" });
    engine.handlePointerSample(createSample({ phase: "down", docX: 8, docY: 8 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 8, docY: 8 }));

    const element = engine.listElements(layerId)[0];
    expect(isFillPatch(element)).toBe(true);
    expect(isFillPatch(element) ? element.color : null).toBe("#123456");
  });

  it("paints a right-button stroke in the alt colour the artist picked", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    const swatch = engine.addPaletteSwatch("#123456");

    engine.setTool("brush");
    engine.setSecondaryColor(swatch?.color ?? "#000000");
    engine.handlePointerSample(
      createSample({ phase: "down", docX: 4, docY: 4, button: 2, buttons: 3 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 12, docY: 12, button: 0, buttons: 3 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 12, docY: 12, button: 2, buttons: 0 }),
    );

    expect(engine.listStrokes(layerId)[0].brush.color).toBe("#123456");
    // The ink itself did not move: the choice was per gesture.
    expect(engine.getState().brush.color).toBe(DEFAULT_BRUSH.color);
  });
});

describe("the palette survives a restart", () => {
  it("round-trips through the settings file", () => {
    const engine = createEngine();
    const swatch = engine.addPaletteSwatch("#123456", "Deep sea");
    engine.setSecondaryColor("#654321");

    const settings = {
      ...DEFAULT_APP_SETTINGS,
      brush: engine.getState().brush,
      secondaryColor: engine.getState().secondaryColor,
      palette: engine.getState().palette,
    };
    const restored = parseAppSettings(serializeAppSettings(settings));

    expect(restored.palette).toHaveLength(DEFAULT_PALETTE.length + 1);
    expect(restored.palette.find((entry) => entry.id === swatch?.id)?.name).toBe(
      "Deep sea",
    );
    expect(restored.secondaryColor).toBe("#654321");
  });

  it("uses the shipped palette for a file written before the palette existed", () => {
    const restored = parseAppSettings(JSON.stringify({ version: 1, toolId: "brush" }));

    expect(restored.palette).toHaveLength(DEFAULT_PALETTE.length);
  });

  it("keeps the good swatches when one entry in the file is broken", () => {
    const restored = parseAppSettings(
      JSON.stringify({
        version: 1,
        palette: [
          { id: "a", name: "Ink", color: "#111111" },
          { id: "b", name: "Broken" },
        ],
      }),
    );

    expect(restored.palette.map((swatch) => swatch.name)).toEqual(["Ink"]);
  });
});
