/**
 * Pointer ownership.
 *
 * **Exactly one gesture may own the pointer at a time.** A gesture takes the
 * pointer at its press and gives it up when it finishes, when the platform
 * cancels it or when the capture is lost. Between those two moments no other
 * gesture reads the pointer: a second finger, a second mouse button or a
 * second tool cannot start a gesture of its own while one is running.
 *
 * The model is pure. It takes the current state and an event and returns the
 * next state; it never touches the DOM, never reads a clock and never mutates
 * its input, so the same event sequence always produces the same ownership
 * history. That is what makes the input layer testable without a browser.
 *
 * Two levels of gesture share the model:
 *
 *  - The **canvas level**, which the input binder sees: a press starts a
 *    paint, a secondary or a pan gesture, and the DOM delivers that gesture's
 *    moves, its release, its cancellation and the loss of its capture.
 *  - The **tool level**, which the engine's router sees: the tool decides
 *    which gesture a press starts - a stroke, a shape, a marquee, a guide -
 *    and the router hands the samples to that gesture alone.
 *
 * The model does not know which level it is used at. It knows only that
 * ownership is exclusive, that an owned pointer cannot be taken by a second
 * gesture, and that a cancellation or a lost capture ends the owner cleanly.
 *
 * The last rule is the one that keeps a tool honest. When a gesture is
 * cancelled the ownership is empty afterwards, so *no* gesture is left
 * believing that a drag is still running: the owner is told that its gesture
 * is over, and the pointer is free for the next one.
 */

import type { PointerPhase } from "../../types/pointer";

/**
 * Identifies the gesture that owns the pointer.
 *
 * A plain string, because the two levels name their gestures differently: the
 * binder names them by the button that was pressed, the engine's router names
 * them by what the tool started ("stroke", "shape", "marquee", ...).
 */
export type GestureId = string;

/** The gesture a primary-button press starts at the canvas level. */
export const PAINT_GESTURE = "canvas.paint";

/** The gesture a secondary-button press starts at the canvas level. */
export const SECONDARY_GESTURE = "canvas.secondary";

/** The gesture a middle-button press starts at the canvas level: a viewport pan. */
export const PAN_GESTURE = "canvas.pan";

/**
 * The gesture a press starts, chosen by the button that was pressed.
 *
 * The middle button pans the viewport whatever tool is active, so it is a
 * gesture of its own and not a second paint.
 */
export function gestureForButton(button: number): GestureId {
  if (button === 1) {
    return PAN_GESTURE;
  }
  if (button === 2) {
    return SECONDARY_GESTURE;
  }
  return PAINT_GESTURE;
}

/** The gesture that owns the pointer, and the pointer it owns. */
export interface PointerOwner {
  readonly pointerId: number;
  readonly gesture: GestureId;
}

/**
 * The ownership state.
 *
 * `owner` is `null` when no gesture is running: the pointer is free, and the
 * next press may take it.
 */
export interface PointerOwnership {
  readonly owner: PointerOwner | null;
}

/** The events the ownership model understands. */
export type OwnershipEvent =
  /** A gesture asks for the pointer. */
  | { readonly type: "take"; readonly pointerId: number; readonly gesture: GestureId }
  /** The owner gives the pointer up: the gesture finished. */
  | { readonly type: "release"; readonly pointerId: number; readonly gesture: GestureId }
  /** The platform cancelled the pointer (`pointercancel`). */
  | { readonly type: "cancel"; readonly pointerId: number }
  /** The capture was lost (`lostpointercapture`). */
  | { readonly type: "capture-lost"; readonly pointerId: number };

/**
 * What an event did.
 *
 *  - `taken` - the gesture now owns the pointer.
 *  - `held` - the gesture already owned the pointer; nothing changed.
 *  - `released` - the owner gave the pointer up.
 *  - `ended` - the owner was cancelled, or lost its capture.
 *  - `refused` - somebody else owns the pointer; the event was rejected.
 *  - `ignored` - the event did not apply to anything.
 */
export type OwnershipOutcome =
  | "taken"
  | "held"
  | "released"
  | "ended"
  | "refused"
  | "ignored";

export interface OwnershipTransition {
  /** The state after the event. */
  readonly ownership: PointerOwnership;
  readonly outcome: OwnershipOutcome;
  /**
   * The gesture that no longer owns the pointer, or `null`.
   *
   * The caller uses it to tell the owner that its gesture is over - the one
   * thing a cancelled gesture must never skip, because a tool that still
   * believes a drag is running will keep drawing after the cancel.
   */
  readonly ended: GestureId | null;
}

/** The state in which no gesture owns the pointer. */
export function emptyOwnership(): PointerOwnership {
  return { owner: null };
}

/** The owner of the pointer, or `null` when the pointer is free. */
export function ownershipOwner(ownership: PointerOwnership): PointerOwner | null {
  return ownership.owner;
}

/** The gesture that owns the pointer, or `null`. */
export function ownerGesture(ownership: PointerOwnership): GestureId | null {
  return ownership.owner?.gesture ?? null;
}

/**
 * True while a gesture is running.
 *
 * An owner exists from the press until the gesture finishes or is cancelled,
 * so this is also the answer to "is a drag in flight?".
 */
export function isDragInFlight(ownership: PointerOwnership): boolean {
  return ownership.owner !== null;
}

/** True when the given pointer is the one that owns the pointer. */
export function ownershipHeldBy(ownership: PointerOwnership, pointerId: number): boolean {
  return ownership.owner?.pointerId === pointerId;
}

/**
 * True when the gesture may take the pointer.
 *
 * A free pointer may be taken by anybody. An owned pointer may only be
 * re-taken by the gesture that already owns it, which is how a gesture
 * re-asserts its ownership without ever handing the pointer to a second one.
 */
export function canTakeOwnership(
  ownership: PointerOwnership,
  pointerId: number,
  gesture: GestureId,
): boolean {
  if (gesture === "") {
    return false;
  }
  const owner = ownership.owner;
  if (owner === null) {
    return true;
  }
  return owner.pointerId === pointerId && owner.gesture === gesture;
}

/**
 * Applies an event to the ownership state.
 *
 * The rules, in one place:
 *
 *  - **Take.** A free pointer is taken. An owned pointer is refused, whoever
 *    asks: the second finger and the second mouse button do not get a
 *    gesture of their own. The gesture that already owns the pointer may
 *    take it again, which changes nothing.
 *  - **Release.** Only the owner may give the pointer up. A gesture that does
 *    not own the pointer cannot release it.
 *  - **Cancel** and **capture lost.** The owner is ended and the pointer is
 *    free again. The gesture is reported as `ended`, so the caller can tell
 *    it that no drag is in flight any more. An event about a different
 *    pointer leaves the owner alone.
 */
export function transitionOwnership(
  ownership: PointerOwnership,
  event: OwnershipEvent,
): OwnershipTransition {
  const owner = ownership.owner;

  switch (event.type) {
    case "take": {
      if (event.gesture === "") {
        return { ownership, outcome: "refused", ended: null };
      }
      if (owner === null) {
        return {
          ownership: { owner: { pointerId: event.pointerId, gesture: event.gesture } },
          outcome: "taken",
          ended: null,
        };
      }
      if (owner.pointerId === event.pointerId && owner.gesture === event.gesture) {
        return { ownership, outcome: "held", ended: null };
      }
      return { ownership, outcome: "refused", ended: null };
    }
    case "release": {
      if (owner === null) {
        return { ownership, outcome: "ignored", ended: null };
      }
      if (owner.pointerId !== event.pointerId || owner.gesture !== event.gesture) {
        return { ownership, outcome: "refused", ended: null };
      }
      return { ownership: emptyOwnership(), outcome: "released", ended: owner.gesture };
    }
    case "cancel":
    case "capture-lost": {
      if (owner === null || owner.pointerId !== event.pointerId) {
        return { ownership, outcome: "ignored", ended: null };
      }
      return { ownership: emptyOwnership(), outcome: "ended", ended: owner.gesture };
    }
  }
}

/** The next state, without the outcome. */
export function reduceOwnership(
  ownership: PointerOwnership,
  event: OwnershipEvent,
): PointerOwnership {
  return transitionOwnership(ownership, event).ownership;
}

/** The facts about a pointer event that the routing needs. */
export interface PointerEventFacts {
  readonly phase: PointerPhase;
  readonly pointerId: number;
  readonly isPrimary: boolean;
  /** The button that changed; `-1` for a move. */
  readonly button: number;
}

/**
 * What should happen to a pointer event.
 *
 *  - `start` - no gesture owns the pointer, so this press starts one.
 *  - `owned` - the event belongs to the gesture that owns the pointer.
 *  - `hover` - nobody owns the pointer and the pointer is moving: the sample
 *    still has to reach the engine, because the cursor report follows it.
 *  - `blocked` - the event belongs to no gesture: another gesture owns the
 *    pointer, or the event does not start one.
 */
export type PointerRoute =
  | { readonly kind: "start"; readonly gesture: GestureId }
  | { readonly kind: "owned" }
  | { readonly kind: "hover" }
  | { readonly kind: "blocked" };

/**
 * Decides what a pointer event means for the current ownership.
 *
 * This is the rule "no other gesture reads the pointer meanwhile" written
 * down: while a gesture owns the pointer, every event that belongs to another
 * pointer is blocked, and a press cannot start a second gesture.
 */
export function routePointerEvent(
  ownership: PointerOwnership,
  event: PointerEventFacts,
): PointerRoute {
  const owner = ownership.owner;

  if (event.phase === "down") {
    if (owner === null) {
      return { kind: "start", gesture: gestureForButton(event.button) };
    }
    // The pointer is owned: a second press, a second button or a second
    // finger gets no gesture of its own.
    return { kind: "blocked" };
  }

  if (owner === null) {
    // The pointer is free. A move is a hover - the cursor still has to follow
    // the pointer - and everything else belongs to no gesture at all.
    return event.phase === "move" && event.isPrimary ? { kind: "hover" } : { kind: "blocked" };
  }

  return event.pointerId === owner.pointerId ? { kind: "owned" } : { kind: "blocked" };
}
