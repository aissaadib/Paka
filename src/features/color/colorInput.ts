/**
 * What the colour panel does with the colours the user names.
 *
 * The text field accepts a colour string, not a colour: it is where a user
 * pastes `hsl(217 91% 60%)` or `oklch(0.62 0.19 259)`, and it has to answer two
 * questions before the brush can change - is this a colour at all, and can it
 * be stored?
 *
 * The second question is the alpha decision. The app stores `#rrggbb` and
 * paints with it, so a translucent colour cannot be honoured: storing it
 * opaque would paint something the user did not ask for, and storing the
 * alpha would change the project format and the settings file. A translucent
 * colour is therefore **rejected with a message** and the field reverts to
 * the colour the brush actually holds - the same treatment as garbage, but
 * with a different, true reason. Nothing is silently dropped.
 *
 * The function is pure and total so the behaviour can be tested without a
 * DOM; the component is the thin presentation of its result.
 */

import { parseColorInput, rgbToHex } from "../../utils/color";

/** Why the field refused a colour. */
export type ColorInputRejection =
  /** The text is not a colour in any of the supported syntaxes. */
  | "invalid"
  /** The text is a colour, but not an opaque one. */
  | "translucent";

/** The result of committing the field: the colour to store, or why not. */
export type ColorInputOutcome =
  | { readonly kind: "applied"; readonly color: string }
  | {
      readonly kind: "rejected";
      /** The colour to show in the field: the last valid one, unchanged. */
      readonly color: string;
      readonly reason: ColorInputRejection;
      /** What the field says, in words a user can act on. */
      readonly message: string;
    };

/**
 * Resolves one commit of the text field.
 *
 * `current` is the colour the brush already holds - the last valid colour -
 * and it is what a rejected input reverts to. The function never throws and
 * never invents a colour: every path either returns a `#rrggbb` string or
 * returns `current` together with the reason it did.
 */
export function resolveColorInput(text: string, current: string): ColorInputOutcome {
  const trimmed = text.trim();
  const parsed = parseColorInput(trimmed);

  if (parsed === null) {
    return {
      kind: "rejected",
      color: current,
      reason: "invalid",
      message:
        trimmed === ""
          ? `Enter a colour - kept ${current}`
          : `Not a colour - kept ${current}`,
    };
  }

  if (parsed.alpha < 1) {
    return {
      kind: "rejected",
      color: current,
      reason: "translucent",
      message: `Not a solid colour (alpha below 1) - kept ${current}`,
    };
  }

  return { kind: "applied", color: rgbToHex(parsed.rgb) };
}

/**
 * The value a native colour input accepts.
 *
 * `input[type=color]` only understands `#rrggbb`. A brush colour written some
 * other way - a short `#rgb`, a named colour - cannot be shown in one, so the
 * control falls back to black rather than rendering nothing. The brush colour
 * itself is untouched: this only decides what the control draws.
 */
export function toColorInputValue(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
}
