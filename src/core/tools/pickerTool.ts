/**
 * Colour picker tool: samples the composite under the pointer.
 *
 * This is the eyedropper. Unlike the brush, a press changes no pixels: the
 * engine reads the composited colour at the sample's document position and
 * makes it the brush colour. The tool therefore owns no gesture state - there
 * is nothing to finish, cancel or reset.
 *
 * The tool stays selected after a pick, consistent with the eraser: tools in
 * this app are chosen explicitly, and `B` returns to the brush. A pick is not an
 * edit, so it also must not switch tools behind the user's back.
 *
 * The sample is already in document space: the input pipeline applies the
 * viewport transform, so the tool never re-implements the screen-to-document
 * mapping.
 */

import type { PointerSample } from "../../types/pointer";
import type { Tool, ToolContext } from "./types";
import { PICKER_TOOL } from "./toolDefinitions";

export class PickerTool implements Tool {
  readonly definition = PICKER_TOOL;
  readonly cursor = "crosshair";

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    context.pickColor(sample);
  }

  onPointerMove(): void {
    // Picking happens on the press; dragging has no separate meaning.
  }

  onPointerUp(): void {
    // Nothing was started, so there is nothing to commit.
  }

  onPointerCancel(): void {
    // Nothing was started, so there is nothing to cancel.
  }

  reset(): void {
    // Stateless: switching away mid-press leaves nothing behind.
  }
}
