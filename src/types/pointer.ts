/**
 * Normalized pointer input.
 *
 * `PointerSample` is the single shape every input consumer works with. Raw
 * `PointerEvent`s are normalized exactly once, in `core/input`, so tools and
 * the stroke pipeline never touch the DOM event directly.
 */

export type PointerPhase = "down" | "move" | "up" | "cancel";

export type PointerKind = "mouse" | "pen" | "touch" | "unknown";

export interface PointerModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
}

export interface PointerSample {
  readonly phase: PointerPhase;
  readonly pointerId: number;
  readonly kind: PointerKind;
  readonly isPrimary: boolean;
  /** Button that changed for `down`/`up` phases; `-1` for moves. */
  readonly button: number;
  /** Bitmask of currently pressed buttons (1 = left, 2 = right, 4 = middle). */
  readonly buttons: number;
  /** Position in document coordinates. */
  readonly docX: number;
  readonly docY: number;
  /** Position in canvas-local CSS pixels (origin = canvas top-left). */
  readonly screenX: number;
  readonly screenY: number;
  /** Normalized pressure in `[0, 1]`, already including the fallback policy. */
  readonly pressure: number;
  /** True when the device reported a real pressure value for this sample. */
  readonly hasPressure: boolean;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly timeStamp: number;
  readonly modifiers: PointerModifiers;
}

/** A single point of a stroke, in document coordinates. */
export interface StrokeSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  /** Monotonic device timestamp in milliseconds. */
  readonly time: number;
}

/** Lightweight cursor report used by overlays; never stored in React state. */
export interface CursorReport {
  /** False when the pointer left the drawing surface. */
  readonly inside: boolean;
  readonly docX: number;
  readonly docY: number;
  /** Canvas-local CSS pixels; recomputed when the viewport changes. */
  readonly screenX: number;
  readonly screenY: number;
  readonly kind: PointerKind;
  readonly pressure: number;
  readonly hasPressure: boolean;
  /**
   * The CSS cursor to show at this position.
   *
   * It is the active tool's cursor, except where the tool has something more
   * specific to say - the select tool's transform handles, for instance, ask
   * for a resize cursor while the pointer is over one of them.
   */
  readonly cursor: string;
}
