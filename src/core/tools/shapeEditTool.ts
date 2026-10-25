/**
 * Shape edit tool.
 *
 * One tool, three gestures, chosen by what the press grabs:
 *  - **a handle of the selected shape** - resize it from that corner, or turn
 *    it from the rotation handle;
 *  - **a shape** - select it and move it;
 *  - **anywhere else** - clear the shape selection.
 *
 * A dedicated tool is what keeps pointer ownership unambiguous: the brush
 * never has to guess whether a press is a paint or a shape grab, and a shape
 * is never hit-tested while the user is painting. This mirrors the reference
 * tool exactly. The tool owns only the gesture bookkeeping (whether a drag is
 * in flight); the engine owns the preview, the single history step and the
 * cancel.
 *
 * The marquee select tool stays stroke-only. Native shapes are edited here,
 * and legacy baked shapes remain selectable with the marquee - they have no
 * primitive to reconstruct, so turning them into shape objects would be a
 * guess.
 */

import type { PointerSample } from "../../types/pointer";
import type { ToolDefinition } from "../../types/tool";
import type { ToolContext } from "./types";

export class ShapeEditTool {
  readonly definition: ToolDefinition;
  /** The plain arrow: a shape is an object, not a brush. */
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
    const handle = context.findShapeHandleAt(sample.docX, sample.docY);
    this.active = context.beginShapeGesture(sample, handle);
  }

  onPointerMove(context: ToolContext, sample: PointerSample): void {
    if (!this.active) {
      return;
    }
    context.updateShapeGesture(sample);
  }

  onPointerUp(context: ToolContext, sample: PointerSample): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    // The release point is the final geometry: a drag that ends outside the
    // canvas still leaves the shape where the pointer actually is.
    context.updateShapeGesture(sample);
    context.finishShapeGesture();
  }

  onPointerCancel(context: ToolContext): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    context.cancelShapeGesture();
  }

  reset(context: ToolContext): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    context.cancelShapeGesture();
  }
}
