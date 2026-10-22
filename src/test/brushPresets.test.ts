/**
 * Brush presets: the name rules, the editor operations and the settings read.
 *
 * A preset is editor preference, not document state. The properties pinned
 * down here are the ones a user would notice: the full brush is stored, the
 * library survives a restart through the normal settings file, applying or
 * deleting a preset never dirties the drawing, and a malformed entry in the
 * file cannot lose the rest of the settings.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH, normalizeBrush } from "../core/brushes/defaults";
import {
  MAX_PRESET_NAME_LENGTH,
  normalizePresetName,
  uniquePresetName,
  type BrushPreset,
} from "../core/brushes/presets";
import { createDocument } from "../core/document/document";
import type { StrokeRecord, StrokeSource } from "../core/document/types";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { parseProject, serializeProject } from "../core/project/projectFormat";
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  parseAppSettings,
  serializeAppSettings,
  settingsEqual,
} from "../core/settings/appSettings";
import { SettingsStore } from "../core/settings/settingsStore";
import type { BrushSettings, PressureCurvePoint, TaperSettings } from "../types/brush";
import type { PointerSample } from "../types/pointer";
import { MemorySettingsGateway } from "./support/memorySettingsGateway";

/** A curve that is not the identity. */
const BENT_CURVE: readonly PressureCurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.8 },
  { x: 1, y: 1 },
];

/** A taper that is not the default one, with every field set. */
const TAPER_WITH_EVERY_FIELD_SET: TaperSettings = {
  enabled: true,
  startLength: 0.45,
  startStrength: 0.7,
  endLength: 0.35,
  endStrength: 0.25,
};

/**
 * A brush with every field set to a value that is not its default.
 *
 * These are the values that must come back unchanged: a field that is dropped
 * on the way into a file and read back out shows up as a difference here,
 * rather than as a brush that quietly reverted to its default.
 */
const BRUSH_WITH_EVERY_FIELD_SET: BrushSettings = {
  size: 23,
  opacity: 0.42,
  color: "#1a2b3c",
  hardness: 0.31,
  pressureSize: 0.77,
  pressureOpacity: 0.66,
  pressureCurve: BENT_CURVE,
  minSizeRatio: 0.55,
  spacing: 0.44,
  stabilizer: 0.33,
  texture: 0.22,
  stamp: true,
  stampSpacing: 0.15,
  stampHardness: 0.85,
  stampTexture: 0.65,
  taper: TAPER_WITH_EVERY_FIELD_SET,
};

/** A value for one field that is neither its default nor its default again. */
function distinctiveValue(
  field: keyof BrushSettings,
): number | string | boolean | readonly PressureCurvePoint[] | TaperSettings {
  const fallback = DEFAULT_BRUSH[field];
  if (typeof fallback === "boolean") {
    return !fallback;
  }
  if (typeof fallback === "string") {
    return "#0a1b2c";
  }
  if (field === "taper") {
    return TAPER_WITH_EVERY_FIELD_SET;
  }
  if (Array.isArray(fallback) || typeof fallback === "object") {
    return BENT_CURVE;
  }
  return (fallback + 0.07) % 1;
}

/** The brush with one field changed, clamped the way the reader clamps it. */
function brushWith(
  field: keyof BrushSettings,
  value: number | string | boolean | readonly PressureCurvePoint[] | TaperSettings,
): BrushSettings {
  return normalizeBrush({ ...DEFAULT_BRUSH, [field]: value } as BrushSettings);
}

/** Every field a brush has, taken from the brush itself. */
function everyBrushField(): (keyof BrushSettings)[] {
  return Object.keys(DEFAULT_BRUSH) as (keyof BrushSettings)[];
}

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

function createEngine(): DrawingEngine {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 200, height: 120 }),
  });
}

describe("preset names", () => {
  it("trims, collapses whitespace and caps the length", () => {
    expect(normalizePresetName("  soft   ink  ")).toBe("soft ink");
    expect(normalizePresetName("   ")).toBe("");
    expect(normalizePresetName("x".repeat(100))).toHaveLength(MAX_PRESET_NAME_LENGTH);
    expect(normalizePresetName("x".repeat(100)).endsWith(" ")).toBe(false);
  });

  it("rejects an empty name and suffixes a duplicate deliberately", () => {
    const existing: BrushPreset[] = [{ id: "a", name: "Ink", brush: DEFAULT_BRUSH }];

    expect(uniquePresetName("   ", existing)).toBe("");
    expect(uniquePresetName("Ink", existing)).toBe("Ink (2)");
    expect(uniquePresetName(" ink ", existing)).toBe("ink (2)");
    expect(uniquePresetName("Ink", existing, "a")).toBe("Ink");
  });

  it("keeps a suffixed name inside the length cap", () => {
    const base = "x".repeat(MAX_PRESET_NAME_LENGTH);
    const existing: BrushPreset[] = [{ id: "a", name: base, brush: DEFAULT_BRUSH }];

    const unique = uniquePresetName(base, existing);
    expect(unique.length).toBeLessThanOrEqual(MAX_PRESET_NAME_LENGTH);
    expect(unique.endsWith(" (2)")).toBe(true);
  });
});

describe("saving, applying, renaming and deleting presets", () => {
  it("saves the whole current brush without touching history or the dirty flag", () => {
    const engine = createEngine();
    engine.setBrush({ size: 42, stamp: true, stampTexture: 0.5, color: "#123456" });

    const before = engine.getState();
    const preset = engine.saveBrushPreset("  Ink  ");
    const state = engine.getState();

    expect(preset?.name).toBe("Ink");
    expect(state.presets).toHaveLength(1);
    expect(state.presets[0].name).toBe("Ink");
    expect(state.presets[0].brush).toEqual(state.brush);
    expect(state.presets[0].brush.stampTexture).toBe(0.5);
    expect(state.file.dirty).toBe(false);
    expect(state.history.depth).toBe(before.history.depth);
  });

  it("rejects an empty name", () => {
    const engine = createEngine();
    expect(engine.saveBrushPreset("   ")).toBeNull();
    expect(engine.getState().presets).toHaveLength(0);
  });

  it("applies a preset through the normal brush setter", () => {
    const engine = createEngine();
    engine.setBrush({ size: 12, color: "#112233" });
    const preset = engine.saveBrushPreset("Small");
    expect(preset).not.toBeNull();

    engine.setBrush({ size: 90, color: "#445566" });
    const before = engine.getState();

    expect(engine.applyBrushPreset(preset?.id ?? "")).toBe(true);
    const after = engine.getState();

    expect(after.brush.size).toBe(12);
    expect(after.brush.color).toBe("#112233");
    expect(after.file.dirty).toBe(false);
    expect(after.history.depth).toBe(before.history.depth);
    expect(engine.applyBrushPreset("missing")).toBe(false);
  });

  it("suffixes, renames and deletes without a document edit", () => {
    const engine = createEngine();
    const first = engine.saveBrushPreset("Ink");
    engine.setBrush({ size: 20 });
    const second = engine.saveBrushPreset("Ink");

    expect(first).not.toBeNull();
    expect(second?.name).toBe("Ink (2)");

    const renamed = engine.renameBrushPreset(first?.id ?? "", " Ink (2) ");
    expect(renamed?.name).toBe("Ink (2) (2)");
    expect(engine.renameBrushPreset(first?.id ?? "", "   ")).toBeNull();
    expect(engine.renameBrushPreset("missing", "Name")).toBeNull();

    expect(engine.deleteBrushPreset("missing")).toBe(false);
    expect(engine.deleteBrushPreset(first?.id ?? "")).toBe(true);
    expect(engine.getState().presets.map((preset) => preset.name)).toEqual(["Ink (2)"]);

    const state = engine.getState();
    expect(state.file.dirty).toBe(false);
    expect(state.history.depth).toBe(0);
  });

  it("leaves the current brush alone when the library changes", () => {
    const engine = createEngine();
    engine.setBrush({ size: 20, color: "#123456" });
    const preset = engine.saveBrushPreset("Ink");
    expect(preset).not.toBeNull();

    const before = engine.getState().brush;
    engine.renameBrushPreset(preset?.id ?? "", "Marker");
    engine.duplicateBrushPreset(preset?.id ?? "");
    engine.deleteBrushPreset(preset?.id ?? "");

    expect(engine.getState().brush).toEqual(before);
    expect(engine.getState().presets).toHaveLength(1);
  });

  it("loads a preset library without a document edit", () => {
    const engine = createEngine();
    engine.setPresets([
      { id: "preset-9", name: "Loaded", brush: { ...DEFAULT_BRUSH, size: 31 } },
      { id: "preset-9", name: "Duplicate id", brush: DEFAULT_BRUSH },
    ]);

    const state = engine.getState();
    expect(state.presets.map((preset) => preset.name)).toEqual(["Loaded", "Duplicate id"]);
    expect(state.presets[0].id).not.toBe(state.presets[1].id);
    expect(state.presets[0].brush.size).toBe(31);
    expect(state.file.dirty).toBe(false);
    expect(state.history.depth).toBe(0);
  });
});

describe("presets in the settings file", () => {
  it("loads a file with no presets as an empty list", () => {
    const parsed = normalizeAppSettings({
      version: 1,
      toolId: "eraser",
      brush: { size: 21 },
    });

    expect(parsed.presets).toEqual([]);
    expect(parsed.toolId).toBe("eraser");
    expect(parseAppSettings(null).presets).toEqual([]);
  });

  it("skips a malformed entry without losing the rest of the file", () => {
    const parsed = normalizeAppSettings({
      version: 1,
      toolId: "eraser",
      fillTolerance: 88,
      brush: { size: 21 },
      presets: [
        { id: "preset-a", name: "Ink", brush: { size: 30 } },
        { name: 42, brush: {} },
        { id: "preset-a", name: "  Ink  ", brush: { size: "big" } },
        { id: "preset-c", name: "Soft", brush: { hardness: 0.2, stamp: true } },
        null,
        "not a preset",
      ],
    });

    expect(parsed.toolId).toBe("eraser");
    expect(parsed.fillTolerance).toBe(88);
    expect(parsed.brush.size).toBe(21);
    expect(parsed.presets.map((preset) => preset.name)).toEqual(["Ink", "Ink (2)", "Soft"]);
    expect(parsed.presets[1].id).not.toBe("preset-a");
    expect(parsed.presets[1].brush.size).toBe(DEFAULT_BRUSH.size);
    expect(parsed.presets[2].brush.hardness).toBe(0.2);
    expect(parsed.presets[2].brush.stamp).toBe(true);
  });

  it("treats a non-array presets value as an empty list", () => {
    const parsed = normalizeAppSettings({ version: 1, presets: { name: "Ink" } });
    expect(parsed.presets).toEqual([]);
  });

  it("is part of settings equality, so a change to a preset is written", () => {
    const withPreset = {
      ...DEFAULT_APP_SETTINGS,
      presets: [{ id: "preset-1", name: "Ink", brush: DEFAULT_BRUSH }],
    };

    expect(settingsEqual(DEFAULT_APP_SETTINGS, withPreset)).toBe(false);
    const parsed = parseAppSettings(serializeAppSettings(withPreset));
    expect(settingsEqual(parsed, withPreset)).toBe(true);
  });
});

describe("no brush field is dropped", () => {
  it("keeps every field of the brush through the settings file", () => {
    const settings = { ...DEFAULT_APP_SETTINGS, brush: BRUSH_WITH_EVERY_FIELD_SET };
    const parsed = parseAppSettings(serializeAppSettings(settings));

    expect(parsed.brush).toEqual(BRUSH_WITH_EVERY_FIELD_SET);
  });

  it("keeps every field of the brush through a saved preset", () => {
    const settings = {
      ...DEFAULT_APP_SETTINGS,
      presets: [{ id: "preset-1", name: "Ink", brush: BRUSH_WITH_EVERY_FIELD_SET }],
    };
    const parsed = parseAppSettings(serializeAppSettings(settings));

    expect(parsed.presets).toHaveLength(1);
    expect(parsed.presets[0].brush).toEqual(BRUSH_WITH_EVERY_FIELD_SET);
  });

  it("keeps every field of the brush through a project file", () => {
    // The project format reads a brush field by field too, so it is covered
    // by the same rule: a stroke must come back with the brush it was drawn
    // with.
    const document = createDocument({ name: "Test", width: 200, height: 120 });
    const layerId = document.layers[0].id;
    const stroke: StrokeRecord = {
      id: "stroke-1",
      layerId,
      brush: BRUSH_WITH_EVERY_FIELD_SET,
      xs: [1, 2.5, 3],
      ys: [4, 5.5, 6],
      pressures: [0.25, 0.5, 1],
      times: [0, 16, 40],
      startTime: 1000,
    };
    const store: StrokeSource = {
      listStrokes: () => [stroke],
      listElements: () => [stroke],
    };

    const parsed = parseProject(serializeProject(document, store));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.strokes[0].brush).toEqual(BRUSH_WITH_EVERY_FIELD_SET);
  });

  it("reads every field of the brush through a project file, one field at a time", () => {
    // The project format has its own hand-written brush reader, separate from
    // the settings one. Walk it field by field too: a field the reader forgets
    // comes back as its default, and no default below is the distinctive value.
    const document = createDocument({ name: "Test", width: 200, height: 120 });
    const layerId = document.layers[0].id;
    for (const field of everyBrushField()) {
      const expected = brushWith(field, distinctiveValue(field));
      const stroke: StrokeRecord = {
        id: "stroke-1",
        layerId,
        brush: expected,
        xs: [1, 2.5, 3],
        ys: [4, 5.5, 6],
        pressures: [0.25, 0.5, 1],
        times: [0, 16, 40],
        startTime: 1000,
      };
      const store: StrokeSource = {
        listStrokes: () => [stroke],
        listElements: () => [stroke],
      };

      const parsed = parseProject(serializeProject(document, store));

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        return;
      }
      expect(
        parsed.project.strokes[0].brush[field],
        `the project reader dropped "${String(field)}"`,
      ).toEqual(expected[field]);
    }
  });

  it("reads every field the brush has, one field at a time", () => {
    // The reader is walked field by field here on purpose: a mapping that
    // forgets one field falls back to the default for it, and the default is
    // never the distinctive value below.
    for (const field of everyBrushField()) {
      const raw = distinctiveValue(field);
      const expected = brushWith(field, raw)[field];

      const parsed = parseAppSettings(
        JSON.stringify({ version: 1, brush: { [field]: raw } }),
      );
      expect(parsed.brush[field], `the settings reader dropped "${field}"`).toEqual(expected);

      const withPreset = parseAppSettings(
        JSON.stringify({
          version: 1,
          presets: [{ id: "preset-1", name: "Ink", brush: { [field]: raw } }],
        }),
      );
      expect(
        withPreset.presets[0].brush[field],
        `the preset reader dropped "${field}"`,
      ).toEqual(expected);
    }
  });

  it("gives an old payload the safe default for a field it does not have", () => {
    // A preset written before a field existed keeps what it had and takes the
    // default for the rest.
    const parsed = parseAppSettings(
      JSON.stringify({
        version: 1,
        presets: [{ id: "preset-1", name: "Ink", brush: { size: 20, stamp: true } }],
      }),
    );

    const brush = parsed.presets[0].brush;
    expect(brush.size).toBe(20);
    expect(brush.stamp).toBe(true);
    expect(brush.stampTexture).toBe(DEFAULT_BRUSH.stampTexture);
    expect(brush.hardness).toBe(DEFAULT_BRUSH.hardness);
    expect(brush.stampSpacing).toBe(DEFAULT_BRUSH.stampSpacing);
  });

  it("gives a preset with no brush at all the default brush", () => {
    const parsed = parseAppSettings(
      JSON.stringify({ version: 1, presets: [{ id: "preset-1", name: "Ink" }] }),
    );

    expect(parsed.presets[0].brush).toEqual(DEFAULT_BRUSH);
  });
});

describe("duplicating a preset", () => {
  it("copies the brush under a fresh id and a name that does not clash", () => {
    const engine = createEngine();
    engine.setBrush({ size: 30, stamp: true, stampTexture: 0.4 });
    const first = engine.saveBrushPreset("Ink");
    expect(first).not.toBeNull();

    const copy = engine.duplicateBrushPreset(first?.id ?? "");

    expect(copy).not.toBeNull();
    expect(copy?.id).not.toBe(first?.id);
    expect(copy?.name).toBe("Ink (2)");
    expect(copy?.brush).toEqual(first?.brush);
    expect(engine.getState().presets).toHaveLength(2);
    expect(engine.duplicateBrushPreset("missing")).toBeNull();
  });

  it("leaves the current brush and the drawing alone", () => {
    const engine = createEngine();
    engine.setBrush({ size: 30 });
    const first = engine.saveBrushPreset("Ink");
    engine.setBrush({ size: 4, color: "#00ff00" });

    const before = engine.getState();
    engine.duplicateBrushPreset(first?.id ?? "");
    const after = engine.getState();

    expect(after.brush).toEqual(before.brush);
    expect(after.file.dirty).toBe(false);
    expect(after.history.depth).toBe(before.history.depth);
  });
});

describe("applying a preset", () => {
  it("changes the brush the next stroke is drawn with", () => {
    const engine = createEngine();
    engine.setBrush({ size: 30, color: "#ff0000", stamp: true, stampTexture: 0.6 });
    const preset = engine.saveBrushPreset("Ink");
    expect(preset).not.toBeNull();

    // The user changes the brush after saving the preset.
    engine.setBrush({ size: 2, color: "#00ff00" });
    expect(engine.applyBrushPreset(preset?.id ?? "")).toBe(true);

    const layerId = engine.getState().document.activeLayerId as string;
    engine.beginStroke(createSample({ docX: 10, docY: 10 }));
    engine.extendStroke(createSample({ docX: 60, docY: 40, timeStamp: 16 }));
    engine.finishStroke();

    const stroke = engine.listStrokes(layerId)[0];
    expect(stroke.brush).toEqual(preset?.brush);
    expect(stroke.brush.stampTexture).toBe(0.6);
  });

  it("leaves the drawing clean and the history untouched", () => {
    const engine = createEngine();
    const preset = engine.saveBrushPreset("Ink");
    const before = engine.getState();

    engine.applyBrushPreset(preset?.id ?? "");

    expect(engine.getState().file.dirty).toBe(false);
    expect(engine.getState().history.depth).toBe(before.history.depth);
  });

  it("reports an unknown id instead of changing the brush", () => {
    const engine = createEngine();
    engine.setBrush({ size: 12 });
    const before = engine.getState();

    expect(engine.applyBrushPreset("missing")).toBe(false);
    expect(engine.getState().brush).toEqual(before.brush);
  });
});

describe("the preset library in the settings store", () => {
  it("survives a restart through the settings file", async () => {
    const gateway = new MemorySettingsGateway();
    const engine = createEngine();
    const store = new SettingsStore({ engine, gateway });
    await store.load();

    engine.setBrush({ size: 33, stamp: true, stampTexture: 0.4 });
    engine.saveBrushPreset("Ink");
    await store.flush();

    // What is on disk is the whole brush, not a summary of it.
    const written = JSON.parse(gateway.contents ?? "{}");
    expect(written.presets).toHaveLength(1);
    expect(written.presets[0].name).toBe("Ink");
    expect(written.presets[0].brush.stampTexture).toBe(0.4);
    expect(written.presets[0].brush.size).toBe(33);

    // A second editor reads the same file and finds the library again.
    const second = createEngine();
    const secondStore = new SettingsStore({ engine: second, gateway });
    await secondStore.load();

    const presets = second.getState().presets;
    expect(presets.map((preset) => preset.name)).toEqual(["Ink"]);
    expect(presets[0].brush.stampTexture).toBe(0.4);
    expect(presets[0].brush.size).toBe(33);

    store.destroy();
    secondStore.destroy();
  });

  it("writes a change to a preset without touching the drawing", async () => {
    const gateway = new MemorySettingsGateway();
    const engine = createEngine();
    const store = new SettingsStore({ engine, gateway });
    await store.load();

    const preset = engine.saveBrushPreset("Ink");
    expect(preset).not.toBeNull();
    await store.flush();

    const written = JSON.parse(gateway.contents ?? "{}");
    expect(written.presets).toHaveLength(1);
    expect(engine.getState().file.dirty).toBe(false);
    expect(engine.getState().history.depth).toBe(0);

    store.destroy();
  });
});
