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
 * A value rounded onto the field's own step.
 *
 * The rounding is done in the field's own units, so a value of `0.333` with a
 * step of `0.1` becomes `0.3` rather than an accumulation of binary
 * fractions. The result is clamped again, because rounding can push a value
 * that was inside the range just outside it.
 */
export function snapToStep(value: number, step: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return clampNumber(value, min, max);
  }
  const snapped = Math.round(value / step) * step;
  // The rounding error of the division can leave a value like 0.30000000000004;
  // the step's own precision is the right number of decimals to keep.
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  const factor = 10 ** decimals;
  return clampNumber(Math.round(snapped * factor) / factor, min, max);
}

/**
 * The text the number box keeps, or `null` when the box shows the value.
 *
 * The box keeps what the user typed while that text is still the value the
 * editor holds, so the caret does not jump while they are typing, and drops
 * it as soon as the value changed under it, so the box can never disagree
 * with the editor.
 *
 * A half-typed value - an empty field, or a field holding something that is
 * not a number yet - is always kept: it is the user still typing, and it has
 * not been given a value to disagree with.
 */
export function numericDraft(draft: string | null, value: number): string | null {
  if (draft === null) {
    return null;
  }
  const parsed = parseNumericInput(draft);
  return parsed !== null && parsed !== value ? null : draft;
}
