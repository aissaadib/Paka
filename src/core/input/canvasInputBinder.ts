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
 *  - **A window that loses focus ends the gesture.** A window that is not
 *    focused is not given a `pointerup`, so without this the gesture would
 *    stay in flight: the preview would stay on the canvas, the stroke would
 *    keep growing with the next move, and nothing would ever be committed.
 *  - A whole event is handed over as one batch, so the consumer can report the
 *    pointer's *position* once per event instead of once per coalesced sample.
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
  /**
   * One pointer event, normalized.
   *
   * A move event can carry several coalesced samples: the browser's way of
   * reporting the sub-frame path of a fast gesture. They arrive as one batch
   * so the consumer can keep every one of them - a stroke must not lose a
   * sample - while reporting the pointer's position only once, for the newest
   * sample. The intermediate positions belong to the same physical move, so
   * republishing them only costs a DOM write per sample.
   */
  onPointerSamples(samples: readonly PointerSample[]): void;
  onWheel(input: WheelInput): void;
  /** True when the pointer is over the drawing surface. */
  onPointerPresence(inside: boolean): void;
}

/**
 * A copy of the fields the normalization needs.
 *
 * A cancel that follows a window blur has no event of its own, so the last
 * event of the tracked pointer is kept. It is copied rather than referenced so
 * the binder never holds a DOM event alive.
 */
function snapshotEvent(event: PointerEvent): PointerEventLike {
  return {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    button: event.button,
    buttons: event.buttons,
    clientX: event.clientX,
    clientY: event.clientY,
    pressure: event.pressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    timeStamp: event.timeStamp,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
}

export class CanvasInputBinder {
  private readonly element: HTMLElement;
  private readonly handlers: CanvasInputHandlers;
  private activePointerId: number | null = null;
  /** The last event of the tracked pointer, for a cancel that has no event. */
  private lastEvent: PointerEventLike | null = null;
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
    // A window that is not focused is not given a `pointerup`, so the gesture
    // has to be ended from here or it stays in flight.
    this.globalWindow()?.addEventListener("blur", this.handleWindowBlur);
    this.globalDocument()?.addEventListener("visibilitychange", this.handleVisibilityChange);
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
    this.globalWindow()?.removeEventListener("blur", this.handleWindowBlur);
    this.globalDocument()?.removeEventListener("visibilitychange", this.handleVisibilityChange);

    const pointerId = this.activePointerId;
    this.activePointerId = null;
    this.lastEvent = null;
    if (pointerId !== null && this.element.hasPointerCapture(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
  }

  private globalWindow(): Window | null {
    return typeof window === "undefined" ? null : window;
  }

  private globalDocument(): Document | null {
    return typeof document === "undefined" ? null : document;
  }

  private origin(): CanvasOrigin {
    const rect = this.element.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  private createSample(event: PointerEventLike, phase: PointerPhase): PointerSample {
    return createPointerSample({
      event,
      origin: this.origin(),
      viewport: this.handlers.getViewport(),
      phase,
    });
  }

  private releaseCapture(pointerId: number): void {
    if (this.element.hasPointerCapture(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
  }

  /**
   * True when the event belongs to the pointer this binder is tracking.
   *
   * A pointer that was never tracked owns no gesture here, so its events must
   * not end one: a release from a second device, or a synthetic event the
   * browser produced, would otherwise close the tracked gesture at a place
   * the user never released at.
   */
  private isTracked(event: PointerEvent): boolean {
    return this.activePointerId !== null && event.pointerId === this.activePointerId;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null) {
      return;
    }
    this.activePointerId = event.pointerId;
    this.lastEvent = snapshotEvent(event);
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch (error) {
      // Capture is best-effort: without it a stroke still works inside the
      // canvas, it just stops when the pointer leaves. Report it, never hide it.
      console.warn("Pointer capture failed; strokes will not survive leaving the canvas.", error);
    }
    this.handlers.onPointerSamples([this.createSample(event, "down")]);
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
    const sources: readonly PointerEventLike[] = coalesced.length > 0 ? coalesced : [event];
    const samples: PointerSample[] = [];
    for (const source of sources) {
      samples.push(createPointerSample({ event: source, origin, viewport, phase: "move" }));
    }
    if (this.activePointerId === event.pointerId) {
      this.lastEvent = snapshotEvent(event);
    }
    this.handlers.onPointerSamples(samples);
    this.handlers.onPointerPresence(true);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.isTracked(event)) {
      return;
    }
    // The pointer is untracked before the sample is forwarded, so a capture
    // released while the gesture ends cannot produce a second cancel.
    this.activePointerId = null;
    this.lastEvent = snapshotEvent(event);
    this.handlers.onPointerSamples([this.createSample(event, "up")]);
    this.releaseCapture(event.pointerId);
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    if (!this.isTracked(event)) {
      return;
    }
    this.activePointerId = null;
    this.lastEvent = snapshotEvent(event);
    this.handlers.onPointerSamples([this.createSample(event, "cancel")]);
    this.releaseCapture(event.pointerId);
  };

  private handleLostCapture = (event: PointerEvent): void => {
    if (!this.isTracked(event)) {
      return;
    }
    this.activePointerId = null;
    this.handlers.onPointerSamples([this.createSample(event, "cancel")]);
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

  // ------------------------------------------------------------ window events

  private handleWindowBlur = (): void => {
    this.endTrackedGesture();
  };

  private handleVisibilityChange = (): void => {
    const doc = this.globalDocument();
    if (doc && doc.visibilityState !== "hidden") {
      return;
    }
    this.endTrackedGesture();
  };

  /**
   * Ends the gesture the tracked pointer owns.
   *
   * A window that loses focus is not given a `pointerup`: the browser stops
   * delivering pointer events to it, and a release that happened while the
   * window was in the background is never seen. The gesture would then stay
   * in flight - the preview would stay on the canvas, a stroke would keep
   * growing with the next move, and nothing would ever be committed. Ending it
   * here turns the stuck gesture into the tool's own cancel, which is exactly
   * what a lost capture already does.
   */
  private endTrackedGesture(): void {
    const pointerId = this.activePointerId;
    if (pointerId === null) {
      return;
    }
    this.activePointerId = null;
    const last = this.lastEvent;
    this.lastEvent = null;
    this.handlers.onPointerSamples([this.createSample(last ?? fallbackEvent(pointerId), "cancel")]);
    this.releaseCapture(pointerId);
  }
}

/** A neutral event, used when a gesture ends without a pointer event. */
function fallbackEvent(pointerId: number): PointerEventLike {
  return {
    pointerId,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 0,
    clientX: 0,
    clientY: 0,
    pressure: 0,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  };
}
