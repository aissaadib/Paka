/**
 * Gradient command.
 *
 * The command carries the committed `GradientRecord` - geometry, stops and
 * opacity - and its element index. Redo re-inserts that record, so the renderer
 * rebuilds the same pixels from the document instead of replaying a bitmap.
 * Undo removes it and refreshes the layer.
 */

import { createId } from "../../utils/id";
import type { GradientRecord } from "../document/types";
import type { StrokeCommandHost } from "./strokeCommand";
import type { Command } from "./types";

export function createGradientCommand(
  gradient: GradientRecord,
  index: number,
  host: StrokeCommandHost,
): Command {
  return {
    id: createId("cmd"),
    label: "Gradient",
    apply(): void {
      host.insert(gradient, index);
      host.refresh(gradient.layerId);
    },
    revert(): void {
      host.remove(gradient);
      host.refresh(gradient.layerId);
    },
  };
}
