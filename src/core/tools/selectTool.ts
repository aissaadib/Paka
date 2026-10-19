/**
 * Select tool.
 *
 * One tool, two gestures, chosen by where the press lands:
 *  - **inside** the current selection - translate the selected strokes;
 *  - **anywhere else** - drag a marquee, which on release becomes the new
 *    selection (a press that never moved is a zero-size marquee, i.e. a click,
 *    which selects the strokes under the pointer or clears the selection).
 *
 * The tool owns only the gesture bookkeeping (`active`, so a stray move or
 * cancel without a press is ignored). Everything else - what stays selected,
 * what a translation means, whether it is undoable - belongs to the engine,
 * which owns the document and history. The tool never touches strokes.
 */

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
    if (context.isInsideSelection(sample.docX, sample.docY)) {
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
