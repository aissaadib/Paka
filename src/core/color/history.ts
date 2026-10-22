/**
 * The recent-colours history: the colours the artist has picked, most recent
 * first.
 *
 * It is **session state**. A colour history is a convenience, not a
 * preference: it is bounded, it is cleared by a button, and it is not written
 * to the settings file. The palette is the thing that survives a restart; the
 * history is what happened in this sitting.
 *
 * The rules are deliberately small so the order is predictable:
 *
 *  - the newest colour is first;
 *  - a colour that is picked again moves to the front instead of appearing
 *    twice, so the list is a set ordered by recency;
 *  - the list is bounded, and the oldest colour falls off the end.
 *
 * Every colour is a plain `#rrggbb`. The app stores no alpha, so a colour
 * that cannot be painted is not a colour the history can hold.
 */

import { hexToRgb, rgbToHex } from "../../utils/color";

/**
 * How many recent colours are kept.
 *
 * Enough to cover a working session's worth of picking without the grid
 * turning into a wall, and small enough that the list stays readable in one
 * glance.
 */
export const COLOR_HISTORY_LIMIT = 24;

/** A colour as a lowercase `#rrggbb`, or `null` when it is not a colour. */
function normalizeHistoryColor(color: unknown): string | null {
  if (typeof color !== "string") {
    return null;
  }
  const rgb = hexToRgb(color.trim());
  return rgb === null ? null : rgbToHex(rgb);
}

/**
 * Records a colour as recently used.
 *
 * The colour moves to the front of the list, any earlier entry of the same
 * colour is dropped, and the list is trimmed to {@link COLOR_HISTORY_LIMIT}.
 * A colour that is not a colour is refused and the list is returned unchanged
 * - the same array, so a caller can compare by identity.
 */
export function pushColorHistory(
  history: readonly string[],
  color: string,
): readonly string[] {
  const normalized = normalizeHistoryColor(color);
  if (normalized === null) {
    return history;
  }
  const next = [normalized, ...history.filter((entry) => entry !== normalized)];
  return next.length > COLOR_HISTORY_LIMIT
    ? next.slice(0, COLOR_HISTORY_LIMIT)
    : next;
}

/**
 * Reads a history out of an untrusted value.
 *
 * The newest colour is kept first, a colour that appears twice is kept once,
 * a colour that is not a colour is dropped, and the list is trimmed to
 * {@link COLOR_HISTORY_LIMIT}. A value that is not a list at all is an empty
 * history.
 */
export function normalizeColorHistory(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const history: string[] = [];
  for (const entry of value) {
    if (history.length >= COLOR_HISTORY_LIMIT) {
      break;
    }
    const normalized = normalizeHistoryColor(entry);
    if (normalized === null || history.includes(normalized)) {
      continue;
    }
    history.push(normalized);
  }
  return history;
}

/** Field-wise comparison, used to skip redundant publishes. */
export function colorHistoryEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}
