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
import type { Guide, GuideAxis, LayerId } from "../document/types";
import type { SelectionHandleId } from "../document/selectionHandles";
import type { ShapeOptions, ShapePoint } from "./shapeGeometry";

export interface ToolContext {
  readonly viewport: Viewport;
  getBrush(): BrushSettings;
  getActiveLayerId(): LayerId | null;
  /**
   * The options the next polygon or star is drawn with.
   *
   * Editor state, like `shapeFill`: the engine owns it and publishes it, and
   * a tool reads it once when its gesture starts, so a shape keeps the values
   * that were active when the user pressed. The line, the rectangle and the
   * ellipse ignore it.
   */
  getShapeOptions(): ShapeOptions;
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
  /**
   * The transform handle a press grabs, or `null` when it grabs none.
   *
   * The select tool asks this **first**: a press on a corner handle starts a
   * scale and a press on the rotation handle starts a rotation, so the handles
   * take precedence over the move gesture that a press inside the frame would
   * otherwise start.
   */
  findSelectionHandleAt(docX: number, docY: number): SelectionHandleId | null;
  /** Starts a marquee gesture; the selection itself is decided on release. */
  beginSelection(sample: PointerSample): void;
  /** Starts translating the current selection, dragging from inside it. */
  beginSelectionMove(sample: PointerSample): void;
  /**
   * Starts a scale or a rotation, from the handle the press grabbed.
   *
   * The transform is about the centre of the selection's frame at this moment,
   * and it moves the selected strokes' samples only - the brush, the colour and
   * the pressure are untouched.
   */
  beginSelectionTransform(sample: PointerSample, handle: SelectionHandleId): void;
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
  /**
   * The composition guide a press grabs, or `null` when it grabs none.
   *
   * The grab radius is screen-space, so the engine converts it with the live
   * zoom; a guide is therefore equally easy to grab at 2 % and at 6400 %.
   */
  findGuideAt(docX: number, docY: number): Guide | null;
  /**
   * Starts creating a guide at the press point.
   *
   * The axis is not decided yet: it comes from the direction the pointer
   * travels, which only the drag knows. The guide's position is the *press*
   * coordinate along that axis, so it does not follow the pointer.
   */
  beginGuideCreate(sample: PointerSample): void;
  /**
   * Puts the new guide on the canvas, on the axis the drag chose.
   *
   * A preview only: the guide reaches the document when `finishGuideGesture`
   * commits the gesture.
   */
  setGuideAxis(axis: GuideAxis): void;
  /** Starts moving an existing guide along its own axis. */
  beginGuideMove(guide: Guide): void;
  /** Moves the guide of a move gesture to follow the pointer. */
  moveGuideTo(sample: PointerSample): void;
  /**
   * Commits the guide gesture as one undoable step.
   *
   * A gesture that changed nothing - a click on empty canvas, or a drag that
   * ended where it started - commits nothing at all.
   */
  finishGuideGesture(): void;
  /** Aborts the guide gesture, restoring the document. */
  cancelGuideGesture(): void;
  /** Selects a guide, or clears the selection with `null`. */
  selectGuide(guideId: string | null): void;
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
  /**
   * True while the tool holds a gesture that a command could finish.
   *
   * Only the polyline does: its path stays open across clicks, so a command
   * (`Enter`) has to be able to end it. Every other tool answers `false`,
   * because their gesture ends with the pointer release.
   */
  canCommit?(): boolean;
  /**
   * Ends the gesture the tool is holding and **keeps** it.
   *
   * Called when the user moves on to another tool, so finished work is not
   * thrown away. A tool with nothing open does nothing.
   */
  commitGesture?(context: ToolContext): void;
  onPointerDown(context: ToolContext, sample: PointerSample): void;
  onPointerMove(context: ToolContext, sample: PointerSample): void;
  onPointerUp(context: ToolContext, sample: PointerSample): void;
  onPointerCancel(context: ToolContext, sample: PointerSample): void;
  /** Drops any in-progress gesture, e.g. when switching tools. */
  reset(context: ToolContext): void;
}

export type { ToolDefinition, ToolId };
