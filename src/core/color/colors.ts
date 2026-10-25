/**
 * The two colours the artist paints with.
 *
 * The **ink** is the colour a left-button gesture paints with and the **alt**
 * colour is the one a right-button gesture paints with. Both are editor
 * state, resolved once at press time, so changing either never repaints what
 * is already drawn.
 *
 * The two questions the toolbar and the colour dock both ask about the pair -
 * "can these be swapped?" and "are these the defaults?" - are asked here, so
 * the two places cannot answer them differently.
 */

import { DEFAULT_BRUSH, DEFAULT_SECONDARY_COLOR } from "../brushes/defaults";

/**
 * True when the two colours differ, so a swap would change something.
 *
 * Swapping two equal colours is a no-op, so the control that offers it is
 * disabled while they are equal.
 */
export function canSwapColors(primary: string, secondary: string): boolean {
  return primary !== secondary;
}

/**
 * True when both colours are the ones a fresh session starts with.
 *
 * The reset that puts them back is disabled while that is the case, so the
 * control says whether there is anything to reset.
 */
export function isDefaultColors(primary: string, secondary: string): boolean {
  return primary === DEFAULT_BRUSH.color && secondary === DEFAULT_SECONDARY_COLOR;
}
