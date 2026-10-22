/**
 * Menu keyboard navigation.
 *
 * The rules are pure so they can be tested in Node: the React layer has no
 * automated tests, but "the arrow keys move to the next item and skip the
 * disabled ones" is a rule worth pinning down.
 */

/**
 * The index of the next item to focus.
 *
 * The disabled items are skipped, and the search wraps around, so the arrow
 * keys always land somewhere. Returns `-1` when there is nothing to focus.
 */
export function nextMenuIndex(
  enabled: readonly boolean[],
  from: number,
  direction: 1 | -1,
): number {
  const count = enabled.length;
  if (count === 0) {
    return -1;
  }
  for (let step = 1; step <= count; step += 1) {
    const index = (((from + direction * step) % count) + count) % count;
    if (enabled[index]) {
      return index;
    }
  }
  return -1;
}

/** The index of the first item that can be focused, or `-1`. */
export function firstMenuIndex(enabled: readonly boolean[]): number {
  return enabled.findIndex((isEnabled) => isEnabled);
}

/** The index of the last item that can be focused, or `-1`. */
export function lastMenuIndex(enabled: readonly boolean[]): number {
  for (let index = enabled.length - 1; index >= 0; index -= 1) {
    if (enabled[index]) {
      return index;
    }
  }
  return -1;
}
