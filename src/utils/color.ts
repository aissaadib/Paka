/**
 * Colour values and conversions.
 *
 * `Rgb` is a plain 8-bit sRGB triple - the precision every surface in the app
 * actually stores, because that is what Canvas 2D gives back (`Uint8ClampedArray`
 * channels). It is deliberately not a colour object with alpha or a colour
 * space: the renderer's composite read hands back exactly three channels, and
 * the brush takes an `#rrggbb` string, so that is the whole vocabulary the two
 * need to share.
 */

export interface Rgb {
  /** Red, `0..255`. */
  readonly r: number;
  /** Green, `0..255`. */
  readonly g: number;
  /** Blue, `0..255`. */
  readonly b: number;
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
