/**
 * Bucket-fill scan tests.
 *
 * The scan is pure, so these pin the rules with synthetic RGBA images instead
 * of a browser canvas: which pixels the region covers, how the tolerance
 * compares channels, how transparency is treated, how the region grows and
 * shrinks, how the soft edge ramps, and how the gap closing seals a break in
 * the line art.
 */

import { describe, expect, it } from "vitest";
import { scanFill, type FillScanOptions } from "../core/fill/fillScan";
import { floodFill, type PixelBuffer } from "../core/fill/floodFill";

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

/** A black field with a white rectangle of the given bounds. */
function whiteSquare(
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): PixelBuffer {
  const pixels: Rgba[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= left && x <= right && y >= top && y <= bottom;
      pixels.push(inside ? WHITE : BLACK);
    }
  }
  return image(width, height, pixels);
}

/** The scan with every option off. */
const PLAIN: FillScanOptions = {
  tolerance: 0,
  expand: 0,
  antialias: 0,
  closeGaps: 0,
};

function scan(
  source: PixelBuffer,
  seedX: number,
  seedY: number,
  overrides: Partial<FillScanOptions> = {},
) {
  return scanFill(source, seedX, seedY, { ...PLAIN, ...overrides });
}

function coverage(mask: Uint8Array | undefined): number[] {
  return [...(mask ?? [])];
}

describe("scanFill", () => {
  it("finds the contiguous region and crops it to its own box", () => {
    const source = whiteSquare(12, 12, 4, 4, 7, 7);

    const region = scan(source, 5, 5);

    expect(region).toMatchObject({ x: 4, y: 4, width: 4, height: 4, pixels: 16 });
    expect(coverage(region?.mask)).toEqual(new Array(16).fill(255));
  });

  it("takes the region under the pointer, not a matching region elsewhere", () => {
    // Two white squares of the same colour, one pixel apart diagonally. The
    // scan is 4-connected, so only the one under the pointer is filled.
    const pixels: Rgba[] = [];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const first = x >= 1 && x <= 2 && y >= 1 && y <= 2;
        const second = x >= 4 && x <= 5 && y >= 4 && y <= 5;
        pixels.push(first || second ? WHITE : BLACK);
      }
    }
    const source = image(8, 8, pixels);

    const region = scan(source, 1, 1);

    expect(region).toMatchObject({ x: 1, y: 1, width: 2, height: 2, pixels: 4 });
  });

  it("agrees with the plain flood fill when no option is on", () => {
    const source = whiteSquare(10, 10, 2, 2, 6, 6);

    const plain = scan(source, 4, 4);
    const flooded = floodFill(source, 4, 4, 0);

    expect(plain).toMatchObject({
      x: flooded?.x,
      y: flooded?.y,
      width: flooded?.width,
      height: flooded?.height,
      pixels: flooded?.pixels,
    });
    expect(coverage(plain?.mask)).toEqual(coverage(flooded?.mask));
  });

  it("returns nothing when the seed is outside the image or matches nothing", () => {
    const source = whiteSquare(6, 6, 2, 2, 3, 3);

    expect(scan(source, -1, 0)).toBeNull();
    expect(scan(source, 6, 0)).toBeNull();
    expect(scan(source, Number.NaN, 0)).toBeNull();
    // The seed is on the black field, which is one region around the white
    // square - the square does not split it.
    expect(scan(source, 0, 0)).toMatchObject({ x: 0, y: 0, width: 6, height: 6 });
  });

  it("treats transparent pixels as one region, whatever their hidden colour", () => {
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

    const region = scan(source, 1, 0);

    expect(region).toMatchObject({ x: 0, y: 0, width: 4, height: 2, pixels: 8 });
    expect(coverage(region?.mask)).toEqual(new Array(8).fill(255));
  });

  it("admits nearby colours up to the tolerance and no further", () => {
    const shades = [100, 104, 108, 120, 124].map(
      (value): Rgba => ({ r: value, g: value, b: value, a: 255 }),
    );
    const source = image(5, 1, shades);

    expect(scan(source, 0, 0, { tolerance: 4 })?.pixels).toBe(2);
    expect(scan(source, 0, 0, { tolerance: 8 })?.pixels).toBe(3);
    // The tolerance is inclusive: a difference exactly at the limit matches.
    expect(scan(source, 0, 0, { tolerance: 3 })?.pixels).toBe(1);
  });

  it("grows the region by whole pixels", () => {
    const source = whiteSquare(16, 16, 4, 4, 7, 7);

    const grown = scan(source, 5, 5, { expand: 2 });

    // The box grows by the radius on every side; the corners are rounded off.
    expect(grown).toMatchObject({ x: 2, y: 2, width: 8, height: 8 });
    // The corner of the grown box is outside the disc, so it is not covered,
    // while the pixel next to it along the edge is.
    expect(grown?.mask[0]).toBe(0);
    expect(grown?.mask[1 * 8 + 1]).toBe(255);
  });

  it("shrinks the region by whole pixels", () => {
    const source = whiteSquare(16, 16, 4, 4, 7, 7);

    const shrunk = scan(source, 5, 5, { expand: -1 });

    expect(shrunk).toMatchObject({ x: 5, y: 5, width: 2, height: 2, pixels: 4 });
  });

  it("returns nothing when the shrink removes the whole region", () => {
    const source = whiteSquare(16, 16, 4, 4, 7, 7);

    expect(scan(source, 5, 5, { expand: -4 })).toBeNull();
  });

  it("keeps the region inside the canvas when it grows past the edge", () => {
    const source = whiteSquare(8, 8, 0, 0, 1, 1);

    const grown = scan(source, 0, 0, { expand: 4 });

    expect(grown?.x).toBe(0);
    expect(grown?.y).toBe(0);
    expect(grown?.width).toBe(6);
    expect(grown?.height).toBe(6);
  });

  it("softens the edge into a ramp instead of a stair step", () => {
    const source = whiteSquare(12, 12, 4, 4, 7, 7);

    const feathered = scan(source, 5, 5, { antialias: 1 });

    // The soft edge reaches one pixel outside the region...
    expect(feathered).toMatchObject({ x: 3, y: 3, width: 6, height: 6 });
    const mask = feathered?.mask ?? new Uint8Array();
    // ...the pixel just outside the edge is barely covered...
    expect(mask[1]).toBe(64);
    // ...the region's own corner is mostly covered...
    expect(mask[7]).toBe(191);
    // ...and the middle of the region is fully covered.
    expect(mask[3 * 6 + 3]).toBe(255);
  });

  it("leaves the edge hard when the soft edge is off", () => {
    const source = whiteSquare(12, 12, 4, 4, 7, 7);

    const hard = scan(source, 5, 5);

    expect(hard).toMatchObject({ x: 4, y: 4, width: 4, height: 4 });
    expect(coverage(hard?.mask)).toEqual(new Array(16).fill(255));
  });

  it("seals a narrow break in the line art so the fill cannot leak", () => {
    // A 12x12 white field with a black ring around a 5x5 area, broken by a
    // one-pixel gap on the right. Without the gap closing the fill escapes.
    const pixels: Rgba[] = [];
    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const onRing = x === 2 || x === 8 || y === 2 || y === 8;
        const inBox = x >= 2 && x <= 8 && y >= 2 && y <= 8;
        const gap = x === 8 && y === 5;
        pixels.push(onRing && inBox && !gap ? BLACK : WHITE);
      }
    }
    const source = image(12, 12, pixels);

    // Without the gap closing the fill leaks out through the break and takes
    // the whole white field with it.
    expect(scan(source, 5, 5)?.pixels).toBe(121);

    // With it, the fill stops at the ring.
    const sealed = scan(source, 5, 5, { closeGaps: 1 });
    expect(sealed?.pixels).toBe(25);
    expect(sealed).toMatchObject({ x: 3, y: 3, width: 5, height: 5 });
  });

  it("leaves an ordinary boundary alone when the gap closing is on", () => {
    const source = whiteSquare(12, 12, 4, 4, 7, 7);

    // The square is four pixels wide, so a gap closing of two is narrower than
    // the passage and leaves it alone.
    const sealed = scan(source, 5, 5, { closeGaps: 2 });

    expect(sealed).toMatchObject({ x: 4, y: 4, width: 4, height: 4, pixels: 16 });
  });

  it("seals a passage the gap closing is wide enough for", () => {
    const source = whiteSquare(12, 12, 4, 4, 7, 7);

    // Four is the width of the passage, so a gap closing of four closes most
    // of it - the control measures how narrow a passage has to be before it
    // stops letting the fill through, and a region that narrow is a passage
    // too.
    expect(scan(source, 5, 5, { closeGaps: 4 })?.pixels).toBeLessThan(16);
  });

  it("never seals the pixel the user clicked on", () => {
    // The seed sits in a one-pixel passage between two walls.
    const pixels: Rgba[] = [];
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        pixels.push(x === 2 || x === 4 ? BLACK : WHITE);
      }
    }
    const source = image(6, 6, pixels);

    const region = scan(source, 3, 3, { closeGaps: 2 });

    // The passage the pointer is in is still filled.
    expect(region?.pixels).toBeGreaterThan(0);
  });
});
