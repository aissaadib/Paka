/**
 * Brush dynamics tests.
 *
 * The rule the whole wave follows is that a new capability must be invisible
 * until it is asked for. The default model is therefore inert: every factor
 * is exactly `1`, so a stroke drawn with no dynamics is the stroke that was
 * drawn before dynamics existed.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_DYNAMICS_MODEL,
  dynamicsAreInert,
  dynamicsSizeFactor,
  findDynamicsModel,
  listDynamicsModels,
  normalizeDynamicsModel,
  registerDynamicsModel,
  resetDynamicsModels,
  taperSizeFactor,
  unregisterDynamicsModel,
  velocitySizeFactor,
} from "../core/brushes/dynamics";

const model = {
  id: "pen",
  label: "Pen",
  velocityReference: 1000,
  velocitySize: 0.5,
  taperIn: 0.2,
  taperOut: 0.2,
  taperDepth: 1,
};

beforeEach(() => {
  resetDynamicsModels();
  registerDynamicsModel(DEFAULT_DYNAMICS_MODEL);
});

describe("the default dynamics", () => {
  it("changes nothing at all", () => {
    expect(dynamicsAreInert(DEFAULT_DYNAMICS_MODEL)).toBe(true);
    for (const speed of [0, 100, 5000]) {
      for (const progress of [0, 0.5, 1]) {
        expect(dynamicsSizeFactor(DEFAULT_DYNAMICS_MODEL, { speed, progress })).toBe(1);
      }
    }
  });

  it("is registered", () => {
    expect(findDynamicsModel("none")).toBe(DEFAULT_DYNAMICS_MODEL);
  });
});

describe("the velocity source", () => {
  it("keeps the size at rest", () => {
    expect(velocitySizeFactor(model, 0)).toBe(1);
  });

  it("narrows the size at the reference speed", () => {
    expect(velocitySizeFactor(model, 1000)).toBeCloseTo(0.5, 10);
  });

  it("does not narrow past the reference speed", () => {
    expect(velocitySizeFactor(model, 100000)).toBeCloseTo(0.5, 10);
  });

  it("does nothing when the velocity size is zero", () => {
    const flat = { ...model, velocitySize: 0 };
    expect(velocitySizeFactor(flat, 1000)).toBe(1);
  });

  it("does nothing when the reference speed is zero", () => {
    const off = { ...model, velocityReference: 0 };
    expect(velocitySizeFactor(off, 1000)).toBe(1);
  });

  it("reads a negative or broken speed as a standstill", () => {
    expect(velocitySizeFactor(model, -10)).toBe(1);
    expect(velocitySizeFactor(model, Number.NaN)).toBe(1);
  });
});

describe("the taper source", () => {
  it("is thinnest at the start and at the end", () => {
    expect(taperSizeFactor(model, 0)).toBeCloseTo(0, 10);
    expect(taperSizeFactor(model, 1)).toBeCloseTo(0, 10);
    expect(taperSizeFactor(model, 0.5)).toBeCloseTo(1, 10);
  });

  it("reaches full size just past the ramp", () => {
    expect(taperSizeFactor(model, 0.25)).toBeCloseTo(1, 10);
    expect(taperSizeFactor(model, 0.75)).toBeCloseTo(1, 10);
  });

  it("tapers in only when asked", () => {
    const taperIn = { ...model, taperOut: 0 };
    expect(taperSizeFactor(taperIn, 0)).toBeCloseTo(0, 10);
    expect(taperSizeFactor(taperIn, 1)).toBeCloseTo(1, 10);
  });

  it("tapers out only when asked", () => {
    const taperOut = { ...model, taperIn: 0 };
    expect(taperSizeFactor(taperOut, 0)).toBeCloseTo(1, 10);
    expect(taperSizeFactor(taperOut, 1)).toBeCloseTo(0, 10);
  });

  it("does nothing when the depth is zero", () => {
    const flat = { ...model, taperDepth: 0 };
    expect(taperSizeFactor(flat, 0)).toBe(1);
    expect(taperSizeFactor(flat, 1)).toBe(1);
  });

  it("clamps a progress outside the range", () => {
    expect(taperSizeFactor(model, -1)).toBeCloseTo(taperSizeFactor(model, 0), 10);
    expect(taperSizeFactor(model, 2)).toBeCloseTo(taperSizeFactor(model, 1), 10);
  });
});

describe("the whole model", () => {
  it("multiplies the two sources", () => {
    // Half speed: the velocity factor is 0.75, and the taper at the very
    // start is 0, so the product is 0.
    expect(dynamicsSizeFactor(model, { speed: 500, progress: 0 })).toBeCloseTo(0, 10);
    expect(dynamicsSizeFactor(model, { speed: 500, progress: 0.5 })).toBeCloseTo(0.75, 10);
  });
});

describe("reading an untrusted model", () => {
  it("falls back to the default for anything that is not a model", () => {
    for (const value of [null, undefined, 3, "model", []]) {
      expect(normalizeDynamicsModel(value)).toEqual(DEFAULT_DYNAMICS_MODEL);
    }
  });

  it("clamps every field into range", () => {
    const normalized = normalizeDynamicsModel({
      id: "pen",
      label: "Pen",
      velocityReference: -5,
      velocitySize: 9,
      taperIn: -1,
      taperOut: 4,
      taperDepth: 99,
    });
    expect(normalized.velocityReference).toBe(1);
    expect(normalized.velocitySize).toBe(1);
    expect(normalized.taperIn).toBe(0);
    expect(normalized.taperOut).toBe(1);
    expect(normalized.taperDepth).toBe(1);
  });

  it("gives a model with no id the default id", () => {
    expect(normalizeDynamicsModel({}).id).toBe("none");
  });
});

describe("the dynamics registry", () => {
  it("registers a model and finds it by id", () => {
    registerDynamicsModel(model);
    expect(findDynamicsModel("pen")).toBe(model);
    // The default model is registered too, so the registry always has one.
    expect(listDynamicsModels()).toHaveLength(2);
  });

  it("replaces a model registered twice under the same id", () => {
    registerDynamicsModel(model);
    registerDynamicsModel({ ...model, label: "Pen 2" });
    expect(listDynamicsModels()).toHaveLength(2);
    expect(findDynamicsModel("pen")?.label).toBe("Pen 2");
  });

  it("refuses a model with no id", () => {
    expect(() => registerDynamicsModel({ ...model, id: " " })).toThrow(/non-empty id/);
  });

  it("removes a model", () => {
    registerDynamicsModel(model);
    expect(unregisterDynamicsModel("pen")).toBe(true);
    expect(unregisterDynamicsModel("pen")).toBe(false);
  });
});
