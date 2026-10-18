/**
 * DOM input binding.
 *
 * Owns the pointer/wheel listeners of the drawing surface and forwards
 * normalized samples. It is attached by the engine, not by React, so pointer
 * movement never triggers a React render.
 *
 * Behaviour notes:
 *  - Pointer capture keeps a stroke alive when the pointer leaves the canvas.
 *  - One pointer is tracked at a time (`activePointerId`), so extra fingers or
 *    a second device cannot interleave samples into a single stroke.
 *  - `pointercancel` and a lost capture end the stroke explicitly.
 *  - Coalesced move events are replayed so high-frequency pen input is not
 *    dropped between frames.
 */

import type { PointerPhase, PointerSample } from "../../types/pointer";
import type { Viewport } from "../../types/viewport";
import {
  createPointerSample,
  type CanvasOrigin,
  type PointerEventLike,
} from "./pointer";

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
  private activePointerId: number | null = null;
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

    const pointerId = this.activePointerId;
    this.activePointerId = null;
    if (pointerId !== null && this.element.hasPointerCapture(pointerId)) {
      this.element.releasePointerCapture(pointerId);
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
    if (this.activePointerId !== null) {
      return;
    }
    this.activePointerId = event.pointerId;
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
    if (this.activePointerId === null && !event.isPrimary) {
      return;
    }
    if (this.activePointerId !== null && event.pointerId !== this.activePointerId) {
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
    if (this.activePointerId !== null && event.pointerId !== this.activePointerId) {
      return;
    }
    this.handlers.onPointerSample(this.createSample(event, "up"));
    this.activePointerId = null;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    if (this.activePointerId !== null && event.pointerId !== this.activePointerId) {
      return;
    }
    this.handlers.onPointerSample(this.createSample(event, "cancel"));
    this.activePointerId = null;
  };

  private handleLostCapture = (event: PointerEvent): void => {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) {
      return;
    }
    this.handlers.onPointerSample(this.createSample(event, "cancel"));
    this.activePointerId = null;
  };

  private handlePointerLeave = (): void => {
    if (this.activePointerId === null) {
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
