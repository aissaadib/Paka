/**
 * The stroke taper: the model, its validation and the width it produces.
 *
 * The taper is the one brush setting that changes a stroke's *shape* along
 * its path, so the numbers it produces are pinned here: how the ramp is
 * measured, what happens where the two ramps overlap, and what a stroke with
 * no path (a tap) or no length does.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH, brushSettingsEqual, normalizeBrush } from "../core/brushes/defaults";
import {
  DEFAULT_TAPER,
  MAX_TAPER_LENGTH,
  normalizeTaper,
  taperIsActive,
  taperWidthFactors,
} from "../core/brushes/taper";
import { buildTaperedPath, drawTaperedPath } from "../core/rendering/taperStroke";
import type { TaperSettings } from "../types/brush";

/** A taper that narrows both ends to a point over one brush width. */
const POINTED: TaperSettings = {
  enabled: true,
  startLength: 1,
  startStrength: 1,
  endLength: 1,
  endStrength: 1,
};

describe("the taper defaults", () => {
  it("is off, so every stroke drawn before it existed is unchanged", () => {
    expect(DEFAULT_TAPER.enabled).toBe(false);
    expect(DEFAULT_BRUSH.taper).toEqual(DEFAULT_TAPER);
    expect(normalizeBrush(DEFAULT_BRUSH).taper).toEqual(DEFAULT_TAPER);
  });

  it("is part of the brush's identity", () => {
    const tapered = normalizeBrush({
      ...DEFAULT_BRUSH,
      taper: { ...DEFAULT_TAPER, enabled: true },
    });
    expect(brushSettingsEqual(DEFAULT_BRUSH, tapered)).toBe(false);
  });
});

describe("reading a taper", () => {
  it("gives a value that is not an object the default", () => {
    expect(normalizeTaper(null)).toEqual(DEFAULT_TAPER);
    expect(normalizeTaper("taper")).toEqual(DEFAULT_TAPER);
    expect(normalizeTaper(7)).toEqual(DEFAULT_TAPER);
  });

  it("takes the default for a field it does not have", () => {
    const taper = normalizeTaper({ enabled: true, startLength: 0.5 });
    expect(taper.enabled).toBe(true);
    expect(taper.startLength).toBe(0.5);
    expect(taper.startStrength).toBe(0);
    expect(taper.endLength).toBe(0);
    expect(taper.endStrength).toBe(0);
  });

  it("clamps every number into range", () => {
    const taper = normalizeTaper({
      enabled: true,
      startLength: 99,
      startStrength: -4,
      endLength: Number.NaN,
      endStrength: 12,
    });
    expect(taper.startLength).toBe(MAX_TAPER_LENGTH);
    expect(taper.startStrength).toBe(0);
    expect(taper.endLength).toBe(0);
    expect(taper.endStrength).toBe(1);
  });

  it("only counts the switch when it is really on", () => {
    expect(normalizeTaper({ enabled: "yes" }).enabled).toBe(false);
  });
});

describe("when the taper changes anything", () => {
  it("is inactive while the switch is off", () => {
    expect(taperIsActive({ ...POINTED, enabled: false })).toBe(false);
  });

  it("is inactive while no ramp has a length", () => {
    expect(
      taperIsActive({ ...POINTED, startLength: 0, endLength: 0 }),
    ).toBe(false);
  });

  it("is inactive while no ramp narrows the stroke", () => {
    expect(
      taperIsActive({ ...POINTED, startStrength: 0, endStrength: 0 }),
    ).toBe(false);
  });

  it("is active when one end narrows the stroke", () => {
    expect(taperIsActive(POINTED)).toBe(true);
    expect(taperIsActive({ ...POINTED, endLength: 0, endStrength: 0 })).toBe(true);
  });
});

describe("the width the taper produces", () => {
  const SIZE = 10;

  it("ramps up from the tip over the ramp's length", () => {
    const xs = [0, 5, 10, 20];
    const ys = [0, 0, 0, 0];
    const taper: TaperSettings = {
      enabled: true,
      startLength: 1,
      startStrength: 0.5,
      endLength: 0,
      endStrength: 0,
    };

    const factors = taperWidthFactors(taper, SIZE, xs, ys);

    // The ramp is one brush width long: half way along it the stroke is
    // three quarters of its width, at its end it is full width.
    expect(factors[0]).toBeCloseTo(0.5, 12);
    expect(factors[1]).toBeCloseTo(0.75, 12);
    expect(factors[2]).toBe(1);
    expect(factors[3]).toBe(1);
  });

  it("ramps down to the tip at the end", () => {
    const xs = [0, 50, 95, 100];
    const ys = [0, 0, 0, 0];
    const taper: TaperSettings = {
      enabled: true,
      startLength: 0,
      startStrength: 0,
      endLength: 1,
      endStrength: 0.25,
    };

    const factors = taperWidthFactors(taper, SIZE, xs, ys);

    // The ramp is one brush width long, so it starts 10 px before the end:
    // half way along it the stroke is seven eighths of its width, and at the
    // very end it is three quarters.
    expect(factors[0]).toBe(1);
    expect(factors[1]).toBe(1);
    expect(factors[2]).toBeCloseTo(0.875, 12);
    expect(factors[3]).toBeCloseTo(0.75, 12);
  });

  it("measures the ramp along the path, not along the axes", () => {
    // A diagonal stroke: the ramp is the same length, even though the
    // horizontal distance is shorter.
    const xs = [0, 10, 20];
    const ys = [0, 10, 20];
    const taper: TaperSettings = {
      enabled: true,
      startLength: 1,
      startStrength: 1,
      endLength: 0,
      endStrength: 0,
    };

    const factors = taperWidthFactors(taper, SIZE, xs, ys);

    // The first segment is 14.14 px long, which is past the 10 px ramp.
    expect(factors[0]).toBe(0);
    expect(factors[1]).toBe(1);
  });

  it("lets the narrower ramp win where the two overlap", () => {
    // A stroke of 4 px with two 10 px ramps: the shape is a lens, and the
    // middle is the narrowest point of the two ramps.
    const xs = [0, 2, 4];
    const ys = [0, 0, 0];
    const taper: TaperSettings = {
      enabled: true,
      startLength: 1,
      startStrength: 1,
      endLength: 1,
      endStrength: 1,
    };

    const factors = taperWidthFactors(taper, SIZE, xs, ys);

    expect(factors[0]).toBe(0);
    expect(factors[1]).toBeCloseTo(0.2, 12);
    expect(factors[2]).toBe(0);
  });

  it("leaves a stroke with no length at its full width", () => {
    const factors = taperWidthFactors(POINTED, SIZE, [4, 4], [4, 4]);
    expect(factors).toEqual([]);
  });

  it("leaves a tap at its full width", () => {
    expect(taperWidthFactors(POINTED, SIZE, [4], [4])).toEqual([]);
  });

  it("does nothing while the taper is off", () => {
    const taper: TaperSettings = { ...POINTED, enabled: false };
    expect(taperWidthFactors(taper, SIZE, [0, 10], [0, 0])).toEqual([]);
  });
});

describe("the path of a tapered stroke", () => {
  it("is empty for a path with no samples", () => {
    const path = buildTaperedPath([], [], []);
    expect(path.discs).toEqual([]);
    expect(path.quads).toEqual([]);
  });

  it("puts a disc at every sample, with that sample's half width", () => {
    const path = buildTaperedPath([0, 10, 20], [0, 0, 0], [1, 2, 3]);

    expect(path.discs).toHaveLength(3);
    expect(path.discs[0]).toEqual({ x: 0, y: 0, radius: 1 });
    expect(path.discs[2]).toEqual({ x: 20, y: 0, radius: 3 });
  });

  it("joins two samples with a quad that carries the width between them", () => {
    const path = buildTaperedPath([0, 10], [0, 0], [2, 4]);

    expect(path.quads).toHaveLength(1);
    // The quad runs along the path, with the two widths on either side.
    const points = path.quads[0].points;
    expect(points[0]).toEqual([0, -2]);
    expect(points[1]).toEqual([10, -4]);
    expect(points[2]).toEqual([10, 4]);
    expect(points[3]).toEqual([0, 2]);
  });

  it("draws nothing for a path with no samples", () => {
    const calls: string[] = [];
    const ctx = {
      beginPath: () => calls.push("beginPath"),
      moveTo: () => calls.push("moveTo"),
      lineTo: () => calls.push("lineTo"),
      closePath: () => calls.push("closePath"),
      arc: () => calls.push("arc"),
      fill: () => calls.push("fill"),
    } as unknown as CanvasRenderingContext2D;

    drawTaperedPath(ctx, buildTaperedPath([], [], []));

    expect(calls).toEqual([]);
  });

  it("winds every piece the same way, so the pieces cannot punch holes", () => {
    const path = buildTaperedPath([0, 10], [0, 0], [2, 4]);

    // The signed area of the quad, and the disc that sits on it, must have
    // the same sign: the path is filled with the non-zero rule.
    const points = path.quads[0].points;
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      area += x1 * y2 - x2 * y1;
    }
    expect(area).toBeGreaterThan(0);

    const disc = path.discs[0];
    let discArea = 0;
    for (let step = 0; step < 32; step += 1) {
      const angle = (step / 32) * Math.PI * 2;
      const x = disc.x + Math.cos(angle) * disc.radius;
      const y = disc.y + Math.sin(angle) * disc.radius;
      const next = ((step + 1) / 32) * Math.PI * 2;
      const nx = disc.x + Math.cos(next) * disc.radius;
      const ny = disc.y + Math.sin(next) * disc.radius;
      discArea += x * ny - nx * y;
    }
    expect(discArea).toBeGreaterThan(0);
  });
});
