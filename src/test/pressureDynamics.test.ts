/**
 * Pressure-dynamics tests.
 *
 * The slice is the *model*: how a device's raw pressure becomes the pressure
 * the brush reacts to, and how that model is registered and chosen.
 *
 * Two rules decide everything here.
 *
 * 1. The mapping happens exactly once, at the brush's mapping boundary. The
 *    stored samples keep the raw device pressure, so the same mapping runs in
 *    live drawing, in a layer rebuild, after undo/redo, in a reopened project
 *    and in an export - and it is never applied to an already mapped value.
 * 2. A new capability is invisible until it is asked for. The default model is
 *    inert: its pressure mapping is the identity and every size factor is
 *    exactly `1`, so a stroke drawn with no dynamics is byte for byte the
 *    stroke that was drawn before this model existed.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_PRESSURE_RESPONSE,
  HARD_PRESSURE_RESPONSE,
  IDENTITY_PRESSURE_CURVE,
  MIN_PRESSURE_CURVE_GAP,
  SOFT_PRESSURE_RESPONSE,
  addPressureResponsePoint,
  createPressureResponse,
  evaluatePressureCurve,
  findPressureResponse,
  hasMinimumPressureCurveGap,
  listPressureResponses,
  mapPressure,
  mapPressures,
  movePressureResponsePoint,
  normalizePressureResponse,
  pressureResponseIsInert,
  pressureResponsesEqual,
  registerPressureResponse,
  removePressureResponsePoint,
  resetPressureResponses,
  unregisterPressureResponse,
} from "../core/brushes/pressureCurve";
import {
  DEFAULT_DYNAMICS_MODEL,
  DEFAULT_PRESSURE_DYNAMICS_MODEL,
  findPressureDynamicsModel,
  listPressureDynamicsModels,
  normalizePressureDynamicsModel,
  pressureDynamicsAreInert,
  pressureDynamicsPressure,
  pressureDynamicsSizeFactor,
  registerPressureDynamicsModel,
  resetPressureDynamicsModels,
  resolvePressureDynamics,
  unregisterPressureDynamicsModel,
} from "../core/brushes/dynamics";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { strokeDiameter, strokeOpacity } from "../core/rendering/canvas2dStroke";
import { createDocument } from "../core/document/document";
import type { LayerElement, StrokeRecord } from "../core/document/types";
import { isStroke } from "../core/document/types";
import { createId } from "../utils/id";
import { parseProject, serializeProject } from "../core/project/projectFormat";
import type { PressureCurvePoint } from "../types/brush";

/** A response that lifts the middle of the range: raw 0.5 answers 0.8. */
const BENT: readonly PressureCurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.8 },
  { x: 1, y: 1 },
];

const BENT_RESPONSE = createPressureResponse("bent", "Bent", BENT);

/** The registry as it stands when the module is evaluated. */
const BUILT_IN_RESPONSES = listPressureResponses();
const BUILT_IN_MODELS = listPressureDynamicsModels();

beforeEach(() => {
  resetPressureResponses();
  registerPressureResponse(DEFAULT_PRESSURE_RESPONSE);
  resetPressureDynamicsModels();
  registerPressureDynamicsModel(DEFAULT_PRESSURE_DYNAMICS_MODEL);
});

describe("the identity response", () => {
  it("maps every raw pressure to itself exactly", () => {
    for (let step = 0; step <= 100; step += 1) {
      const pressure = step / 100;
      expect(mapPressure(DEFAULT_PRESSURE_RESPONSE, pressure)).toBe(pressure);
    }
  });

  it("is inert, and the other built-in responses are not", () => {
    expect(pressureResponseIsInert(DEFAULT_PRESSURE_RESPONSE)).toBe(true);
    expect(pressureResponseIsInert(SOFT_PRESSURE_RESPONSE)).toBe(false);
    expect(pressureResponseIsInert(HARD_PRESSURE_RESPONSE)).toBe(false);
  });

  it("is the curve the default brush already uses", () => {
    expect(DEFAULT_BRUSH.pressureCurve).toBe(IDENTITY_PRESSURE_CURVE);
    expect(pressureResponseIsInert({ id: "x", label: "x", curve: DEFAULT_BRUSH.pressureCurve })).toBe(
      true,
    );
  });

  it("clamps a broken reading instead of throwing", () => {
    expect(mapPressure(DEFAULT_PRESSURE_RESPONSE, Number.NaN)).toBe(0);
    expect(mapPressure(DEFAULT_PRESSURE_RESPONSE, -2)).toBe(0);
    expect(mapPressure(DEFAULT_PRESSURE_RESPONSE, 4)).toBe(1);
  });
});

describe("the response model", () => {
  it("normalises the curve it is built from", () => {
    const response = createPressureResponse("custom", "Custom", [
      { x: 1, y: 0.8 },
      { x: 0.5, y: 0.6 },
      { x: -1, y: 4 },
    ]);
    expect(response.curve).toEqual([
      { x: 0, y: 1 },
      { x: 0.5, y: 0.6 },
      { x: 1, y: 0.8 },
    ]);
  });

  it("falls back to the identity curve for an unusable curve", () => {
    expect(createPressureResponse("custom", "Custom", "nonsense").curve).toBe(
      IDENTITY_PRESSURE_CURVE,
    );
  });

  it("names a nameless response", () => {
    const response = createPressureResponse("  ", "  ", BENT);
    expect(response.id).toBe("custom");
    expect(response.label).toBe("Custom");
  });

  it("reads an untrusted response without throwing", () => {
    for (const value of [null, undefined, 3, "response", []]) {
      expect(normalizePressureResponse(value)).toEqual(DEFAULT_PRESSURE_RESPONSE);
    }
    const normalized = normalizePressureResponse({
      id: "pen",
      label: "Pen",
      curve: [{ x: 0.5, y: 0.5 }],
    });
    expect(normalized.id).toBe("pen");
    expect(normalized.label).toBe("Pen");
    expect(normalized.curve).toBe(IDENTITY_PRESSURE_CURVE);
  });

  it("compares responses by value", () => {
    expect(pressureResponsesEqual(BENT_RESPONSE, { ...BENT_RESPONSE })).toBe(true);
    expect(
      pressureResponsesEqual(BENT_RESPONSE, { ...BENT_RESPONSE, curve: [...BENT] }),
    ).toBe(true);
    expect(
      pressureResponsesEqual(BENT_RESPONSE, { ...BENT_RESPONSE, id: "other" }),
    ).toBe(false);
    expect(
      pressureResponsesEqual(BENT_RESPONSE, { ...BENT_RESPONSE, label: "Other" }),
    ).toBe(false);
    expect(
      pressureResponsesEqual(BENT_RESPONSE, { ...BENT_RESPONSE, curve: IDENTITY_PRESSURE_CURVE }),
    ).toBe(false);
  });
});

describe("the response registry", () => {
  it("registers the built-in responses when the module is evaluated", () => {
    expect(BUILT_IN_RESPONSES).toContain(DEFAULT_PRESSURE_RESPONSE);
    expect(BUILT_IN_RESPONSES).toContain(SOFT_PRESSURE_RESPONSE);
    expect(BUILT_IN_RESPONSES).toContain(HARD_PRESSURE_RESPONSE);
    expect(findPressureResponse("linear")).toBe(DEFAULT_PRESSURE_RESPONSE);
  });

  it("registers a response and finds it by id", () => {
    registerPressureResponse(BENT_RESPONSE);
    expect(findPressureResponse("bent")).toBe(BENT_RESPONSE);
    expect(listPressureResponses()).toHaveLength(2);
  });

  it("replaces a response registered twice under the same id", () => {
    registerPressureResponse(BENT_RESPONSE);
    registerPressureResponse({ ...BENT_RESPONSE, label: "Bent 2" });
    expect(listPressureResponses()).toHaveLength(2);
    expect(findPressureResponse("bent")?.label).toBe("Bent 2");
  });

  it("refuses a response with no id", () => {
    expect(() => registerPressureResponse({ ...BENT_RESPONSE, id: " " })).toThrow(/non-empty id/);
  });

  it("removes a response", () => {
    registerPressureResponse(BENT_RESPONSE);
    expect(unregisterPressureResponse("bent")).toBe(true);
    expect(unregisterPressureResponse("bent")).toBe(false);
  });
});

describe("editing a response", () => {
  it("adds a point and keeps the minimum gap", () => {
    const added = addPressureResponsePoint(BENT_RESPONSE, 0.25, 0.4);
    expect(added.curve).toHaveLength(4);
    expect(added.curve[1]).toEqual({ x: 0.25, y: 0.4 });
    expect(hasMinimumPressureCurveGap(added.curve)).toBe(true);
    // The response keeps its name.
    expect(added.id).toBe("bent");
    expect(added.label).toBe("Bent");
  });

  it("ignores a click that cannot honour the minimum gap", () => {
    const tight = createPressureResponse("tight", "Tight", [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0.5 + MIN_PRESSURE_CURVE_GAP, y: 0.5 },
      { x: 1, y: 1 },
    ]);
    expect(addPressureResponsePoint(tight, 0.5 + MIN_PRESSURE_CURVE_GAP / 2, 0.4)).toBe(tight);
  });

  it("ignores a click on a full curve", () => {
    const full = createPressureResponse(
      "full",
      "Full",
      Array.from({ length: 32 }, (_, index) => ({ x: index / 31, y: 0.5 })),
    );
    expect(addPressureResponsePoint(full, 0.5, 0.5)).toBe(full);
  });

  it("moves a point between its neighbours and keeps the endpoints in place", () => {
    const moved = movePressureResponsePoint(BENT_RESPONSE, 1, 2, 0.25);
    expect(moved.curve[1]).toEqual({ x: 1 - MIN_PRESSURE_CURVE_GAP, y: 0.25 });
    expect(hasMinimumPressureCurveGap(moved.curve)).toBe(true);

    const first = movePressureResponsePoint(BENT_RESPONSE, 0, 0.7, 0.4);
    const last = movePressureResponsePoint(BENT_RESPONSE, 2, 0.2, 0.6);
    expect(first.curve[0]).toEqual({ x: 0, y: 0.4 });
    expect(last.curve[2]).toEqual({ x: 1, y: 0.6 });
  });

  it("never breaks the minimum gap, even when the neighbours are too close", () => {
    const tight = createPressureResponse("tight", "Tight", [
      { x: 0, y: 0 },
      { x: 0.002, y: 0.5 },
      { x: 0.004, y: 0.5 },
      { x: 1, y: 1 },
    ]);
    const moved = movePressureResponsePoint(tight, 1, 0.9, 0.2);
    // There is nowhere to go in x, so the point keeps its place and only its
    // response moves.
    expect(moved.curve[1]).toEqual({ x: 0.002, y: 0.2 });
  });

  it("returns the same response when an edit changes nothing", () => {
    expect(movePressureResponsePoint(BENT_RESPONSE, 1, 0.5, 0.8)).toBe(BENT_RESPONSE);
    expect(removePressureResponsePoint(BENT_RESPONSE, 0)).toBe(BENT_RESPONSE);
    expect(removePressureResponsePoint(BENT_RESPONSE, BENT_RESPONSE.curve.length - 1)).toBe(
      BENT_RESPONSE,
    );
  });

  it("removes only middle points", () => {
    const removed = removePressureResponsePoint(BENT_RESPONSE, 1);
    expect(removed.curve).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });
});

describe("the mapping boundary", () => {
  it("maps the raw pressure with the curve the model holds", () => {
    for (const pressure of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(mapPressure(BENT_RESPONSE, pressure)).toBe(
        evaluatePressureCurve(BENT_RESPONSE.curve, pressure),
      );
    }
  });

  it("is the mapping the renderer uses", () => {
    const brush = {
      ...DEFAULT_BRUSH,
      size: 20,
      pressureSize: 0.5,
      minSizeRatio: 0.1,
      pressureCurve: BENT,
    };
    for (const pressure of [0, 0.25, 0.5, 0.75, 1]) {
      const mapped = mapPressure(BENT_RESPONSE, pressure);
      expect(strokeDiameter(brush, pressure)).toBe(
        Math.max(20 * 0.1, 20 * (1 - 0.5 * (1 - mapped))),
      );
    }
  });

  it("leaves the stored samples raw", () => {
    const raw = [0.1, 0.5, 0.9];
    const mapped = mapPressures(BENT_RESPONSE, raw);
    expect(raw).toEqual([0.1, 0.5, 0.9]);
    expect(mapped).not.toBe(raw);
    expect(mapped[1]).toBeCloseTo(0.8, 12);
  });

  it("maps the identity response to a copy of the raw pressures", () => {
    const raw = [0.1, 0.5, 0.9];
    const mapped = mapPressures(DEFAULT_PRESSURE_RESPONSE, raw);
    expect(mapped).not.toBe(raw);
    expect(mapped).toEqual(raw);
  });

  it("would be visible if the mapping were applied twice", () => {
    // The mapping is not idempotent for a bent curve, so a stroke that mapped
    // an already mapped pressure would look different - which is why the
    // samples keep the raw pressure.
    const once = mapPressure(BENT_RESPONSE, 0.5);
    const twice = mapPressure(BENT_RESPONSE, once);
    expect(twice).not.toBe(once);
    expect(twice).toBeCloseTo(0.92, 12);
  });

  it("is idempotent for the identity response", () => {
    const once = mapPressure(DEFAULT_PRESSURE_RESPONSE, 0.5);
    expect(mapPressure(DEFAULT_PRESSURE_RESPONSE, once)).toBe(once);
  });

  it("keeps the raw samples and the model in the file", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const stroke: StrokeRecord = {
      id: createId("stroke"),
      layerId,
      brush: { ...DEFAULT_BRUSH, pressureCurve: BENT },
      xs: [1, 2],
      ys: [1, 2],
      pressures: [0.25, 0.75],
      times: [0, 10],
      startTime: 1000,
    };
    const elements = new Map<string, LayerElement[]>([[layerId, [{ ...stroke, layerId }]]]);
    const payload = JSON.parse(
      serializeProject(document, {
        listStrokes: (id) => (elements.get(id) ?? []).filter(isStroke),
        listElements: (id) => elements.get(id) ?? [],
      }),
    );
    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const reopened = parsed.project.strokes[0];
    // The file holds the raw pressure and the model, never a mapped value:
    // the mapping is not baked into the samples.
    expect(reopened.pressures).toEqual([0.25, 0.75]);
    expect(reopened.brush.pressureCurve).toEqual(BENT);
    // So the reopened stroke draws the same picture: the mapping runs again
    // on the raw pressure, exactly once.
    expect(strokeDiameter(reopened.brush, reopened.pressures[0])).toBe(
      strokeDiameter(stroke.brush, stroke.pressures[0]),
    );
  });
});

describe("the default pressure dynamics", () => {
  it("is registered when the module is evaluated", () => {
    expect(BUILT_IN_MODELS).toContain(DEFAULT_PRESSURE_DYNAMICS_MODEL);
    expect(findPressureDynamicsModel("none")).toBe(DEFAULT_PRESSURE_DYNAMICS_MODEL);
  });

  it("changes nothing at all", () => {
    expect(pressureDynamicsAreInert(DEFAULT_PRESSURE_DYNAMICS_MODEL)).toBe(true);
    for (const speed of [0, 100, 5000]) {
      for (const progress of [0, 0.5, 1]) {
        const resolved = resolvePressureDynamics(DEFAULT_PRESSURE_DYNAMICS_MODEL, {
          pressure: 0.5,
          speed,
          progress,
        });
        expect(resolved.sizeFactor).toBe(1);
      }
    }
  });

  it("hands the raw pressure back unchanged", () => {
    for (const pressure of [0, 0.25, 0.5, 0.75, 1]) {
      const resolved = resolvePressureDynamics(DEFAULT_PRESSURE_DYNAMICS_MODEL, {
        pressure,
        speed: 400,
        progress: 0.5,
      });
      expect(resolved.pressure).toBe(pressure);
    }
  });
});

describe("a pressure dynamics model", () => {
  const model = {
    id: "pen",
    label: "Pen",
    pressureCurve: BENT,
    sources: {
      ...DEFAULT_DYNAMICS_MODEL,
      id: "pen-sources",
      label: "Pen sources",
      velocityReference: 1000,
      velocitySize: 0.5,
      taperIn: 0.2,
      taperOut: 0.2,
      taperDepth: 1,
    },
  };

  it("maps the pressure once, with the same mapping as the curve", () => {
    for (const pressure of [0, 0.25, 0.5, 0.75, 1]) {
      expect(pressureDynamicsPressure(model, pressure)).toBe(
        evaluatePressureCurve(BENT, pressure),
      );
      expect(resolvePressureDynamics(model, { pressure, speed: 0, progress: 0.5 }).pressure).toBe(
        evaluatePressureCurve(BENT, pressure),
      );
    }
  });

  it("multiplies the speed and taper sources into one size factor", () => {
    // Half the reference speed: the velocity factor is 0.75, and the taper at
    // the very start is 0, so the product is 0.
    expect(pressureDynamicsSizeFactor(model, { speed: 500, progress: 0 })).toBeCloseTo(0, 10);
    expect(pressureDynamicsSizeFactor(model, { speed: 500, progress: 0.5 })).toBeCloseTo(0.75, 10);
  });

  it("is not inert when either part is not", () => {
    const flatSources = {
      ...model.sources,
      velocitySize: 0,
      taperDepth: 0,
      taperIn: 0,
      taperOut: 0,
    };
    // Both parts active.
    expect(pressureDynamicsAreInert(model)).toBe(false);
    // The sources still change the size.
    expect(pressureDynamicsAreInert({ ...model, pressureCurve: IDENTITY_PRESSURE_CURVE })).toBe(
      false,
    );
    // The curve still changes the pressure.
    expect(pressureDynamicsAreInert({ ...model, sources: flatSources })).toBe(false);
    // Only an identity curve and inert sources make a model inert.
    expect(
      pressureDynamicsAreInert({
        ...model,
        pressureCurve: IDENTITY_PRESSURE_CURVE,
        sources: flatSources,
      }),
    ).toBe(true);
  });

  it("reads an untrusted model without throwing", () => {
    for (const value of [null, undefined, 3, "model", []]) {
      expect(normalizePressureDynamicsModel(value)).toEqual(DEFAULT_PRESSURE_DYNAMICS_MODEL);
    }
    const normalized = normalizePressureDynamicsModel({
      id: "pen",
      label: "Pen",
      pressureCurve: [{ x: 0.5, y: 0.5 }],
      sources: { id: "pen", label: "Pen", velocitySize: 9, taperDepth: -1 },
    });
    expect(normalized.id).toBe("pen");
    expect(normalized.pressureCurve).toBe(IDENTITY_PRESSURE_CURVE);
    expect(normalized.sources.velocitySize).toBe(1);
    expect(normalized.sources.taperDepth).toBe(0);
  });

  it("registers, finds and removes a model", () => {
    registerPressureDynamicsModel(model);
    expect(findPressureDynamicsModel("pen")).toBe(model);
    expect(listPressureDynamicsModels()).toHaveLength(2);
    registerPressureDynamicsModel({ ...model, label: "Pen 2" });
    expect(listPressureDynamicsModels()).toHaveLength(2);
    expect(findPressureDynamicsModel("pen")?.label).toBe("Pen 2");
    expect(() => registerPressureDynamicsModel({ ...model, id: " " })).toThrow(/non-empty id/);
    expect(unregisterPressureDynamicsModel("pen")).toBe(true);
    expect(unregisterPressureDynamicsModel("pen")).toBe(false);
  });
});

describe("the pixels do not move", () => {
  it("keeps the old linear diameter formula exactly", () => {
    const brush = { ...DEFAULT_BRUSH, size: 20, pressureSize: 0.6, minSizeRatio: 0.12 };
    for (const pressure of [0, 0.25, 0.5, 0.75, 1]) {
      const before = Math.max(20 * 0.12, 20 * (1 - 0.6 * (1 - pressure)));
      expect(strokeDiameter(brush, pressure)).toBe(before);
    }
  });

  it("keeps the old linear mean-pressure opacity exactly", () => {
    const brush = { ...DEFAULT_BRUSH, opacity: 0.8, pressureOpacity: 0.5 };
    const pressures = [0.2, 0.6, 1];
    const mean = pressures.reduce((sum, value) => sum + value, 0) / pressures.length;
    expect(strokeOpacity(brush, pressures)).toBe(0.8 * (1 - 0.5 * (1 - mean)));
  });

  it("draws a stroke with no dynamics as the stroke before dynamics existed", () => {
    const brush = { ...DEFAULT_BRUSH, size: 20, pressureSize: 0.6, minSizeRatio: 0.12 };
    const resolved = resolvePressureDynamics(DEFAULT_PRESSURE_DYNAMICS_MODEL, {
      pressure: 0.5,
      speed: 500,
      progress: 0.25,
    });
    // The default model hands the raw pressure back and asks for no change
    // to the size, so the diameter is the one the old linear formula gave.
    expect(strokeDiameter(brush, resolved.pressure)).toBe(
      Math.max(20 * 0.12, 20 * (1 - 0.6 * (1 - resolved.pressure))),
    );
    expect(resolved.sizeFactor).toBe(1);
  });
});
