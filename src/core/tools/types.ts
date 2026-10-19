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
   * True when a document point lies inside the current selection's rectangle.
   *
   * The select tool asks this on press to choose between two gestures: dragging
   * inside the selection translates the selected strokes, dragging anywhere else
   * starts a new marquee. A point outside an empty or absent selection is always
   * `false`, so "no selection" needs no separate query.
   */
  isInsideSelection(docX: number, docY: number): boolean;
  /** Starts a marquee gesture; the selection itself is decided on release. */
  beginSelection(sample: PointerSample): void;
  /** Starts translating the current selection, dragging from inside it. */
  beginSelectionMove(sample: PointerSample): void;
  /**
   * Applies the active selection gesture to a sample: a marquee rubber-band
   * while selecting, or a live translation while moving.
   */
  updateSelection(sample: PointerSample): void;
  /**
   * Commits the active gesture - the strokes the marquee enclosed become the
   * selection, or a translation becomes one undoable history step. A gesture
   * that changed nothing is dropped rather than recorded.
   */
  finishSelection(): void;
  /** Aborts the active gesture, restoring any live translation. */
  cancelSelection(): void;
  /** Drops the selection and its overlay. */
  clearSelection(): void;
  /**
   * Samples the *composited* document at the sample's document position and
   * makes it the brush colour.
   *
   * This is not an edit: no pixels change, no stroke is recorded and nothing
   * enters history. The sample is already in document space because the input
   * pipeline applies the viewport transform.
   */
  pickColor(sample: PointerSample): void;
  /**
   * Flood-fills the region under the sample on the active layer.
   *
   * The region is sampled from the visible composite, the result is written to
   * the active layer, and the patch is previewed immediately. Returns whether a
   * patch was applied; a no-op, an out-of-bounds press or an oversized document
   * leaves the document unchanged.
   */
  beginFill(sample: PointerSample): boolean;
  /** Commits the applied fill as one undoable step. */
  finishFill(): void;
  /** Removes an uncommitted fill, leaving the document untouched. */
  cancelFill(): void;
  /** True while a fill is applied but not yet recorded in history. */
  isFillActive(): boolean;
  /**
   * Starts a gradient gesture at the sample: the press point is the axis start
   * (linear) or centre (radial). The gradient is previewed on the active layer
   * immediately but is not yet an undo step.
   *
   * Returns whether a gradient was started; an out-of-bounds press, an active
   * gesture or a missing active layer leaves the document unchanged.
   */
  beginGradient(sample: PointerSample): boolean;
  /** Moves the in-progress gradient's free end, previewing the result. */
  updateGradient(sample: PointerSample): void;
  /** Commits the in-progress gradient as one undoable step. */
  finishGradient(sample: PointerSample): void;
  /** Removes an uncommitted gradient, leaving the document untouched. */
  cancelGradient(): void;
  /** True while a gradient is previewed but not yet recorded in history. */
  isGradientActive(): boolean;
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
