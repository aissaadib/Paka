/**
 * Comparing two colours: WCAG contrast and CIEDE2000.
 *
 * `colorMetrics.ts` answers "how does this ink read on the paper?". This
 * module answers the other question the colour panel asks: **"what is the
 * difference between these two colours?"** The same pair is measured twice,
 * because the two numbers answer different things:
 *
 * - the **WCAG 2.2 contrast ratio** is a lightness comparison and says
 *   whether text is likely to be legible;
 * - **CIEDE2000** is a perceptual distance and says how different the colours
 *   look, independent of which one is lighter.
 *
 * Both are defined for solid sRGB colours. Paka stores and paints `#rrggbb`,
 * and the colour field refuses to store an alpha below 1, so a translucent
 * value is reported as *not a solid colour* rather than silently composited
 * over a background the user did not choose. A malformed string is reported
 * separately from a translucent one.
 *
 * The module is pure and total: it reads no DOM, no canvas and no clock; it
 * never throws, and a value it cannot measure becomes `null` with a reason,
 * never `NaN` or `Infinity`.
 */

import { parseHexColor } from "./color";
import type { Rgb } from "./color";
import { contrastRatio, deltaE2000, srgbToLab } from "./colorMetrics";

/** Why one side of a comparison cannot be measured. */
export type ColorPairIssue =
  /** The text is not a hex colour at all. */
  | "invalid"
  /** The text is a hex colour, but its alpha is below 1. */
  | "translucent";

/** How a contrast ratio relates to the common WCAG 2.2 text thresholds. */
export type ContrastGuidanceLevel =
  /** 7:1 and above. */
  | "aaa-body"
  /** 4.5:1 and above. */
  | "aa-body"
  /** 3:1 and above. */
  | "aa-large"
  /** Below 3:1. */
  | "below-aa";

/** The sentence and the threshold behind one guidance level. */
export interface ContrastGuidance {
  readonly level: ContrastGuidanceLevel;
  /** The sentence the panel shows. */
  readonly label: string;
  /** The threshold the sentence refers to, in `:1`. */
  readonly minimum: number;
}

/**
 * The wording for each level.
 *
 * The labels name the *threshold*, not the whole interface: a measured pair
 * can meet a text-contrast threshold and still be inaccessible for other
 * reasons (size, font, colour alone, focus states), so the panel also says
 * that this is guidance rather than an audit.
 */
export const CONTRAST_GUIDANCE_LABELS: Readonly<
  Record<ContrastGuidanceLevel, string>
> = {
  "aaa-body": "Meets AAA body text (7:1)",
  "aa-body": "Meets AA body text (4.5:1)",
  "aa-large": "Meets AA large text (3:1)",
  "below-aa": "Below AA text (3:1)",
};

/** The threshold each level is about, in `:1`. */
const GUIDANCE_MINIMUMS: Readonly<Record<ContrastGuidanceLevel, number>> = {
  "aaa-body": 7,
  "aa-body": 4.5,
  "aa-large": 3,
  "below-aa": 3,
};

/**
 * The strongest WCAG 2.2 text threshold a ratio meets.
 *
 * The comparison uses the **unrounded** ratio, so `4.499` is "AA large"
 * even though the panel prints it as `4.5:1`. A non-finite ratio falls into
 * the lowest level rather than producing a made-up pass.
 */
export function contrastGuidance(ratio: number): ContrastGuidance {
  let level: ContrastGuidanceLevel = "below-aa";
  if (Number.isFinite(ratio)) {
    if (ratio >= GUIDANCE_MINIMUMS["aaa-body"]) {
      level = "aaa-body";
    } else if (ratio >= GUIDANCE_MINIMUMS["aa-body"]) {
      level = "aa-body";
    } else if (ratio >= GUIDANCE_MINIMUMS["aa-large"]) {
      level = "aa-large";
    }
  }
  return {
    level,
    label: CONTRAST_GUIDANCE_LABELS[level],
    minimum: GUIDANCE_MINIMUMS[level],
  };
}

/** What the panel knows about one pair of colours. */
export interface ColorPairReport {
  /** The first colour, parsed. `null` when it cannot be measured. */
  readonly ink: Rgb | null;
  /** The second colour, parsed. `null` when it cannot be measured. */
  readonly against: Rgb | null;
  /** The WCAG contrast ratio, or `null` when either side is unmeasurable. */
  readonly contrast: number | null;
  /** The CIEDE2000 difference, or `null` when either side is unmeasurable. */
  readonly deltaE: number | null;
  /** The guidance for `contrast`, or `null` when there is no ratio. */
  readonly guidance: ContrastGuidance | null;
  /** Why the first colour cannot be measured, or `null` when it can. */
  readonly inkIssue: ColorPairIssue | null;
  /** Why the second colour cannot be measured, or `null` when it can. */
  readonly againstIssue: ColorPairIssue | null;
}

/**
 * Parses one side of the comparison, keeping "not a colour" apart from
 * "not a solid colour": they are different facts, and the panel says which.
 */
function solidColor(value: string): { readonly rgb: Rgb } | ColorPairIssue {
  if (typeof value !== "string" || value.trim() === "") {
    return "invalid";
  }
  const parsed = parseHexColor(value);
  if (parsed === null) {
    return "invalid";
  }
  if (!(parsed.alpha >= 1)) {
    return "translucent";
  }
  return { rgb: parsed.rgb };
}

/**
 * Measures the same pair with both metrics.
 *
 * A colour is only measured when it is solid: the app paints `#rrggbb`, so a
 * translucent colour has no honest stand-in. When either side is unreadable
 * both metrics are `null` and the report carries the reason(s); when both are
 * readable every returned number is finite.
 */
export function compareColorPair(ink: string, against: string): ColorPairReport {
  const inkParsed = solidColor(ink);
  const againstParsed = solidColor(against);

  const inkRgb = typeof inkParsed === "string" ? null : inkParsed.rgb;
  const againstRgb = typeof againstParsed === "string" ? null : againstParsed.rgb;

  const measurable = inkRgb !== null && againstRgb !== null;
  const contrast = measurable ? contrastRatio(inkRgb, againstRgb) : null;
  const deltaE = measurable
    ? deltaE2000(srgbToLab(inkRgb), srgbToLab(againstRgb))
    : null;

  return {
    ink: inkRgb,
    against: againstRgb,
    contrast,
    deltaE,
    guidance: contrast === null ? null : contrastGuidance(contrast),
    inkIssue: typeof inkParsed === "string" ? inkParsed : null,
    againstIssue: typeof againstParsed === "string" ? againstParsed : null,
  };
}

/** The human-readable reason one side cannot be measured. */
export function describeColorIssue(issue: ColorPairIssue): string {
  return issue === "translucent"
    ? "not a solid colour (alpha below 1)"
    : "not a hex value";
}
