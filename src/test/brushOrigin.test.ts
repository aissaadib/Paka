/**
 * The brush's origin: the preset its defaults come from.
 *
 * The preset's defaults and the edited values the next stroke uses are two
 * different things, and the engine keeps them apart: the origin says where
 * the brush came from, the brush says what it holds now. Editing a field
 * changes the brush and leaves the origin alone, which is what makes a reset
 * possible after the brush has been changed.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";

function createEngine() {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
  });
}

describe("the brush's origin", () => {
  it("keeps the preset's defaults apart from the edited values", () => {
    const engine = createEngine();
    const preset = engine.saveBrushPreset("Ink");
    expect(preset).not.toBeNull();
    engine.setBrush({ size: 40 });
    // The preset is still where the brush came from, and the edited value is
    // what the next stroke uses.
    expect(engine.getState().activePresetId).toBe(preset?.id);
    expect(engine.getState().brush.size).toBe(40);
  });

  it("restores the preset's values on a reset", () => {
    const engine = createEngine();
    const preset = engine.saveBrushPreset("Ink");
    engine.setBrush({ size: 40, opacity: 0.5 });
    engine.resetBrush();
    expect(engine.getState().brush.size).toBe(preset?.brush.size);
    expect(engine.getState().brush.opacity).toBe(preset?.brush.opacity);
  });

  it("restores the default brush when there is no preset", () => {
    const engine = createEngine();
    engine.setBrush({ size: 40 });
    engine.resetBrush();
    expect(engine.getState().brush).toEqual(DEFAULT_BRUSH);
  });

  it("forgets the preset when the user asks for a custom brush", () => {
    const engine = createEngine();
    engine.saveBrushPreset("Ink");
    engine.setActivePreset(null);
    expect(engine.getState().activePresetId).toBeNull();
    engine.setBrush({ size: 40 });
    engine.resetBrush();
    expect(engine.getState().brush).toEqual(DEFAULT_BRUSH);
  });

  it("drops the origin when the preset is deleted", () => {
    const engine = createEngine();
    const preset = engine.saveBrushPreset("Ink");
    expect(engine.getState().activePresetId).toBe(preset?.id);
    engine.deleteBrushPreset(preset?.id ?? "");
    expect(engine.getState().activePresetId).toBeNull();
  });

  it("is editor state: no history entry and no dirty flag", () => {
    const engine = createEngine();
    engine.saveBrushPreset("Ink");
    const before = engine.getState();
    engine.setBrush({ size: 40 });
    engine.resetBrush();
    const after = engine.getState();
    expect(after.history.canUndo).toBe(before.history.canUndo);
    expect(after.file.dirty).toBe(before.file.dirty);
  });
});
