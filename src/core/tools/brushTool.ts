/**
 * Brush tool: paints the active stroke through the engine.
 *
 * The tool owns no pixels and no samples — the engine holds the stroke data and
 * the renderer draws it. Cancellation commits whatever was drawn, because the
 * pixels are real once they have been rasterized into the stroke buffer.
 *
 * The same behaviour drives the eraser, which is a brush whose strokes subtract
 * coverage: the pointer handling, the pressure policy and the sampling are
 * identical, so the two tools differ only in their definition and in `erases`.
 */

import { isPaintButton, type PointerSample } from "../../types/pointer";
import type { ToolContext, Tool } from "./types";
import { BRUSH_TOOL } from "./toolDefinitions";

export class BrushTool implements Tool {
  readonly definition: Tool["definition"];
  /** The brush outline overlay replaces the system cursor. */
  readonly cursor = "none";
  readonly erases: boolean;

  constructor(definition: Tool["definition"] = BRUSH_TOOL, erases = false) {
    this.definition = definition;
    this.erases = erases;
  }

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    if (!isPaintButton(sample.button)) {
      return;
    }
    context.beginStroke(sample);
  }

  onPointerMove(context: ToolContext, sample: PointerSample): void {
    if (!context.isStrokeActive()) {
      return;
    }
    context.extendStroke(sample);
  }

  onPointerUp(context: ToolContext, sample: PointerSample): void {
    if (context.isStrokeActive()) {
      // The release sample is where the stroke ends, so a stabilized path is
      // caught up on it rather than on the last position the pointer moved
      // through.
      context.finishStroke(sample);
    }
  }

  onPointerCancel(context: ToolContext, sample: PointerSample): void {
    if (context.isStrokeActive()) {
      // The ink is already on the canvas, so a cancelled gesture commits what
      // was drawn - as one history step - and ends on the last position the
      // pointer reported.
      context.finishStroke(sample);
    }
  }

  reset(context: ToolContext): void {
    if (context.isStrokeActive()) {
      context.finishStroke();
    }
  }
}
