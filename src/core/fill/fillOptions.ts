/**
 * Bucket-fill options.
 *
 * These are **editor state**: they describe the *next* fill, not the fills
 * that were committed. A committed fill stores its own pixels, so changing an
 * option never rewrites one, never adds a history step and never makes the
 * document dirty.
 *
 * Every option here is one the scanner actually implements - the options strip
 * must not offer a control the algorithm cannot honour.
 *
 *  - `tolerance` - how far a pixel's colour may sit from the seed's and still
 *    count as "the same region", in 8-bit channel units.
 *  - `reference` - **what the region is measured against**: the merged visible
 *    composite, the active layer alone, or one chosen layer.
 *  - `expand` - grow (positive) or shrink (negative) the region, in document
 *    pixels.
 *  - `antialias` - soften the region's edge over N pixels, so a fill does not
 *    stair-step along a diagonal.
 *  - `closeGaps` - seal passages narrower than N pixels, so the fill cannot
 *    leak through a break in the line art.
 */

import type { LayerId } from "../document/types";
import { clamp } from "../../utils/math";

/**
 * What the bucket measures its region against.
 *
 *  - `merged` - the paper plus **every visible layer**, at its opacity and
 *    blend mode. The default: the boundary is the one the user sees.
 *  - `active` - the paper plus the **active layer** alone. Line art on another
 *    layer no longer bounds the fill.
 *  - `layer` - the paper plus **one chosen layer**. The layer id is editor
 *    state and is never serialized: a layer belongs to a document, and the
 *    option has to survive a restart.
 */
export type FillReferenceMode = "merged" | "active" | "layer";

/** The reference modes, in the order the picker lists them. */
export const FILL_REFERENCE_MODES: readonly FillReferenceMode[] = ["merged", "active", "layer"];

/** Most the region may grow, in document pixels. */
export const MAX_FILL_EXPAND = 32;
/** Most the region may shrink, in document pixels (a negative `expand`). */
export const MIN_FILL_EXPAND = -32;
/** Widest soft edge the fill may draw, in document pixels. */
export const MAX_FILL_ANTIALIAS = 8;
/** Widest passage the gap closing may seal, in document pixels. */
export const MAX_FILL_CLOSE_GAPS = 16;

/** The default reference: the merged visible composite. */
export const DEFAULT_FILL_REFERENCE: FillReferenceMode = "merged";
/** The default growth: none. */
export const DEFAULT_FILL_EXPAND = 0;
/** The default edge: hard. */
export const DEFAULT_FILL_ANTIALIAS = 0;
/** The default gap closing: off. */
export const DEFAULT_FILL_CLOSE_GAPS = 0;

/**
 * The bucket's options for the next fill.
 *
 * `referenceLayerId` is only read in the `layer` mode; `null` there means the
 * active layer is sampled instead, so a restored preference never points at a
 * layer that does not exist.
 */
export interface FillOptions {
  readonly tolerance: number;
  readonly reference: FillReferenceMode;
  readonly referenceLayerId: LayerId | null;
  readonly expand: number;
  readonly antialias: number;
  readonly closeGaps: number;
}

/** The options a fresh editor starts with. */
export const DEFAULT_FILL_OPTIONS: FillOptions = {
  tolerance: 24,
  reference: DEFAULT_FILL_REFERENCE,
  referenceLayerId: null,
  expand: DEFAULT_FILL_EXPAND,
  antialias: DEFAULT_FILL_ANTIALIAS,
  closeGaps: DEFAULT_FILL_CLOSE_GAPS,
};

/** The reference mode, or the default when the value is not one. */
export function normalizeFillReference(value: unknown): FillReferenceMode {
  return FILL_REFERENCE_MODES.includes(value as FillReferenceMode)
    ? (value as FillReferenceMode)
    : DEFAULT_FILL_REFERENCE;
}

/** The growth, clamped to the supported range and rounded to whole pixels. */
export function normalizeFillExpand(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FILL_EXPAND;
  }
  return Math.round(clamp(value, MIN_FILL_EXPAND, MAX_FILL_EXPAND));
}

/** The soft edge width, clamped to the supported range. */
export function normalizeFillAntialias(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FILL_ANTIALIAS;
  }
  return Math.round(clamp(value, 0, MAX_FILL_ANTIALIAS));
}

/** The gap-closing width, clamped to the supported range. */
export function normalizeFillCloseGaps(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FILL_CLOSE_GAPS;
  }
  return Math.round(clamp(value, 0, MAX_FILL_CLOSE_GAPS));
}

/** The tolerance, clamped to the 8-bit channel range. */
export function normalizeFillTolerance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FILL_OPTIONS.tolerance;
  }
  return Math.round(clamp(value, 0, 255));
}

/**
 * The layer a reference mode samples.
 *
 * `merged` samples every visible layer, so it has no single layer; `active`
 * samples the active layer; `layer` samples the chosen one and falls back to
 * the active layer when nothing is chosen yet.
 */
export function fillReferenceLayers(
  mode: FillReferenceMode,
  activeLayerId: LayerId | null,
  chosenLayerId: LayerId | null,
): readonly LayerId[] | null {
  if (mode === "merged") {
    return null;
  }
  if (mode === "active") {
    return activeLayerId ? [activeLayerId] : [];
  }
  const chosen = chosenLayerId ?? activeLayerId;
  return chosen ? [chosen] : [];
}
