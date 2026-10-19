/**
 * Contiguous flood fill over 8-bit RGBA pixels.
 *
 * This module is deliberately pure: it takes a pixel buffer and a seed and
 * returns a bounded coverage mask. It knows nothing about layers, the renderer,
 * history or the project format, which is what lets the boundary rules be tested
 * against synthetic images without a browser canvas.
 *
 * Matching is **4-connected** and uses the largest absolute difference across
 * the four 8-bit channels, compared to the tolerance. At tolerance `0` a pixel
 * matches only when its RGBA value is identical to the seed's; raising the
 * tolerance admits nearby values (including anti-aliased boundary pixels) in
 * every channel together. The mask is binary by design - see
 * `FillPatchRecord` for why an invented feathered edge would break exact
 * save/reopen.
 */

/** Pixel source accepted by the scanner (`ImageData` satisfies it). */
export interface PixelBuffer {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

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
 * Selects the contiguous region around `(seedX, seedY)` and returns its mask,
 * or `null` when the seed is outside the buffer or nothing matches.
 *
 * `tolerance` is clamped to `0..255` and rounded. The returned mask is cropped
 * to the region's bounding box, so a small fill stores only its own pixels.
 */
export function floodFill(
  source: PixelBuffer,
  seedX: number,
  seedY: number,
  tolerance: number,
): FloodFillRegion | null {
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

  const matches = (x: number, y: number): boolean => {
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
  };

  const visited = new Uint8Array(width * height);
  // Flat `[x, y, x, y, ...]` stack: no per-pixel object allocation in the scan.
  const stack: number[] = [sx, sy];
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
    if (visited[row + x] !== 0 || !matches(x, y)) {
      continue;
    }

    let left = x;
    while (left > 0 && visited[row + left - 1] === 0 && matches(left - 1, y)) {
      left -= 1;
    }
    let right = x;
    while (right < width - 1 && visited[row + right + 1] === 0 && matches(right + 1, y)) {
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
        const inside = visited[nextRow + column] === 0 && matches(column, nextY);
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

  return { x: minX, y: minY, width: cropWidth, height: cropHeight, mask, pixels };
}
