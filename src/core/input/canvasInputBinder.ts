/**
 * DOM input binding.
 *
 * Owns the pointer/wheel listeners of the drawing surface and forwards
 * normalized samples. It is attached by the engine, not by React, so pointer
 * movement never triggers a React render.
 *
 * Behaviour notes:
 *  - Pointer capture keeps a stroke alive when the pointer leaves the canvas.
 *  - **One gesture owns the pointer at a time.** The ownership lives in
 *    `core/input/ownership`; the binder asks that model what an event means
 *    and follows its answer. A second finger, a second mouse button or a
 *    second press therefore cannot start a gesture while one is running, and
 *    no other pointer's samples reach the engine while a gesture owns the
 *    pointer.
 *  - `pointercancel` and a lost capture end the gesture cleanly: the
 *    ownership is released *before* the engine is told, so no gesture is left
 *    believing that a drag is running, and the owner is told exactly once.
 *  - Coalesced move events are replayed so high-frequency pen input is not
 *    dropped between frames.
 *  - A move with no owner is still forwarded: it is a hover, and the cursor
 *    report has to follow the pointer.
 */

import type { PointerPhase, PointerSample } from "../../types/pointer";
import type { Viewport } from "../../types/viewport";
import {
  createPointerSample,
  type CanvasOrigin,
  type PointerEventLike,
} from "./pointer";
import {
  emptyOwnership,
  isDragInFlight,
  ownershipOwner,
  routePointerEvent,
  transitionOwnership,
  type PointerOwnership,
} from "./ownership";

export interface WheelInput {
  readonly screenX: number;
  readonly screenY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export interface CanvasInputHandlers {
  /** Current viewport, read per event so mapping always uses fresh state. */
  getViewport(): Viewport;
  onPointerSample(sample: PointerSample): void;
  onWheel(input: WheelInput): void;
  /** True when the pointer is over the drawing surface. */
  onPointerPresence(inside: boolean): void;
}

export class CanvasInputBinder {
  private readonly element: HTMLElement;
  private readonly handlers: CanvasInputHandlers;
  /** Who owns the pointer, if anybody. The single source of truth. */
  private ownership: PointerOwnership = emptyOwnership();
  private attached = false;

  constructor(element: HTMLElement, handlers: CanvasInputHandlers) {
    this.element = element;
    this.handlers = handlers;
  }

  attach(): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.element.addEventListener("pointerdown", this.handlePointerDown);
    this.element.addEventListener("pointermove", this.handlePointerMove);
    this.element.addEventListener("pointerup", this.handlePointerUp);
    this.element.addEventListener("pointercancel", this.handlePointerCancel);
    this.element.addEventListener("lostpointercapture", this.handleLostCapture);
    this.element.addEventListener("pointerleave", this.handlePointerLeave);
    this.element.addEventListener("pointerenter", this.handlePointerEnter);
    this.element.addEventListener("wheel", this.handleWheel, { passive: false });
    this.element.addEventListener("contextmenu", this.handleContextMenu);
    // Chromium starts autoscroll on middle-button mousedown; the pointer
    // events alone do not suppress it.
    this.element.addEventListener("mousedown", this.handleMouseDown);
  }

  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.element.removeEventListener("pointerdown", this.handlePointerDown);
    this.element.removeEventListener("pointermove", this.handlePointerMove);
    this.element.removeEventListener("pointerup", this.handlePointerUp);
    this.element.removeEventListener("pointercancel", this.handlePointerCancel);
    this.element.removeEventListener("lostpointercapture", this.handleLostCapture);
    this.element.removeEventListener("pointerleave", this.handlePointerLeave);
    this.element.removeEventListener("pointerenter", this.handlePointerEnter);
    this.element.removeEventListener("wheel", this.handleWheel);
    this.element.removeEventListener("contextmenu", this.handleContextMenu);
    this.element.removeEventListener("mousedown", this.handleMouseDown);

    const owner = ownershipOwner(this.ownership);
    this.ownership = emptyOwnership();
    if (owner !== null && this.element.hasPointerCapture(owner.pointerId)) {
      this.element.releasePointerCapture(owner.pointerId);
    }
  }

  private origin(): CanvasOrigin {
    const rect = this.element.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  private createSample(event: PointerEventLike, phase: PointerPhase) {
    return createPointerSample({
      event,
      origin: this.origin(),
      viewport: this.handlers.getViewport(),
      phase,
    });
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const route = routePointerEvent(this.ownership, {
      phase: "down",
      pointerId: event.pointerId,
      isPrimary: event.isPrimary,
      button: event.button,
    });
    if (route.kind !== "start") {
      // The pointer is already owned by a gesture: a second finger, a second
      // mouse button or a second press gets no gesture of its own.
      return;
    }
    const transition = transitionOwnership(this.ownership, {
      type: "take",
      pointerId: event.pointerId,
      gesture: route.gesture,
    });
    if (transition.outcome !== "taken") {
      return;
    }
    this.ownership = transition.ownership;
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch (error) {
      // Capture is best-effort: without it a stroke still works inside the
      // canvas, it just stops when the pointer leaves. Report it, never hide it.
      console.warn("Pointer capture failed; strokes will not survive leaving the canvas.", error);
    }
    this.handlers.onPointerSample(this.createSample(event, "down"));
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const route = routePointerEvent(this.ownership, {
      phase: "move",
      pointerId: event.pointerId,
      isPrimary: event.isPrimary,
      button: event.button,
    });
    if (route.kind === "blocked") {
      // Another gesture owns the pointer, or this pointer is a secondary one
      // hovering: its samples are not the gesture's and are not forwarded.
      return;
    }

    const origin = this.origin();
    const viewport = this.handlers.getViewport();
    const coalesced = event.getCoalescedEvents?.() ?? [];
    const samples: readonly PointerEventLike[] = coalesced.length > 0 ? coalesced : [event];
    for (const sample of samples) {
      this.handlers.onPointerSample(
        createPointerSample({ event: sample, origin, viewport, phase: "move" }),
      );
    }
    this.handlers.onPointerPresence(true);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const owner = ownershipOwner(this.ownership);
    if (owner === null || event.pointerId !== owner.pointerId) {
      // Nothing owns the pointer, so this release ends no gesture.
      return;
    }
    // The ownership goes first: the gesture is over before the engine hears
    // about the release, and the capture release that follows cannot be
    // mistaken for a lost capture.
    this.ownership = transitionOwnership(this.ownership, {
      type: "release",
      pointerId: owner.pointerId,
      gesture: owner.gesture,
    }).ownership;
    this.handlers.onPointerSample(this.createSample(event, "up"));
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    const owner = ownershipOwner(this.ownership);
    if (owner === null || event.pointerId !== owner.pointerId) {
      return;
    }
    // The platform took the pointer away. The gesture ends here: the
    // ownership is released first, so no gesture is left believing that a
    // drag is running, and the owner is told exactly once.
    this.ownership = transitionOwnership(this.ownership, {
      type: "cancel",
      pointerId: owner.pointerId,
    }).ownership;
    this.handlers.onPointerSample(this.createSample(event, "cancel"));
  };

  private handleLostCapture = (event: PointerEvent): void => {
    const owner = ownershipOwner(this.ownership);
    if (owner === null || event.pointerId !== owner.pointerId) {
      // The capture was already released on purpose, or another pointer owns
      // the pointer: there is no gesture to end.
      return;
    }
    // A lost capture ends the gesture cleanly, exactly like a cancellation:
    // the stroke is not left half-finished in the buffer.
    this.ownership = transitionOwnership(this.ownership, {
      type: "capture-lost",
      pointerId: owner.pointerId,
    }).ownership;
    this.handlers.onPointerSample(this.createSample(event, "cancel"));
  };

  private handlePointerLeave = (): void => {
    if (!isDragInFlight(this.ownership)) {
      this.handlers.onPointerPresence(false);
    }
  };

  private handlePointerEnter = (): void => {
    this.handlers.onPointerPresence(true);
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.element.getBoundingClientRect();
    this.handlers.onWheel({
      screenX: event.clientX - rect.left,
      screenY: event.clientY - rect.top,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      ctrlKey: event.ctrlKey || event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
  };

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private handleMouseDown = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };
}
