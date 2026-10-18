/**
 * Pointer normalization.
 *
 * Raw DOM pointer events are converted here into the single normalized shape
 * the rest of the engine consumes. Nothing downstream of this module reads
 * `PointerEvent`, and nothing here touches rendering or React state.
 */

import type {
  PointerKind,
  PointerPhase,
  PointerSample,
  PointerModifiers,
  StrokeSample,
} from "../../types/pointer";
import type { Viewport } from "../../types/viewport";
import { clamp } from "../../utils/math";
import { screenToDoc } from "../rendering/viewport";

/**
 * Pressure fallback policy.
 *
 * A pen that reports pressure is used as-is. Devices without pressure report
 * `1` so that the brush size slider is honored exactly (a mouse drawing at
 * 50% pressure would silently halve the stroke width). A pen reporting no
 * pressure at all falls back to `0.5`, which is the value most pen drivers
 * report for "touched but not yet measuring".
 */
export const FALLBACK_PRESSURE_PEN = 0.5;
export const FALLBACK_PRESSURE_DEFAULT = 1;

/**
 * Structural subset of `PointerEvent` used for normalization. Keeping the
 * input side structural makes it possible to unit test the conversion without
 * constructing real DOM events.
 */
export interface PointerEventLike {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly timeStamp: number;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** Top-left corner of the drawing surface in client coordinates. */
export interface CanvasOrigin {
  readonly left: number;
  readonly top: number;
}

export interface PressureReading {
  readonly pressure: number;
  readonly hasPressure: boolean;
}

export function toPointerKind(pointerType: string): PointerKind {
  if (pointerType === "mouse") {
    return "mouse";
  }
  if (pointerType === "pen") {
    return "pen";
  }
  if (pointerType === "touch") {
    return "touch";
  }
  return "unknown";
}

export function resolvePressure(pressure: number, kind: PointerKind): PressureReading {
  if (kind === "pen" && Number.isFinite(pressure) && pressure > 0) {
    return { pressure: clamp(pressure, 0, 1), hasPressure: true };
  }
  return {
    pressure: kind === "pen" ? FALLBACK_PRESSURE_PEN : FALLBACK_PRESSURE_DEFAULT,
    hasPressure: false,
  };
}

export interface CreatePointerSampleOptions {
  readonly event: PointerEventLike;
  readonly origin: CanvasOrigin;
  readonly viewport: Viewport;
  readonly phase: PointerPhase;
}

export function createPointerSample(options: CreatePointerSampleOptions): PointerSample {
  const { event, origin, viewport, phase } = options;
  const kind = toPointerKind(event.pointerType);
  const screenX = event.clientX - origin.left;
  const screenY = event.clientY - origin.top;
  const doc = screenToDoc(viewport, screenX, screenY);
  const pressure = resolvePressure(event.pressure, kind);

  const modifiers: PointerModifiers = {
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
  };

  return {
    phase,
    pointerId: event.pointerId,
    kind,
    isPrimary: event.isPrimary,
    button: event.button,
    buttons: event.buttons,
    docX: doc.x,
    docY: doc.y,
    screenX,
    screenY,
    pressure: pressure.pressure,
    hasPressure: pressure.hasPressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    timeStamp: event.timeStamp,
    modifiers,
  };
}

export function toStrokeSample(sample: PointerSample): StrokeSample {
  return {
    x: sample.docX,
    y: sample.docY,
    pressure: sample.pressure,
    time: sample.timeStamp,
  };
}
