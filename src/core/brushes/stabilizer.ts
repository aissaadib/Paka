/**
 * Stroke stabilization.
 *
 * The stabilizer decides **which samples a stroke stores**, so what it
 * produces is what the stroke draws: in live drawing, in undo/redo, in a
 * reopened file and in an export. It is a capture-time filter, not a
 * rasterization effect, and it belongs to the brush and the eraser only - a
 * shape's geometry comes from the drag, not from a sampled path.
 *
 * Three properties make it usable rather than merely smooth:
 *
 *  - **It is online.** Every sample is filtered as it arrives, from the
 *    filter's own state and the sample before it. Nothing waits for the
 *    stroke to end, so the drawn line keeps up with the pointer.
 *  - **It is bounded.** The filter keeps a fixed window of state, so a long
 *    stroke costs the same as a short one and the lag does not grow with
 *    the stroke's length.
 *  - **It ends where the pointer ended.** A causal filter lags, so the
 *    release runs a short catch-up that lands the last stored sample
 *    exactly on the release point.
 *
 * The filter is a first-order lag: the captured point covers a fraction of
 * the way to the pointer's own position on every sample, and the fraction
 * comes from a **time constant** rather than from a share of the distance.
 * A time constant is a duration, so the same gesture is filtered the same way
 * at 60 Hz and at 240 Hz, and the strength means "the line trails the pointer
 * by this long" rather than "the line covers this share of the gap".
 *
 * The pressure and the timestamp of a sample are **not** filtered. The
 * stored pressure is the device's own reading - the brush's pressure curve
 * is applied later, when the stroke is rasterized - and the times stay the
 * device's times, so a stored stroke replays exactly as it was drawn.
 */

import type { StabilizerMode } from "../../types/brush";
import type { StrokeSample } from "../../types/pointer";
import { clamp } from "../../utils/math";

/** Every mode the stabilizer offers, in the order the control lists them. */
export const STABILIZER_MODES = [
  "off",
  "smooth",
  "pull",
] as const satisfies readonly StabilizerMode[];

/** The mode a brush uses when nothing says otherwise. */
export const DEFAULT_STABILIZER_MODE: StabilizerMode = "smooth";

/** True when the value is one of the modes. */
export function isStabilizerMode(value: unknown): value is StabilizerMode {
  return value === "off" || value === "smooth" || value === "pull";
}

/** The mode, or the default when the value is not one of them. */
export function normalizeStabilizerMode(value: unknown): StabilizerMode {
  return isStabilizerMode(value) ? value : DEFAULT_STABILIZER_MODE;
}

/**
 * The longest time constant the `smooth` mode uses, in seconds.
 *
 * It is the time the captured point takes to close most of the gap to the
 * pointer, and so it is also how long the line trails a pointer that has
 * stopped: at 133 ms a hand's tremor - which lives between 8 Hz and 12 Hz -
 * is almost entirely removed, and a slow stroke trails the pointer by a
 * fraction of a pixel per frame.
 */
export const SMOOTH_MAX_TAU = 0.133;

/**
 * The longest time constant the `pull` mode uses, in seconds.
 *
 * The pull mode has no speed term: the captured point trails the pointer by
 * a fixed *time*, so the line is dragged behind the pointer and the distance
 * it trails grows with the pointer's speed. It is the rubber band the smooth
 * mode is not.
 */
export const PULL_MAX_TAU = 0.05;

/**
 * How much the pointer's speed shortens the `smooth` mode's time constant,
 * in seconds per px/s.
 *
 * A slow pointer is smoothed hard and a fast one is followed closely, so a
 * flick and a corner survive: at 1000 px/s the time constant is a twentieth
 * of what it is at a standstill.
 */
export const SPEED_TAU_GAIN = 0.02;

/**
 * How many raw samples the speed estimate looks at.
 *
 * The estimate is the **median** of the recent steps, not their average: a
 * hand that trembles while it draws makes long and short steps in turn, and
 * the median is the one of them that does not move. Six samples is about
 * 48 ms at 125 Hz.
 */
export const SPEED_WINDOW = 6;

/**
 * How many times the recent step a single step has to be to count as a
 * movement of its own.
 *
 * A flick is much larger than the travel that came before it, and the filter
 * has to open for it at once: waiting for the window to fill would round the
 * first flick of a stroke into a swoop.
 */
export const BURST_FACTOR = 2;

/**
 * The smallest step that can count as a movement of its own, in px.
 *
 * Below it a step is a tremor, whatever the recent travel was.
 */
export const BURST_MIN_DISTANCE = 1;

/** The smallest time step the filter assumes, in seconds. */
const MIN_DT = 1 / 1000;

/** How many points the catch-up curve is cut into. */
const CATCH_UP_POINTS = 4;

/** The distance below which the catch-up is not worth running, in px. */
const CATCH_UP_EPSILON = 1e-6;

/**
 * The fraction of the remaining distance a first-order lag covers per sample.
 *
 * `tau` is the time constant in seconds and `dt` the time since the last
 * sample. The result depends on the *time* between the samples and not on
 * their number, so the same motion is filtered the same way at 60 Hz and at
 * 240 Hz.
 */
export function tauAlpha(tau: number, dt: number): number {
  if (!(tau > 0) || !(dt > 0)) {
    return 1;
  }
  return 1 / (1 + tau / dt);
}

/** The settings a stabilizer runs with. */
export interface StabilizerOptions {
  readonly mode: StabilizerMode;
  /** The strength in `[0, 1]`. `0` filters nothing, whatever the mode. */
  readonly strength: number;
}

/**
 * The online filter that turns raw pointer samples into stored samples.
 *
 * One instance belongs to one stroke. It is fed the raw samples as they
 * arrive and answers with the point to store; at the end of the stroke
 * {@link settle} produces the short tail that lands the stroke on the
 * release point.
 */
export class StrokeStabilizer {
  private readonly mode: StabilizerMode;
  private readonly strength: number;

  /** True once the first sample has been seen. */
  private started = false;
  /** The filtered position. */
  private x = 0;
  private y = 0;
  /** The last raw position. */
  private rawX = 0;
  private rawY = 0;
  /** The last raw pressure, used by the catch-up's tail. */
  private rawPressure = 1;
  /** The time of the last raw sample, in milliseconds. */
  private lastTime = 0;
  /** The last raw step, used to aim the catch-up's curve. */
  private stepX = 0;
  private stepY = 0;
  /** The trailing window of raw samples the speed estimate looks at. */
  private readonly window: StrokeSample[] = [];

  constructor(options: StabilizerOptions) {
    this.mode = options.mode;
    this.strength = clamp(options.strength, 0, 1);
  }

  /** True when the filter changes the path at all. */
  get isActive(): boolean {
    return this.mode !== "off" && this.strength > 0;
  }

  /**
   * Filters one raw sample.
   *
   * The first sample is returned unchanged, so a stroke starts exactly where
   * the pointer was pressed. The pressure and the time are always the raw
   * ones: the filter moves the point, not the pressure.
   */
  push(sample: StrokeSample): StrokeSample {
    if (!this.started) {
      this.started = true;
      this.x = sample.x;
      this.y = sample.y;
      this.rawX = sample.x;
      this.rawY = sample.y;
      this.rawPressure = sample.pressure;
      this.lastTime = sample.time;
      this.window.push(sample);
      return { x: sample.x, y: sample.y, pressure: sample.pressure, time: sample.time };
    }

    const dt = Math.max((sample.time - this.lastTime) / 1000, MIN_DT);
    this.stepX = sample.x - this.rawX;
    this.stepY = sample.y - this.rawY;

    this.window.push(sample);
    if (this.window.length > SPEED_WINDOW) {
      this.window.shift();
    }

    if (!this.isActive) {
      // The raw path: the filter is transparent, and the stored point is the
      // pointer's own.
      this.x = sample.x;
      this.y = sample.y;
    } else {
      const step = Math.hypot(this.stepX, this.stepY);
      const speed = this.pointerSpeed(step, dt);
      const tau = this.timeConstant(speed);
      const alpha = tauAlpha(tau, dt);
      this.x += alpha * (sample.x - this.x);
      this.y += alpha * (sample.y - this.y);
    }

    this.rawX = sample.x;
    this.rawY = sample.y;
    this.rawPressure = sample.pressure;
    this.lastTime = sample.time;

    return { x: this.x, y: this.y, pressure: sample.pressure, time: sample.time };
  }

  /**
   * The tail that lands the stroke on the release point.
   *
   * A causal filter lags behind a moving pointer, so the last stored point
   * is behind the pointer's last position. The catch-up closes that gap: it
   * is a short curve from the filtered point to the release point, and its
   * last point is the release point **exactly**. Without a release point the
   * last raw position is the target, which is where the pointer was when the
   * stroke ended.
   *
   * The tail's pressure is the last raw pressure, not the release's: a pen
   * reports its pressure as it leaves the tablet, and a stroke must not end
   * with a spike the device never measured.
   */
  settle(release?: StrokeSample): StrokeSample[] {
    if (!this.started) {
      return [];
    }
    const targetX = release ? release.x : this.rawX;
    const targetY = release ? release.y : this.rawY;
    const targetTime = release ? Math.max(release.time, this.lastTime) : this.lastTime;

    const gap = Math.hypot(targetX - this.x, targetY - this.y);
    if (gap < CATCH_UP_EPSILON) {
      // The stroke already ends where it should: nothing to catch up to.
      return [];
    }

    const control = this.catchUpControl(targetX, targetY, gap);
    const tail: StrokeSample[] = [];
    for (let index = 1; index <= CATCH_UP_POINTS; index += 1) {
      const t = index / CATCH_UP_POINTS;
      tail.push({
        x: quadratic(this.x, control.x, targetX, t),
        y: quadratic(this.y, control.y, targetY, t),
        pressure: this.rawPressure,
        time: this.lastTime + (targetTime - this.lastTime) * t,
      });
    }
    return tail;
  }

  /**
   * The time constant the filter runs with, in seconds.
   *
   * The `smooth` mode shortens it as the pointer speeds up, so a slow
   * gesture is smoothed hard and a fast one is followed closely. The `pull`
   * mode keeps it: the line trails the pointer by a fixed time, so the
   * distance it trails grows with the pointer's speed.
   */
  private timeConstant(speed: number): number {
    if (this.mode === "pull") {
      return PULL_MAX_TAU * this.strength;
    }
    const tau = SMOOTH_MAX_TAU * this.strength;
    return tau / (1 + SPEED_TAU_GAIN * speed);
  }

  /**
   * The speed of the pointer, in px/s.
   *
   * It is the median of the recent steps over their median time, not their
   * average: a hand that trembles while it draws makes long and short steps
   * in turn, and the median is the one that does not move. A step that is
   * much larger than the recent travel is a movement of its own - a flick -
   * and the filter opens for it at once.
   */
  private pointerSpeed(step: number, dt: number): number {
    const window = this.window;
    if (window.length < 2) {
      return 0;
    }
    const lengths: number[] = [];
    let totalTime = 0;
    for (let index = 1; index < window.length; index += 1) {
      const previous = window[index - 1];
      const current = window[index];
      lengths.push(Math.hypot(current.x - previous.x, current.y - previous.y));
      totalTime += current.time - previous.time;
    }
    const meanTime = Math.max(totalTime / lengths.length / 1000, MIN_DT);
    const median = medianOf(lengths);
    const speed = median / meanTime;
    if (step > Math.max(BURST_MIN_DISTANCE, BURST_FACTOR * median)) {
      return Math.max(speed, step / dt);
    }
    return speed;
  }

  /**
   * The control point of the catch-up's curve.
   *
   * The curve leaves the stroke along the direction the pointer was
   * travelling, so the tail continues the line instead of cutting across it,
   * and it is bounded by half the gap, so it cannot swing wide.
   */
  private catchUpControl(targetX: number, targetY: number, gap: number): {
    x: number;
    y: number;
  } {
    const stepLength = Math.hypot(this.stepX, this.stepY);
    if (stepLength <= 0) {
      // The pointer had stopped: aim straight at the target.
      return { x: (this.x + targetX) / 2, y: (this.y + targetY) / 2 };
    }
    const offset = Math.min(gap * 0.5, stepLength);
    return {
      x: this.x + (this.stepX / stepLength) * offset,
      y: this.y + (this.stepY / stepLength) * offset,
    };
  }
}

/** The middle value of a list of numbers. */
function medianOf(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/** A point on the quadratic curve from `from` through `control` to `to`. */
function quadratic(from: number, control: number, to: number, t: number): number {
  const inverse = 1 - t;
  return inverse * inverse * from + 2 * inverse * t * control + t * t * to;
}
