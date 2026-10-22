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
 *
 * The path itself is filtered by the stabilizer (`core/brushes/stabilizer`),
 * which decides where the stored samples are. The pressure and the time of a
 * sample are the device's own: the stored pressure is what the device
 * measured, and the brush's pressure curve is applied later, when the stroke
 * is rasterized.
 */

import type { BrushSettings } from "../../types/brush";
import type { StrokeSample } from "../../types/pointer";
import { createId } from "../../utils/id";
import { clamp, distance, lerp } from "../../utils/math";
import type { LayerId, StrokeRecord } from "../document/types";
import {
  DEFAULT_STABILIZER_MODE,
  StrokeStabilizer,
} from "./stabilizer";

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
  /** The filter that decides where the stored samples are. */
  private readonly stabilizer: StrokeStabilizer;
  private lastX = 0;
  private lastY = 0;
  private lastPressure = 1;
  private lastTime = 0;
  /** Latest raw pointer position, kept separately so the jump guard can use it. */
  private lastRawX = 0;
  private lastRawY = 0;
  private count = 0;

  constructor(stroke: StrokeRecord) {
    this.stroke = stroke;
    this.stabilizer = new StrokeStabilizer({
      mode: stroke.brush.stabilizerMode ?? DEFAULT_STABILIZER_MODE,
      strength: stroke.brush.stabilizer ?? 0,
    });
  }

  get pointCount(): number {
    return this.count;
  }

  /**
   * Appends a sample, inserting interpolated points when needed.
   *
   * The sample's position goes through the stabilizer first: what is stored is
   * the filtered path, so the stroke draws the same line in live drawing, in
   * undo/redo, in a reopened file and in an export. The pressure and the time
   * are stored as the device reported them.
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
    const rawSegment = distance(this.lastRawX, this.lastRawY, sample.x, sample.y);
    const point = this.stabilizer.push({ x: sample.x, y: sample.y, pressure, time });

    if (this.count === 0) {
      this.stroke.startTime = time;
      this.lastRawX = sample.x;
      this.lastRawY = sample.y;
      this.append(point.x, point.y, pressure, time);
      return 0;
    }

    const firstIndex = this.count;
    const step = Math.max(MIN_SPACING_STEP, this.stroke.brush.spacing * this.stroke.brush.size);
    const segmentLength = distance(this.lastX, this.lastY, point.x, point.y);

    if (segmentLength > step && rawSegment <= MAX_INTERPOLATION_DISTANCE) {
      const steps = Math.min(MAX_INTERPOLATED_POINTS, Math.floor(segmentLength / step));
      for (let index = 1; index <= steps; index += 1) {
        const t = index / (steps + 1);
        this.append(
          lerp(this.lastX, point.x, t),
          lerp(this.lastY, point.y, t),
          lerp(this.lastPressure, pressure, t),
          lerp(this.lastTime, time, t),
        );
      }
    }

    // Keep the latest raw point for the jump guard. The append decision below
    // uses the distance from the last *appended* point, so sub-pixel motion
    // accumulates instead of stalling when every event is small.
    this.lastRawX = sample.x;
    this.lastRawY = sample.y;

    if (segmentLength < MIN_SAMPLE_DISTANCE) {
      return firstIndex;
    }
    this.append(point.x, point.y, pressure, time);
    return firstIndex;
  }

  /**
   * Ends the stroke, catching the path up on the release point.
   *
   * Smoothing deliberately lags the pointer while it moves, but the line must
   * still end where the user released. The stabilizer's catch-up is a short
   * curve from the last stored point to the release point, and its last point
   * is the release point exactly. The tail is part of the stored (and
   * therefore rendered) samples rather than a hidden post-process.
   *
   * Without a release point the last raw position is the target. When the
   * stabilizer filters nothing, the tail is empty and the stored samples are
   * exactly the raw ones.
   */
  finish(release?: StrokeSample): StrokeRecord {
    for (const point of this.stabilizer.settle(release)) {
      this.append(point.x, point.y, point.pressure, point.time);
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
