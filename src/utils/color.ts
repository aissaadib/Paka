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
 *
 * The bottom of the file is the *input* path: `parseColorInput` reads the hex,
 * `hsl()` and `oklch()` syntaxes a user may type or paste. Parsing is wider
 * than storage on purpose - every syntax normalises to `#rrggbb`, so the
 * stored colour, the project format and the settings file are unchanged.
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

/**
 * The value an `input[type=color]` can hold.
 *
 * The native control accepts only `#rrggbb`, so a colour stored in another
 * shape - a project file may hold any non-empty string - cannot be shown in
 * it. The fallback is used instead, so the control always has a value it
 * accepts rather than an empty one.
 */
export function colorInputValue(color: string, fallback = "#000000"): string {
  const rgb = hexToRgb(color.trim());
  return rgb === null ? fallback : rgbToHex(rgb);
}

/* ------------------------------------------------------------------ input */

/**
 * A colour read from a text field: the 8-bit sRGB triple plus its alpha.
 *
 * The alpha is part of the *parsed* value and never of the stored one. The
 * app stores `#rrggbb`, so a translucent colour cannot be painted faithfully;
 * the caller therefore sees the alpha and decides what to do with it, and
 * nothing on this path drops it silently.
 */
export interface ParsedColor {
  /** The colour, clamped into the 8-bit sRGB cube. */
  readonly rgb: Rgb;
  /** Opacity in `0..1`; `1` is a solid colour. */
  readonly alpha: number;
}

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, with the `#` optional. */
const HEX_COLOR = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Parses a hex colour of any of the four CSS lengths into its triple and its
 * alpha. Shorthand is expanded, the alpha pair becomes `0..1`, and a string
 * that is not hex of one of those lengths is `null`.
 */
export function parseHexColor(hex: string): ParsedColor | null {
  const match = HEX_COLOR.exec(hex.trim());
  if (!match) {
    return null;
  }
  const digits = match[1];
  const full =
    digits.length <= 4
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return {
    rgb: {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    },
    alpha: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

/** A plain decimal number - no units, no exponent - or `null`. */
function parseDecimal(token: string): number | null {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
    return null;
  }
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/**
 * A `0..100` percentage, clamped. The `%` is optional: `hsl()` accepts both
 * `50` and `50%` for saturation and lightness, and reads them the same way.
 */
function parsePercentage(token: string): number | null {
  const percent = token.endsWith("%");
  const value = parseDecimal(percent ? token.slice(0, -1) : token);
  return value === null ? null : clamp(value, 0, 100);
}

/** An alpha as `0..1` or as `0..100%`; a missing alpha is `1`. */
function parseAlpha(token: string | null): number | null {
  if (token === null) {
    return 1;
  }
  const percent = token.endsWith("%");
  const value = parseDecimal(percent ? token.slice(0, -1) : token);
  if (value === null) {
    return null;
  }
  return clamp(percent ? value / 100 : value, 0, 1);
}

/** The lower-case name of a colour function and its body, or `null`. */
function functionCall(text: string): { name: string; body: string } | null {
  const open = text.indexOf("(");
  if (open <= 0 || !text.endsWith(")")) {
    return null;
  }
  return { name: text.slice(0, open).trim().toLowerCase(), body: text.slice(open + 1, -1) };
}

/**
 * Splits the inside of `hsl()` / `oklch()` into its three components and its
 * optional alpha, accepting the comma and the space syntax alike.
 *
 * The alpha may arrive as a fourth comma-separated argument (the legacy
 * `hsla(r, g, b, a)` form) or after a slash (the CSS Color 4 form); both are
 * read, and an argument list that says both is rejected as ambiguous.
 */
function splitComponents(
  body: string,
): { parts: readonly [string, string, string]; alpha: string | null } | null {
  const halves = body.split("/");
  if (halves.length > 2) {
    return null;
  }
  const alpha = halves.length === 2 ? halves[1].trim() : null;
  const tokens = halves[0]
    .trim()
    .split(/[\s,]+/)
    .filter((token) => token.length > 0);
  if (alpha !== null && tokens.length !== 3) {
    return null;
  }
  if (tokens.length === 4) {
    if (alpha !== null) {
      return null;
    }
    return { parts: [tokens[0], tokens[1], tokens[2]], alpha: tokens[3] };
  }
  if (tokens.length !== 3) {
    return null;
  }
  return { parts: [tokens[0], tokens[1], tokens[2]], alpha };
}

/** HSL to 8-bit sRGB, with the hue wrapped and the rest clamped. */
function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const angle = normalizeHue(hue);
  const sat = clamp(saturation, 0, 1);
  const light = clamp(lightness, 0, 1);

  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const second = chroma * (1 - Math.abs(((angle / 60) % 2) - 1));
  const base = light - chroma / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (angle < 60) {
    r = chroma;
    g = second;
  } else if (angle < 120) {
    r = second;
    g = chroma;
  } else if (angle < 180) {
    g = chroma;
    b = second;
  } else if (angle < 240) {
    g = second;
    b = chroma;
  } else if (angle < 300) {
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
 * One linear-light sRGB channel as a byte, clamped into the cube first.
 *
 * This is the gamut clamp: OKLCH can name colours outside sRGB (a more
 * saturated green than the display can show, for instance), and its linear
 * channels then fall outside `[0, 1]`. Clamping each channel is the simple,
 * predictable thing to do - it lands the colour on the nearest face of the
 * cube - and it is why no channel can come back negative or above 255.
 */
function linearToRgbByte(channel: number): number {
  const linear = clamp(channel, 0, 1);
  const encoded =
    linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return toRgbByte(encoded * 255);
}

/**
 * OKLCH to 8-bit sRGB.
 *
 * OKLab is Björn Ottosson's perceptual space; the matrices below are the
 * published ones (the same constants `colorMetrics.ts` uses in the other
 * direction for CIELAB, but a different space: OKLab is a better fit for
 * colour *picking*, CIELAB for measured *differences*). An out-of-sRGB
 * colour is clamped into the cube rather than returned as an out-of-range
 * channel.
 */
function oklchToRgb(lightness: number, chroma: number, hue: number): Rgb {
  const angle = (normalizeHue(hue) * Math.PI) / 180;
  const a = chroma * Math.cos(angle);
  const b = chroma * Math.sin(angle);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: linearToRgbByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToRgbByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToRgbByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** An OKLCH lightness as `0..1` or as `0..100%`, clamped. */
function parseLightness(token: string): number | null {
  const percent = token.endsWith("%");
  const value = parseDecimal(percent ? token.slice(0, -1) : token);
  return value === null ? null : clamp(percent ? value / 100 : value, 0, 1);
}

/** An OKLCH chroma, `0..0.4` by default; `100%` is the CSS reference range. */
function parseChroma(token: string): number | null {
  const percent = token.endsWith("%");
  const value = parseDecimal(percent ? token.slice(0, -1) : token);
  if (value === null) {
    return null;
  }
  return Math.max(0, percent ? (value / 100) * 0.4 : value);
}

/**
 * Parses a colour typed or pasted into a text field.
 *
 * Four syntaxes are understood, and every one of them is normalised to the
 * same result - an 8-bit triple and an alpha:
 *
 * - hex, `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (the `#` is optional);
 * - `hsl()` / `hsla()`, comma or space separated, `%` optional, alpha after a
 *   slash or as a fourth argument;
 * - `oklch()`, `oklch(L C H)` or `oklch(L C H / A)`, clamped into sRGB.
 *
 * Every failure is `null` and nothing throws: this runs on a keystroke, so a
 * half-typed value is an ordinary input, not an error. The caller decides
 * what to do with the alpha; the stored colour stays `#rrggbb`.
 */
export function parseColorInput(text: string): ParsedColor | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }

  const hex = parseHexColor(trimmed);
  if (hex !== null) {
    return hex;
  }

  const call = functionCall(trimmed);
  if (call === null) {
    return null;
  }
  if (call.name !== "hsl" && call.name !== "hsla" && call.name !== "oklch") {
    return null;
  }

  const split = splitComponents(call.body);
  if (split === null) {
    return null;
  }
  const [first, second, third] = split.parts;
  const alpha = parseAlpha(split.alpha);
  if (alpha === null) {
    return null;
  }

  if (call.name === "oklch") {
    const lightness = parseLightness(first);
    const chroma = parseChroma(second);
    const hue = parseDecimal(third.replace(/deg$/i, ""));
    if (lightness === null || chroma === null || hue === null) {
      return null;
    }
    return { rgb: oklchToRgb(lightness, chroma, hue), alpha };
  }

  const hue = parseDecimal(first.replace(/deg$/i, ""));
  const saturation = parsePercentage(second);
  const lightness = parsePercentage(third);
  if (hue === null || saturation === null || lightness === null) {
    return null;
  }
  return { rgb: hslToRgb(hue, saturation / 100, lightness / 100), alpha };
}
