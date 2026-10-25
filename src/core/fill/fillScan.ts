/**
 * The bucket-fill scan: what counts as "the same region", and what one scan
 * may cost.
 *
 * The scan is pure. It takes a pixel buffer, a seed and the fill's options,
 * and returns the pixels the fill would paint. It knows nothing about layers,
 * the renderer, the history or the project format, which is what lets the
 * boundary rules be tested against synthetic images without a browser canvas.
 *
 * Four rules live here.
 *
 *  1. **The pixel comparison.** A pixel matches the seed when no 8-bit channel
 *     differs by more than the tolerance. Two fully transparent pixels always
 *     match each other: their hidden RGB bytes carry no colour, and a canvas
 *     is free to leave anything there.
 *  2. **The region.** `contiguous` selects the pixels reachable from the seed
 *     without crossing a colour boundary (4-connected); `global` selects every
 *     pixel in the image whose colour matches the seed's, wherever it is.
 *  3. **The sampling.** A scan may run on a sampled copy of the composite
 *     (`sampleScale`), which trades the precision of the boundary for the
 *     cost of the scan. The default scale is `1`: the full resolution, and
 *     therefore the fill the bucket has always made.
 *  4. **The budget.** A scan that would examine more than
 *     {@link MAX_FILL_SCAN_PIXELS} pixels is **refused, not truncated**: the
 *     scan does not start and the caller is told why. A fill is either painted
 *     whole or not at all; a half-filled region is never returned.
 */

import { normalizeFillOptions, type FillOptions } from "./fillOptions";

/** Pixel source accepted by the scanner (`ImageData` satisfies it). */
export interface PixelBuffer {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * The pixels one fill selects, cropped to their own bounding box.
 *
 * The mask is **binary** by design: `255` inside the region and `0` outside
 * it. See `FillPatchRecord` for why an invented feathered edge would break
 * an exact save and reopen.
 */
export interface FloodFillRegion {
  /** Tight bounding box of the filled pixels, in source pixels. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** `width * height` coverage bytes, `255` for every selected pixel. */
  readonly mask: Uint8Array;
  /** Number of selected pixels, before cropping to the bounding box. */
  readonly pixels: number;
}

/**
 * Upper bound for one bucket operation, in source pixels.
 *
 * The scan needs a full RGBA composite plus one coverage byte per document
 * pixel, so this caps the transient memory at roughly 170 MB - the composed
 * canvas and its `ImageData` copy are the bulk of it - and keeps a single click
 * from freezing the UI on an extreme canvas. Documents larger than this are
 * still editable; a bucket click on one is refused with a message rather than
 * attempted.
 */
export const MAX_FILL_SCAN_PIXELS = 16_777_216;

/**
 * Whether a scan of this size may run.
 *
 * The budget is a **refusal**, never a truncation: a scan that would exceed it
 * is not started at all.
 */
export type FillScanBudget =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      /** The ceiling that was exceeded. */
      readonly limit: number;
      /** The number of pixels the scan would have examined. */
      readonly pixels: number;
    };

/**
 * Checks a size against the scan budget.
 *
 * An unusable size (a zero, a negative or a non-numeric dimension) has no
 * pixels to examine, so it is allowed; the scan then finds no seed and
 * reports an empty region.
 */
export function fillScanBudget(
  width: number,
  height: number,
  limit: number = MAX_FILL_SCAN_PIXELS,
): FillScanBudget {
  const pixels = fillPixelCount(width, height);
  if (pixels > limit) {
    return { allowed: false, limit, pixels };
  }
  return { allowed: true };
}

/** The number of pixels a buffer of this size holds, or `0` when unusable. */
function fillPixelCount(width: number, height: number): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return 0;
  }
  return Math.floor(width) * Math.floor(height);
}

/**
 * What a scan reports back.
 *
 *  - `region` - the scan ran and found these pixels.
 *  - `empty` - the seed was unusable, or nothing matched it. The fill is a
 *    no-op: no patch, no history step, no dirty document.
 *  - `over-budget` - the scan was **refused** because it would have examined
 *    more pixels than the budget allows. There is no region: the caller must
 *    tell the user the fill was refused rather than paint part of it.
 */
export type FillScanOutcome =
  | { readonly status: "region"; readonly region: FloodFillRegion }
  | { readonly status: "empty" }
  | {
      readonly status: "over-budget";
      /** The ceiling that was exceeded. */
      readonly limit: number;
      /** The number of pixels the scan would have examined. */
      readonly pixels: number;
    };

/**
 * The colour rule a scan runs on.
 *
 * A pixel matches the seed when no 8-bit channel differs by more than the
 * tolerance. Two fully transparent pixels always match each other: their
 * hidden RGB bytes carry no colour, and a canvas is free to leave anything
 * there.
 */
export interface ColorMatch {
  /** Whether the pixel at `(x, y)` counts as the seed's colour. */
  matches(x: number, y: number): boolean;
}

/**
 * Builds the colour rule for a seed, or `null` when the seed is unusable.
 *
 * The seed's own colour is the reference: a fill grows the colour under the
 * pointer, not the colour of the paper or of the layer.
 */
export function createColorMatch(
  source: PixelBuffer,
  seedX: number,
  seedY: number,
  tolerance: number,
): ColorMatch | null {
  const { data, width, height } = source;
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return null;
  }
  if (
    !Number.isFinite(seedX) ||
    !Number.isFinite(seedY) ||
    seedX < 0 ||
    seedY < 0 ||
    seedX >= width ||
    seedY >= height
  ) {
    return null;
  }

  const sx = Math.floor(seedX);
  const sy = Math.floor(seedY);
  const seed = (sy * width + sx) * 4;
  const targetR = data[seed];
  const targetG = data[seed + 1];
  const targetB = data[seed + 2];
  const targetA = data[seed + 3];
  const limit = Math.min(255, Math.max(0, Math.round(tolerance)));

  return {
    matches(x: number, y: number): boolean {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3];
      // Fully transparent pixels have no visible colour, so their hidden RGB
      // bytes must not split a region. Canvas implementations are free to leave
      // arbitrary values there (and often leave the last colour's channels).
      if (targetA === 0 && alpha === 0) {
        return true;
      }
      return (
        Math.abs(data[offset] - targetR) <= limit &&
        Math.abs(data[offset + 1] - targetG) <= limit &&
        Math.abs(data[offset + 2] - targetB) <= limit &&
        Math.abs(alpha - targetA) <= limit
      );
    },
  };
}

/**
 * Selects the region a bucket fill would paint.
 *
 * The options are normalised first, so a caller may hand over an untrusted
 * object: a missing or malformed field takes its default and the scan runs
 * with a known set of settings.
 *
 * The budget is checked **before** the scan starts. An over-budget source is
 * refused and reported, never scanned in part: a fill is either painted whole
 * or not at all.
 */
export function scanFill(
  source: PixelBuffer,
  seedX: number,
  seedY: number,
  options: FillOptions,
  limit: number = MAX_FILL_SCAN_PIXELS,
): FillScanOutcome {
  const settings = normalizeFillOptions(options);

  const budget = fillScanBudget(source.width, source.height, limit);
  if (!budget.allowed) {
    return { status: "over-budget", limit: budget.limit, pixels: budget.pixels };
  }

  if (
    source.width <= 0 ||
    source.height <= 0 ||
    source.data.length < source.width * source.height * 4
  ) {
    return { status: "empty" };
  }

  const scale = settings.sampleScale;
  const sampled = scale === 1 ? source : sampleSource(source, scale);
  const seedX2 = Math.floor(seedX / scale);
  const seedY2 = Math.floor(seedY / scale);

  const match = createColorMatch(sampled, seedX2, seedY2, settings.tolerance);
  if (!match) {
    return { status: "empty" };
  }

  const region =
    settings.mode === "global"
      ? scanGlobal(sampled, match)
      : scanContiguous(sampled, seedX2, seedY2, match);
  if (!region) {
    return { status: "empty" };
  }

  if (scale === 1) {
    return { status: "region", region };
  }

  const expanded = expandRegion(region, scale, source.width, source.height);
  if (!expanded) {
    return { status: "empty" };
  }
  return { status: "region", region: expanded };
}

/**
 * Selects the contiguous region around `(seedX, seedY)`.
 *
 * Matching is **4-connected**: a diagonal neighbour does not join the region.
 * The scan walks the rows in spans, so a wide region costs one visit per
 * pixel rather than one per neighbour.
 */
export function scanContiguous(
  source: PixelBuffer,
  seedX: number,
  seedY: number,
  match: ColorMatch,
): FloodFillRegion | null {
  const { width, height } = source;
  const visited = new Uint8Array(width * height);
  // Flat `[x, y, x, y, ...]` stack: no per-pixel object allocation in the scan.
  const stack: number[] = [seedX, seedY];
  let pixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  while (stack.length > 0) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }
    const row = y * width;
    if (visited[row + x] !== 0 || !match.matches(x, y)) {
      continue;
    }

    let left = x;
    while (left > 0 && visited[row + left - 1] === 0 && match.matches(left - 1, y)) {
      left -= 1;
    }
    let right = x;
    while (
      right < width - 1 &&
      visited[row + right + 1] === 0 &&
      match.matches(right + 1, y)
    ) {
      right += 1;
    }

    for (let column = left; column <= right; column += 1) {
      visited[row + column] = 255;
      pixels += 1;
    }
    if (left < minX) {
      minX = left;
    }
    if (right > maxX) {
      maxX = right;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }

    // Push the start of each matching span on the rows above and below. A span
    // may be pushed more than once; `visited` makes the extra entry cheap.
    for (let offset = -1; offset <= 1; offset += 2) {
      const nextY = y + offset;
      if (nextY < 0 || nextY >= height) {
        continue;
      }
      const nextRow = nextY * width;
      let inSpan = false;
      for (let column = left; column <= right; column += 1) {
        const inside = visited[nextRow + column] === 0 && match.matches(column, nextY);
        if (inside) {
          if (!inSpan) {
            stack.push(column, nextY);
            inSpan = true;
          }
        } else {
          inSpan = false;
        }
      }
    }
  }

  if (pixels === 0 || maxX < minX || maxY < minY) {
    return null;
  }

  return cropToRegion(visited, width, minX, minY, maxX, maxY, pixels);
}

/**
 * Selects every pixel in the image whose colour matches the seed's.
 *
 * The region is not bounded by the seed in any way: two shapes of the same
 * flat colour are one region, and the fill paints both. The result is cropped
 * to the matching pixels' bounding box, so it stores only its own pixels.
 */
export function scanGlobal(
  source: PixelBuffer,
  match: ColorMatch,
): FloodFillRegion | null {
  const { width, height } = source;
  const visited = new Uint8Array(width * height);
  let pixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!match.matches(x, y)) {
        continue;
      }
      visited[y * width + x] = 255;
      pixels += 1;
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }

  if (pixels === 0 || maxX < minX || maxY < minY) {
    return null;
  }

  return cropToRegion(visited, width, minX, minY, maxX, maxY, pixels);
}

/**
 * Copies the selected pixels of a scan into a mask cropped to their bounding
 * box.
 */
function cropToRegion(
  visited: Uint8Array,
  width: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  pixels: number,
): FloodFillRegion {
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const mask = new Uint8Array(cropWidth * cropHeight);
  for (let y = minY; y <= maxY; y += 1) {
    const sourceRow = y * width;
    const targetRow = (y - minY) * cropWidth;
    for (let x = minX; x <= maxX; x += 1) {
      if (visited[sourceRow + x] !== 0) {
        mask[targetRow + (x - minX)] = 255;
      }
    }
  }
  return {
    x: minX,
    y: minY,
    width: cropWidth,
    height: cropHeight,
    mask,
    pixels,
  };
}

/**
 * Takes every `scale`-th pixel of the source, nearest neighbour.
 *
 * The sampled grid is anchored at the document's origin, so the same source
 * and the same scale always produce the same grid. The grid is what the scan
 * measures; the region it finds is mapped back to document pixels afterwards.
 */
function sampleSource(source: PixelBuffer, scale: number): PixelBuffer {
  const width = Math.max(1, Math.ceil(source.width / scale));
  const height = Math.max(1, Math.ceil(source.height / scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, y * scale);
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, x * scale);
      const from = (sourceY * source.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      data[to] = source.data[from];
      data[to + 1] = source.data[from + 1];
      data[to + 2] = source.data[from + 2];
      data[to + 3] = source.data[from + 3];
    }
  }
  return { data, width, height };
}

/**
 * Maps a region found on the sampled grid back to document pixels.
 *
 * Every sampled pixel stands for a `scale` by `scale` block of document
 * pixels, so the region's boundary follows the sampled grid. The blocks are
 * clipped to the source: a fill never reaches outside the canvas.
 */
function expandRegion(
  region: FloodFillRegion,
  scale: number,
  width: number,
  height: number,
): FloodFillRegion | null {
  const x = region.x * scale;
  const y = region.y * scale;
  const right = Math.min(width, (region.x + region.width) * scale);
  const bottom = Math.min(height, (region.y + region.height) * scale);
  const outWidth = right - x;
  const outHeight = bottom - y;
  if (outWidth <= 0 || outHeight <= 0) {
    return null;
  }

  const mask = new Uint8Array(outWidth * outHeight);
  let pixels = 0;
  for (let row = 0; row < region.height; row += 1) {
    const blockTop = y + row * scale;
    const blockBottom = Math.min(blockTop + scale, bottom);
    for (let column = 0; column < region.width; column += 1) {
      if (region.mask[row * region.width + column] === 0) {
        continue;
      }
      const blockLeft = x + column * scale;
      const blockRight = Math.min(blockLeft + scale, right);
      for (let py = blockTop; py < blockBottom; py += 1) {
        const targetRow = (py - y) * outWidth;
        for (let px = blockLeft; px < blockRight; px += 1) {
          mask[targetRow + (px - x)] = 255;
          pixels += 1;
        }
      }
    }
  }

  return { x, y, width: outWidth, height: outHeight, mask, pixels };
}
