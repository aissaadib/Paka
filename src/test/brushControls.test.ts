import { describe, expect, it } from "vitest";
import {
  BRUSH_HIDDEN_FIELDS,
  BRUSH_PROPERTIES,
  brushFieldBounds,
  brushPropertyBounds,
  brushPropertyControlValue,
  brushPropertyDefault,
  brushPropertyFormat,
  brushPropertyPatch,
  brushPropertyRange,
  brushPropertiesFor,
  EVERY_BRUSH_FIELD_IS_ACCOUNTED_FOR,
  findBrushProperty,
  PRESSURE_STRENGTH,
  UNIMPLEMENTED_BRUSH_PROPERTIES,
  type BrushNumberField,
  type BrushSliderProperty,
  type BrushToggleField,
  type BrushToggleProperty,
} from "../core/brushes/brushProperties";
import {
  BRUSH_NUMBER_FIELDS,
  brushSizeStep,
  DEFAULT_BRUSH,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  normalizeBrush,
  stepBrushSize,
} from "../core/brushes/defaults";
import {
  clampNumber,
  numericDraft,
  parseNumericInput,
  snapToStep,
  stepSize,
  stepValue,
} from "../core/brushes/numericInput";
import type { BrushSettings } from "../types/brush";

/** A brush with one numeric field replaced. */
function withField(field: BrushNumberField, value: number): BrushSettings {
  const patch: Partial<Record<BrushNumberField, number>> = {};
  patch[field] = value;
  return { ...DEFAULT_BRUSH, ...patch };
}

/** The slider the model offers for a field. */
function sliderFor(id: BrushNumberField): BrushSliderProperty {
  const property = findBrushProperty(id);
  if (property === undefined || property.kind !== "slider") {
    throw new Error(`the brush offers no slider for "${id}"`);
  }
  return property;
}

/** The switch the model offers for a field. */
function toggleFor(id: BrushToggleField): BrushToggleProperty {
  const property = findBrushProperty(id);
  if (property === undefined || property.kind !== "toggle") {
    throw new Error(`the brush offers no switch for "${id}"`);
  }
  return property;
}

describe("the brush property model", () => {
  it("reads every range out of the engine's own clamp", () => {
    for (const property of BRUSH_PROPERTIES) {
      if (property.kind !== "slider") {
        continue;
      }
      const bounds = brushPropertyBounds(property);
      expect(normalizeBrush(withField(property.id, Number.MAX_VALUE))[property.id]).toBe(
        bounds.max,
      );
      expect(normalizeBrush(withField(property.id, -Number.MAX_VALUE))[property.id]).toBe(
        bounds.min,
      );
    }
  });

  it("gives the size and the percentages the ranges the engine clamps to", () => {
    expect(brushFieldBounds("size")).toEqual({ min: MIN_BRUSH_SIZE, max: MAX_BRUSH_SIZE });
    expect(brushFieldBounds("opacity")).toEqual({ min: 0, max: 1 });
    expect(brushFieldBounds("hardness")).toEqual({ min: 0, max: 1 });
    expect(brushFieldBounds("spacing")).toEqual({ min: 0.02, max: 2 });
    expect(brushFieldBounds("stampSpacing")).toEqual({ min: 0.02, max: 1 });
  });

  it("shows a fraction as a percentage and a size as pixels", () => {
    const opacity = sliderFor("opacity");
    expect(brushPropertyRange(opacity)).toEqual({ min: 0, max: 100 });
    expect(brushPropertyControlValue(opacity, 0.5)).toBe(50);
    expect(brushPropertyControlValue(opacity, 1)).toBe(100);

    const size = sliderFor("size");
    expect(brushPropertyRange(size)).toEqual({ min: MIN_BRUSH_SIZE, max: MAX_BRUSH_SIZE });
    expect(brushPropertyControlValue(size, 24)).toBe(24);
  });

  it("gives every property the default the fresh brush carries", () => {
    expect(brushPropertyDefault(sliderFor("size"))).toBe(6);
    expect(brushPropertyDefault(sliderFor("opacity"))).toBe(100);
    expect(brushPropertyDefault(sliderFor("hardness"))).toBe(100);
    expect(brushPropertyDefault(sliderFor("spacing"))).toBe(12);
    expect(brushPropertyDefault(sliderFor("stabilizer"))).toBe(0);
    expect(brushPropertyDefault(sliderFor("texture"))).toBe(0);
    expect(brushPropertyDefault(sliderFor("stampSpacing"))).toBe(10);
    expect(brushPropertyDefault(sliderFor("stampHardness"))).toBe(100);
    expect(brushPropertyDefault(sliderFor("stampTexture"))).toBe(0);
  });

  it("round-trips a control's value into the brush", () => {
    const opacity = sliderFor("opacity");
    const patch = brushPropertyPatch(opacity, 42);
    expect(patch).toEqual({ opacity: 0.42 });
    const brush = normalizeBrush({ ...DEFAULT_BRUSH, ...patch });
    expect(brush.opacity).toBeCloseTo(0.42, 10);
    expect(brushPropertyControlValue(opacity, brush.opacity)).toBe(42);

    expect(brushPropertyPatch(sliderFor("size"), 24)).toEqual({ size: 24 });
    expect(brushPropertyPatch(sliderFor("spacing"), 25)).toEqual({ spacing: 0.25 });
  });

  it("accounts for every numeric field of the brush", () => {
    expect(EVERY_BRUSH_FIELD_IS_ACCOUNTED_FOR).toBe(true);
    const offered = new Set<string>(BRUSH_PROPERTIES.map((property) => property.id));
    const held = new Set<string>(BRUSH_HIDDEN_FIELDS);
    for (const field of BRUSH_NUMBER_FIELDS) {
      expect(offered.has(field) || held.has(field)).toBe(true);
    }
  });

  it("offers a control only for a property the engine honours", () => {
    for (const property of BRUSH_PROPERTIES) {
      expect(property.honoured).toBe(true);
    }
  });

  it("keeps the stamp's own properties behind the stamp switch", () => {
    const without = brushPropertiesFor(DEFAULT_BRUSH).map((property) => property.id);
    expect(without).not.toContain("stampSpacing");
    expect(without).not.toContain("stampHardness");
    expect(without).not.toContain("stampTexture");

    const with_ = brushPropertiesFor({ ...DEFAULT_BRUSH, stamp: true }).map(
      (property) => property.id,
    );
    expect(with_).toContain("stampSpacing");
    expect(with_).toContain("stampHardness");
    expect(with_).toContain("stampTexture");
  });

  it("keeps the toolbar's order", () => {
    expect(BRUSH_PROPERTIES.map((property) => property.id)).toEqual([
      "size",
      "opacity",
      "hardness",
      "spacing",
      "stabilizer",
      "texture",
      "stamp",
      "stampSpacing",
      "stampHardness",
      "stampTexture",
      "pressureSize",
      "pressureOpacity",
    ]);
  });

  it("turns the pressure switches on at the strength and off at zero", () => {
    const size = toggleFor("pressureSize");
    expect(size.read(DEFAULT_BRUSH)).toBe(true);
    expect(size.read({ ...DEFAULT_BRUSH, pressureSize: 0 })).toBe(false);
    expect(size.write(true)).toEqual({ pressureSize: PRESSURE_STRENGTH });
    expect(size.write(false)).toEqual({ pressureSize: 0 });

    const opacity = toggleFor("pressureOpacity");
    expect(opacity.read(DEFAULT_BRUSH)).toBe(false);
    expect(opacity.write(true)).toEqual({ pressureOpacity: PRESSURE_STRENGTH });
  });

  it("formats a value in the property's own unit", () => {
    expect(brushPropertyFormat(sliderFor("size"), 6)).toBe("6 px");
    expect(brushPropertyFormat(sliderFor("opacity"), 50)).toBe("50%");
    expect(brushPropertyFormat(sliderFor("spacing"), 12)).toBe("12%");
  });

  it("lists the properties the engine does not implement, and offers none of them", () => {
    expect(UNIMPLEMENTED_BRUSH_PROPERTIES.length).toBeGreaterThan(0);
    for (const missing of UNIMPLEMENTED_BRUSH_PROPERTIES) {
      expect(missing.name.trim()).not.toBe("");
      expect(missing.reason.trim()).not.toBe("");
      expect(missing.owner.trim()).not.toBe("");
      expect(findBrushProperty(missing.name)).toBeUndefined();
    }
  });

  it("does not offer the classic properties Paka has no engine for", () => {
    const offered = BRUSH_PROPERTIES.map((property) => property.id);
    for (const name of ["flow", "taper", "scatter", "jitter", "roundness", "tilt"]) {
      expect(offered).not.toContain(name);
    }
  });
});

describe("the number box's rules", () => {
  it("reads a typed number and refuses anything else", () => {
    expect(parseNumericInput("12")).toBe(12);
    expect(parseNumericInput("  1.5 ")).toBe(1.5);
    expect(parseNumericInput("-3")).toBe(-3);
    expect(parseNumericInput("1e2")).toBe(100);
    expect(parseNumericInput("")).toBeNull();
    expect(parseNumericInput("   ")).toBeNull();
    expect(parseNumericInput("abc")).toBeNull();
    expect(parseNumericInput("1,5")).toBeNull();
    expect(parseNumericInput("Infinity")).toBeNull();
    expect(parseNumericInput("NaN")).toBeNull();
  });

  it("clamps a value into the field's range", () => {
    expect(clampNumber(5, 0, 100)).toBe(5);
    expect(clampNumber(-5, 0, 100)).toBe(0);
    expect(clampNumber(500, 0, 100)).toBe(100);
    expect(clampNumber(Number.NaN, 0, 100)).toBe(0);
  });

  it("keeps a fine step smaller than the coarse one", () => {
    expect(stepSize(1, "normal")).toBe(1);
    expect(stepSize(1, "fine")).toBe(0.1);
    expect(stepSize(1, "coarse")).toBe(10);
    expect(stepSize(0.5, "fine")).toBeCloseTo(0.05, 10);
  });

  it("stops a step at the bound instead of wrapping", () => {
    expect(stepValue(10, 1, 0, 100)).toBe(11);
    expect(stepValue(100, 1, 0, 100)).toBe(100);
    expect(stepValue(0, -1, 0, 100)).toBe(0);
    expect(stepValue(Number.NaN, 1, 2, 100)).toBe(3);
  });

  it("rounds a value onto the field's own step", () => {
    expect(snapToStep(0.333, 0.1, 0, 1)).toBe(0.3);
    expect(snapToStep(7, 1, 0, 100)).toBe(7);
    expect(snapToStep(101, 1, 0, 100)).toBe(100);
    expect(snapToStep(-1, 1, 0, 100)).toBe(0);
  });

  it("keeps the user's text while it is being edited", () => {
    expect(numericDraft(null, 5)).toBeNull();
    // Half-typed: there is no value yet to disagree with.
    expect(numericDraft("", 5)).toBe("");
    expect(numericDraft("-", 5)).toBe("-");
    // Typed and still the value the editor holds: the caret must not jump.
    expect(numericDraft("12", 12)).toBe("12");
    // The value changed under the box: the box shows the value again.
    expect(numericDraft("12", 20)).toBeNull();
  });
});

describe("the shared brush size step", () => {
  it("agrees with the shortcut's step in the normal mode", () => {
    expect(brushSizeStep(6, 1)).toBe(stepBrushSize(6, 1));
    expect(brushSizeStep(100, -1)).toBe(stepBrushSize(100, -1));
    expect(brushSizeStep(6, 1)).toBe(7);
    expect(brushSizeStep(100, 1)).toBe(110);
  });

  it("moves by a tenth of the step when the key is fine", () => {
    expect(brushSizeStep(100, 1, "fine")).toBe(101);
    expect(brushSizeStep(6, 1, "fine")).toBe(6.1);
  });

  it("moves by ten steps when the key is coarse", () => {
    expect(brushSizeStep(100, 1, "coarse")).toBe(200);
    expect(brushSizeStep(6, 1, "coarse")).toBe(16);
  });

  it("stops at the bounds", () => {
    expect(brushSizeStep(MAX_BRUSH_SIZE, 1)).toBe(MAX_BRUSH_SIZE);
    expect(brushSizeStep(MIN_BRUSH_SIZE, -1)).toBe(MIN_BRUSH_SIZE);
    expect(brushSizeStep(MIN_BRUSH_SIZE, -1, "fine")).toBe(MIN_BRUSH_SIZE);
  });
});
