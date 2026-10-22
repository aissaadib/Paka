/**
 * Shape tool: draws a line, rectangle, ellipse, polygon or star outline with
 * the brush.
 *
 * The gesture is a drag from an anchor to the current point. The tool keeps the
 * anchor, recomputes the whole outline on every move (so Shift/Alt can change
 * the shape mid-drag), and hands it to the engine, which previews it in the
 * stroke buffer. Nothing reaches the layer until the pointer is released; then
 * the outline is committed as a single stroke, which means one undo step, a
 * normal entry in the project file, and pixels that re-rasterize identically
 * after undo, reopen or resize.
 *
 * The polygon and the star read their options (the side count, the inner ratio
 * and the rotation) once, when the gesture starts, so the shape keeps the
 * values that were active when the user pressed.
 *
 * A release that cancels, a tool switch or a lost capture *discards* the
 * preview rather than committing it: unlike a brush stroke, nothing has been
 * placed on the layer yet, so discarding is exact and loses no work. A drag
 * that never moved (a bare click) is discarded too, so a stray click cannot
 * leave a dot behind.
 */

import { isPaintButton, type PointerSample } from "../../types/pointer";
import type { ToolDefinition } from "../../types/tool";
import {
  DEFAULT_SHAPE_OPTIONS,
  outlineExtent,
  shapeOutline,
  type ShapeDrag,
  type ShapeKind,
  type ShapeOptions,
  type ShapePoint,
} from "./shapeGeometry";
// The shape tools bring their own options: the module registers them in the
// shared per-tool registry when it is loaded, so the options bar shows the
// controls the one model describes without the options bar knowing about them.
import "./shapeToolOptions";
import type { Tool, ToolContext } from "./types";

/** Below this document-space size a shape is treated as a click, not a shape. */
const MIN_SHAPE_EXTENT = 0.5;

export class ShapeTool implements Tool {
  readonly definition: ToolDefinition;
  readonly cursor = "crosshair";

  private readonly kind: ShapeKind;
  private anchor: ShapePoint | null = null;
  /**
   * The options this gesture started with.
   *
   * Read once, on press, and held for the whole drag: a polygon or a star
   * keeps the side count, the inner ratio and the rotation that were active
   * when the user pressed, even if the toolbar changes them mid-drag.
   */
  private options: ShapeOptions = DEFAULT_SHAPE_OPTIONS;

  constructor(kind: ShapeKind, definition: ToolDefinition) {
    this.kind = kind;
    this.definition = definition;
  }

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    if (!isPaintButton(sample.button)) {
      return;
    }
    this.anchor = { x: sample.docX, y: sample.docY };
    this.options = context.getShapeOptions();
    // No outline yet: an unmoved drag should show nothing, not a dot.
    context.beginShape(sample);
  }

  onPointerMove(context: ToolContext, sample: PointerSample): void {
    if (!this.anchor) {
      return;
    }
    context.setShapeOutline(this.outlineFor(this.anchor, sample));
  }

  onPointerUp(context: ToolContext, sample: PointerSample): void {
    const anchor = this.anchor;
    if (!anchor) {
      return;
    }
    this.anchor = null;

    // The release point can differ from the last move, so the committed shape
    // is recomputed here rather than trusting whatever the buffer last drew.
    const outline = this.outlineFor(anchor, sample);
    if (outlineExtent(outline) < MIN_SHAPE_EXTENT) {
      context.cancelShape();
      return;
    }
    context.setShapeOutline(outline);
    context.finishShape();
  }

  onPointerCancel(context: ToolContext): void {
    if (!this.anchor) {
      return;
    }
    this.anchor = null;
    context.cancelShape();
  }

  reset(context: ToolContext): void {
    if (!this.anchor) {
      return;
    }
    this.anchor = null;
    context.cancelShape();
  }

  private outlineFor(anchor: ShapePoint, sample: PointerSample): ShapePoint[] {
    const drag: ShapeDrag = {
      anchor,
      current: { x: sample.docX, y: sample.docY },
      shift: sample.modifiers.shift,
      alt: sample.modifiers.alt,
    };
    return shapeOutline(this.kind, drag, this.options);
  }
}
