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
      this.append(sample.x, sample.y, pressure, time);
      return 0;
    }

    const segmentLength = distance(this.lastX, this.lastY, sample.x, sample.y);
    if (segmentLength < MIN_SAMPLE_DISTANCE) {
      return this.count;
    }

    const firstIndex = this.count;
    const step = Math.max(MIN_SPACING_STEP, this.stroke.brush.spacing * this.stroke.brush.size);

    if (segmentLength > step && segmentLength <= MAX_INTERPOLATION_DISTANCE) {
      const steps = Math.min(MAX_INTERPOLATED_POINTS, Math.floor(segmentLength / step));
      for (let index = 1; index <= steps; index += 1) {
        const t = index / (steps + 1);
        this.append(
          lerp(this.lastX, sample.x, t),
          lerp(this.lastY, sample.y, t),
          lerp(this.lastPressure, pressure, t),
          lerp(this.lastTime, time, t),
        );
      }
    }

    this.append(sample.x, sample.y, pressure, time);
    return firstIndex;
  }

  finish(): StrokeRecord {
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
