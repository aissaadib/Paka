/**
 * The quick brush-size gesture.
 *
 * A press with Ctrl and Alt held, followed by a vertical drag, changes the
 * brush size without drawing: dragging up grows the brush, dragging down
 * shrinks it. The gesture is a *view* gesture - it changes the size of the
 * next stroke, never a stroke that has already been made - and it is owned by
 * the engine, so the press never reaches a painting tool.
 *
 * Changing the brush size is **not an edit**. The size is a drawing setting:
 * it adds no history step, dirties nothing and never reaches a project file.
 * The only thing this module produces is a size for the engine to write to
 * the brush, and the gesture's own "undo" is its cancel rule - the size
 * goes back to the one the gesture started from, which is a setting being
 * restored, not a command being undone.
 *
 * The rules live here, free of DOM and engine state, so they can be tested
 * without a browser and reasoned about in one place. The gesture is a small
 * state machine - idle, armed, dragging - and the transition is a pure
 * function, so the whole life of a gesture can be played through in a test
 * without a canvas.
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
 *
 * The one caveat is Windows' AltGr, which reports itself as Ctrl+Alt. A
 * stray AltGr keystroke therefore arms the gesture, and the deadzone is what
 * keeps it harmless: nothing is resized until the pointer travels.
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
 *
 * A travel inside the deadzone proposes the size the gesture started from,
 * and a size outside the brush's range is clamped to it.
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

/** Where the gesture is in its life. */
export type BrushSizeGesturePhase =
  /** No gesture: the canvas belongs to the tool. */
  | "idle"
  /** The press was taken by the gesture, but the pointer has not moved yet. */
  | "armed"
  /** The pointer has moved and the size is following the drag. */
  | "dragging";

/** The state of the gesture. */
export interface BrushSizeGestureState {
  readonly phase: BrushSizeGesturePhase;
  /**
   * The size the brush had when the gesture was armed.
   *
   * A cancelled gesture goes back to this size, and the drag is measured
   * against it, so the size never depends on the order the moves arrive in.
   */
  readonly startSize: number;
  /**
   * The size the gesture proposes.
   *
   * While the gesture is idle this is the size the brush holds.
   */
  readonly size: number;
  /** Where the pointer was when the gesture was armed, in CSS pixels. */
  readonly originScreenX: number;
  readonly originScreenY: number;
}

/** What can happen to the gesture. */
export type BrushSizeGestureEvent =
  /**
   * A press on the canvas.
   *
   * The press carries the context because the press is the only event that
   * has to ask whether the gesture may start at all.
   */
  | {
      readonly kind: "press";
      readonly sample: PointerSample;
      /** The brush's size now. */
      readonly size: number;
      readonly context: BrushSizeGestureContext;
    }
  /** The pointer moved while the gesture was live. */
  | { readonly kind: "move"; readonly sample: PointerSample }
  /** The pointer was released: the size the drag reached is kept. */
  | { readonly kind: "release" }
  /**
   * The gesture was called off: the Escape key, or a pointer the browser
   * took away. The size goes back to the one the gesture started from.
   */
  | { readonly kind: "cancel" }
  /**
   * The pointer capture was lost.
   *
   * The gesture cannot continue without the pointer, so it is called off the
   * same way a cancel calls it off.
   */
  | { readonly kind: "capture-lost" };

/** What an event did to the gesture. */
export interface BrushSizeGestureOutcome {
  /** The state after the event. */
  readonly state: BrushSizeGestureState;
  /**
   * The size the brush should hold now, or `null` when the event did not
   * change the size.
   *
   * This is the gesture's only output. There is no command, no history step
   * and nothing to undo: the engine writes the size to the brush, and that
   * is all a drawing setting does.
   */
  readonly size: number | null;
}

/**
 * The state of a gesture that is not running.
 *
 * The size is the one the brush holds, so the state is a complete answer to
 * "what size is the brush" even when nothing is happening.
 */
export function createBrushSizeGestureState(size: number): BrushSizeGestureState {
  const clamped = clamp(size, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
  return {
    phase: "idle",
    startSize: clamped,
    size: clamped,
    originScreenX: 0,
    originScreenY: 0,
  };
}

/** True while the gesture owns the pointer. */
export function isBrushSizeGestureActive(state: BrushSizeGestureState): boolean {
  return state.phase !== "idle";
}

/**
 * Advances the gesture.
 *
 * The life of a gesture is three phases:
 *
 *  - **idle** - the canvas belongs to the tool. A press that qualifies arms
 *    the gesture; the tool never sees that press.
 *  - **armed** - the gesture has the pointer but nothing has been resized
 *    yet. A press and a release without movement is a click, not a resize,
 *    so the size only starts to follow the pointer once the travel passes
 *    the deadzone.
 *  - **dragging** - the size follows the pointer. The drag is measured
 *    against the size the gesture started from, so the size does not depend
 *    on the order the moves arrive in and cannot drift.
 *
 * The gesture ends in one of three ways. A release keeps the size the drag
 * reached. A cancel - the Escape key, or a pointer the browser took away -
 * puts the size back where the gesture found it. Losing the pointer capture
 * ends the gesture the same way a cancel does: without the pointer there is
 * no drag left to follow, and a size nobody finished choosing is not worth
 * keeping.
 */
export function reduceBrushSizeGesture(
  state: BrushSizeGestureState,
  event: BrushSizeGestureEvent,
): BrushSizeGestureOutcome {
  switch (event.kind) {
    case "press": {
      if (state.phase !== "idle") {
        return { state, size: null };
      }
      if (!shouldStartBrushSizeGesture(event.sample, event.context)) {
        return { state, size: null };
      }
      const size = clamp(event.size, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
      return {
        state: {
          phase: "armed",
          startSize: size,
          size,
          originScreenX: event.sample.screenX,
          originScreenY: event.sample.screenY,
        },
        size: null,
      };
    }
    case "move": {
      if (state.phase === "idle") {
        return { state, size: null };
      }
      const delta = event.sample.screenY - state.originScreenY;
      const size = brushSizeFromDrag(state.startSize, delta);
      const moved = Math.abs(delta) > BRUSH_SIZE_GESTURE_DEADZONE;
      const phase: BrushSizeGesturePhase =
        state.phase === "armed" ? (moved ? "dragging" : "armed") : "dragging";
      return {
        state: { ...state, phase, size },
        size: size === state.size ? null : size,
      };
    }
    case "release": {
      if (state.phase === "idle") {
        return { state, size: null };
      }
      return {
        state: {
          phase: "idle",
          startSize: state.size,
          size: state.size,
          originScreenX: 0,
          originScreenY: 0,
        },
        size: null,
      };
    }
    case "cancel":
    case "capture-lost": {
      if (state.phase === "idle") {
        return { state, size: null };
      }
      return {
        state: {
          phase: "idle",
          startSize: state.startSize,
          size: state.startSize,
          originScreenX: 0,
          originScreenY: 0,
        },
        size: state.size === state.startSize ? null : state.startSize,
      };
    }
  }
}
