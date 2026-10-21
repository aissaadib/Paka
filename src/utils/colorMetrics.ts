/**
 * Colour metrics: how far apart two colours are, in two different senses.
 *
 * The app asks two questions about a colour, and they have two different
 * answers:
 *
 * - **"Will this ink read against this paper?"** is a question about
 *   *lightness*. WCAG 2.2 defines a relative luminance for an sRGB colour and
 *   a contrast ratio between two of them, together with the thresholds a
 *   document has to meet (4.5:1 for body text, 3:1 for large text and for
 *   the non-text parts of a user interface). See
 *   <https://www.w3.org/TR/WCAG22/#dfn-relative-luminance> and
 *   <https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio>.
 * - **"How different is this from the colour I already have?"** is a question
 *   about *perceived difference*. CIEDE2000 (CIE 142-2001 / ISO 11664-6) is
 *   the published standard for small colour differences: it compares two
 *   CIELAB colours, and it is the only one of the CIE formulas that stays
 *   meaningful in the blue region and at low chroma, where the plain
 *   Lab distance over-reports.
 *
 * The two are not interchangeable, and neither may stand in for the other: a
 * dark blue and a dark red are far apart to the eye and yet almost equally
 * bright, so a contrast ratio says nothing about hue, and a colour difference
 * says nothing about whether a mark will be readable. The readout therefore
 * shows the two numbers as two answers.
 *
 * The module is **pure**: it reads no DOM, no canvas and no clock, and it
 * never throws. Every function is **total**: a broken input produces a usable
 * result rather than a `NaN`. The metric functions fold a broken channel
 * into the sRGB cube, and the formatters render a value that is not a number
 * as *unknown*, so no `NaN` can reach the readout. It also knows nothing
 * about CSS colour strings: parsing is the caller's business (`hexToRgb` in
 * `./color` does it), and a colour that is not a hex colour never reaches
 * the arithmetic.
 */

import { hexToRgb } from "./color";
import type { Rgb } from "./color";

/**
 * A CIELAB colour.
 *
 * The field names are the CIE ones, so the published formula and the
 * published verification data can be read against the code: `L` is the
 * lightness (`0` is black, `100` is white), `a` runs from green to red and
 * `b` from blue to yellow.
 */
export interface Lab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

/** One entry of a palette: the colour as the app writes it, and its value. */
export interface PaletteEntry {
  /** The colour as a hex string, e.g. `#3b82f6`. */
  readonly hex: string;
  /** The same colour as an 8-bit sRGB triple. */
  readonly rgb: Rgb;
}

/** The palette entry closest to a colour, and how far away it is. */
export interface PaletteMatch extends PaletteEntry {
  /** The CIEDE2000 distance between the two colours. */
  readonly deltaE: number;
}

/**
 * The sRGB breakpoint of the transfer function, on the *normalised* channel
 * (0..1), not on the raw byte. WCAG 2.2 uses 0.04045; the older 0.03928 of
 * WCAG 1.0 gives slightly different values at the dark end and must not be
 * mixed in.
 */
const LINEAR_BREAKPOINT = 0.04045;

/** The exponent of the sRGB transfer function above the breakpoint. */
const LINEAR_GAMMA = 2.4;

/** The sRGB coefficients of WCAG 2.2's relative luminance. */
const LUMINANCE_RED = 0.2126;
const LUMINANCE_GREEN = 0.7152;
const LUMINANCE_BLUE = 0.0722;

/** The offset the contrast ratio adds to each luminance. */
const CONTRAST_OFFSET = 0.05;

/** The D65 white point of sRGB, in the CIEXYZ the Lab conversion uses. */
const WHITE_POINT_X = 0.95047;
const WHITE_POINT_Y = 1;
const WHITE_POINT_Z = 1.08883;

/** The sRGB-to-CIEXYZ matrix (D65). */
const XYZ_RED = [0.4124564, 0.3575761, 0.1804375];
const XYZ_GREEN = [0.2126729, 0.7151522, 0.072175];
const XYZ_BLUE = [0.0193339, 0.119192, 0.9503041];

/** The cube root of the CIELAB linear segment's breakpoint, `(6/29)^3`. */
const LAB_BREAKPOINT_CUBED = (6 / 29) ** 3;

/** The CIELAB linear segment's slope, `3 * (6/29)^2`. */
const LAB_LINEAR_SLOPE = 3 * (6 / 29) ** 2;

/** The CIELAB linear segment's offset, `4/29`. */
const LAB_LINEAR_OFFSET = 4 / 29;

/**
 * The scale of the CIEDE2000 hue-rotation term.
 *
 * The standard's `25^7` appears in the two places where a chroma is raised to
 * the seventh power, so it is kept as one named constant.
 */
const CHROMA_SCALE = 25 ** 7;

/**
 * Clamps one channel into `0..255` and folds a broken channel to `0`.
 *
 * A colour that reaches the metrics has been parsed from bytes, but the
 * functions are public, so they defend themselves: `NaN` would poison every
 * result downstream, and an out-of-range channel would leave the sRGB cube.
 */
function toChannel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return value;
}

/** The sRGB transfer function: an encoded channel to a linear one. */
function toLinear(channel: number): number {
  const normalized = channel / 255;
  if (normalized <= LINEAR_BREAKPOINT) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** LINEAR_GAMMA;
}

/**
 * The relative luminance of a colour, in `0..1`, as WCAG 2.2 defines it.
 *
 * Black is `0` and white is `1`; the value is the linear-light share of the
 * colour that a display shows.
 */
export function relativeLuminance(color: Rgb): number {
  const red = toLinear(toChannel(color.r));
  const green = toLinear(toChannel(color.g));
  const blue = toLinear(toChannel(color.b));
  return (
    LUMINANCE_RED * red + LUMINANCE_GREEN * green + LUMINANCE_BLUE * blue
  );
}

/**
 * The WCAG 2.2 contrast ratio of two colours, in `1..21`.
 *
 * The ratio is symmetric: the lighter colour is always the numerator, so the
 * argument order does not matter. Two identical colours give `1`, and black
 * against white gives the maximum of `21`.
 */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const lighter = a > b ? a : b;
  const darker = a > b ? b : a;
  const ratio = (lighter + CONTRAST_OFFSET) / (darker + CONTRAST_OFFSET);
  // The float arithmetic can land a hair outside the range the formula
  // defines (21 comes out as 21.000000000000004), so the result is pinned.
  if (!Number.isFinite(ratio)) {
    return 1;
  }
  if (ratio < 1) {
    return 1;
  }
  return ratio > 21 ? 21 : ratio;
}

/** The CIELAB auxiliary function: a CIEXYZ coordinate to its cube root or to
 * the linear segment near zero. */
function labAuxiliary(value: number): number {
  if (value > LAB_BREAKPOINT_CUBED) {
    return Math.cbrt(value);
  }
  return value / LAB_LINEAR_SLOPE + LAB_LINEAR_OFFSET;
}

/**
 * The CIELAB (D65) coordinates of an 8-bit sRGB colour.
 *
 * The white point is the one sRGB is defined against, so a colour converted
 * here and converted back through the same matrices is the same colour.
 */
export function srgbToLab(color: Rgb): Lab {
  const red = toLinear(toChannel(color.r));
  const green = toLinear(toChannel(color.g));
  const blue = toLinear(toChannel(color.b));

  const x =
    XYZ_RED[0] * red + XYZ_RED[1] * green + XYZ_RED[2] * blue;
  const y =
    XYZ_GREEN[0] * red + XYZ_GREEN[1] * green + XYZ_GREEN[2] * blue;
  const z =
    XYZ_BLUE[0] * red + XYZ_BLUE[1] * green + XYZ_BLUE[2] * blue;

  const fx = labAuxiliary(x / WHITE_POINT_X);
  const fy = labAuxiliary(y / WHITE_POINT_Y);
  const fz = labAuxiliary(z / WHITE_POINT_Z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/**
 * The hue of a CIELAB colour, in degrees, in `0..360`.
 *
 * A colour with no chroma has no hue at all; the standard defines its hue as
 * `0`, and that is what this returns rather than whatever `atan2` happens to
 * say about `0, 0`.
 */
function labHue(a: number, b: number): number {
  if (a === 0 && b === 0) {
    return 0;
  }
  const degrees = (Math.atan2(b, a) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

/**
 * An angle in degrees as radians.
 *
 * The standard writes its hue angles in degrees, but the trigonometric
 * functions work in radians, so every angle that reaches one of them goes
 * through here.
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * A CIELAB coordinate that is a number, whatever it was handed.
 *
 * `deltaE2000` is a public function and could be handed anything, so it
 * defends itself: a `NaN` coordinate would make every term below it `NaN`.
 */
function toLabValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * The CIEDE2000 colour difference between two CIELAB colours.
 *
 * The formula is the published one (CIE 142-2001 / ISO 11664-6) with the
 * standard's default weights `kL = kC = kH = 1`. The result is `0` for two
 * identical colours and grows with the perceptual distance between the two;
 * a difference of about `1` is roughly one just-noticeable difference.
 *
 * The arguments are any two CIELAB colours: the function does not clamp the
 * lightness, because the standard's weights - not a range check - are what
 * make the formula behave.
 */
export function deltaE2000(first: Lab, second: Lab): number {
  const lightnessFirst = toLabValue(first.L);
  const aFirst = toLabValue(first.a);
  const bFirst = toLabValue(first.b);
  const lightnessSecond = toLabValue(second.L);
  const aSecond = toLabValue(second.a);
  const bSecond = toLabValue(second.b);

  const lightnessDifference = lightnessSecond - lightnessFirst;

  const chromaFirst = Math.hypot(aFirst, bFirst);
  const chromaSecond = Math.hypot(aSecond, bSecond);
  const chromaMean = (chromaFirst + chromaSecond) / 2;

  // The chroma mean decides how much the hue axes are stretched; the
  // seventh power keeps the correction away from the near-neutral colours,
  // where it would otherwise distort them.
  const chromaMeanSeventh = chromaMean ** 7;
  const chromaCorrection =
    0.5 * (1 - Math.sqrt(chromaMeanSeventh / (chromaMeanSeventh + CHROMA_SCALE)));

  const aFirstPrime = (1 + chromaCorrection) * aFirst;
  const aSecondPrime = (1 + chromaCorrection) * aSecond;

  const chromaFirstPrime = Math.hypot(aFirstPrime, bFirst);
  const chromaSecondPrime = Math.hypot(aSecondPrime, bSecond);

  const hueFirstPrime = labHue(aFirstPrime, bFirst);
  const hueSecondPrime = labHue(aSecondPrime, bSecond);

  const chromaDifference = chromaSecondPrime - chromaFirstPrime;

  // The hue difference is taken the short way round the circle.
  const chromaProduct = chromaFirstPrime * chromaSecondPrime;
  let hueDifference = 0;
  if (chromaProduct !== 0) {
    const raw = hueSecondPrime - hueFirstPrime;
    if (raw > 180) {
      hueDifference = raw - 360;
    } else if (raw < -180) {
      hueDifference = raw + 360;
    } else {
      hueDifference = raw;
    }
  }
  const hueTerm = 2 * Math.sqrt(chromaProduct) * Math.sin(toRadians(hueDifference) / 2);

  const lightnessMean = (lightnessFirst + lightnessSecond) / 2;
  const chromaMeanPrime = (chromaFirstPrime + chromaSecondPrime) / 2;

  // The mean hue: the simple mean unless the two hues sit on opposite sides
  // of the circle, in which case the mean has to go the long way round.
  let hueMeanPrime: number;
  if (chromaProduct === 0) {
    hueMeanPrime = hueFirstPrime + hueSecondPrime;
  } else if (Math.abs(hueFirstPrime - hueSecondPrime) <= 180) {
    hueMeanPrime = (hueFirstPrime + hueSecondPrime) / 2;
  } else if (hueFirstPrime + hueSecondPrime < 360) {
    hueMeanPrime = (hueFirstPrime + hueSecondPrime + 360) / 2;
  } else {
    hueMeanPrime = (hueFirstPrime + hueSecondPrime - 360) / 2;
  }

  // The weighting of the hue term: a rotation term that follows the mean hue.
  const hueWeighting =
    1 -
    0.17 * Math.cos(toRadians(hueMeanPrime - 30)) +
    0.24 * Math.cos(toRadians(2 * hueMeanPrime)) +
    0.32 * Math.cos(toRadians(3 * hueMeanPrime + 6)) -
    0.2 * Math.cos(toRadians(4 * hueMeanPrime - 63));

  const hueRotationAngle = 30 * Math.exp(-(((hueMeanPrime - 275) / 25) ** 2));
  const chromaMeanPrimeSeventh = chromaMeanPrime ** 7;
  const rotationFactor =
    2 *
    Math.sqrt(
      chromaMeanPrimeSeventh / (chromaMeanPrimeSeventh + CHROMA_SCALE),
    );

  const lightnessWeight =
    1 +
    (0.015 * (lightnessMean - 50) ** 2) /
      Math.sqrt(20 + (lightnessMean - 50) ** 2);
  const chromaWeight = 1 + 0.045 * chromaMeanPrime;
  const hueWeight = 1 + 0.015 * chromaMeanPrime * hueWeighting;
  const rotationTerm = -Math.sin(toRadians(2 * hueRotationAngle)) * rotationFactor;

  const lightnessTerm = lightnessDifference / lightnessWeight;
  const chromaTerm = chromaDifference / chromaWeight;
  const hueTermWeighted = hueTerm / hueWeight;

  const total =
    lightnessTerm ** 2 +
    chromaTerm ** 2 +
    hueTermWeighted ** 2 +
    rotationTerm * chromaTerm * hueTermWeighted;

  return total < 0 ? 0 : Math.sqrt(total);
}

/**
 * The palette entry perceptually closest to a colour.
 *
 * The distance is CIEDE2000, so "closest" means closest to the eye rather
 * than closest in RGB. `null` means there was nothing to compare against -
 * an empty palette, not a failure.
 */
export function nearestByDeltaE(
  color: Rgb,
  palette: readonly PaletteEntry[],
): PaletteMatch | null {
  const target = srgbToLab(color);
  let best: PaletteMatch | null = null;
  for (const entry of palette) {
    const deltaE = deltaE2000(target, srgbToLab(entry.rgb));
    if (best === null || deltaE < best.deltaE) {
      best = { hex: entry.hex, rgb: entry.rgb, deltaE };
    }
  }
  return best;
}

/** How a contrast ratio is described in words. */
export type ContrastBand =
  /** 7:1 and above: the WCAG 2.2 AAA threshold for body text. */
  | "excellent"
  /** 4.5:1 and above: the WCAG 2.2 AA threshold for body text. */
  | "good"
  /** 3:1 and above: the WCAG 2.2 AA threshold for large text and non-text. */
  | "fair"
  /** Below 3:1. */
  | "low";

/**
 * The wording of each band.
 *
 * The bands name the *contrast*, never the visibility: a contrast ratio is a
 * luminance comparison and says nothing about hue, so promising that a
 * colour "will be seen" would be a claim the number does not support.
 */
export const CONTRAST_BAND_LABELS: Readonly<Record<ContrastBand, string>> = {
  excellent: "Excellent contrast",
  good: "Good contrast",
  fair: "Fair contrast",
  low: "Low contrast",
};

/**
 * The band a contrast ratio falls in.
 *
 * The thresholds are WCAG 2.2's own. The band is taken from the unrounded
 * ratio, so a ratio of `4.499` is "fair" even though it would be printed as
 * `4.5`.
 */
export function contrastBand(ratio: number): ContrastBand {
  if (!Number.isFinite(ratio)) {
    return "low";
  }
  if (ratio >= 7) {
    return "excellent";
  }
  if (ratio >= 4.5) {
    return "good";
  }
  if (ratio >= 3) {
    return "fair";
  }
  return "low";
}

/**
 * The word the readout shows in place of a number it does not have.
 *
 * It is the same word for every case, so a value that is missing reads as
 * missing rather than as a measurement.
 */
const UNKNOWN = "unknown";

/** A contrast ratio as it is shown: `17.8:1`. */
export function formatContrastRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return UNKNOWN;
  }
  return `${ratio.toFixed(1)}:1`;
}

/**
 * A contrast ratio as it is spoken: `17.8 to 1`.
 *
 * A screen reader reads `17.8:1` as "seventeen point eight colon one", so the
 * visible text carries the spoken form alongside it.
 */
export function formatSpokenRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return UNKNOWN;
  }
  return `${ratio.toFixed(1)} to 1`;
}

/** A CIEDE2000 distance as it is shown: `0.35`. */
export function formatDeltaE(deltaE: number): string {
  if (!Number.isFinite(deltaE)) {
    return UNKNOWN;
  }
  return deltaE.toFixed(2);
}

/**
 * Why a number the readout wanted is not there.
 *
 * The reasons are kept apart because they are different facts: a palette that
 * holds no entries is not the same as a palette whose entries cannot be read.
 */
export type MetricUnavailable =
  /** The colour being measured is not a hex colour. */
  | "ink"
  /** The paper colour is not a hex colour. */
  | "paper"
  /** The palette holds no entries at all. */
  | "palette-empty"
  /** The palette holds entries, but none of them is a readable colour. */
  | "palette-unreadable";

/**
 * What the readout knows about one ink on one paper.
 *
 * Every field that cannot be computed is `null` rather than a stand-in
 * number, so the readout can say that it does not know instead of showing a
 * `0` that means nothing. The two `*Reason` fields say *why* it does not
 * know, so the words it shows are true.
 */
export interface ColorMetricReport {
  /** The ink, parsed. `null` when the stored colour is not a hex colour. */
  readonly ink: Rgb | null;
  /** The paper, parsed. `null` when the stored colour is not a hex colour. */
  readonly paper: Rgb | null;
  /** The WCAG contrast ratio of the two, or `null` when either is unreadable. */
  readonly ratio: number | null;
  /** The band the ratio falls in, or `null` when there is no ratio. */
  readonly band: ContrastBand | null;
  /** The closest palette entry, or `null` when there is nothing to compare. */
  readonly nearest: PaletteMatch | null;
  /** Why there is no contrast ratio, or `null` when there is one. */
  readonly ratioReason: MetricUnavailable | null;
  /** Why there is no nearest swatch, or `null` when there is one. */
  readonly nearestReason: MetricUnavailable | null;
}

/**
 * Measures one ink against one paper.
 *
 * Both colours arrive as the strings the app stores, because that is the
 * only thing the app has: a project file may hold any non-empty string as a
 * colour, and a colour that is not a hex colour cannot be measured. Such a
 * colour produces `null` fields and an *unknown* readout, never a crash and
 * never a made-up number.
 */
export function measureColor(
  ink: string,
  paper: string,
  palette: readonly string[],
): ColorMetricReport {
  const inkRgb = hexToRgb(ink);
  const paperRgb = hexToRgb(paper);

  // A palette entry that is not a hex colour is dropped rather than
  // measured, but it is counted: a palette that holds entries and has no
  // readable one is a different fact from a palette that holds none.
  const entries: PaletteEntry[] = [];
  for (const hex of palette) {
    const rgb = hexToRgb(hex);
    if (rgb !== null) {
      entries.push({ hex, rgb });
    }
  }

  const ratio =
    inkRgb !== null && paperRgb !== null ? contrastRatio(inkRgb, paperRgb) : null;

  let ratioReason: MetricUnavailable | null = null;
  if (ratio === null) {
    ratioReason = inkRgb === null ? "ink" : "paper";
  }

  let nearestReason: MetricUnavailable | null = null;
  if (inkRgb === null) {
    nearestReason = "ink";
  } else if (palette.length === 0) {
    nearestReason = "palette-empty";
  } else if (entries.length === 0) {
    nearestReason = "palette-unreadable";
  }

  return {
    ink: inkRgb,
    paper: paperRgb,
    ratio,
    band: ratio === null ? null : contrastBand(ratio),
    nearest: inkRgb === null ? null : nearestByDeltaE(inkRgb, entries),
    ratioReason,
    nearestReason,
  };
}

/**
 * The wording the readout uses when it has nothing to show.
 *
 * The reasons are stated rather than implied: a readout that silently shows
 * nothing looks broken, and one that shows `0.00` looks like a measurement.
 */
export const UNKNOWN_REASONS: Readonly<Record<MetricUnavailable, string>> = {
  ink: "the colour is not a hex value",
  paper: "the paper colour is not a hex value",
  "palette-empty": "the palette is empty",
  "palette-unreadable": "the palette holds no readable colour",
};
