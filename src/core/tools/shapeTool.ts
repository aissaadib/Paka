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
 * The shape reads its options (the side count, the inner ratio and the
 * rotation) once, when the gesture starts, so it keeps the values that were
 * active when the user pressed. The options come from the one model
 * (`shapeOptions.ts`), and they are editor state: changing one is not an
 * edit.
 *
 * A release that cancels, a tool switch or a lost capture *discards* the
 * preview rather than committing it: unlike a brush stroke, nothing has been
 * placed on the layer yet, so discarding is exact and loses no work. A drag
 * that never moved (a bare click) is discarded too, so a stray click cannot
 * leave a dot behind.
 */

import { isPaintButton, type PointerSample } from "../../types/pointer";
import type { ToolDefinition } from "../../types/tool";
import type { ShapeGeometry } from "../document/types";
import {
  DEFAULT_SHAPE_OPTIONS,
  outlineExtent,
  shapeGeometryOutline,
  shapeSpecFromDrag,
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
    context.setShapeSpec(this.specFor(this.anchor, sample));
  }

  onPointerUp(context: ToolContext, sample: PointerSample): void {
    const anchor = this.anchor;
    if (!anchor) {
      return;
    }
    this.anchor = null;

    // The release point can differ from the last move, so the committed shape
    // is recomputed here rather than trusting whatever the buffer last drew.
    const geometry = this.specFor(anchor, sample);
    if (outlineExtent(shapeGeometryOutline(geometry)) < MIN_SHAPE_EXTENT) {
      context.cancelShape();
      return;
    }
    context.setShapeSpec(geometry);
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

  private specFor(anchor: ShapePoint, sample: PointerSample): ShapeGeometry {
    const drag: ShapeDrag = {
      anchor,
      current: { x: sample.docX, y: sample.docY },
      shift: sample.modifiers.shift,
      alt: sample.modifiers.alt,
    };
    return shapeSpecFromDrag(this.kind, drag, this.options);
  }
}
