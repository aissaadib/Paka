/**
 * The bucket-fill scan: what the region is, and how the options shape it.
 *
 * `floodFill` answers one question - "which pixels are contiguous with the
 * seed and match its colour?" - and returns a binary mask. This module is the
 * whole fill pipeline on top of it:
 *
 *  1. **Gap closing** (optional) seals a passage too narrow for the fill to
 *     pass through, so a break in the line art cannot leak the fill into the
 *     shape next door.
 *  2. The **scan** runs over the reference image and returns the contiguous
 *     region around the seed.
 *  3. **Growth** (optional) grows or shrinks the region by whole document
 *     pixels, measured from the region's boundary.
 *  4. **Antialiasing** (optional) softens the region's edge, so a fill does
 *     not stair-step along a diagonal.
 *
 * Everything here is pure and bounded. The scan is O(pixels), the growth and
 * the antialiasing run over the region's own bounding box (never the whole
 * document), and the only allocations are one distance field over that box and
 * the coverage the fill commits.
 *
 * The distance field is an exact Euclidean distance transform (Felzenszwalb
 * and Huttenlocher): a distance to a pixel's *centre*, so the region's boundary
 * sits half a pixel outside the outermost selected pixel and the numbers mean
 * the same thing at every zoom.
 */

import { clamp } from "../../utils/math";
import {
  MAX_FILL_ANTIALIAS,
  MAX_FILL_CLOSE_GAPS,
  MAX_FILL_EXPAND,
  MIN_FILL_EXPAND,
} from "./fillOptions";
import {
  createColorMatch,
  floodFill,
  type ColorMatch,
  type FloodFillRegion,
  type PixelBuffer,
} from "./floodFill";

/** The options one scan runs with. */
export interface FillScanOptions {
  /** How far a pixel's colour may sit from the seed's, per 8-bit channel. */
  readonly tolerance: number;
  /** Grow (positive) or shrink (negative) the region, in document pixels. */
  readonly expand: number;
  /** Soften the region's edge over this many pixels. */
  readonly antialias: number;
  /** Seal passages narrower than this many pixels. */
  readonly closeGaps: number;
}

/**
 * A filled region, cropped to its own bounding box.
 *
 * `mask` holds one **coverage** byte per pixel: 255 inside the region, 0
 * outside it, and a ramp between the two on a feathered edge. The renderer
 * writes the coverage as the patch's alpha, so a soft edge blends with the
 * layer underneath instead of stair-stepping.
 */
export interface FillScanResult {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly mask: Uint8Array;
  /** Number of pixels the patch covers at all (coverage above zero). */
  readonly pixels: number;
}

/**
 * Selects the region the bucket fills, shaped by the options.
 *
 * Returns `null` when the seed is unusable, when nothing matches it, or when
 * the options shrink the region away entirely. The returned region is cropped
 * to its own bounding box and never leaves the source image.
 */
export function scanFill(
  source: PixelBuffer,
  seedX: number,
  seedY: number,
  options: FillScanOptions,
): FillScanResult | null {
  const tolerance = clamp(Math.round(options.tolerance), 0, 255);
  const expand = clamp(Math.round(options.expand), MIN_FILL_EXPAND, MAX_FILL_EXPAND);
  const antialias = clamp(Math.round(options.antialias), 0, MAX_FILL_ANTIALIAS);
  const closeGaps = clamp(Math.round(options.closeGaps), 0, MAX_FILL_CLOSE_GAPS);

  const match = createColorMatch(source, seedX, seedY, tolerance);
  if (!match) {
    return null;
  }

  const region = scanRegion(source, match, seedX, seedY, tolerance, closeGaps);
  if (!region) {
    return null;
  }

  if (expand === 0 && antialias === 0) {
    return {
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      mask: region.mask,
      pixels: region.pixels,
    };
  }

  return refineRegion(source, region, expand, antialias);
}

/**
 * Runs the scan, sealing a narrow passage first when the gap closing is on.
 *
 * The sealed map is released as soon as the scan is done, so the refinement
 * that follows never has to hold it.
 */
function scanRegion(
  source: PixelBuffer,
  match: ColorMatch,
  seedX: number,
  seedY: number,
  tolerance: number,
  closeGaps: number,
): FloodFillRegion | null {
  if (closeGaps <= 0) {
    return floodFill(source, seedX, seedY, tolerance);
  }
  const sealed = sealNarrowPassages(source, match, seedX, seedY, closeGaps);
  return floodFill(
    source,
    seedX,
    seedY,
    tolerance,
    (x, y) => sealed[y * source.width + x] !== 0,
  );
}

/**
 * The two scan directions the gap closing looks along.
 *
 * A passage runs across the canvas, so a break in a wall is found by looking
 * along the row and along the column. Diagonals are deliberately **not** used:
 * two walls meeting at a corner look like a one-pixel diagonal passage, and
 * sealing it would cut the corners off every boxy shape.
 */
const SCAN_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
];

/**
 * Marks the pixels that sit in a passage too narrow for the fill to pass
 * through.
 *
 * A matching pixel is sealed when the scan line through it has a barrier
 * within `radius` steps on **both** sides and the passage between the two
 * barriers is no wider than `radius` steps. That is the shape of a break in a
 * wall: the wall's two ends face each other across the opening.
 *
 * The rule is deliberately simple, and it has one visible consequence: a
 * region narrower than `radius` is itself a passage, so it is sealed too. The
 * control therefore measures *how narrow a passage has to be before it stops
 * letting the fill through*, and a one-pixel break in a line of line art is
 * sealed at `1`.
 *
 * The seed is never sealed: the user clicked there, so that pixel belongs to
 * the region whatever the walls around it look like.
 */
function sealNarrowPassages(
  source: PixelBuffer,
  match: ColorMatch,
  seedX: number,
  seedY: number,
  radius: number,
): Uint8Array {
  const { width, height } = source;
  const sealed = new Uint8Array(width * height);
  const seedIndex = Math.floor(seedY) * width + Math.floor(seedX);

  const lineSize = Math.max(width, height);
  const flags = new Uint8Array(lineSize);
  const behind = new Int32Array(lineSize);
  const ahead = new Int32Array(lineSize);

  for (const [dx, dy] of SCAN_DIRECTIONS) {
    eachScanLine(width, height, dy, (startX, startY) => {
      let count = 0;
      let x = startX;
      let y = startY;
      while (x >= 0 && x < width && y >= 0 && y < height) {
        flags[count] = match.matches(x, y) ? 0 : 1;
        count += 1;
        x += dx;
        y += dy;
      }
      if (count < 2) {
        return;
      }

      let wall = -1;
      for (let index = 0; index < count; index += 1) {
        behind[index] = wall < 0 ? -1 : index - wall;
        if (flags[index] !== 0) {
          wall = index;
        }
      }
      wall = -1;
      for (let index = count - 1; index >= 0; index -= 1) {
        ahead[index] = wall < 0 ? -1 : wall - index;
        if (flags[index] !== 0) {
          wall = index;
        }
      }

      for (let index = 0; index < count; index += 1) {
        // Only a matching pixel can be part of the passage; a barrier is the
        // wall itself.
        if (flags[index] !== 0) {
          continue;
        }
        if (behind[index] < 0 || ahead[index] < 0) {
          continue;
        }
        if (behind[index] > radius || ahead[index] > radius) {
          continue;
        }
        // The passage between the two walls, measured through the opening.
        if (behind[index] + ahead[index] - 1 > radius) {
          continue;
        }
        const index2 = (startY + index * dy) * width + (startX + index * dx);
        if (index2 === seedIndex) {
          continue;
        }
        sealed[index2] = 255;
      }
    });
  }

  return sealed;
}

/**
 * Visits the first pixel of every scan line that runs along `(dx, dy)`.
 *
 * A line starts where the step before it would leave the image: a row starts
 * at its left edge and a column at its top.
 */
function eachScanLine(
  width: number,
  height: number,
  dy: number,
  visit: (startX: number, startY: number) => void,
): void {
  if (dy === 0) {
    for (let y = 0; y < height; y += 1) {
      visit(0, y);
    }
    return;
  }
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
  }
}

/**
 * Grows, shrinks and feathers the scanned region.
 *
 * The work happens inside the region's own bounding box, padded by the widest
 * margin any option needs, and clipped to the source image: a fill never
 * reaches outside the canvas.
 */
function refineRegion(
  source: PixelBuffer,
  region: FloodFillRegion,
  expand: number,
  antialias: number,
): FillScanResult | null {
  const margin = Math.max(expand, 0) + antialias + 1;
  const boxX = Math.max(0, region.x - margin);
  const boxY = Math.max(0, region.y - margin);
  const boxRight = Math.min(source.width, region.x + region.width + margin);
  const boxBottom = Math.min(source.height, region.y + region.height + margin);
  const boxWidth = boxRight - boxX;
  const boxHeight = boxBottom - boxY;
  if (boxWidth <= 0 || boxHeight <= 0) {
    return null;
  }

  const field = new DistanceField(boxWidth, boxHeight);

  // Stage one: the distance from every pixel to the region's boundary.
  field.reset();
  markBoundary(field.values, boxWidth, boxHeight, region, boxX, boxY);
  field.compute();

  const grown = expand === 0 ? region : growOrShrink(region, field.values, boxX, boxY, boxWidth, boxHeight, expand);
  if (!grown) {
    return null;
  }

  if (antialias === 0) {
    return {
      x: grown.x,
      y: grown.y,
      width: grown.width,
      height: grown.height,
      mask: grown.mask,
      pixels: grown.pixels,
    };
  }

  return feather(grown, field, boxX, boxY, boxWidth, boxHeight, antialias);
}

/**
 * A binary region: a bounding box and one byte per pixel.
 */
interface BinaryRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly mask: Uint8Array;
  readonly pixels: number;
}

/** Whether a pixel belongs to a binary region. */
function regionHolds(region: BinaryRegion, x: number, y: number): boolean {
  if (x < region.x || y < region.y || x >= region.x + region.width || y >= region.y + region.height) {
    return false;
  }
  return region.mask[(y - region.y) * region.width + (x - region.x)] !== 0;
}

/**
 * Marks the region's boundary pixels as distance features.
 *
 * A boundary pixel is a selected pixel with at least one neighbour that is not
 * selected. The canvas edge counts as unselected, so a region that runs to the
 * edge of the document has a boundary there and can be shrunk away from it.
 */
function markBoundary(
  values: Float32Array,
  boxWidth: number,
  boxHeight: number,
  region: BinaryRegion,
  boxX: number,
  boxY: number,
): void {
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      if (!regionHolds(region, x, y)) {
        continue;
      }
      const open =
        !regionHolds(region, x - 1, y) ||
        !regionHolds(region, x + 1, y) ||
        !regionHolds(region, x, y - 1) ||
        !regionHolds(region, x, y + 1);
      if (!open) {
        continue;
      }
      const column = x - boxX;
      const row = y - boxY;
      if (column < 0 || row < 0 || column >= boxWidth || row >= boxHeight) {
        continue;
      }
      values[row * boxWidth + column] = 0;
    }
  }
}

/**
 * Grows or shrinks the region by whole pixels, measured from its boundary.
 *
 * A positive radius takes in every pixel within that distance of the region;
 * a negative one drops every pixel that close to the boundary. The result is
 * cropped to its own bounding box, so a shrunken region stores less.
 */
function growOrShrink(
  region: BinaryRegion,
  values: Float32Array,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
  expand: number,
): BinaryRegion | null {
  const selected = (x: number, y: number): boolean => {
    const pixelX = boxX + x;
    const pixelY = boxY + y;
    const inside = regionHolds(region, pixelX, pixelY);
    if (expand > 0) {
      if (inside) {
        return true;
      }
      // The squared distance to the boundary; the radius is whole pixels.
      const distance = values[y * boxWidth + x];
      return distance <= expand * expand;
    }
    if (!inside) {
      return false;
    }
    // A pixel survives while it is further than the radius from the boundary.
    const radius = -expand - 0.5;
    const distance = values[y * boxWidth + x];
    return distance > radius * radius;
  };

  let minX = boxWidth;
  let minY = boxHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      if (!selected(x, y)) {
        continue;
      }
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
  if (maxX < minX || maxY < minY) {
    return null;
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const mask = new Uint8Array(width * height);
  let pixels = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!selected(x, y)) {
        continue;
      }
      mask[(y - minY) * width + (x - minX)] = 255;
      pixels += 1;
    }
  }

  return { x: boxX + minX, y: boxY + minY, width, height, mask, pixels };
}

/**
 * Softens the region's edge.
 *
 * The coverage is a ramp centred on the boundary: a pixel just inside keeps
 * most of its coverage, a pixel just outside keeps a little, and the ramp
 * reaches zero `antialias` pixels out. The renderer writes the coverage as
 * the patch's alpha, so the edge blends with whatever is underneath it.
 */
function feather(
  region: BinaryRegion,
  field: DistanceField,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
  antialias: number,
): FillScanResult | null {
  field.reset();
  markBoundary(field.values, boxWidth, boxHeight, region, boxX, boxY);
  field.compute();

  const coverage = (x: number, y: number): number => {
    const distance = Math.sqrt(field.values[y * boxWidth + x]);
    const depth = regionHolds(region, boxX + x, boxY + y) ? distance + 0.5 : -(distance - 0.5);
    const value = 0.5 + depth / (2 * antialias);
    if (value <= 0) {
      return 0;
    }
    if (value >= 1) {
      return 255;
    }
    return Math.round(value * 255);
  };

  let minX = boxWidth;
  let minY = boxHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      if (coverage(x, y) <= 0) {
        continue;
      }
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
  if (maxX < minX || maxY < minY) {
    return null;
  }

  // The working box is clipped to the canvas, so the patch never reaches
  // outside it.
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const mask = new Uint8Array(width * height);
  let pixels = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const value = coverage(x, y);
      if (value <= 0) {
        continue;
      }
      mask[(y - minY) * width + (x - minX)] = value;
      pixels += 1;
    }
  }

  return { x: boxX + minX, y: boxY + minY, width, height, mask, pixels };
}

/**
 * An exact Euclidean distance field over a rectangle.
 *
 * The transform is Felzenszwalb and Huttenlocher's: a linear lower envelope
 * per row and per column, which is O(pixels) and needs no priority queue.
 * `values` holds the **squared** distance to the nearest feature, which keeps
 * the comparisons in the growth exact and avoids a square root per pixel.
 */
class DistanceField {
  /** Squared distance to the nearest feature, one per pixel. */
  readonly values: Float32Array;
  /** The field's width in pixels. */
  readonly width: number;
  /** The field's height in pixels. */
  readonly height: number;
  /** The 1-D scratch the transform runs in. */
  readonly scratch: {
    readonly f: Float64Array;
    readonly d: Float64Array;
    readonly v: Int32Array;
    readonly z: Float64Array;
  };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.values = new Float32Array(width * height);
    const size = Math.max(width, height);
    this.scratch = {
      f: new Float64Array(size),
      d: new Float64Array(size),
      v: new Int32Array(size),
      z: new Float64Array(size + 1),
    };
  }

  /** Empties the field, so every pixel is infinitely far from a feature. */
  reset(): void {
    this.values.fill(DISTANCE_INFINITY);
  }

  /** Computes the squared distance to the nearest feature. */
  compute(): void {
    const { width, height } = this;
    const { f, d, v, z } = this.scratch;

    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        f[y] = this.values[y * width + x];
      }
      transformLine(f, d, v, z, height);
      for (let y = 0; y < height; y += 1) {
        this.values[y * width + x] = d[y];
      }
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        f[x] = this.values[y * width + x];
      }
      transformLine(f, d, v, z, width);
      for (let x = 0; x < width; x += 1) {
        this.values[y * width + x] = d[x];
      }
    }
  }
}

/** The "no feature here" distance. Large, finite, and safe in float maths. */
const DISTANCE_INFINITY = 1e20;

/**
 * The 1-D squared distance transform of one row or column.
 *
 * `f` holds the squared distance to a feature on the line (or a large value
 * where there is none); `d` receives the result.
 */
function transformLine(
  f: Float64Array,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
  n: number,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -DISTANCE_INFINITY;
  z[1] = DISTANCE_INFINITY;

  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = DISTANCE_INFINITY;
  }

  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) {
      k += 1;
    }
    const gap = q - v[k];
    d[q] = gap * gap + f[v[k]];
  }
}
