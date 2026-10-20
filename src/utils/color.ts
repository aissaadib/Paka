/**
 * Colour values and conversions.
 *
 * `Rgb` is a plain 8-bit sRGB triple - the precision every surface in the app
 * actually stores, because that is what Canvas 2D gives back (`Uint8ClampedArray`
 * channels). It is deliberately not a colour object with alpha or a colour
 * space: the renderer's composite read hands back exactly three channels, and
 * the brush takes an `#rrggbb` string, so that is the whole vocabulary the two
 * need to share.
 *
 * `Hsv` is the third model, and it exists for one reason: the colour wheel
 * needs a hue and a saturation that survive a round trip through the disc
 * without dragging a gamma-corrected lightness around. It is a *view* of a
 * colour, not a second source of truth - the brush still stores `#rrggbb`, and
 * every HSV value here converts back to exactly the bytes it came from.
 */

import { clamp } from "./math";

export interface Rgb {
  /** Red, `0..255`. */
  readonly r: number;
  /** Green, `0..255`. */
  readonly g: number;
  /** Blue, `0..255`. */
  readonly b: number;
}

export interface Hsv {
  /** Hue in degrees, `0..360`; `360` is the same colour as `0`. */
  readonly h: number;
  /** Saturation, `0..1`: `0` is the colour's own grey, `1` is fully saturated. */
  readonly s: number;
  /** Value (brightness), `0..1`: `0` is black, `1` is the brightest form of the hue. */
  readonly v: number;
}

const HEX_DIGITS = "0123456789abcdef";

/** Clamps and rounds a channel to one hex pair; a float or an out-of-range
 * value still produces valid hex rather than `NaN`. */
function toHexByte(value: number): string {
  const byte = Math.min(255, Math.max(0, Math.round(value)));
  return HEX_DIGITS[(byte >> 4) & 0xf] + HEX_DIGITS[byte & 0xf];
}

/** Formats an 8-bit sRGB triple as a lowercase `#rrggbb` string. */
export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

/**
 * Parses a `#rrggbb` (or shorthand `#rgb`) string back into an 8-bit sRGB
 * triple, returning `null` for anything else. The inverse of
 * {@link rgbToHex}, so the two can be tested as a round trip.
 */
export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return null;
  }
  const digits = match[1];
  const full =
    digits.length === 3
      ? digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2]
      : digits;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * Rounds a float channel to a byte.
 *
 * The epsilon matters: a channel that mathematically lands exactly on `.5`
 * arrives as `127.49999999999999` often enough to round the wrong way, and a
 * colour that came from an 8-bit source must come back as the same byte. The
 * epsilon lifts a value that is a hair under a boundary onto it, so the
 * rounding is half-up and consistent.
 */
function toRgbByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value + 1e-9)));
}

/** Wraps a hue into `[0, 360)`; `360` and `-30` are the same hue as `0`. */
export function normalizeHue(hue: number): number {
  if (!Number.isFinite(hue)) {
    return 0;
  }
  const wrapped = hue % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Converts an HSV colour to 8-bit sRGB.
 *
 * The hue wraps, the saturation and the value are clamped, and a non-finite
 * input collapses to `0` rather than to `NaN` - a colour wheel that hands the
 * renderer a `NaN` channel would paint nothing and say nothing.
 */
export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = normalizeHue(h);
  const saturation = clamp(s, 0, 1);
  const value = clamp(v, 0, 1);

  const chroma = value * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = value - chroma;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = chroma;
    g = second;
  } else if (hue < 120) {
    r = second;
    g = chroma;
  } else if (hue < 180) {
    g = chroma;
    b = second;
  } else if (hue < 240) {
    g = second;
    b = chroma;
  } else if (hue < 300) {
    r = second;
    b = chroma;
  } else {
    r = chroma;
    b = second;
  }

  return {
    r: toRgbByte((r + base) * 255),
    g: toRgbByte((g + base) * 255),
    b: toRgbByte((b + base) * 255),
  };
}

/**
 * Converts 8-bit sRGB to HSV.
 *
 * A grey has no hue of its own, so it is reported as hue `0` with saturation
 * `0`: the wheel then shows it at the centre of the hue ring, which is where
 * "no hue" belongs.
 */
export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = clamp(r, 0, 255);
  const green = clamp(g, 0, 255);
  const blue = clamp(b, 0, 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  const value = max / 255;
  const saturation = max === 0 ? 0 : delta / max;

  if (delta === 0) {
    return { h: 0, s: 0, v: value };
  }

  let hue: number;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  hue *= 60;
  if (hue < 0) {
    hue += 360;
  }
  return { h: hue, s: saturation, v: value };
}

/** Formats an HSV colour as a lowercase `#rrggbb` string. */
export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

/**
 * Parses a `#rrggbb` (or shorthand `#rgb`) string into HSV, returning `null`
 * for anything that is not a hex colour.
 */
export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex);
  return rgb === null ? null : rgbToHsv(rgb);
}
