/**
 * The stabilizer's model.
 *
 * The stabilizer decides **which samples a stroke stores**, so what it
 * produces is what the stroke draws: in live drawing, in undo/redo, in a
 * reopened file and in an export. It is a capture-time filter, not a
 * rasterization effect, and it belongs to the brush and the eraser only - a
 * shape's geometry comes from the drag, not from a sampled path.
 *
 * This module is the *model* of that filter: the follow rule, the lag limit
 * and the release settle, written as pure functions over plain data. The
 * filter itself runs in `core/brushes/strokeBuilder`, and this module does
 * not replace it - it describes it, so the three rules that decide where a
 * stroke's samples land can be read in one place and checked against the
 * builder in a test (`src/test/stabilizer.test.ts` holds the builder to the
 * numbers written here).
 *
 * Three properties make the filter usable rather than merely smooth:
 *
 *  - **It is online.** Every sample is filtered as it arrives, from the
 *    filter's own state and the sample before it. Nothing waits for the
 *    stroke to end, so the drawn line keeps up with the pointer.
 *  - **It is bounded.** The filter keeps a fixed amount of state - the last
 *    stored point and the last raw point - so a long stroke costs the same as
 *    a short one and the lag does not grow with the stroke's length.
 *  - **It ends where the pointer ended.** A causal filter lags, so the
 *    release runs a short catch-up that lands the last stored sample exactly
 *    on the release point.
 *
 * The pressure is filtered with the same follow factor as the position: the
 * builder smooths the pressure too, so a pen's ramp does not jump between
 * two samples. The *time* is never filtered - it is the device's own, so a
 * stored stroke replays exactly as it was drawn.
 */

import type { StrokeSample } from "../../types/pointer";
import { clamp, distance, lerp } from "../../utils/math";

/**
 * Fraction of the remaining distance a fully stabilized pointer leaves per
 * input sample.
 *
 * At strength `1` the captured path follows 25% of the way to each new
 * pointer position, which removes hand jitter at the cost of a short visible
 * lag; the release settles the path back on the release point. At strength
 * `0` the follow factor is exactly `1`, so the raw path is unchanged.
 *
 * This is the filter's *lag limit*: the filter never leaves more than this
 * fraction of the distance to the pointer behind, however strong the setting
 * is. A larger limit would make the line crawl behind a fast pointer; a
 * smaller one would make the smoothing so weak that the jitter the setting
 * exists to remove comes straight back.
 */
export const STABILIZER_MAX_LAG = 0.75;

/**
 * The distance below which a filtered point is not stored, in document px.
 *
 * The builder measures the filtered segment against the last *stored* point
 * and drops a segment shorter than this, so a hand that trembles by a
 * fraction of a pixel does not fill the stroke with duplicate samples. The
 * measurement is against the stored point rather than against the previous
 * raw sample, so sub-pixel motion accumulates instead of stalling.
 */
export const MIN_STABILIZER_SEGMENT = 0.05;

/** The state the filter carries from one sample to the next. */
export interface StabilizerState {
  /** True once a sample has been stored. */
  readonly started: boolean;
  /**
   * The last stored point.
   *
   * This is the anchor the filter follows from, and it is the point the
   * release settles onto: the filter is measured against where the stroke
   * actually is, not against where the pointer is.
   */
  readonly anchor: StrokeSample;
  /**
   * The last raw sample: where the pointer actually was.
   *
   * The settle targets this point, because it is where the user let go.
   */
  readonly raw: StrokeSample;
}

/** The result of filtering one sample. */
export interface StabilizerFilterResult {
  /**
   * The point the filter produced, or `null` when the sample stored nothing.
   *
   * A sample stores nothing when it is not finite, or when the filtered
   * segment is shorter than {@link MIN_STABILIZER_SEGMENT}.
   */
  readonly point: StrokeSample | null;
  /** The state after the sample. */
  readonly state: StabilizerState;
}

/** The state of a filter that has not seen a sample yet. */
export function createStabilizerState(): StabilizerState {
  return {
    started: false,
    anchor: { x: 0, y: 0, pressure: 1, time: 0 },
    raw: { x: 0, y: 0, pressure: 1, time: 0 },
  };
}

/**
 * The fraction of the remaining distance the filter covers per sample.
 *
 * The strength is the brush's stabilizer setting in `[0, 1]`. At `0` the
 * factor is exactly `1`: the filter is transparent and the raw path is
 * stored. At `1` the factor is `1 - STABILIZER_MAX_LAG`, which is the lag
 * limit. A strength outside the range is clamped, and a strength that is not
 * a number is treated as `0`.
 */
export function stabilizerFollow(strength: number): number {
  return 1 - STABILIZER_MAX_LAG * clamp(strength, 0, 1);
}

/**
 * True when the filter changes the path at all.
 *
 * The builder takes the raw path when the strength is `0`, and it takes the
 * raw path *unchanged* rather than running the filter with a follow factor
 * of `1`, so a stroke drawn without a stabilizer is byte for byte the stroke
 * that was drawn before the setting existed.
 */
export function stabilizerIsActive(strength: number): boolean {
  return clamp(strength, 0, 1) > 0;
}

/**
 * Filters one raw sample.
 *
 * The first sample is stored unchanged, so a stroke starts exactly where the
 * pointer was pressed. Every later sample is pulled towards the pointer by
 * the follow factor: the stored point covers `follow` of the distance that
 * separated the anchor from the pointer, so the line lags behind a moving
 * pointer and stays still while the pointer is still.
 *
 * The pressure is pulled by the same factor. The time is the device's own,
 * and a sample without a usable time inherits the anchor's.
 */
export function filterStabilizerSample(
  state: StabilizerState,
  sample: StrokeSample,
  strength: number,
): StabilizerFilterResult {
  if (
    !Number.isFinite(sample.x) ||
    !Number.isFinite(sample.y) ||
    !Number.isFinite(sample.pressure)
  ) {
    // A sample that cannot be trusted is not stored and does not move the
    // filter: the stroke continues from where it was.
    return { point: null, state };
  }

  const pressure = clamp(sample.pressure, 0, 1);
  const time = Number.isFinite(sample.time) ? sample.time : state.anchor.time;
  const raw: StrokeSample = { x: sample.x, y: sample.y, pressure, time };

  if (!state.started) {
    return { point: raw, state: { started: true, anchor: raw, raw } };
  }

  const active = stabilizerIsActive(strength);
  const follow = stabilizerFollow(strength);
  const x = active ? lerp(state.anchor.x, sample.x, follow) : sample.x;
  const y = active ? lerp(state.anchor.y, sample.y, follow) : sample.y;
  const smoothed = active ? lerp(state.anchor.pressure, pressure, follow) : pressure;
  const point: StrokeSample = { x, y, pressure: smoothed, time };

  if (distance(state.anchor.x, state.anchor.y, x, y) < MIN_STABILIZER_SEGMENT) {
    // The point moved less than the builder stores, so it is dropped. The
    // anchor stays where it was - the filter keeps measuring from the last
    // stored point - and the raw point still moves on, so the next sample is
    // measured against the newer pointer position.
    return { point: null, state: { started: true, anchor: state.anchor, raw } };
  }

  return { point, state: { started: true, anchor: point, raw } };
}

/**
 * The point that lands the stroke on the release point.
 *
 * The filter lags, so the last stored point is behind the pointer's last
 * position. The settle closes that gap in one step: the raw point is stored
 * as the stroke's last sample, so the line ends exactly where the user let
 * go rather than where the smoothing left it.
 *
 * There is no settle when the filter is off - the raw path is already the
 * pointer's own path - and none when the stroke has no samples yet, or when
 * the pointer was already where the stroke ends.
 */
export function settleStabilizerSample(
  state: StabilizerState,
  strength: number,
): StrokeSample | null {
  if (!stabilizerIsActive(strength)) {
    return null;
  }
  if (!state.started) {
    return null;
  }
  if (distance(state.anchor.x, state.anchor.y, state.raw.x, state.raw.y) < MIN_STABILIZER_SEGMENT) {
    return null;
  }
  return state.raw;
}

/* --------------------------------------------------------------------------
 * The filter's two regimes.
 *
 * The strength says *how much* the path is filtered; these names say *what*
 * the filter does, so a setting can be stored and shown as a choice rather
 * than as a number.
 *
 * `off` is the pointer's own path, sample for sample. `pull` is the lagged
 * path: the line is dragged behind the pointer by a fixed fraction of the
 * distance that separates them.
 *
 * There is no third name here on purpose. The captured work in the shared
 * checkout also carried an adaptive `smooth` mode, which filters the path
 * more while the pointer is slow and hardly at all while it is fast. The
 * builder in this repository does not implement it: it has one follow rule
 * and one lag limit. A mode the code cannot honour would be a setting that
 * claims a capability the stroke does not have, so it is not offered here,
 * and a file that names it takes the default instead.
 * ------------------------------------------------------------------------ */

/** Every regime the filter has, in the order a control lists them. */
export const STABILIZER_MODES = ["off", "pull"] as const;

/** The regime a brush uses when nothing says otherwise. */
export type StabilizerMode = (typeof STABILIZER_MODES)[number];

/**
 * The regime a brush uses when nothing says otherwise.
 *
 * The default brush carries no stabilizer, so the default is the pointer's
 * own path.
 */
export const DEFAULT_STABILIZER_MODE: StabilizerMode = "off";

/** True when the value names a regime the filter has. */
export function isStabilizerMode(value: unknown): value is StabilizerMode {
  return value === "off" || value === "pull";
}

/**
 * The regime, or the default when the value is not one of them.
 *
 * A value from a file that was edited by hand, or from a version of the
 * format that knew a mode this build does not, takes the default rather
 * than being trusted.
 */
export function normalizeStabilizerMode(value: unknown): StabilizerMode {
  return isStabilizerMode(value) ? value : DEFAULT_STABILIZER_MODE;
}
