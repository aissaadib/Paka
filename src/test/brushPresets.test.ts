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
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  MAX_PRESET_NAME_LENGTH,
  normalizePresetName,
  uniquePresetName,
  type BrushPreset,
} from "../core/brushes/presets";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  parseAppSettings,
  serializeAppSettings,
  settingsEqual,
} from "../core/settings/appSettings";

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
