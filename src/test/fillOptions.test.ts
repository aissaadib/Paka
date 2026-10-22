/**
 * Bucket-fill option and scan tests.
 *
 * The options are editor state and the scan is pure, so both are pinned here
 * without a browser: the tolerance's meaning and bounds, the
 * contiguous-or-global rule, the sampling scale, and the rule that a scan
 * over its budget is **reported** rather than truncated into a half-filled
 * region.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILL_MODE,
  DEFAULT_FILL_OPTIONS,
  DEFAULT_FILL_SAMPLE_SCALE,
  DEFAULT_FILL_TOLERANCE,
  FILL_MODES,
  MAX_FILL_SAMPLE_SCALE,
  MAX_FILL_TOLERANCE,
  MIN_FILL_SAMPLE_SCALE,
  MIN_FILL_TOLERANCE,
  fillOptionsEqual,
  normalizeFillMode,
  normalizeFillOptions,
  normalizeFillSampleScale,
  normalizeFillTolerance,
} from "../core/fill/fillOptions";
import {
  MAX_FILL_SCAN_PIXELS,
  fillScanBudget,
  scanFill,
  type PixelBuffer,
} from "../core/fill/fillScan";
import { floodFill } from "../core/fill/floodFill";

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };

/** Builds an image from one colour per pixel, row-major. */
function image(width: number, height: number, pixels: readonly Rgba[]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((pixel, index) => {
    const offset = index * 4;
    data[offset] = pixel.r;
    data[offset + 1] = pixel.g;
    data[offset + 2] = pixel.b;
    data[offset + 3] = pixel.a;
  });
  return { data, width, height };
}

/** A 5x5 white square inside a one-pixel black frame. */
function framedSquare(): PixelBuffer {
  const pixels: Rgba[] = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      pixels.push(x === 0 || y === 0 || x === 4 || y === 4 ? BLACK : WHITE);
    }
  }
  return image(5, 5, pixels);
}

/** A 5x5 white square split in two by a full-height black line at x = 2. */
function splitSquare(): PixelBuffer {
  const pixels: Rgba[] = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      pixels.push(x === 2 ? BLACK : WHITE);
    }
  }
  return image(5, 5, pixels);
}

describe("the fill options", () => {
  it("start from the tolerance, the contiguous mode and the full resolution", () => {
    expect(DEFAULT_FILL_OPTIONS).toEqual({
      tolerance: 24,
      mode: "contiguous",
      sampleScale: 1,
    });
    // The tolerance has always defaulted to 24 in 8-bit channel units, and the
    // options must not move it.
    expect(DEFAULT_FILL_TOLERANCE).toBe(24);
    expect(DEFAULT_FILL_MODE).toBe("contiguous");
    expect(DEFAULT_FILL_SAMPLE_SCALE).toBe(1);
  });

  it("keep the tolerance in 8-bit channel units", () => {
    expect(MIN_FILL_TOLERANCE).toBe(0);
    expect(MAX_FILL_TOLERANCE).toBe(255);
    expect(normalizeFillTolerance(0)).toBe(0);
    expect(normalizeFillTolerance(24)).toBe(24);
    expect(normalizeFillTolerance(255)).toBe(255);
    // A tolerance is a whole number of channel units.
    expect(normalizeFillTolerance(12.6)).toBe(13);
  });

  it("clamp a tolerance outside the channel range", () => {
    expect(normalizeFillTolerance(999)).toBe(255);
    expect(normalizeFillTolerance(-10)).toBe(0);
  });

  it("fall back to the default tolerance when the value is malformed", () => {
    for (const value of ["24", null, undefined, Number.NaN, {}, []]) {
      expect(normalizeFillTolerance(value), String(value)).toBe(
        DEFAULT_FILL_TOLERANCE,
      );
    }
  });

  it("keep the two modes and fall back for anything else", () => {
    expect(FILL_MODES).toEqual(["contiguous", "global"]);
    expect(normalizeFillMode("contiguous")).toBe("contiguous");
    expect(normalizeFillMode("global")).toBe("global");
    for (const value of ["everywhere", 7, null, undefined, {}]) {
      expect(normalizeFillMode(value), String(value)).toBe(DEFAULT_FILL_MODE);
    }
  });

  it("round a sample scale down to a supported one", () => {
    expect(MIN_FILL_SAMPLE_SCALE).toBe(1);
    expect(MAX_FILL_SAMPLE_SCALE).toBe(8);
    expect(normalizeFillSampleScale(1)).toBe(1);
    expect(normalizeFillSampleScale(2)).toBe(2);
    expect(normalizeFillSampleScale(4)).toBe(4);
    expect(normalizeFillSampleScale(8)).toBe(8);
    // A scale that is not a supported power of two rounds down, so the scan is
    // never coarser than the request.
    expect(normalizeFillSampleScale(3)).toBe(2);
    expect(normalizeFillSampleScale(5)).toBe(4);
    // Out of range, a scale is clamped into it.
    expect(normalizeFillSampleScale(0)).toBe(1);
    expect(normalizeFillSampleScale(16)).toBe(8);
    // Malformed, a scale takes its default.
    expect(normalizeFillSampleScale("2")).toBe(DEFAULT_FILL_SAMPLE_SCALE);
    expect(normalizeFillSampleScale(Number.NaN)).toBe(DEFAULT_FILL_SAMPLE_SCALE);
  });

  it("read a whole option set out of an untrusted value", () => {
    expect(
      normalizeFillOptions({ tolerance: 10, mode: "global", sampleScale: 2 }),
    ).toEqual({ tolerance: 10, mode: "global", sampleScale: 2 });

    // A missing field takes its default; a malformed one does too.
    expect(normalizeFillOptions({})).toEqual(DEFAULT_FILL_OPTIONS);
    expect(
      normalizeFillOptions({ tolerance: "x", mode: "everywhere", sampleScale: 3 }),
    ).toEqual({ tolerance: 24, mode: "contiguous", sampleScale: 2 });

    // A value that is not an object at all takes every default.
    expect(normalizeFillOptions(null)).toEqual(DEFAULT_FILL_OPTIONS);
    expect(normalizeFillOptions("nope")).toEqual(DEFAULT_FILL_OPTIONS);
    expect(normalizeFillOptions([])).toEqual(DEFAULT_FILL_OPTIONS);
  });

  it("compare two option sets", () => {
    const options = normalizeFillOptions({ tolerance: 4, mode: "global" });
    expect(fillOptionsEqual(options, options)).toBe(true);
    expect(
      fillOptionsEqual(options, normalizeFillOptions({ tolerance: 4 })),
    ).toBe(false);
    expect(
      fillOptionsEqual(
        normalizeFillOptions({ tolerance: 4 }),
        normalizeFillOptions({ tolerance: 5 }),
      ),
    ).toBe(false);
  });
});

describe("the fill scan", () => {
  it("selects the contiguous region around the seed", () => {
    const outcome = scanFill(framedSquare(), 2, 2, DEFAULT_FILL_OPTIONS);

    expect(outcome.status).toBe("region");
    if (outcome.status !== "region") {
      return;
    }
    expect(outcome.region).toMatchObject({
      x: 1,
      y: 1,
      width: 3,
      height: 3,
      pixels: 9,
    });
    expect([...outcome.region.mask]).toEqual(new Array(9).fill(255));
  });

  it("selects every matching pixel in global mode", () => {
    const source = splitSquare();

    // The contiguous region stops at the black line.
    const contiguous = scanFill(source, 0, 0, DEFAULT_FILL_OPTIONS);
    expect(contiguous.status).toBe("region");
    if (contiguous.status === "region") {
      expect(contiguous.region).toMatchObject({
        x: 0,
        y: 0,
        width: 2,
        height: 5,
        pixels: 10,
      });
    }

    // The global region is every white pixel, on both sides of the line.
    const global = scanFill(source, 0, 0, {
      ...DEFAULT_FILL_OPTIONS,
      mode: "global",
    });
    expect(global.status).toBe("region");
    if (global.status === "region") {
      expect(global.region).toMatchObject({
        x: 0,
        y: 0,
        width: 5,
        height: 5,
        pixels: 20,
      });
    }
  });

  it("measures the tolerance in 8-bit channel units", () => {
    const shades = [100, 104, 108, 120, 124].map(
      (value): Rgba => ({ r: value, g: value, b: value, a: 255 }),
    );
    const source = image(5, 1, shades);

    const tight = scanFill(source, 0, 0, { ...DEFAULT_FILL_OPTIONS, tolerance: 4 });
    expect(tight.status).toBe("region");
    if (tight.status === "region") {
      expect(tight.region.pixels).toBe(2);
    }

    const wider = scanFill(source, 0, 0, { ...DEFAULT_FILL_OPTIONS, tolerance: 8 });
    expect(wider.status).toBe("region");
    if (wider.status === "region") {
      expect(wider.region.pixels).toBe(3);
    }

    // The tolerance is inclusive: a difference exactly at the limit matches.
    const exact = scanFill(source, 0, 0, { ...DEFAULT_FILL_OPTIONS, tolerance: 3 });
    expect(exact.status).toBe("region");
    if (exact.status === "region") {
      expect(exact.region.pixels).toBe(1);
    }
  });

  it("treats two transparent pixels as the same colour", () => {
    const source = image(3, 1, [
      { r: 255, g: 0, b: 0, a: 0 },
      { r: 0, g: 255, b: 0, a: 0 },
      { r: 255, g: 0, b: 0, a: 255 },
    ]);

    const outcome = scanFill(source, 0, 0, DEFAULT_FILL_OPTIONS);
    expect(outcome.status).toBe("region");
    if (outcome.status === "region") {
      expect(outcome.region).toMatchObject({ x: 0, y: 0, width: 2, height: 1 });
      expect([...outcome.region.mask]).toEqual([255, 255]);
    }
  });

  it("reports an empty result for an unusable seed", () => {
    const source = framedSquare();
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [5, 0],
      [0, 5],
      [Number.NaN, 2],
    ] as const) {
      expect(scanFill(source, x, y, DEFAULT_FILL_OPTIONS).status, `${x},${y}`).toBe(
        "empty",
      );
    }
  });

  it("agrees with the legacy flood fill at the default settings", () => {
    const source = splitSquare();
    const outcome = scanFill(source, 0, 0, DEFAULT_FILL_OPTIONS);
    const legacy = floodFill(source, 0, 0, DEFAULT_FILL_OPTIONS.tolerance);

    expect(outcome.status).toBe("region");
    expect(legacy).not.toBeNull();
    if (outcome.status === "region" && legacy) {
      expect(outcome.region).toEqual(legacy);
    }
  });

  it("refuses a scan over the budget instead of filling part of the region", () => {
    // The source would need 25 pixels; the budget allows 4.
    const outcome = scanFill(framedSquare(), 2, 2, DEFAULT_FILL_OPTIONS, 4);

    expect(outcome).toEqual({ status: "over-budget", limit: 4, pixels: 25 });
    // There is no region at all: a refused scan never returns half a fill.
    expect("region" in outcome).toBe(false);
  });

  it("checks the budget before it scans", () => {
    // The default budget is the same ceiling the engine has always used.
    expect(MAX_FILL_SCAN_PIXELS).toBe(16_777_216);
    expect(fillScanBudget(4096, 4096)).toEqual({ allowed: true });
    expect(fillScanBudget(4097, 4097)).toEqual({
      allowed: false,
      limit: MAX_FILL_SCAN_PIXELS,
      pixels: 4097 * 4097,
    });
    // A size with no pixels in it is allowed; the scan then finds no seed.
    expect(fillScanBudget(0, 0)).toEqual({ allowed: true });
  });

  it("samples the composite at the chosen scale", () => {
    // Three white columns and one black column in a 4x4 image.
    const pixels: Rgba[] = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        pixels.push(x === 3 ? BLACK : WHITE);
      }
    }
    const source = image(4, 4, pixels);

    const full = scanFill(source, 0, 0, DEFAULT_FILL_OPTIONS);
    expect(full.status).toBe("region");
    if (full.status === "region") {
      expect(full.region).toMatchObject({ x: 0, y: 0, width: 3, height: 4 });
      expect(full.region.pixels).toBe(12);
    }

    // The sampled grid never sees the black column, so the region grows to the
    // whole image. This is the trade a coarser sample makes: a boundary
    // thinner than the sample can be missed.
    const sampled = scanFill(source, 0, 0, {
      ...DEFAULT_FILL_OPTIONS,
      sampleScale: 2,
    });
    expect(sampled.status).toBe("region");
    if (sampled.status === "region") {
      expect(sampled.region).toMatchObject({ x: 0, y: 0, width: 4, height: 4 });
      expect(sampled.region.pixels).toBe(16);
    }
  });

  it("keeps a sampled region inside the source", () => {
    // A 5x5 image samples to a 3x3 grid at scale 2; the last column stands
    // for one document pixel, not two.
    const pixels: Rgba[] = new Array(25).fill(WHITE);
    const source = image(5, 5, pixels);

    const outcome = scanFill(source, 0, 0, {
      ...DEFAULT_FILL_OPTIONS,
      sampleScale: 2,
    });
    expect(outcome.status).toBe("region");
    if (outcome.status === "region") {
      expect(outcome.region).toMatchObject({ x: 0, y: 0, width: 5, height: 5 });
      expect(outcome.region.pixels).toBe(25);
      expect(outcome.region.mask.length).toBe(25);
    }
  });

  it("keeps the mask binary, whatever the sample scale", () => {
    const pixels: Rgba[] = new Array(25).fill(WHITE);
    const source = image(5, 5, pixels);

    const outcome = scanFill(source, 1, 1, {
      ...DEFAULT_FILL_OPTIONS,
      sampleScale: 4,
    });
    expect(outcome.status).toBe("region");
    if (outcome.status === "region") {
      expect([...new Set(outcome.region.mask)]).toEqual([255]);
    }
  });
});
