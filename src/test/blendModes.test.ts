/**
 * Layer blend-mode formulas.
 *
 * These are the reference values for the Canvas 2D operations the renderer
 * selects. The renderer delegates the arithmetic to the browser, so this suite
 * pins the separable W3C formulas - including the branch boundaries at 0, 0.5
 * and 1 - and the straight-alpha compositing equation independently of any
 * canvas implementation.
 */

import { describe, expect, it } from "vitest";
import {
  blendChannel,
  compositeBlendChannel,
  isLayerBlendMode,
  LAYER_BLEND_MODES,
} from "../core/document/blendModes";
import type { LayerBlendMode } from "../core/document/types";

describe("blendChannel", () => {
  it("implements every separable mode at an intermediate backdrop and source", () => {
    const backdrop = 0.3;
    const source = 0.7;
    const expected: ReadonlyArray<readonly [LayerBlendMode, number]> = [
      ["normal", 0.7],
      ["multiply", 0.21],
      ["screen", 0.79],
      // The backdrop is below 0.5, so overlay doubles the product.
      ["overlay", 0.42],
      // Source is above 0.5, and the square-root branch applies at Cb = 0.3.
      ["soft-light", backdrop + 0.4 * (Math.sqrt(backdrop) - backdrop)],
      // Source is above 0.5, so hard light switches to the screen branch.
      ["hard-light", 0.58],
      // 0.3 / (1 - 0.7) is exactly 1.
      ["color-dodge", 1],
      ["darken", 0.3],
      ["lighten", 0.7],
      ["difference", 0.4],
      ["exclusion", 0.58],
    ];

    for (const [mode, value] of expected) {
      expect(blendChannel(mode, backdrop, source), mode).toBeCloseTo(value, 10);
    }
  });

  it("honours each mode's 0 and 1 boundaries", () => {
    expect(blendChannel("normal", 1, 0)).toBe(0);
    expect(blendChannel("multiply", 0, 1)).toBe(0);
    expect(blendChannel("multiply", 1, 0.4)).toBeCloseTo(0.4, 10);
    expect(blendChannel("screen", 0, 0.6)).toBeCloseTo(0.6, 10);
    expect(blendChannel("screen", 1, 0)).toBe(1);

    // Overlay branches on the backdrop, hard light on the source.
    expect(blendChannel("overlay", 0, 1)).toBe(0);
    expect(blendChannel("overlay", 1, 0)).toBe(1);
    expect(blendChannel("overlay", 0.5, 0)).toBe(0);
    expect(blendChannel("overlay", 0.5, 1)).toBe(1);
    expect(blendChannel("hard-light", 1, 0)).toBe(0);
    expect(blendChannel("hard-light", 0, 1)).toBe(1);

    expect(blendChannel("darken", 0.2, 0.8)).toBe(0.2);
    expect(blendChannel("lighten", 0.2, 0.8)).toBe(0.8);
    expect(blendChannel("difference", 0, 1)).toBe(1);
    expect(blendChannel("difference", 1, 1)).toBe(0);
    expect(blendChannel("exclusion", 0, 0)).toBe(0);
    expect(blendChannel("exclusion", 0, 1)).toBe(1);
    expect(blendChannel("exclusion", 1, 1)).toBe(0);
  });

  it("pins the soft-light curve on both sides of its 0.5 source branch", () => {
    // Below 0.5 the polynomial branch darkens a mid backdrop.
    expect(blendChannel("soft-light", 0.5, 0.25)).toBeCloseTo(0.375, 10);
    expect(blendChannel("soft-light", 0.5, 0)).toBeCloseTo(0.25, 10);
    // Above 0.5, the D(Cb) branch uses the linear segment below 0.25.
    expect(blendChannel("soft-light", 0.2, 1)).toBeCloseTo(
      ((16 * 0.2 - 12) * 0.2 + 4) * 0.2,
      10,
    );
    // ... and the square root above it.
    expect(blendChannel("soft-light", 0.64, 1)).toBeCloseTo(0.8, 10);
  });

  it("pins color-dodge's two division guards", () => {
    // A black backdrop stays black even for a white source.
    expect(blendChannel("color-dodge", 0, 1)).toBe(0);
    // A white source saturates a non-zero backdrop.
    expect(blendChannel("color-dodge", 0.4, 1)).toBe(1);
    expect(blendChannel("color-dodge", 0.2, 0.6)).toBeCloseTo(0.5, 10);
    // The ratio is clamped when it exceeds one.
    expect(blendChannel("color-dodge", 0.9, 0.1)).toBeCloseTo(1, 10);
  });

  it("clamps channels outside [0, 1] instead of leaking premultiplied values", () => {
    expect(blendChannel("multiply", -1, 2)).toBe(0);
    expect(blendChannel("screen", -1, 2)).toBe(1);
    expect(blendChannel("difference", 2, -1)).toBe(1);
    expect(blendChannel("exclusion", 2, 2)).toBe(0);
  });
});

describe("compositeBlendChannel", () => {
  it("returns the source for any mode over a transparent backdrop", () => {
    for (const mode of LAYER_BLEND_MODES) {
      expect(compositeBlendChannel(mode, 0.1, 0.8, 0, 1), mode).toBeCloseTo(0.8, 10);
    }
  });

  it("leaves the backdrop untouched for a fully transparent source", () => {
    for (const mode of LAYER_BLEND_MODES) {
      expect(compositeBlendChannel(mode, 0.4, 0.9, 0.7, 0), mode).toBeCloseTo(0.4, 10);
    }
  });

  it("reduces to the blend function when both pixels are opaque", () => {
    for (const mode of LAYER_BLEND_MODES) {
      expect(compositeBlendChannel(mode, 0.4, 0.8, 1, 1), mode).toBeCloseTo(
        blendChannel(mode, 0.4, 0.8),
        10,
      );
    }
  });

  it("scales the blend by source alpha over an opaque backdrop", () => {
    // Difference of 0.8 and 0.4 is 0.4; half source alpha mixes that with the
    // backdrop: 0.5 * 0.4 + 0.5 * 0.4 = 0.4.
    expect(compositeBlendChannel("difference", 0.4, 0.8, 1, 0.5)).toBeCloseTo(0.4, 10);
    // Multiply of 0.4 and 0.8 is 0.32; half alpha gives 0.36.
    expect(compositeBlendChannel("multiply", 0.4, 0.8, 1, 0.5)).toBeCloseTo(0.36, 10);
  });

  it("blends a partial backdrop into the result", () => {
    // Opaque difference source over a half-transparent backdrop:
    // 0.5 * 0.8 (source term) + 0.5 * 0.4 (blend term) = 0.6.
    expect(compositeBlendChannel("difference", 0.4, 0.8, 0.5, 1)).toBeCloseTo(0.6, 10);
    // A normal opaque source over a half-transparent backdrop is still the
    // source: 0.5 * 0.8 + 0.5 * 0.8 = 0.8.
    expect(compositeBlendChannel("normal", 0.4, 0.8, 0.5, 1)).toBeCloseTo(0.8, 10);
  });

  it("returns zero when both alpha values are zero", () => {
    for (const mode of LAYER_BLEND_MODES) {
      expect(compositeBlendChannel(mode, 0.2, 0.8, 0, 0), mode).toBe(0);
    }
  });
});

describe("blend-mode registry", () => {
  it("accepts exactly the persisted modes", () => {
    expect([...LAYER_BLEND_MODES]).toEqual([
      "normal",
      "multiply",
      "screen",
      "overlay",
      "soft-light",
      "hard-light",
      "color-dodge",
      "darken",
      "lighten",
      "difference",
      "exclusion",
    ]);
    for (const mode of LAYER_BLEND_MODES) {
      expect(isLayerBlendMode(mode)).toBe(true);
    }
    expect(isLayerBlendMode("color-burn")).toBe(false);
    expect(isLayerBlendMode("Normal")).toBe(false);
  });
});
