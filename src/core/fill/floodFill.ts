/**
 * Contiguous flood fill over 8-bit RGBA pixels.
 *
 * This module is the **primitive** the bucket has always used: it takes a
 * pixel buffer and a seed and returns a bounded coverage mask. It knows
 * nothing about layers, the renderer, history or the project format, which is
 * what lets the boundary rules be tested against synthetic images without a
 * browser canvas.
 *
 * Matching is **4-connected** and uses the largest absolute difference across
 * the four 8-bit channels, compared to the tolerance. At tolerance `0` a pixel
 * matches only when its RGBA value is identical to the seed's; raising the
 * tolerance admits nearby values (including anti-aliased boundary pixels) in
 * every channel together. The mask is binary by design - see
 * `FillPatchRecord` for why an invented feathered edge would break exact
 * save/reopen.
 *
 * The rules themselves live in the two modules this one reads:
 *
 *  - `core/fill/fillScan.ts` owns the pixel comparison, the scan and the
 *    scan budget. {@link scanFill} is the whole fill pipeline: it takes the
 *    fill's *options* (the tolerance, the contiguous-or-global rule and the
 *    sampling scale), checks the budget and reports an over-budget scan
 *    instead of truncating it.
 *  - `core/fill/fillOptions.ts` owns the options: their bounds, their
 *    defaults and the rule that a malformed option falls back to the default.
 *
 * This function stays the plain, single-argument form the engine calls: the
 * contiguous region at a given tolerance, with no options and no budget
 * policing. A caller that wants the budget checked and reported uses
 * {@link scanFill}.
 */

import {
  createColorMatch,
  scanContiguous,
  type FloodFillRegion,
  type PixelBuffer,
} from "./fillScan";

export { MAX_FILL_SCAN_PIXELS } from "./fillScan";
export type { FloodFillRegion, PixelBuffer } from "./fillScan";

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
  const match = createColorMatch(source, seedX, seedY, tolerance);
  if (!match) {
    return null;
  }
  return scanContiguous(source, Math.floor(seedX), Math.floor(seedY), match);
}
