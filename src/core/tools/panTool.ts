/**
 * Pan tool: moves the viewport without touching the document.
 *
 * The engine also drives an instance of this tool for middle-button drags, so
 * panning works regardless of the active tool.
 */

import type { PointerSample } from "../../types/pointer";
import { panBy } from "../rendering/viewport";
import type { ToolContext, Tool } from "./types";
import { PAN_TOOL } from "./toolDefinitions";

export class PanTool implements Tool {
  readonly definition = PAN_TOOL;
  readonly cursor = "grab";

  private active = false;
  private lastX = 0;
  private lastY = 0;

  onPointerDown(_context: ToolContext, sample: PointerSample): void {
    this.active = true;
    this.lastX = sample.screenX;
    this.lastY = sample.screenY;
  }

  onPointerMove(context: ToolContext, sample: PointerSample): void {
    if (!this.active) {
      return;
    }
    const deltaX = sample.screenX - this.lastX;
    const deltaY = sample.screenY - this.lastY;
    this.lastX = sample.screenX;
    this.lastY = sample.screenY;
    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    context.setViewport(panBy(context.viewport, deltaX, deltaY));
  }

  onPointerUp(): void {
    this.active = false;
  }

  onPointerCancel(): void {
    this.active = false;
  }

  reset(): void {
    this.active = false;
  }
}
