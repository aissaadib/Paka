/**
 * The brush property tiers.
 *
 * The options bar shows the stroke controls and hides the settings behind a
 * panel. That split is a presentation decision with a hard requirement: it
 * must not lose a control. These tests pin the partition - every property is
 * in exactly one tier, the bar keeps size, opacity and hardness, and every
 * advanced control is still a real write into the brush.
 */

import { describe, expect, it } from "vitest";
import {
  BRUSH_PROPERTIES,
  advancedBrushProperties,
  brushPropertiesFor,
  brushPropertyPatch,
  brushPropertyStoredValue,
  brushPropertyControlValue,
  primaryBrushProperties,
  type BrushSliderProperty,
} from "../core/brushes/brushProperties";
import { DEFAULT_BRUSH, updateBrushSettings } from "../core/brushes/defaults";
import type { BrushSettings } from "../types/brush";

/** A brush as the engine holds it, with a patch applied. */
function brushWith(patch: Partial<BrushSettings>): BrushSettings {
  return updateBrushSettings(DEFAULT_BRUSH, patch);
}

describe("the brush property tiers", () => {
  it("gives every property exactly one tier", () => {
    for (const property of BRUSH_PROPERTIES) {
      expect(["primary", "advanced"]).toContain(property.tier);
    }
  });

  it("keeps the stroke controls in the bar", () => {
    const ids = primaryBrushProperties(DEFAULT_BRUSH).map((property) => property.id);
    expect(ids).toEqual(["size", "opacity", "hardness"]);
  });

  it("partitions every visible control, with nothing dropped or doubled", () => {
    for (const brush of [
      DEFAULT_BRUSH,
      brushWith({ stamp: true }),
      brushWith({ pressureSize: 0.6, pressureOpacity: 0.6 }),
    ]) {
      const all = brushPropertiesFor(brush).map((property) => property.id);
      const shown = [...primaryBrushProperties(brush), ...advancedBrushProperties(brush)].map(
        (property) => property.id,
      );
      expect(shown).toEqual(all);
      expect(new Set(shown).size).toBe(shown.length);
    }
  });

  it("shows the stamp's own controls only while the stamp is on", () => {
    const off = advancedBrushProperties(DEFAULT_BRUSH).map((property) => property.id);
    expect(off).not.toContain("stampSpacing");
    expect(off).not.toContain("stampHardness");
    expect(off).not.toContain("stampTexture");

    const on = advancedBrushProperties(brushWith({ stamp: true })).map(
      (property) => property.id,
    );
    expect(on).toContain("stampSpacing");
    expect(on).toContain("stampHardness");
    expect(on).toContain("stampTexture");
  });

  it("offers no control the engine ignores", () => {
    for (const property of BRUSH_PROPERTIES) {
      expect(property.honoured).toBe(true);
    }
  });

  it("writes a real brush field from every control in both tiers", () => {
    const brush = brushWith({ stamp: true });
    for (const property of brushPropertiesFor(brush)) {
      if (property.kind === "toggle") {
        const patch = property.write(!property.read(brush));
        expect(Object.keys(patch)).toEqual([property.id]);
        const next = updateBrushSettings(brush, patch);
        expect(next[property.id]).not.toBe(brush[property.id]);
        continue;
      }
      const slider = property as BrushSliderProperty;
      const value = brushPropertyControlValue(slider, brush[slider.id]);
      const patch = brushPropertyPatch(slider, value);
      expect(Object.keys(patch)).toEqual([slider.id]);
      expect(brushPropertyStoredValue(slider, value)).toBeCloseTo(brush[slider.id], 5);
    }
  });
});
