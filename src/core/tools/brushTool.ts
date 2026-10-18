/**
 * Brush tool: paints the active stroke through the engine.
 *
 * The tool owns no pixels and no samples — the engine holds the stroke data and
 * the renderer draws it. Cancellation commits whatever was drawn, because the
 * pixels are real once they have been rasterized into the stroke buffer.
 */

import type { PointerSample } from "../../types/pointer";
import type { ToolContext, Tool } from "./types";
import { BRUSH_TOOL } from "./toolDefinitions";

export class BrushTool implements Tool {
  readonly definition = BRUSH_TOOL;
  /** The brush outline overlay replaces the system cursor. */
  readonly cursor = "none";

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    if (sample.button !== 0) {
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

  onPointerUp(context: ToolContext): void {
    if (context.isStrokeActive()) {
      context.finishStroke();
    }
  }

  onPointerCancel(context: ToolContext): void {
    if (context.isStrokeActive()) {
      context.finishStroke();
    }
  }

  reset(context: ToolContext): void {
    if (context.isStrokeActive()) {
      context.finishStroke();
    }
  }
}
