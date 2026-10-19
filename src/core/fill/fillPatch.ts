/**
 * Fill-patch records.
 *
 * A bucket fill is stored as the pixels it committed - colour plus a coverage
 * mask - not as the algorithm that found them. Creating a patch is the only
 * bridge between the scanner (`core/fill/floodFill`) and the document model, so
 * a redo or a reopened project can replay the patch without touching the flood
 * code again.
 */

import { createId } from "../../utils/id";
import type { FillPatchRecord, LayerId } from "../document/types";
import type { FloodFillRegion } from "./floodFill";

/** Builds the document element for a successful flood region. */
export function createFillPatch(
  layerId: LayerId,
  color: string,
  region: FloodFillRegion,
): FillPatchRecord {
  return {
    id: createId("fill"),
    layerId,
    kind: "fill",
    color,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    mask: region.mask,
  };
}

/** Deep copy for layer duplication; the mask is copied, not shared. */
export function cloneFillPatch(
  patch: FillPatchRecord,
  layerId: LayerId = patch.layerId,
): FillPatchRecord {
  return {
    id: createId("fill"),
    layerId,
    kind: "fill",
    color: patch.color,
    x: patch.x,
    y: patch.y,
    width: patch.width,
    height: patch.height,
    mask: patch.mask.slice(),
  };
}

/** Number of pixels the patch can affect (its bounding box). */
export function fillPatchPixelCount(patch: FillPatchRecord): number {
  return patch.width * patch.height;
}
