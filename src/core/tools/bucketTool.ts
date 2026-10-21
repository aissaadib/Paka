/**
 * Bucket (flood) fill tool.
 *
 * A fill is a press, not a drag: the press scans the visible composite under the
 * pointer and applies one pixel patch to the active layer. The patch is on the
 * layer immediately so the user sees the real result; the release records it as
 * a single undo step. A cancelled press (lost capture, tool switch, pointer
 * cancel) removes the patch and records nothing.
 *
 * The tool owns only "did this press apply a fill?" - the region, pixels and
 * history live in the engine.
 */

import { isPaintButton, type PointerSample } from "../../types/pointer";
import type { Tool, ToolContext } from "./types";
import { BUCKET_TOOL } from "./toolDefinitions";

export class BucketTool implements Tool {
  readonly definition = BUCKET_TOOL;
  readonly cursor = "crosshair";

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    if (!isPaintButton(sample.button)) {
      return;
    }
    context.beginFill(sample);
  }

  onPointerMove(): void {
    // The region is decided by the press; dragging has no separate meaning.
  }

  onPointerUp(context: ToolContext): void {
    if (context.isFillActive()) {
      context.finishFill();
    }
  }

  onPointerCancel(context: ToolContext): void {
    if (context.isFillActive()) {
      context.cancelFill();
    }
  }

  reset(context: ToolContext): void {
    if (context.isFillActive()) {
      context.cancelFill();
    }
  }
}

