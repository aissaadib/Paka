/**
 * The colour wheel's own state.
 *
 * The wheel is a view of the brush colour, but the 8-bit sRGB grid is coarse:
 * on a dark or desaturated colour the hue that was asked for is not the hue the
 * colour can hold (the default brush colour `#16181c` has six levels of red,
 * so 205° comes back as 220°). So the wheel keeps the hue and the saturation
 * the *user* asked for while the brush holds the colour the wheel wrote, and
 * drops them as soon as the colour is changed from anywhere else.
 *
 * "Anywhere else" is the whole difficulty, and it cannot be decided by
 * comparing colours: a colour changed elsewhere and then changed back to the
 * wheel's last colour is indistinguishable from the wheel's own write, and
 * comparing the two lets a stale hue survive. So the state remembers the
 * colour it was last reconciled against, and any change to the brush colour
 * that the wheel did not write invalidates the request - once and for good, so
 * the stale hue cannot come back.
 *
 * The state is pure data and the transition is a pure function, so the rule
 * can be tested without a browser.
 */

import type { Hsv } from "../../utils/color";

export interface WheelState {
  /** The hue and the saturation the user asked for on the wheel. */
  readonly requested: Hsv | null;
  /** The colour the wheel last wrote to the brush. */
  readonly written: string | null;
  /** The brush colour this state was last reconciled against. */
  readonly observed: string;
}

export type WheelEvent =
  /** The user picked a colour on the wheel; the wheel writes it. */
  | { readonly kind: "picked"; readonly hsv: Hsv; readonly color: string }
  /** The brush colour changed; the wheel did not write it. */
  | { readonly kind: "brush-changed"; readonly color: string };

/** The state of a wheel that has not asked for anything yet. */
export function createWheelState(color: string): WheelState {
  return { requested: null, written: null, observed: color };
}

/**
 * Advances the wheel's state.
 *
 * A pick keeps the request: the brush now holds the colour the wheel wrote,
 * so the wheel may show the hue the user asked for rather than the hue the
 * 8-bit colour can hold. A brush colour the wheel did not write came from
 * somewhere else, and the request is dropped with it.
 */
export function reduceWheelState(state: WheelState, event: WheelEvent): WheelState {
  if (event.kind === "picked") {
    return { requested: event.hsv, written: event.color, observed: event.color };
  }
  if (event.color === state.observed) {
    return state;
  }
  return { requested: null, written: null, observed: event.color };
}
