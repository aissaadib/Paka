/**
 * Reference tool.
 *
 * One tool, three gestures, chosen by what the press grabs:
 *  - **a handle of the selected reference** - resize it from that corner, or
 *    turn it from the rotation handle;
 *  - **a visible reference** - select it and move it;
 *  - **anywhere else** - clear the reference selection.
 *
 * A dedicated tool is what keeps pointer ownership unambiguous: the brush
 * never has to guess whether a press is a paint or a reference grab, and a
 * reference is never hit-tested while the user is painting. The tool owns only
 * the gesture bookkeeping (whether a drag is in flight); the engine owns the
 * preview, the single history step and the cancel.
 */

import type { PointerSample } from "../../types/pointer";
import type { ToolDefinition } from "../../types/tool";
import type { ToolContext } from "./types";

export class ReferenceTool {
  readonly definition: ToolDefinition;
  /** The plain arrow: a reference is an object, not a brush. */
  readonly cursor = "default";

  private active = false;

  constructor(definition: ToolDefinition) {
    this.definition = definition;
  }

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    // Secondary buttons are not this tool's business (middle-drag pans).
    if (sample.button !== 0 || this.active) {
      return;
    }
    const handle = context.findReferenceHandleAt(sample.docX, sample.docY);
    this.active = context.beginReferenceGesture(sample, handle);
  }

  onPointerMove(context: ToolContext, sample: PointerSample): void {
    if (!this.active) {
      return;
    }
    context.updateReferenceGesture(sample);
  }

  onPointerUp(context: ToolContext, sample: PointerSample): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    // The release point is the final geometry: a drag that ends outside the
    // canvas still leaves the reference where the pointer actually is.
    context.updateReferenceGesture(sample);
    context.finishReferenceGesture();
  }

  onPointerCancel(context: ToolContext): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    context.cancelReferenceGesture();
  }

  reset(context: ToolContext): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    context.cancelReferenceGesture();
  }
}
