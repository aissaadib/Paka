/**
 * Bucket-fill options: the settings that describe the *next* fill.
 *
 * These are **editor state**, not a drawing. A committed fill stores the
 * pixels it painted (`FillPatchRecord`), so changing an option never rewrites
 * one, never adds a history step and never makes the document dirty - the
 * same contract the brush and the shape options follow. The options are read
 * at press time, so a committed fill keeps the setting it was drawn with.
 *
 * Every option here is one the scanner actually implements
 * (`core/fill/fillScan.ts`). The options strip must never offer a control the
 * algorithm cannot honour.
 *
 *  - `tolerance` - how far a pixel's colour may sit from the seed's and still
 *    count as "the same region", in 8-bit sRGB channel units (0-255). This is
 *    the meaning the tolerance has always had and it is kept exactly.
 *  - `mode` - **whether the region is contiguous**: the pixels reachable from
 *    the seed without crossing a boundary, or every pixel in the image whose
 *    colour matches the seed's.
 *  - `sampleScale` - how finely the composite is sampled before the scan: one
 *    in `sampleScale` document pixels is examined. `1` is the full resolution
 *    and is the default, so the default fill is the fill the bucket has always
 *    made.
 *
 * The values are validated the way every other untrusted value in the project
 * is validated: a missing field takes its default, an out-of-range value is
 * clamped into the supported range, and a malformed value takes its default.
 */

import { clamp } from "../../utils/math";

/**
 * Whether the region is the contiguous one around the seed or every match.
 *
 *  - `contiguous` - the pixels reachable from the seed without crossing a
 *    colour boundary. This is what a bucket has always done.
 *  - `global` - every pixel in the image whose colour matches the seed's,
 *    wherever it is. Two shapes of the same flat colour are filled together.
 */
export type FillMode = "contiguous" | "global";

/** The modes, in the order the picker lists them. */
export const FILL_MODES: readonly FillMode[] = ["contiguous", "global"];

/** The default mode: the contiguous region around the seed. */
export const DEFAULT_FILL_MODE: FillMode = "contiguous";

/** The smallest tolerance: only an exactly equal colour matches. */
export const MIN_FILL_TOLERANCE = 0;
/** The largest tolerance: every 8-bit value matches every other one. */
export const MAX_FILL_TOLERANCE = 255;
/** The default tolerance, in 8-bit sRGB channel units. */
export const DEFAULT_FILL_TOLERANCE = 24;

/** The finest sampling: every document pixel is examined. */
export const MIN_FILL_SAMPLE_SCALE = 1;
/** The coarsest sampling: one document pixel in eight is examined. */
export const MAX_FILL_SAMPLE_SCALE = 8;
/**
 * The sampling scales the scanner supports, finest first.
 *
 * Only powers of two: a halved scale is exactly a quarter of the pixels, so
 * the cost of a scan falls in known steps and the sampled grid stays aligned
 * with the document's own pixel grid.
 */
export const FILL_SAMPLE_SCALES: readonly number[] = [1, 2, 4, 8];
/** The default sampling: the full resolution. */
export const DEFAULT_FILL_SAMPLE_SCALE = 1;

/**
 * The bucket's options for the next fill.
 *
 * Every field is a plain value: the options travel through the engine's
 * snapshot, the settings file and the options bar without any of them
 * knowing about the others.
 */
export interface FillOptions {
  /** The colour distance, in 8-bit sRGB channel units (0-255). */
  readonly tolerance: number;
  /** Whether the region is the contiguous one or every match. */
  readonly mode: FillMode;
  /** One in `sampleScale` document pixels is examined by the scan. */
  readonly sampleScale: number;
}

/** The options a fresh editor starts with. */
export const DEFAULT_FILL_OPTIONS: FillOptions = Object.freeze({
  tolerance: DEFAULT_FILL_TOLERANCE,
  mode: DEFAULT_FILL_MODE,
  sampleScale: DEFAULT_FILL_SAMPLE_SCALE,
});

/**
 * The mode, or the default when the value is not one.
 *
 * A mode is a name, not a number: an unknown name is malformed input, so it
 * falls back to the default rather than being clamped towards it.
 */
export function normalizeFillMode(value: unknown): FillMode {
  return FILL_MODES.includes(value as FillMode)
    ? (value as FillMode)
    : DEFAULT_FILL_MODE;
}

/**
 * The tolerance, in 8-bit sRGB channel units.
 *
 * A malformed value takes the default. A value outside the channel range is
 * clamped into it: the engine's own setter has always clamped, and a
 * tolerance of 999 means "as loose as the format allows", not "the default".
 */
export function normalizeFillTolerance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FILL_TOLERANCE;
  }
  return Math.round(clamp(value, MIN_FILL_TOLERANCE, MAX_FILL_TOLERANCE));
}

/**
 * The sampling scale, snapped to a supported one.
 *
 * A malformed value takes the default. A number outside the supported range
 * is clamped into it, and a number that is not a supported scale is rounded
 * **down** to the next one that is - so the scan is never coarser than the
 * request, only ever finer.
 */
export function normalizeFillSampleScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FILL_SAMPLE_SCALE;
  }
  const wanted = Math.floor(
    clamp(value, MIN_FILL_SAMPLE_SCALE, MAX_FILL_SAMPLE_SCALE),
  );
  let scale = MIN_FILL_SAMPLE_SCALE;
  for (const candidate of FILL_SAMPLE_SCALES) {
    if (candidate <= wanted) {
      scale = candidate;
    }
  }
  return scale;
}

/**
 * Reads the whole option set out of an untrusted value.
 *
 * A value that is not an object at all takes every default; an object with
 * missing or malformed fields takes the default for those fields only.
 */
export function normalizeFillOptions(value: unknown): FillOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_FILL_OPTIONS;
  }
  const record = value as {
    tolerance?: unknown;
    mode?: unknown;
    sampleScale?: unknown;
  };
  return {
    tolerance: normalizeFillTolerance(record.tolerance),
    mode: normalizeFillMode(record.mode),
    sampleScale: normalizeFillSampleScale(record.sampleScale),
  };
}

/** Whether two option sets say the same thing. */
export function fillOptionsEqual(a: FillOptions, b: FillOptions): boolean {
  return (
    a.tolerance === b.tolerance &&
    a.mode === b.mode &&
    a.sampleScale === b.sampleScale
  );
}
