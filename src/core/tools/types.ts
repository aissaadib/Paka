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
import type { ShapePoint } from "./shapeGeometry";

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
  /**
   * Starts a shape gesture on the active layer with the current brush.
   *
   * Like `beginStroke`, but the samples are not a path the pointer traces: the
   * tool computes the whole outline and replaces it with `setShapeOutline`. The
   * shape is previewed in the stroke buffer and reaches the layer only when
   * `finishShape` is called.
   */
  beginShape(sample: PointerSample): void;
  /**
   * Replaces the in-progress shape's outline with the given document-space
   * points. A preview only: nothing is committed until `finishShape`.
   */
  setShapeOutline(points: readonly ShapePoint[]): void;
  /** Commits the in-progress shape as one undoable stroke. */
  finishShape(): void;
  /** Discards the in-progress shape without touching the layer. */
  cancelShape(): void;
  /** Commits the active stroke to its layer and to history. */
  finishStroke(): void;
  /** Discards the active stroke without touching the layer. */
  cancelStroke(): void;
  isStrokeActive(): boolean;
  /**
   * Samples the *composited* document at the sample's document position and
   * makes it the brush colour.
   *
   * This is not an edit: no pixels change, no stroke is recorded and nothing
   * enters history. The sample is already in document space because the input
   * pipeline applies the viewport transform.
   */
  pickColor(sample: PointerSample): void;
}

export interface Tool {
  readonly definition: ToolDefinition;
  /** CSS cursor to use while this tool is active. */
  readonly cursor: string;
  /**
   * True when the strokes this tool captures *remove* coverage from the layer
   * instead of adding it. The engine stamps each stroke with it, so a stroke
   * stays self-describing: reopened files and re-rasterized layers know whether
   * to paint or to subtract.
   */
  readonly erases?: boolean;
  onPointerDown(context: ToolContext, sample: PointerSample): void;
  onPointerMove(context: ToolContext, sample: PointerSample): void;
  onPointerUp(context: ToolContext, sample: PointerSample): void;
  onPointerCancel(context: ToolContext, sample: PointerSample): void;
  /** Drops any in-progress gesture, e.g. when switching tools. */
  reset(context: ToolContext): void;
}

export type { ToolDefinition, ToolId };
