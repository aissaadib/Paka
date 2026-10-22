/**
 * Numeric editing rules for the brush and tool controls.
 *
 * The number box is a text field before it is a number: it can be empty,
 * half-typed, or hold something that is not a number at all. None of those
 * states may reach the editor - a brush whose size is `NaN` would break the
 * rasterizer, and a brush whose size is `0` would vanish - so the rules live
 * here, away from the DOM, where they can be exercised by a test.
 *
 * Three rules run through the module:
 *
 *  1. A value that cannot be read is **not** a value. The field keeps what it
 *     had and waits for the next keystroke.
 *  2. A value that is out of range is **clamped**, not rejected: `120` for a
 *     100 % field means "the maximum", and the number the user typed is
 *     corrected in place so the two never disagree.
 *  3. A keyboard step is **never** bigger than the field's own step, and a
 *     fine step is never bigger than the coarse one.
 */

import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, stepBrushSize } from "./defaults";

/** A Shift + arrow moves a tenth of the field's own step. */
export const FINE_STEP_FACTOR = 0.1;

/** A Page Up / Page Down moves ten of the field's own steps. */
export const COARSE_STEP_FACTOR = 10;

/**
 * Which step a key press asks for.
 *
 * `fine` is the last fraction of a step, for the adjustment that has to be
 * exact; `coarse` is a jump, for the value that is nearly right.
 */
export type StepMode = "normal" | "fine" | "coarse";

/**
 * The size of one step, for the mode the key press asked for.
 *
 * The three are always ordered: a fine step is a tenth of the normal one and
 * a coarse step is ten times it.
 */
export function stepSize(step: number, mode: StepMode): number {
  if (mode === "fine") {
    return step * FINE_STEP_FACTOR;
  }
  if (mode === "coarse") {
    return step * COARSE_STEP_FACTOR;
  }
  return step;
}

/**
 * The number a text field holds, or `null` when it does not hold one.
 *
 * An empty field and a field holding something that is not a number are both
 * "no value yet". `Number("")` is `0`, which is why the empty string is
 * rejected before the conversion: without that check, clearing the field
 * would snap the brush to its minimum instead of leaving it alone.
 */
export function parseNumericInput(raw: string): number | null {
  const text = raw.trim();
  if (text === "") {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** A value inside `[min, max]`; a non-finite value collapses to `min`. */
export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * A value moved by `delta` and kept inside `[min, max]`.
 *
 * The delta is added first and the result is clamped, so a step at a bound
 * stops at the bound instead of wrapping or overshooting.
 */
export function stepValue(
  current: number,
  delta: number,
  min: number,
  max: number,
): number {
  const base = Number.isFinite(current) ? current : min;
  return clampNumber(base + delta, min, max);
}

/**
 * The step the brush size moves by under the keyboard.
 *
 * The normal step is the one the `[` / `]` shortcuts use: a pixel for a small
 * brush, a tenth of the size for a large one. A fine step is a tenth of that
 * - the last fraction of a pixel, for the size that has to be exact - and a
 * coarse step is ten times it.
 */
export function brushSizeStep(
  current: number,
  direction: 1 | -1,
  mode: StepMode = "normal",
): number {
  const base = stepBrushSize(current, direction);
  const delta = base - current;
  if (mode === "fine") {
    return clampNumber(current + delta / 10, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
  }
  if (mode === "coarse") {
    return clampNumber(current + delta * 10, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
  }
  return base;
}
