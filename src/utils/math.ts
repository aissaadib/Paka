/** Small numeric helpers used by the drawing engine hot paths. */

/** Clamps `value` into `[min, max]`. Non-finite values collapse to `min`. */
export function clamp(value: number, min: number, max: number): number {
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

/** Linear interpolation between `a` and `b` with `t` in `[0, 1]`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function distance(x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return Math.sqrt(dx * dx + dy * dy);
}

export function nearlyEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** Rounds to `decimals` places, used for display-only values. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Maps a value into a `[0, 1]` slider position on a logarithmic scale.
 * Used for brush size, where the interesting range spans two orders of
 * magnitude and a linear slider would be useless at the low end.
 */
export function toLogPosition(value: number, min: number, max: number): number {
  if (min <= 0 || max <= min) {
    return 0;
  }
  return clamp(Math.log(clamp(value, min, max) / min) / Math.log(max / min), 0, 1);
}

/** Inverse of {@link toLogPosition}. */
export function fromLogPosition(position: number, min: number, max: number): number {
  if (min <= 0 || max <= min) {
    return min;
  }
  const t = clamp(position, 0, 1);
  return min * (max / min) ** t;
}
