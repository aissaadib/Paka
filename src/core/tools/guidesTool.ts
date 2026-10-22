/**
 * Guides tool.
 *
 * One tool, two gestures, chosen by where the press lands:
 *  - **on an existing guide** - drag it along its axis;
 *  - **anywhere else** - drag out a new one.
 *
 * A press that never moves is a click: on a guide it selects it, on empty
 * canvas it clears the selection.
 *
 * The axis of a new guide comes from the dominant direction of the drag, and
 * its position is the *press* coordinate along that axis, so the guide marks
 * where the user started rather than where they let go. The axis of an
 * existing guide never changes: dragging it moves it along the axis it was
 * created on.
 *
 * The tool owns only the gesture bookkeeping (which gesture is in flight and
 * where it started). What a guide is, where it lands, whether it is undoable
 * and what it looks like belong to the engine and the renderer.
 *
 * **A drag shorter than 3 CSS px creates nothing at all.** The axis of a new
 * guide comes from the direction the pointer travels, so the drag has to
 * travel far enough for that direction to mean something; until it does, no
 * guide exists and a press-and-release is a click.
 */

import type { PointerSample } from "../../types/pointer";
import type { Guide } from "../document/types";
import { guideAxisFromDrag } from "../document/guides";
import type { ToolContext } from "./types";
import type { ToolDefinition } from "../../types/tool";

/**
 * How far the pointer must travel, in CSS pixels, before the drag decides
 * which axis the new guide takes.
 *
 * Without it, the first pixel of jitter would fix the axis for the whole
 * drag. The threshold is in **CSS pixels**, so it is the same distance on
 * screen at every zoom; a shorter drag creates no guide at all.
 */
const AXIS_DECISION_THRESHOLD_PX = 3;

export class GuidesTool {
  readonly definition: ToolDefinition;
  /** A crosshair: the user is placing a marker, not painting. */
  readonly cursor = "crosshair";

  private active = false;
  /** The gesture in flight: a new guide, or an existing one being moved. */
  private mode: "create" | "move" | null = null;
  /**
   * True when the gesture's axis is already fixed.
   *
   * A guide pulled out of a ruler knows its axis from the start, so the drag
   * moves the guide along it instead of choosing an axis.
   */
  private axisFixed = false;
  /** Where the press landed, in document space. */
  private anchorX = 0;
  private anchorY = 0;

  constructor(definition: ToolDefinition) {
    this.definition = definition;
  }

  onPointerDown(context: ToolContext, sample: PointerSample): void {
    // Secondary buttons are not this tool's business (middle-drag already pans).
    if (sample.button !== 0 || this.active) {
      return;
    }
    this.active = true;
    this.anchorX = sample.docX;
    this.anchorY = sample.docY;

    // A press on a ruler strip pulls a guide out of the ruler: the strip says
    // which way the guide runs, and the drag carries it along that axis.
    const rulerAxis = context.rulerAxisAt(sample.screenX, sample.screenY);
    if (rulerAxis !== null) {
      this.mode = "create";
      this.axisFixed = true;
      context.selectGuide(null);
      context.beginGuideCreate(sample, rulerAxis);
      return;
    }

    const grabbed: Guide | null = context.findGuideAt(sample.docX, sample.docY);
    if (grabbed) {
      this.mode = "move";
      context.selectGuide(grabbed.id);
      context.beginGuideMove(grabbed);
      return;
    }

    this.mode = "create";
    // A press on empty canvas clears the selection: the guide the user is
    // about to place is the one they are working with.
    context.selectGuide(null);
    context.beginGuideCreate(sample);
  }

  onPointerMove(context: ToolContext, sample: PointerSample): void {
    if (!this.active) {
      return;
    }
    if (this.mode === "move") {
      context.moveGuideTo(sample);
      return;
    }
    if (this.mode !== "create") {
      return;
    }
    if (this.axisFixed) {
      // The ruler already chose the axis: the drag moves the guide along it.
      context.moveGuideTo(sample);
      return;
    }

    const dx = sample.docX - this.anchorX;
    const dy = sample.docY - this.anchorY;
    // The drag has to travel far enough to mean something before it decides
    // the axis.
    const threshold = AXIS_DECISION_THRESHOLD_PX / context.viewport.zoom;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
      return;
    }
    context.setGuideAxis(guideAxisFromDrag(dx, dy));
  }

  onPointerUp(context: ToolContext, sample: PointerSample): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    const mode = this.mode;
    this.mode = null;
    this.axisFixed = false;
    if (mode === "move") {
      // The release point is the final geometry: a drag that ends outside the
      // canvas still leaves the guide where the pointer actually is.
      context.moveGuideTo(sample);
    }
    context.finishGuideGesture();
  }

  onPointerCancel(context: ToolContext): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.mode = null;
    this.axisFixed = false;
    context.cancelGuideGesture();
  }

  reset(context: ToolContext): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.mode = null;
    this.axisFixed = false;
    context.cancelGuideGesture();
  }
}
