/**
 * What a brush can be asked to do.
 *
 * Two lists, and the gap between them is the point of this module:
 *
 *  - the fields the engine honours, with the range it clamps them to;
 *  - the properties a brush is commonly expected to have that the engine does
 *    **not** implement.
 *
 * A control may only be offered for a field in the first list. A switch for a
 * property the engine ignores is worse than no switch at all: it looks like it
 * works, it does not, and the user has no way to tell. The missing properties
 * are therefore listed here, with the reason and the work that would close the
 * gap, rather than being quietly left out.
 *
 * The ranges are read out of `normalizeBrush`, the function the engine clamps
 * a brush with, so they cannot drift away from what the engine does.
 */

import { BRUSH_NUMBER_FIELDS, DEFAULT_BRUSH, normalizeBrush } from "./defaults";

/** The numeric fields of a brush, as the engine lists them. */
export type BrushNumberField = (typeof BRUSH_NUMBER_FIELDS)[number];

/**
 * The range the engine clamps one brush field to.
 *
 * The probe values are far outside every range, so the clamp answers with the
 * range's own ends. A change to `normalizeBrush` therefore changes these
 * numbers with it.
 */
export function brushFieldBounds(field: BrushNumberField): { min: number; max: number } {
  const high = normalizeBrush({
    ...DEFAULT_BRUSH,
    [field]: Number.MAX_VALUE,
  })[field] as number;
  const low = normalizeBrush({
    ...DEFAULT_BRUSH,
    [field]: -Number.MAX_VALUE,
  })[field] as number;
  return { min: low, max: high };
}

/**
 * The properties a brush is commonly expected to have that Paka does not
 * implement.
 *
 * They are listed rather than hidden so the gap is visible and owned: a
 * control for one of these would be a switch the engine ignores. Closing a
 * gap means teaching the engine the property - the brush-engine work, agents
 * 11 to 14 - and then adding it to the options bar.
 */
export const UNIMPLEMENTED_BRUSH_PROPERTIES: readonly {
  /** The name the property has in other paint programs. */
  readonly name: string;
  /** Why the engine does not have it. */
  readonly reason: string;
  /** The work that would close the gap. */
  readonly owner: string;
}[] = [
  {
    name: "flow",
    reason:
      "Paka applies a stroke's opacity once, when its finished coverage composites, so a stroke never darkens where it overlaps itself. A flow is the per-dab build-up that would darken a slow stroke, which needs a per-dab alpha the coverage union cannot carry.",
    owner:
      "the brush engine (agents 11-14): the dab union would have to keep a per-dab alpha instead of a maximum",
  },
  {
    name: "taper",
    reason:
      "A stroke always starts and ends at full width. A taper needs a width multiplier along the path, on the segment path and in the dab plan alike.",
    owner:
      "the brush engine (agents 11-14): a per-dab radius multiplier, and a width ramp on the segment path",
  },
  {
    name: "cap and join styles",
    reason:
      "The segment path is round-capped and round-joined, and the stamp path draws round dabs. A flat cap is different geometry, not a setting.",
    owner: "the brush engine (agents 11-14)",
  },
  {
    name: "size jitter and scatter",
    reason:
      "Paka's rasterization is deterministic by rule: the same samples always produce the same pixels, so a random jitter would have to be derived from a hash of the sample rather than from a random number.",
    owner: "the brush engine (agents 11-14)",
  },
];
