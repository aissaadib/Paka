/**
 * Bucket-fill command.
 *
 * The command carries the **committed patch** - colour, bounding box and mask -
 * not the seed point and tolerance. Redo therefore reinserts exactly the pixels
 * the user saw when they made the fill; it never reruns flood fill against
 * artwork that may have changed since. Undo removes the patch and the renderer
 * rebuilds the layer from the remaining ordered elements.
 */

import { createId } from "../../utils/id";
import type { FillPatchRecord } from "../document/types";
import type { StrokeCommandHost } from "./strokeCommand";
import type { Command } from "./types";

export function createFillCommand(
  patch: FillPatchRecord,
  index: number,
  host: StrokeCommandHost,
): Command {
  return {
    id: createId("cmd"),
    label: "Fill",
    apply(): void {
      host.insert(patch, index);
      host.refresh(patch.layerId);
    },
    revert(): void {
      host.remove(patch);
      host.refresh(patch.layerId);
    },
  };
}
