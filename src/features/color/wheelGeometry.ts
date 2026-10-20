/**
 * Geometry of the colour wheel disc.
 *
 * The disc is a hue ring seen from above: the angle of the pointer gives the
 * hue, the distance from the centre gives the saturation, and the value
 * (brightness) is a separate control because it is a scale, not a direction.
 *
 * The convention is fixed here so the maths and the CSS agree:
 *
 *  - hue `0` is at **3 o'clock** (the right of the disc) and the hue grows
 *    clockwise, which is what `atan2(dy, dx)` gives when `y` grows downwards;
 *  - the centre is saturation `0` (the colour's own grey) and the rim is
 *    saturation `1`;
 *  - a CSS `conic-gradient` starts at 12 o'clock, so the disc's gradient is
 *    rotated by `from 90deg` to put hue `0` at 3 o'clock.
 *
 * These functions are pure and take the disc's size in CSS pixels, so they can
 * be tested without a browser and reused at any disc size.
 */

import { clamp } from "../../utils/math";
import { normalizeHue } from "../../utils/color";
import type { Hsv } from "../../utils/color";

export interface WheelPoint {
  /** Horizontal position, in CSS pixels from the disc's left edge. */
  readonly x: number;
  /** Vertical position, in CSS pixels from the disc's top edge. */
  readonly y: number;
}

export interface WheelSelection {
  /** Hue in degrees, `0..360`. */
  readonly h: number;
  /** Saturation, `0..1`. */
  readonly s: number;
}

/**
 * Reads a point on the disc as a hue and a saturation.
 *
 * A point outside the disc keeps the pointer's angle but clamps the
 * saturation to the rim, so a drag that leaves the element keeps painting at
 * the edge instead of jumping back to the centre. The exact centre has no
 * direction, and is reported as hue `0`.
 */
export function wheelPointToHsv(x: number, y: number, size: number): WheelSelection {
  if (!(size > 0)) {
    return { h: 0, s: 0 };
  }
  const centre = size / 2;
  const dx = x - centre;
  const dy = y - centre;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const saturation = clamp(distance / centre, 0, 1);
  const hue = normalizeHue((Math.atan2(dy, dx) * 180) / Math.PI);
  return { h: hue, s: saturation };
}

/**
 * Places a hue and a saturation on the disc.
 *
 * The inverse of {@link wheelPointToHsv}: the marker's position for a colour,
 * ready to be placed in CSS pixels.
 */
export function hsvToWheelPoint(hue: number, saturation: number, size: number): WheelPoint {
  const centre = size / 2;
  const radius = clamp(saturation, 0, 1) * centre;
  const angle = (normalizeHue(hue) * Math.PI) / 180;
  return {
    x: centre + radius * Math.cos(angle),
    y: centre + radius * Math.sin(angle),
  };
}

/**
 * Chooses the hue and saturation the wheel shows.
 *
 * The brush colour is the authority, and `stored` is it read back as HSV. The
 * wheel still prefers `requested` - the hue and saturation the user actually
 * asked for - as long as the colour on the brush is the one the wheel wrote.
 * The reason is the 8-bit sRGB grid: on a dark or desaturated colour it is
 * coarse enough that the hue it can hold is not the hue that was asked for
 * (the default brush colour `#16181c` has six levels of red, so 205° comes
 * back as 220°), and a control that showed the stored value would snap away
 * from the user's choice while they dragged it.
 *
 * As soon as the colour is changed from anywhere else - the toolbar's colour
 * input, the swatches, the canvas picker - the stored colour wins again, so
 * the wheel never shows a hue the brush does not have.
 */
export function resolveWheelHsv(
  stored: Hsv,
  requested: Hsv | null,
  writtenColor: string | null,
  currentColor: string,
): Hsv {
  if (requested !== null && writtenColor !== null && writtenColor === currentColor) {
    return requested;
  }
  return stored;
}
