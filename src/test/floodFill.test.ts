/**
 * Flood-fill scanner tests.
 *
 * The scanner is pure, so these pin the boundary rules with synthetic RGBA
 * images instead of a browser canvas: which pixels are contiguous, how the
 * tolerance compares channels, how transparency is treated, and that the
 * returned mask is cropped to the filled pixels' bounding box.
 */

import { describe, expect, it } from "vitest";
import { floodFill, MAX_FILL_SCAN_PIXELS, type PixelBuffer } from "../core/fill/floodFill";

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };
const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };

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

function coverage(mask: Uint8Array | undefined): number[] {
  return [...(mask ?? [])];
}

describe("floodFill", () => {
  it("selects the region enclosed by a border, not the border", () => {
    const region = floodFill(framedSquare(), 2, 2, 0);

    expect(region).not.toBeNull();
    expect(region).toMatchObject({ x: 1, y: 1, width: 3, height: 3, pixels: 9 });
    // Every pixel inside the frame is selected; the frame itself is not.
    expect(coverage(region?.mask)).toEqual(new Array(9).fill(255));
  });

  it("stops at a drawn boundary instead of leaking around it", () => {
    // A full-height black line at x = 2 splits a 5x5 white square in two.
    const pixels: Rgba[] = [];
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        pixels.push(x === 2 ? BLACK : WHITE);
      }
    }
    const source = image(5, 5, pixels);

    const left = floodFill(source, 0, 0, 0);
    expect(left).toMatchObject({ x: 0, y: 0, width: 2, height: 5, pixels: 10 });

    const right = floodFill(source, 4, 4, 0);
    expect(right).toMatchObject({ x: 3, y: 0, width: 2, height: 5, pixels: 10 });
  });

  it("uses 4-connectivity, so a diagonal neighbour does not join the region", () => {
    // White pixels on the main diagonal, black everywhere else.
    const pixels: Rgba[] = [];
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        pixels.push(x === y ? WHITE : BLACK);
      }
    }

    const region = floodFill(image(3, 3, pixels), 0, 0, 0);
    // With no tolerance the black neighbours block the scan, and 4-connectivity
    // means the diagonal white pixel is never reached.
    expect(region).toMatchObject({ x: 0, y: 0, width: 1, height: 1, pixels: 1 });
  });

  it("admits nearby colours up to the tolerance and no further", () => {
    const shades = [100, 104, 108, 120, 124].map(
      (value): Rgba => ({ r: value, g: value, b: value, a: 255 }),
    );
    const source = image(5, 1, shades);

    const tight = floodFill(source, 0, 0, 4);
    expect(tight).toMatchObject({ x: 0, y: 0, width: 2, height: 1, pixels: 2 });

    const wider = floodFill(source, 0, 0, 8);
    expect(wider).toMatchObject({ x: 0, y: 0, width: 3, height: 1, pixels: 3 });

    // The tolerance is inclusive: a difference exactly at the limit matches.
    expect(floodFill(source, 0, 0, 3)?.pixels).toBe(1);
  });

  it("compares alpha as well as RGB, so transparency is boundaried", () => {
    const source = image(3, 1, [
      { r: 255, g: 0, b: 0, a: 0 },
      { r: 0, g: 255, b: 0, a: 0 },
      { r: 255, g: 0, b: 0, a: 255 },
    ]);

    // Transparent pixels match each other regardless of their hidden RGB.
    const transparent = floodFill(source, 0, 0, 0);
    expect(transparent).toMatchObject({ x: 0, y: 0, width: 2, height: 1, pixels: 2 });

    // The opaque red pixel differs only in alpha and is not selected.
    expect(transparent?.mask).toEqual(new Uint8Array([255, 255]));
  });

  it("fills an all-transparent canvas without treating hidden RGB as paint", () => {
    const source = image(4, 2, [
      { r: 0, g: 0, b: 0, a: 0 },
      { r: 255, g: 0, b: 0, a: 0 },
      { r: 0, g: 255, b: 0, a: 0 },
      { r: 0, g: 0, b: 255, a: 0 },
      { r: 1, g: 2, b: 3, a: 0 },
      { r: 4, g: 5, b: 6, a: 0 },
      { r: 7, g: 8, b: 9, a: 0 },
      { r: 10, g: 11, b: 12, a: 0 },
    ]);

    const region = floodFill(source, 1, 0, 0);
    expect(region).toMatchObject({ x: 0, y: 0, width: 4, height: 2, pixels: 8 });
    expect(coverage(region?.mask)).toEqual(new Array(8).fill(255));
  });

  it("crops the mask to a tight bounding box around sparse pixels", () => {
    const pixels: Rgba[] = new Array(36).fill(CLEAR);
    // A 2x3 blue block at (2, 1).
    for (let y = 1; y <= 3; y += 1) {
      pixels[y * 6 + 2] = { r: 0, g: 0, b: 255, a: 255 };
      pixels[y * 6 + 3] = { r: 0, g: 0, b: 255, a: 255 };
    }
    const source = image(6, 6, pixels);

    const region = floodFill(source, 3, 3, 0);
    expect(region).toMatchObject({ x: 2, y: 1, width: 2, height: 3, pixels: 6 });
    expect(coverage(region?.mask)).toEqual(new Array(6).fill(255));
  });

  it("treats an out-of-bounds or invalid seed as a no-op", () => {
    const source = framedSquare();
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [5, 0],
      [0, 5],
      [Number.NaN, 2],
      [2, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(floodFill(source, x, y, 0), `${x},${y}`).toBeNull();
    }

    expect(floodFill({ data: new Uint8Array(3), width: 2, height: 2 }, 0, 0, 0)).toBeNull();
    expect(floodFill({ data: new Uint8Array(0), width: 0, height: 0 }, 0, 0, 0)).toBeNull();
  });

  it("clamps the tolerance to the 8-bit channel range", () => {
    const source = image(2, 1, [WHITE, BLACK]);
    expect(floodFill(source, 0, 0, 999)?.pixels).toBe(2);
    expect(floodFill(source, 0, 0, -10)?.pixels).toBe(1);
  });

  it("documents a pixel ceiling above the largest supported document", () => {
    // 16.7 M pixels ~= 4096 x 4096, while documents can reach 8192 x 8192;
    // the engine refuses a fill on the latter rather than scanning it.
    expect(MAX_FILL_SCAN_PIXELS).toBe(16_777_216);
  });
});
