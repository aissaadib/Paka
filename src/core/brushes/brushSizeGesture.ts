/**
 * The quick brush-size gesture.
 *
 * A press with Ctrl and Alt held, followed by a vertical drag, changes the
 * brush size without drawing: dragging up grows the brush, dragging down
 * shrinks it. The gesture is a *view* gesture - it changes the size of the
 * next stroke, never a stroke that has already been made - and it is owned by
 * the engine, so the press never reaches a painting tool.
 *
 * The rules live here, free of DOM and engine state, so they can be tested
 * without a browser and reasoned about in one place.
 */

import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from "./defaults";
import { isPaintButton, type PointerModifiers, type PointerSample } from "../../types/pointer";
import type { ToolId } from "../../types/tool";
import { clamp } from "../../utils/math";

/**
 * Screen pixels of vertical travel that double (or halve) the brush size.
 *
 * The size range spans two orders of magnitude (1 to 512 document pixels), so
 * the drag is proportional rather than additive: one e-fold per 100 pixels of
 * travel is roughly one percent per pixel, which makes a 6 px brush reach
 * 20 px in a comfortable arm movement and still lets a 300 px brush be
 * trimmed by a pixel or two.
 */
export const BRUSH_SIZE_GESTURE_SCALE = 100;

/**
 * Travel, in screen pixels, that the gesture ignores.
 *
 * A press and release without movement is a click, not a resize, and a
 * hand that trembles by a pixel or two should not change the brush.
 */
export const BRUSH_SIZE_GESTURE_DEADZONE = 3;

/**
 * True when the modifiers ask for the quick resize.
 *
 * Ctrl and Alt together are not a Paka shortcut and not an operating-system
 * one on the platforms Paka runs on, which is what makes the gesture safe to
 * use: Cmd+Option belongs to macOS, and Alt+Tab to Windows.
 */
export function isBrushSizeGestureModifier(modifiers: PointerModifiers): boolean {
  return modifiers.ctrl === true && modifiers.alt === true;
}

/**
 * The brush size a vertical drag proposes.
 *
 * `deltaScreenY` is the pointer's vertical travel in CSS pixels, positive
 * downwards, so dragging up (a negative delta) grows the brush. The result is
 * relative to the size the gesture started from, which keeps the gesture
 * anchored: the ring does not jump when the drag begins.
 */
export function brushSizeFromDrag(startSize: number, deltaScreenY: number): number {
  if (!Number.isFinite(startSize) || !Number.isFinite(deltaScreenY)) {
    return clamp(startSize, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
  }
  if (Math.abs(deltaScreenY) <= BRUSH_SIZE_GESTURE_DEADZONE) {
    return startSize;
  }
  const factor = Math.exp(-deltaScreenY / BRUSH_SIZE_GESTURE_SCALE);
  return clamp(Math.round(startSize * factor), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
}

/** The tools whose brush the quick resize applies to. */
export function toolUsesBrushSize(toolId: ToolId): boolean {
  return toolId === "brush" || toolId === "eraser";
}

/** What the gesture needs to know about the surface it is asking for. */
export interface BrushSizeGestureContext {
  /** The tool that would otherwise receive the press. */
  readonly toolId: ToolId;
  /**
   * True when another surface owns the interaction.
   *
   * A text field with the keyboard focus means the user is in the middle of
   * typing, and the canvas must not take the gesture away from it. A modal
   * dialog covers the canvas, so the press never arrives at all; a slider or
   * a panel only owns the pointer while it is being pressed, and a press on
   * the canvas belongs to the canvas.
   */
  readonly blocked: boolean;
}

/**
 * True when a press starts the quick resize.
 *
 * The press must be a paint button, the modifiers must ask for the gesture,
 * the active tool must paint with the brush, and nothing else may own the
 * interaction.
 */
export function shouldStartBrushSizeGesture(
  sample: PointerSample,
  context: BrushSizeGestureContext,
): boolean {
  if (sample.phase !== "down") {
    return false;
  }
  if (!isPaintButton(sample.button)) {
    return false;
  }
  if (context.blocked) {
    return false;
  }
  if (!toolUsesBrushSize(context.toolId)) {
    return false;
  }
  return isBrushSizeGestureModifier(sample.modifiers);
}
