/**
 * Polyline tool: a path of straight segments the user places one vertex at a
 * time.
 *
 * The other shape tools are all *drags*: one press, one drag, one outline. A
 * polyline cannot be - the user places its vertices one click at a time, so
 * the path stays **open** across several pointer gestures. That is the whole
 * difference, and it is why this tool exists on its own rather than as
 * another `ShapeKind`:
 *
 *  - a **click** places a vertex where the pointer is;
 *  - a **drag** places a vertex at the release point, and the segment follows
 *    the pointer while the button is down;
 *  - a **rubber band** runs from the last vertex to the pointer, so the shape
 *    the user is about to get is on screen before they commit to it;
 *  - **`Shift`** constrains the segment to 45 degrees, exactly like the line
 *    tool, and the constrained point is the one that is placed;
 *  - **clicking the first vertex** closes the path and ends it, so a closed
 *    shape can be drawn without a separate command;
 *  - **`Enter`** ends the path and keeps it, and a **double click** does the
 *    same;
 *  - **`Escape`** throws the path away.
 *
 * The path is one ordinary stroke: it previews in the stroke buffer, it is
 * committed as a single undo step, it saves and reopens like any other stroke
 * and it exports like any other stroke. A path that is still open is *not* in
 * the document, so cancelling it costs nothing - unlike a brush stroke, whose
 * pixels are real once they have been rasterized.
 *
 * A path is **one colour**: the colour is resolved when the path *opens*, so
 * the first press decides it (a right-button press opens the path in the
 * secondary colour, exactly as it would for any other shape). The later
 * corners are the same stroke, so they cannot change its colour.
 */

import { isPaintButton, type PointerSample } from "../../types/pointer";
import type { ToolDefinition } from "../../types/tool";
import {
  MIN_POLYLINE_VERTICES,
  constrainTo45Degrees,
  outlineExtent,
  polylineOutline,
  type ShapePoint,
} from "./shapeGeometry";
import type { Tool, ToolContext } from "./types";

/** Below this document-space size a path is treated as a click, not a path. */
const MIN_SHAPE_EXTENT = 0.5;

/**
 * How close the pointer has to be to the first vertex to close the path, in
 * CSS pixels.
 *
 * The radius is screen space, so the first vertex is equally easy to grab at
 * 25 % and at 6400 % zoom. It is the same idea as the guides' grab radius.
 */
const CLOSE_GRAB_RADIUS_PX = 10;

/** How close two clicks have to be to count as a double click, in CSS pixels. */
const DOUBLE_CLICK_RADIUS_PX = 8;

/** How long two clicks may be apart to count as a double click, in milliseconds. */
const DOUBLE_CLICK_MS = 400;

export class PolylineTool implements Tool {
  readonly definition: ToolDefinition;
  readonly cursor = "crosshair";

  /**
   * The vertices placed so far, in document space.
   *
   * The path's geometry is this list: the last entry is the vertex the next
   * segment starts from.
   */
  private vertices: ShapePoint[] = [];

  /**
   * True while the path is open.
   *
   * An open path owns an in-flight stroke in the engine, so the tool knows it
   * has to keep updating the preview rather than starting a new shape.
   */
  private open = false;

  /**
   * Whether the path closes when it is finished.
   *
   * Read once, when the path opens, so a path keeps the setting it was started
   * with - the same rule the polygon and the star follow. Clicking the first
   * corner closes a path whatever this says, because that is a decision the
   * user makes about *this* path.
   */
  private closeOnFinish = false;

  /** The last press, so a second click in the same spot can end the path. */
  private lastPress: { x: number; y: number; timeStamp: number } | null = null;

  constructor(definition: ToolDefinition) {
    this.definition = definition;
  }

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    if (!isPaintButton(sample.button)) {
      return;
    }
    const point = { x: sample.docX, y: sample.docY };

    if (this.open) {
      // A double click ends the path where it is.
      if (this.isDoubleClick(context, sample)) {
        this.commit(context, false);
        return;
      }
      // Clicking the first vertex closes the path and ends it.
      if (this.grabsFirstVertex(context, point)) {
        this.commit(context, true);
        return;
      }
    } else {
      // The first press opens the path. The engine refuses a press outside the
      // paper, and then there is no path to open.
      context.beginShape(sample);
      if (!context.isStrokeActive()) {
        return;
      }
      this.open = true;
      this.vertices = [];
      this.closeOnFinish = context.getShapeOptions().closed;
    }

    this.lastPress = { x: point.x, y: point.y, timeStamp: sample.timeStamp };
    // The band runs from the last vertex to the pointer, so the shape the
    // user is about to place is on screen from the press onwards.
    context.setShapeOutline(this.outline(this.bandEnd(point, sample.modifiers.shift)));
  }

  onPointerMove(context: ToolContext, sample: PointerSample): void {
    if (!this.open) {
      return;
    }
    const point = { x: sample.docX, y: sample.docY };
    context.setShapeOutline(this.outline(this.bandEnd(point, sample.modifiers.shift)));
  }

  onPointerUp(context: ToolContext, sample: PointerSample): void {
    if (!this.open) {
      return;
    }
    // The release point is the vertex: a click releases where it pressed and a
    // drag releases at the end of the segment, and both place the same way.
    const point = { x: sample.docX, y: sample.docY };
    const end = this.bandEnd(point, sample.modifiers.shift);
    const last = this.vertices[this.vertices.length - 1];
    if (!last || last.x !== end.x || last.y !== end.y) {
      this.vertices.push(end);
    }
    context.setShapeOutline(this.outline(null));
  }

  onPointerCancel(context: ToolContext): void {
    // A cancelled pointer means the platform took the gesture away. The path
    // has not reached the layer yet, so throwing it away is exact.
    this.reset(context);
  }

  reset(context: ToolContext): void {
    this.vertices = [];
    this.lastPress = null;
    if (!this.open) {
      return;
    }
    this.open = false;
    context.cancelShape();
  }

  /**
   * Ends the path and keeps it.
   *
   * Called when the user moves on to another tool: the path is finished work,
   * not a half-finished preview, so it is committed rather than thrown away.
   */
  commitGesture(context: ToolContext): void {
    if (!this.open) {
      return;
    }
    this.commit(context, false);
  }

  /** True while a path is open, so a command can end it. */
  canCommit(): boolean {
    return this.open;
  }

  /**
   * Commits the path as one stroke.
   *
   * A path with fewer than two vertices, or one that never moved, is not a
   * shape: it is thrown away, so a stray click cannot leave a dot behind or
   * an undo step that appears to do nothing.
   */
  private commit(context: ToolContext, closed: boolean): void {
    const outline = polylineOutline(this.vertices, closed || this.closeOnFinish);
    const degenerate =
      outline.length < MIN_POLYLINE_VERTICES || outlineExtent(outline) < MIN_SHAPE_EXTENT;
    // An empty outline cancels the shape in the engine, which is exactly what
    // a degenerate path deserves.
    context.setShapeOutline(degenerate ? [] : outline);
    context.finishShape();
    this.vertices = [];
    this.lastPress = null;
    this.open = false;
  }

  /**
   * The outline the path currently has.
   *
   * `cursor` is the pointer's position while it is being dragged; `null` when
   * the pointer is resting on the last vertex. A path with fewer than two
   * points has no outline at all: one point is a click, not a shape.
   */
  private outline(cursor: ShapePoint | null): ShapePoint[] {
    const points = cursor === null ? this.vertices : [...this.vertices, cursor];
    const outline = polylineOutline(points, false);
    return outline.length >= MIN_POLYLINE_VERTICES ? outline : [];
  }

  /**
   * The point the band points at: the pointer's position, constrained to 45
   * degrees when `Shift` is held.
   *
   * The constraint is measured from the last vertex, so it is the *segment*
   * that is straightened, not the pointer's absolute direction. The band and
   * the placed vertex use the same point, so the shape the user watches is the
   * shape they get.
   */
  private bandEnd(point: ShapePoint, shift: boolean): ShapePoint {
    const anchor = this.vertices[this.vertices.length - 1];
    if (!shift || !anchor) {
      return point;
    }
    const { dx, dy } = constrainTo45Degrees(point.x - anchor.x, point.y - anchor.y);
    return { x: anchor.x + dx, y: anchor.y + dy };
  }

  /** True when the press lands on the first vertex, which closes the path. */
  private grabsFirstVertex(context: ToolContext, point: ShapePoint): boolean {
    const first = this.vertices[0];
    if (!first || this.vertices.length < MIN_POLYLINE_VERTICES) {
      return false;
    }
    const radius = CLOSE_GRAB_RADIUS_PX / Math.max(context.viewport.zoom, 0.0001);
    return Math.hypot(point.x - first.x, point.y - first.y) <= radius;
  }

  /** True when this press is the second click of a double click. */
  private isDoubleClick(context: ToolContext, sample: PointerSample): boolean {
    const last = this.lastPress;
    if (!last) {
      return false;
    }
    const elapsed = sample.timeStamp - last.timeStamp;
    if (elapsed < 0 || elapsed > DOUBLE_CLICK_MS) {
      return false;
    }
    const radius = DOUBLE_CLICK_RADIUS_PX / Math.max(context.viewport.zoom, 0.0001);
    return Math.hypot(sample.docX - last.x, sample.docY - last.y) <= radius;
  }
}
