/**
 * Tool interface.
 *
 * Tools are stateless with respect to the document: they receive normalized
 * pointer samples and drive the engine through `ToolContext`. Adding a tool
 * means implementing this interface and registering it, never touching the
 * input pipeline or the renderer.
 */

import type { BrushSettings } from "../../types/brush";
import type { PointerSample } from "../../types/pointer";
import type { ToolDefinition, ToolId } from "../../types/tool";
import type { Viewport } from "../../types/viewport";
import type { LayerId } from "../document/types";

export interface ToolContext {
  readonly viewport: Viewport;
  getBrush(): BrushSettings;
  getActiveLayerId(): LayerId | null;
  setViewport(viewport: Viewport): void;
  requestRender(): void;
  /** Starts a stroke on the active layer with the current brush. */
  beginStroke(sample: PointerSample): void;
  /** Appends a sample to the active stroke. */
  extendStroke(sample: PointerSample): void;
  /** Commits the active stroke to its layer and to history. */
  finishStroke(): void;
  /** Discards the active stroke without touching the layer. */
  cancelStroke(): void;
  isStrokeActive(): boolean;
}

export interface Tool {
  readonly definition: ToolDefinition;
  /** CSS cursor to use while this tool is active. */
  readonly cursor: string;
  onPointerDown(context: ToolContext, sample: PointerSample): void;
  onPointerMove(context: ToolContext, sample: PointerSample): void;
  onPointerUp(context: ToolContext, sample: PointerSample): void;
  onPointerCancel(context: ToolContext, sample: PointerSample): void;
  /** Drops any in-progress gesture, e.g. when switching tools. */
  reset(context: ToolContext): void;
}

export type { ToolDefinition, ToolId };
