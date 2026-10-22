/**
 * Gradient tool.
 *
 * A drag defines the gradient: the press point is the start (linear) or centre
 * (radial), the current point is the end or outer radius. The engine inserts a
 * preview element on the active layer and updates it as the pointer moves; the
 * release records one undo step. A cancelled gesture removes the preview and
 * records nothing.
 *
 * The tool also **edits** a gradient that is already on the layer. A press is
 * resolved in this order:
 *
 *  1. on a handle of the selected gradient - drag that handle and the geometry
 *     follows, live, with one undo step on the release;
 *  2. on the geometry of a gradient on the active layer - select it, so its
 *     handles appear;
 *  3. anywhere else - draw a new gradient.
 *
 * The tool owns only the gesture. Geometry, colours, opacity and history live in
 * the engine, so the same rules apply to a reopened or redone gradient.
 */

import { isPaintButton, type PointerSample } from "../../types/pointer";
import type { Tool, ToolContext } from "./types";
import { GRADIENT_TOOL } from "./toolDefinitions";

export class GradientTool implements Tool {
  readonly definition = GRADIENT_TOOL;
  readonly cursor = "crosshair";

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    if (!isPaintButton(sample.button)) {
      return;
    }
    // A handle wins: it is an explicit "move this point of that gradient".
    if (context.beginGradientHandleDrag(sample)) {
      return;
    }
    // The geometry of a gradient on this layer selects it; its handles appear
    // so it can be adjusted from there.
    if (context.selectGradientAt(sample.docX, sample.docY)) {
      return;
    }
    context.beginGradient(sample);
  }

  onPointerMove(context: ToolContext, sample: PointerSample): void {
    if (context.isGradientHandleDragActive()) {
      context.updateGradientHandleDrag(sample);
      return;
    }
    if (context.isGradientActive()) {
      context.updateGradient(sample);
    }
  }

  onPointerUp(context: ToolContext, sample: PointerSample): void {
    if (context.isGradientHandleDragActive()) {
      // The release point is the final geometry, exactly as for a shape.
      context.updateGradientHandleDrag(sample);
      context.finishGradientHandleDrag();
      return;
    }
    if (context.isGradientActive()) {
      context.finishGradient(sample);
    }
  }

  onPointerCancel(context: ToolContext): void {
    if (context.isGradientHandleDragActive()) {
      context.cancelGradientHandleDrag();
      return;
    }
    if (context.isGradientActive()) {
      context.cancelGradient();
    }
  }

  reset(context: ToolContext): void {
    if (context.isGradientHandleDragActive()) {
      context.cancelGradientHandleDrag();
    }
    if (context.isGradientActive()) {
      context.cancelGradient();
    }
  }
}
