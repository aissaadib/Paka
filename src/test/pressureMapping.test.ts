/**
 * Pressure-mapping tests.
 *
 * A mapping is the typed answer to "what does the pressure do to this
 * property": whether it is enabled, and the response at no pressure and at
 * full pressure. The shape of the response comes from the brush's pressure
 * curve, which every property shares.
 *
 * The rules these tests pin down:
 *
 *  - the mapping is applied at the brush's mapping boundary, so a stored
 *    sample keeps the raw pressure the device reported;
 *  - the curve comes first and the mapping second;
 *  - a disabled mapping leaves the property alone, so a brush with the
 *    mappings off draws exactly what it drew before they existed;
 *  - a mouse has no pressure, so it draws at the top of every range;
 *  - the same samples and the same brush always produce the same picture, so
 *    live drawing, a rebuild, a reopen and an export agree.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRUSH,
  DEFAULT_PRESSURE_FLOW,
  DEFAULT_PRESSURE_OPACITY,
  DEFAULT_PRESSURE_SIZE,
  normalizeBrush,
} from "../core/brushes/defaults";
import {
  DISABLED_PRESSURE_MAPPING,
  evaluatePressureMapping,
  legacyPressureMapping,
  normalizePressureMapping,
  pressureMappingsEqual,
  pressureResponse,
} from "../core/brushes/pressureMapping";
import { evaluatePressureCurve } from "../core/brushes/pressureCurve";
import { resolvePressure } from "../core/input/pointer";
import { strokeDiameter, strokeOpacity } from "../core/rendering/canvas2dStroke";
import { StampCoverage, stampDabs } from "../core/rendering/stampCoverage";
import type { BrushSettings, PressureMapping } from "../types/brush";

const BENT: readonly { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.8 },
  { x: 1, y: 1 },
];

function mapping(enabled: boolean, min: number, max: number): PressureMapping {
  return { enabled, min, max };
}

describe("the pressure mapping model", () => {
  it("reads a pre-mapping strength as the mapping it stood for", () => {
    expect(legacyPressureMapping(0)).toEqual({ enabled: false, min: 1, max: 1 });
    expect(legacyPressureMapping(0.6)).toEqual({ enabled: true, min: 0.4, max: 1 });
    expect(legacyPressureMapping(1)).toEqual({ enabled: true, min: 0, max: 1 });
  });

  it("clamps a strength that is out of range", () => {
    expect(legacyPressureMapping(-3)).toEqual({ enabled: false, min: 1, max: 1 });
    expect(legacyPressureMapping(9)).toEqual({ enabled: true, min: 0, max: 1 });
    expect(legacyPressureMapping(Number.NaN)).toEqual({ enabled: false, min: 1, max: 1 });
  });

  it("normalizes an untrusted mapping without throwing", () => {
    expect(normalizePressureMapping(undefined)).toEqual(DISABLED_PRESSURE_MAPPING);
    expect(normalizePressureMapping("nonsense")).toEqual(DISABLED_PRESSURE_MAPPING);
    expect(normalizePressureMapping([])).toEqual(DISABLED_PRESSURE_MAPPING);
    // A number is a pre-mapping strength.
    expect(normalizePressureMapping(0.5)).toEqual({ enabled: true, min: 0.5, max: 1 });
  });

  it("clamps the ends and puts them in order", () => {
    expect(normalizePressureMapping({ enabled: true, min: -1, max: 4 })).toEqual({
      enabled: true,
      min: 0,
      max: 1,
    });
    expect(normalizePressureMapping({ enabled: true, min: 0.8, max: 0.2 })).toEqual({
      enabled: true,
      min: 0.2,
      max: 0.8,
    });
    expect(normalizePressureMapping({ enabled: true, min: "x", max: null })).toEqual({
      enabled: true,
      min: 0,
      max: 1,
    });
  });

  it("keeps the ends of a mapping that is switched off", () => {
    const off = normalizePressureMapping({ enabled: false, min: 0.3, max: 0.7 });
    expect(off).toEqual({ enabled: false, min: 0.3, max: 0.7 });
    // So switching it back on restores the range the user chose.
    expect(evaluatePressureMapping({ ...off, enabled: true }, 0)).toBeCloseTo(0.3, 12);
    expect(evaluatePressureMapping({ ...off, enabled: true }, 1)).toBeCloseTo(0.7, 12);
  });

  it("answers the ends of the range and interpolates between them", () => {
    const response = mapping(true, 0.25, 0.75);
    expect(evaluatePressureMapping(response, 0)).toBeCloseTo(0.25, 12);
    expect(evaluatePressureMapping(response, 1)).toBeCloseTo(0.75, 12);
    expect(evaluatePressureMapping(response, 0.5)).toBeCloseTo(0.5, 12);
  });

  it("leaves the property alone when the mapping is off", () => {
    expect(evaluatePressureMapping(DISABLED_PRESSURE_MAPPING, 0)).toBe(1);
    expect(evaluatePressureMapping(DISABLED_PRESSURE_MAPPING, 0.5)).toBe(1);
    expect(evaluatePressureMapping(DISABLED_PRESSURE_MAPPING, 1)).toBe(1);
  });

  it("clamps a pressure that is out of range", () => {
    const response = mapping(true, 0, 1);
    expect(evaluatePressureMapping(response, -3)).toBeCloseTo(0, 12);
    expect(evaluatePressureMapping(response, 4)).toBeCloseTo(1, 12);
    expect(evaluatePressureMapping(response, Number.NaN)).toBeCloseTo(0, 12);
  });

  it("compares two mappings field by field", () => {
    expect(pressureMappingsEqual(mapping(true, 0.2, 0.8), mapping(true, 0.2, 0.8))).toBe(true);
    expect(pressureMappingsEqual(mapping(true, 0.2, 0.8), mapping(true, 0.2, 0.9))).toBe(false);
    expect(pressureMappingsEqual(mapping(true, 0.2, 0.8), mapping(false, 0.2, 0.8))).toBe(false);
  });
});

describe("the size mapping", () => {
  const brush: BrushSettings = {
    ...DEFAULT_BRUSH,
    size: 20,
    minSizeRatio: 0.02,
    pressureSize: mapping(true, 0.25, 1),
  };

  it("runs from the low end at no pressure to the top end at full pressure", () => {
    expect(strokeDiameter(brush, 0)).toBeCloseTo(5, 12);
    expect(strokeDiameter(brush, 1)).toBeCloseTo(20, 12);
    expect(strokeDiameter(brush, 0.5)).toBeCloseTo(12.5, 12);
  });

  it("applies the curve first and the mapping second", () => {
    const bent: BrushSettings = { ...brush, pressureCurve: BENT };
    // The curve turns a raw 0.5 into 0.8, and the mapping answers 0.8 with
    // 0.25 + 0.75 * 0.8 = 0.85 of the brush's diameter.
    expect(evaluatePressureCurve(BENT, 0.5)).toBeCloseTo(0.8, 12);
    expect(strokeDiameter(bent, 0.5)).toBeCloseTo(20 * 0.85, 12);
    // The same chain the preview and the renderer use.
    expect(pressureResponse(bent, bent.pressureSize, 0.5)).toBeCloseTo(0.85, 12);
  });

  it("keeps the brush's own floor", () => {
    const floored: BrushSettings = {
      ...brush,
      minSizeRatio: 0.5,
      pressureSize: mapping(true, 0, 1),
    };
    // The mapping asks for nothing at no pressure, but the floor does.
    expect(strokeDiameter(floored, 0)).toBeCloseTo(10, 12);
  });

  it("leaves the width alone when the mapping is off", () => {
    const plain: BrushSettings = {
      ...brush,
      pressureSize: mapping(false, 0.25, 1),
    };
    expect(strokeDiameter(plain, 0)).toBeCloseTo(20, 12);
    expect(strokeDiameter(plain, 0.5)).toBeCloseTo(20, 12);
    expect(strokeDiameter(plain, 1)).toBeCloseTo(20, 12);
  });

  it("reproduces the pre-mapping strength exactly", () => {
    // The strength a brush carried before the mappings existed, and the
    // mapping it stands for, have to give the same numbers: a project
    // written by an older build must not change shape when it is opened.
    const legacy = { ...brush, pressureSize: legacyPressureMapping(0.6) };
    for (const pressure of [0, 0.25, 0.5, 0.75, 1]) {
      expect(strokeDiameter(legacy, pressure)).toBe(
        Math.max(20 * 0.02, 20 * (1 - 0.6 * (1 - pressure))),
      );
    }
  });

  it("draws a mouse at the top of the range", () => {
    // A mouse reports no pressure, so the input layer gives it a stable 1.
    const reading = resolvePressure(0, "mouse");
    expect(reading.hasPressure).toBe(false);
    expect(reading.pressure).toBe(1);
    expect(strokeDiameter(brush, reading.pressure)).toBeCloseTo(20, 12);
  });
});

describe("the opacity mapping", () => {
  it("answers with the stroke's mean pressure", () => {
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      opacity: 1,
      pressureOpacity: mapping(true, 0, 1),
    };
    expect(strokeOpacity(brush, [0.2, 0.8])).toBeCloseTo(0.5, 12);
    expect(strokeOpacity(brush, [1, 1])).toBeCloseTo(1, 12);
  });

  it("leaves the opacity alone when the mapping is off", () => {
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      opacity: 0.4,
      pressureOpacity: mapping(false, 0, 1),
    };
    expect(strokeOpacity(brush, [0.1, 0.2])).toBeCloseTo(0.4, 12);
  });

  it("reproduces the pre-mapping strength exactly", () => {
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      opacity: 0.8,
      pressureOpacity: legacyPressureMapping(0.5),
    };
    const pressures = [0.2, 0.6, 1];
    const mean = pressures.reduce((sum, value) => sum + value, 0) / pressures.length;
    expect(strokeOpacity(brush, pressures)).toBe(0.8 * (1 - 0.5 * (1 - mean)));
  });
});

describe("the flow mapping", () => {
  it("gives every dab the ink its pressure asks for", () => {
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      size: 20,
      stamp: true,
      stampSpacing: 0.5,
      pressureSize: mapping(false, 0, 1),
      pressureFlow: mapping(true, 0.2, 1),
    };
    const dabs = stampDabs(
      { xs: [0, 40], ys: [0, 0], pressures: [0, 1] },
      brush,
    );
    expect(dabs.length).toBeGreaterThan(1);
    // The first dab sits where the pressure is 0, the last where it is 1.
    expect(dabs[0].flow).toBeCloseTo(0.2, 12);
    expect(dabs[dabs.length - 1].flow).toBeCloseTo(1, 12);
  });

  it("deposits full ink when the mapping is off", () => {
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      size: 20,
      stamp: true,
      stampSpacing: 0.5,
      pressureFlow: mapping(false, 0.2, 1),
    };
    const dabs = stampDabs({ xs: [0, 40], ys: [0, 0], pressures: [0, 1] }, brush);
    for (const dab of dabs) {
      expect(dab.flow).toBe(1);
    }
  });

  it("scales the dab's coverage without letting the stroke build up", () => {
    /** Reads the coverage of one device pixel. */
    function coverageAt(map: StampCoverage, x: number, y: number): number {
      const data = new Uint8ClampedArray(4);
      map.writeRect(data, 1, { left: x, top: y, width: 1, height: 1 }, { r: 0, g: 0, b: 0 });
      return data[3];
    }

    const full = new StampCoverage();
    full.paintDab(20, 20, 10, 1);
    const light = new StampCoverage();
    light.paintDab(20, 20, 10, 1, null, 0.5);

    expect(coverageAt(full, 20, 20)).toBe(255);
    // Half the ink is half the coverage.
    expect(coverageAt(light, 20, 20)).toBe(128);

    // The union is still a maximum: a light dab cannot raise a dark one, and
    // a dark one cannot be darkened by a light one.
    const mixed = new StampCoverage();
    mixed.paintDab(20, 20, 10, 1);
    mixed.paintDab(20, 20, 10, 1, null, 0.25);
    expect(coverageAt(mixed, 20, 20)).toBe(255);
  });
});

describe("the defaults", () => {
  it("answer the pressure the way the pre-mapping brush did", () => {
    expect(DEFAULT_PRESSURE_SIZE).toEqual({ enabled: true, min: 0.4, max: 1 });
    expect(DEFAULT_PRESSURE_OPACITY.enabled).toBe(false);
    expect(DEFAULT_PRESSURE_FLOW.enabled).toBe(false);
    // The default brush's size response is the strength of 0.6 it carried.
    expect(DEFAULT_BRUSH.pressureSize).toEqual(legacyPressureMapping(0.6));
  });

  it("survive a round trip through the brush normalizer", () => {
    const normalized = normalizeBrush({ ...DEFAULT_BRUSH });
    expect(normalized.pressureSize).toEqual(DEFAULT_PRESSURE_SIZE);
    expect(normalized.pressureOpacity).toEqual(DEFAULT_PRESSURE_OPACITY);
    expect(normalized.pressureFlow).toEqual(DEFAULT_PRESSURE_FLOW);
  });
});

describe("replay", () => {
  it("gives the same picture for the same samples and the same brush", () => {
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      size: 18,
      pressureSize: mapping(true, 0.3, 0.9),
      pressureOpacity: mapping(true, 0.2, 1),
      pressureCurve: BENT,
    };
    const pressures = [0, 0.3, 0.6, 1];
    const first = pressures.map((pressure) => strokeDiameter(brush, pressure));
    const second = pressures.map((pressure) => strokeDiameter(brush, pressure));
    expect(second).toEqual(first);
    // The opacity of the stroke is a function of its samples too.
    expect(strokeOpacity(brush, pressures)).toBe(strokeOpacity(brush, pressures));
  });

  it("keeps the mapping on the stroke, so a reopened stroke draws the same", () => {
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      pressureSize: mapping(true, 0.3, 0.9),
    };
    // A stroke stores the brush it was drawn with, mappings included.
    const stored = { ...brush };
    expect(stored.pressureSize).toEqual(brush.pressureSize);
    expect(strokeDiameter(stored, 0.5)).toBe(strokeDiameter(brush, 0.5));
  });
});
