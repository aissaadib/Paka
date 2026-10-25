/**
 * Stroke processing.
 *
 * Turns a stream of pointer samples into a `StrokeRecord`: a smooth, evenly
 * spaced sample sequence stored as parallel number arrays. Sampling (input)
 * and rendering (rasterization) are separate concerns; this module only shapes
 * the data between them.
 *
 * Interpolation exists so that fast movement does not produce visible
 * polygonal segments, and so that pressure ramps stay smooth. It is bounded
 * per input event to keep a stalled or teleporting pointer from allocating an
 * unbounded number of points.
 */

import type { BrushSettings } from "../../types/brush";
import type { StrokeSample } from "../../types/pointer";
import { createId } from "../../utils/id";
import { clamp, distance, lerp } from "../../utils/math";
import type { LayerId, StrokeRecord } from "../document/types";

/** Maximum interpolated points generated from a single input sample. */
export const MAX_INTERPOLATED_POINTS = 96;
/**
 * Segments longer than this (document px) are not interpolated: they usually
 * mean a pointer jump rather than real movement.
 */
export const MAX_INTERPOLATION_DISTANCE = 2048;
/** Samples closer than this (document px) are treated as duplicates. */
export const MIN_SAMPLE_DISTANCE = 0.05;
/** Smallest spacing step in document px, regardless of brush size. */
export const MIN_SPACING_STEP = 0.75;
/**
 * Fraction of the remaining distance a fully stabilized pointer leaves per
 * input sample. At strength `1` the captured path follows 25% of the way to
 * each new pointer position, which removes hand jitter at the cost of a short
 * visible lag; `finish()` settles the path back to the release point. At
 * strength `0` the follow factor is exactly `1`, so the raw path is unchanged.
 */
export const STABILIZER_MAX_LAG = 0.75;

/**
 * Creates an empty stroke. The brush configuration is copied into the record
 * so undo/redo re-rasterizes exactly what was drawn, even if the user changes
 * brush settings afterwards.
 */
export function createStrokeRecord(
  layerId: LayerId,
  brush: BrushSettings,
  erase = false,
  fill = false,
): StrokeRecord {
  return {
    id: createId("stroke"),
    layerId,
    brush: { ...brush },
    erase,
    fill,
    xs: [],
    ys: [],
    pressures: [],
    times: [],
    startTime: 0,
  };
}

/**
 * Deep-copies a stroke, optionally moving it to another layer and always
 * assigning a fresh id. Used when duplicating a layer so the copy's strokes
 * cannot collide with the originals in the store, history or project file.
 */
export function cloneStroke(stroke: StrokeRecord, layerId: LayerId = stroke.layerId): StrokeRecord {
  return {
    id: createId("stroke"),
    layerId,
    brush: { ...stroke.brush },
    erase: stroke.erase,
    fill: stroke.fill,
    xs: [...stroke.xs],
    ys: [...stroke.ys],
    pressures: [...stroke.pressures],
    times: [...stroke.times],
    startTime: stroke.startTime,
  };
}

export class StrokeBuilder {
  readonly stroke: StrokeRecord;
  private lastX = 0;
  private lastY = 0;
  private lastPressure = 1;
  private lastTime = 0;
  /** Latest raw pointer position, kept separately so `finish()` can settle. */
  private lastRawX = 0;
  private lastRawY = 0;
  private lastRawPressure = 1;
  private lastRawTime = 0;
  private count = 0;

  constructor(stroke: StrokeRecord) {
    this.stroke = stroke;
  }

  get pointCount(): number {
    return this.count;
  }

  /**
   * Appends a sample, inserting interpolated points when needed.
   *
   * Returns the index of the first point appended by this call, which is
   * exactly what the renderer needs to rasterize only the new part of the
   * stroke. Returns the current point count when the sample added nothing.
   */
  addSample(sample: StrokeSample): number {
    if (
      !Number.isFinite(sample.x) ||
      !Number.isFinite(sample.y) ||
      !Number.isFinite(sample.pressure)
    ) {
      return this.count;
    }

    const pressure = clamp(sample.pressure, 0, 1);
    const time = Number.isFinite(sample.time) ? sample.time : this.lastTime;

    if (this.count === 0) {
      this.stroke.startTime = time;
      this.lastRawX = sample.x;
      this.lastRawY = sample.y;
      this.lastRawPressure = pressure;
      this.lastRawTime = time;
      this.append(sample.x, sample.y, pressure, time);
      return 0;
    }

    const rawSegment = distance(this.lastRawX, this.lastRawY, sample.x, sample.y);
    const stabilizer = clamp(this.stroke.brush.stabilizer ?? 0, 0, 1);
    const follow = 1 - STABILIZER_MAX_LAG * stabilizer;
    // At strength 0 these are the raw values, so the legacy path is unchanged.
    const x = stabilizer > 0 ? lerp(this.lastX, sample.x, follow) : sample.x;
    const y = stabilizer > 0 ? lerp(this.lastY, sample.y, follow) : sample.y;
    const smoothedPressure =
      stabilizer > 0 ? lerp(this.lastPressure, pressure, follow) : pressure;

    const firstIndex = this.count;
    const step = Math.max(MIN_SPACING_STEP, this.stroke.brush.spacing * this.stroke.brush.size);
    const segmentLength = distance(this.lastX, this.lastY, x, y);

    if (segmentLength > step && rawSegment <= MAX_INTERPOLATION_DISTANCE) {
      const steps = Math.min(MAX_INTERPOLATED_POINTS, Math.floor(segmentLength / step));
      for (let index = 1; index <= steps; index += 1) {
        const t = index / (steps + 1);
        this.append(
          lerp(this.lastX, x, t),
          lerp(this.lastY, y, t),
          lerp(this.lastPressure, smoothedPressure, t),
          lerp(this.lastTime, time, t),
        );
      }
    }

    // Keep the latest raw point for `finish()`. The append decision below uses
    // the distance from the last *appended* point, so sub-pixel motion
    // accumulates instead of stalling when every event is small.
    this.lastRawX = sample.x;
    this.lastRawY = sample.y;
    this.lastRawPressure = pressure;
    this.lastRawTime = time;

    if (segmentLength < MIN_SAMPLE_DISTANCE) {
      return firstIndex;
    }
    this.append(x, y, smoothedPressure, time);
    return firstIndex;
  }

  /**
   * Ends the stroke, settling a stabilized path on the last raw pointer point.
   *
   * Smoothing deliberately lags the pointer while it moves, but the line must
   * still end where the user released. Appending the raw point here makes the
   * final segment part of the stored (and therefore rendered) samples rather
   * than a hidden post-process. At strength 0 this is a no-op, so the legacy
   * sample sequence is unchanged.
   */
  finish(): StrokeRecord {
    const stabilizer = clamp(this.stroke.brush.stabilizer ?? 0, 0, 1);
    if (
      stabilizer > 0 &&
      this.count > 0 &&
      distance(this.lastX, this.lastY, this.lastRawX, this.lastRawY) >= MIN_SAMPLE_DISTANCE
    ) {
      this.append(this.lastRawX, this.lastRawY, this.lastRawPressure, this.lastRawTime);
    }
    return this.stroke;
  }

  private append(x: number, y: number, pressure: number, time: number): void {
    const { stroke } = this;
    stroke.xs.push(x);
    stroke.ys.push(y);
    stroke.pressures.push(pressure);
    stroke.times.push(time);
    this.lastX = x;
    this.lastY = y;
    this.lastPressure = pressure;
    this.lastTime = time;
    this.count += 1;
  }
}
