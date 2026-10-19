/**
 * Gradient tool.
 *
 * A drag defines the gradient: the press point is the start (linear) or centre
 * (radial), the current point is the end or outer radius. The engine inserts a
 * preview element on the active layer and updates it as the pointer moves; the
 * release records one undo step. A cancelled gesture removes the preview and
 * records nothing.
 *
 * The tool owns only the gesture. Geometry, colours, opacity and history live in
 * the engine, so the same rules apply to a reopened or redone gradient.
 */

import type { PointerSample } from "../../types/pointer";
import type { Tool, ToolContext } from "./types";
import { GRADIENT_TOOL } from "./toolDefinitions";

export class GradientTool implements Tool {
  readonly definition = GRADIENT_TOOL;
  readonly cursor = "crosshair";

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    if (sample.button !== 0) {
      return;
    }
    context.beginGradient(sample);
  }

  onPointerMove(context: ToolContext, sample: PointerSample): void {
    if (context.isGradientActive()) {
      context.updateGradient(sample);
    }
  }

  onPointerUp(context: ToolContext, sample: PointerSample): void {
    if (context.isGradientActive()) {
      context.finishGradient(sample);
    }
  }

  onPointerCancel(context: ToolContext): void {
    if (context.isGradientActive()) {
      context.cancelGradient();
    }
  }

  reset(context: ToolContext): void {
    if (context.isGradientActive()) {
      context.cancelGradient();
    }
  }
}
