/**
 * Select tool.
 *
 * One tool, four gestures, chosen by where the press lands:
 *  - **on a handle** - scale the selection by a corner handle, or rotate it by
 *    the handle above the frame;
 *  - **inside** the current selection - translate the selected strokes;
 *  - **anywhere else** - drag a marquee, which on release becomes the new
 *    selection (a press that never moved is a zero-size marquee, i.e. a click,
 *    which selects the strokes under the pointer or clears the selection).
 *
 * The handles come first: they sit on the frame's corners, which are inside
 * the frame, so a press on a corner would otherwise start a move. Grabbing a
 * handle is an explicit "transform this", and it wins.
 *
 * The **mode** decides what a drag that is not on a handle does. A plain
 * `replace` marquee is a move when the press lands inside the selection, as
 * above. In every other mode - `add`, `subtract` or `intersect`, whether the
 * toolbar asked for it or a modifier key did - the drag is a marquee that
 * combines with the selection, wherever it lands. That is what lets a stroke
 * *inside* the current frame be added, subtracted or intersected: the mode
 * decides, and the frame does not get in the way.
 *
 * The tool owns only the gesture bookkeeping (`active`, so a stray move or
 * cancel without a press is ignored). Everything else - what stays selected,
 * what a translation means, whether it is undoable - belongs to the engine,
 * which owns the document and history. The tool never touches strokes.
 */

import { resolveSelectionMode } from "../document/selectionModes";
import type { PointerSample } from "../../types/pointer";
import type { ToolContext } from "./types";
import type { ToolDefinition } from "../../types/tool";

export class SelectTool {
  readonly definition: ToolDefinition;
  /** A pointer arrow: what the user expects when pointing at things to pick. */
  readonly cursor = "default";

  private active = false;

  constructor(definition: ToolDefinition) {
    this.definition = definition;
  }

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    // Secondary buttons are not this tool's business (middle-drag already pans).
    if (sample.button !== 0 || this.active) {
      return;
    }
    this.active = true;
    // The handles win over the move: they are the transform's affordance.
    const handle = context.findSelectionHandleAt(sample.docX, sample.docY);
    if (handle !== null) {
      context.beginSelectionTransform(sample, handle);
      return;
    }
    const mode = resolveSelectionMode(context.getSelectionMode(), sample.modifiers);
    if (mode === "replace" && context.isInsideSelection(sample.docX, sample.docY)) {
      context.beginSelectionMove(sample);
    } else {
      context.beginSelection(sample);
    }
  }

  onPointerMove(context: ToolContext, sample: PointerSample): void {
    if (this.active) {
      context.updateSelection(sample);
    }
  }

  onPointerUp(context: ToolContext, sample: PointerSample): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    // The release point is the final geometry, exactly as for a shape: letting
    // go outside the canvas still selects up to where the pointer actually is.
    context.updateSelection(sample);
    context.finishSelection();
  }

  onPointerCancel(context: ToolContext): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    context.cancelSelection();
  }

  reset(context: ToolContext): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    context.cancelSelection();
  }
}
