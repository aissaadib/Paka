import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  MAX_INTERPOLATED_POINTS,
  MAX_INTERPOLATION_DISTANCE,
  StrokeBuilder,
  cloneStroke,
  createStrokeRecord,
} from "../core/brushes/strokeBuilder";
import type { BrushSettings } from "../types/brush";
import type { StrokeSample } from "../types/pointer";

function sample(x: number, y: number, pressure: number, time: number): StrokeSample {
  return { x, y, pressure, time };
}

function createBuilder(brush: BrushSettings = DEFAULT_BRUSH): StrokeBuilder {
  return new StrokeBuilder(createStrokeRecord("layer-1", brush));
}

describe("StrokeBuilder", () => {
  it("records the first sample and reports index 0 so it is drawn as a dab", () => {
    const builder = createBuilder();
    const index = builder.addSample(sample(10, 20, 0.8, 0));
    expect(index).toBe(0);
    expect(builder.pointCount).toBe(1);
    expect(builder.stroke.xs).toEqual([10]);
    expect(builder.stroke.ys).toEqual([20]);
    expect(builder.stroke.pressures).toEqual([0.8]);
    expect(builder.stroke.startTime).toBe(0);
  });

  it("returns the index of the first point appended by a sample", () => {
    // Spacing larger than the segment avoids interpolation, isolating the
    // index contract.
    const builder = createBuilder({ ...DEFAULT_BRUSH, size: 200, spacing: 2 });
    builder.addSample(sample(0, 0, 0.5, 0));
    const index = builder.addSample(sample(10, 0, 0.5, 10));
    expect(index).toBe(1);
    expect(builder.pointCount).toBe(2);
  });

  it("interpolates long segments with a pressure ramp", () => {
    const builder = createBuilder({ ...DEFAULT_BRUSH, size: 10, spacing: 0.5 });
    builder.addSample(sample(0, 0, 0, 0));
    const index = builder.addSample(sample(50, 0, 1, 100));

    // step = 5 px -> floor(50 / 5) = 10 new points, plus the final sample.
    expect(index).toBe(1);
    expect(builder.pointCount).toBe(12);
    expect(builder.stroke.pressures[1]).toBeGreaterThan(0);
    expect(builder.stroke.pressures[1]).toBeLessThan(1);
    expect(builder.stroke.xs[builder.stroke.xs.length - 1]).toBe(50);
    expect(builder.stroke.pressures[builder.stroke.pressures.length - 1]).toBe(1);
  });

  it("spacing controls how many interpolated points a fast move produces", () => {
    const loose = createBuilder({ ...DEFAULT_BRUSH, size: 100, spacing: 0.5 });
    loose.addSample(sample(0, 0, 1, 0));
    loose.addSample(sample(100, 0, 1, 100));

    const tight = createBuilder({ ...DEFAULT_BRUSH, size: 100, spacing: 0.1 });
    tight.addSample(sample(0, 0, 1, 0));
    tight.addSample(sample(100, 0, 1, 100));

    // step = spacing * size: 50 px -> 2 interpolated points, 10 px -> 10. Both
    // then append the final sample, so lower spacing is denser, not wider.
    expect(loose.pointCount).toBe(4);
    expect(tight.pointCount).toBe(12);
    expect(loose.stroke.xs[loose.stroke.xs.length - 1]).toBe(100);
    expect(tight.stroke.xs[tight.stroke.xs.length - 1]).toBe(100);
  });

  it("accumulates sub-threshold movement instead of stalling", () => {
    const builder = createBuilder({
      ...DEFAULT_BRUSH,
      size: 200,
      spacing: 2,
      stabilizer: 0,
    });
    builder.addSample(sample(0, 0, 1, 0));
    for (let index = 1; index <= 4; index += 1) {
      builder.addSample(sample(index * 0.04, 0, 1, index));
    }

    // Each 0.04 px step is below MIN_SAMPLE_DISTANCE, but they are measured
    // from the last appended point (0 and 0.08), so the stroke does not freeze.
    expect(builder.stroke.xs).toEqual([0, 0.08, 0.16]);
  });

  it("leaves the raw path and release point untouched without a stabilizer", () => {
    const builder = createBuilder({
      ...DEFAULT_BRUSH,
      size: 200,
      spacing: 2,
      stabilizer: 0,
    });
    builder.addSample(sample(0, 0, 0.2, 0));
    builder.addSample(sample(10, 0, 0.6, 10));
    builder.finish();

    expect(builder.stroke.xs).toEqual([0, 10]);
    expect(builder.stroke.pressures).toEqual([0.2, 0.6]);
  });

  it("lags a stabilized path and catches up on the release point", () => {
    const builder = createBuilder({
      ...DEFAULT_BRUSH,
      size: 200,
      spacing: 2,
      stabilizer: 1,
    });
    builder.addSample(sample(0, 0, 0, 0));
    builder.addSample(sample(10, 0, 1, 10));
    builder.addSample(sample(20, 0, 1, 20));

    // The captured point trails the pointer, so it is between the press point
    // and the pointer's own position.
    expect(builder.stroke.xs[0]).toBe(0);
    expect(builder.stroke.xs[1]).toBeGreaterThan(0);
    expect(builder.stroke.xs[1]).toBeLessThan(10);

    builder.finish();
    // The catch-up lands the stroke on the pointer's last position.
    expect(builder.stroke.xs[builder.stroke.xs.length - 1]).toBe(20);
    expect(builder.stroke.ys[builder.stroke.ys.length - 1]).toBe(0);
  });

  it("ends exactly on the release point it is given", () => {
    const builder = createBuilder({ ...DEFAULT_BRUSH, stabilizer: 1 });
    builder.addSample(sample(0, 0, 0.5, 0));
    builder.addSample(sample(10, 0, 0.5, 10));
    builder.finish(sample(37, 21, 0.5, 20));

    const last = builder.stroke.xs.length - 1;
    expect(builder.stroke.xs[last]).toBe(37);
    expect(builder.stroke.ys[last]).toBe(21);
  });

  it("stores the device's pressure, not a smoothed one", () => {
    const builder = createBuilder({ ...DEFAULT_BRUSH, stabilizer: 1 });
    builder.addSample(sample(0, 0, 0.2, 0));
    builder.addSample(sample(10, 0, 0.6, 10));
    builder.addSample(sample(20, 0, 0.9, 20));

    // The raw pressures are the ones the device measured: the brush's
    // pressure curve is applied when the stroke is rasterized, not here.
    expect(builder.stroke.pressures[0]).toBe(0.2);
    expect(builder.stroke.pressures[builder.stroke.pressures.length - 1]).toBe(0.9);
  });

  it("stores the device's times, not a smoothed one", () => {
    const builder = createBuilder({ ...DEFAULT_BRUSH, stabilizer: 1 });
    builder.addSample(sample(0, 0, 0.5, 0));
    builder.addSample(sample(10, 0, 0.5, 40));

    expect(builder.stroke.times[0]).toBe(0);
    expect(builder.stroke.times[builder.stroke.times.length - 1]).toBe(40);
  });

  it("keeps a stabilized stroke's start exactly on the press point", () => {
    const builder = createBuilder({ ...DEFAULT_BRUSH, stabilizer: 1 });
    builder.addSample(sample(12, 34, 0.5, 0));
    builder.addSample(sample(200, 34, 0.5, 10));
    builder.finish();

    expect(builder.stroke.xs[0]).toBe(12);
    expect(builder.stroke.ys[0]).toBe(34);
  });

  it("caps interpolated points for a single sample", () => {
    const builder = createBuilder({ ...DEFAULT_BRUSH, size: 400, spacing: 0.02 });
    builder.addSample(sample(0, 0, 1, 0));
    builder.addSample(sample(2000, 0, 1, 1000));
    expect(builder.pointCount).toBe(MAX_INTERPOLATED_POINTS + 2);
  });

  it("does not interpolate pointer jumps beyond the interpolation limit", () => {
    const builder = createBuilder({ ...DEFAULT_BRUSH, size: 1, spacing: 0.02 });
    builder.addSample(sample(0, 0, 1, 0));
    builder.addSample(sample(MAX_INTERPOLATION_DISTANCE + 1, 0, 1, 1000));
    expect(builder.pointCount).toBe(2);
  });

  it("ignores duplicate samples and non-finite input", () => {
    const builder = createBuilder();
    builder.addSample(sample(5, 5, 0.5, 0));
    expect(builder.addSample(sample(5, 5, 0.5, 1))).toBe(1);
    expect(builder.addSample(sample(Number.NaN, 5, 0.5, 2))).toBe(1);
    expect(builder.addSample(sample(5, Number.POSITIVE_INFINITY, 0.5, 3))).toBe(1);
    expect(builder.pointCount).toBe(1);
  });

  it("clamps pressure into the 0..1 range", () => {
    const builder = createBuilder();
    builder.addSample(sample(0, 0, 4, 0));
    builder.addSample(sample(20, 0, -2, 5));
    expect(builder.stroke.pressures[0]).toBe(1);
    expect(builder.stroke.pressures[builder.stroke.pressures.length - 1]).toBe(0);
  });

  it("copies the brush configuration into the stroke record", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH };
    const stroke = createStrokeRecord("layer-7", brush);
    expect(stroke.brush).not.toBe(brush);
    expect(stroke.brush).toEqual(brush);
    expect(stroke.layerId).toBe("layer-7");
  });

  it("returns the same record from finish", () => {
    const builder = createBuilder();
    builder.addSample(sample(0, 0, 1, 0));
    expect(builder.finish()).toBe(builder.stroke);
  });

  it("marks a stroke as an eraser only when asked", () => {
    expect(createStrokeRecord("layer-1", DEFAULT_BRUSH).erase).toBe(false);
    expect(createStrokeRecord("layer-1", DEFAULT_BRUSH, true).erase).toBe(true);
  });
});

describe("the same gesture, captured twice", () => {
  /**
   * A straight drag with a hand's tremor on it.
   *
   * The line runs along `y = 40` at 100 px/s and a 1 px tremor at 10 Hz
   * swings the pointer up and down, which is the shape of a hand that is
   * nearly still.
   */
  function gesture(count = 60): StrokeSample[] {
    const samples: StrokeSample[] = [];
    for (let index = 0; index < count; index += 1) {
      const time = index * 8;
      samples.push(
        sample(
          index * 0.8,
          40 + Math.sin((2 * Math.PI * 10 * time) / 1000),
          0.5,
          time,
        ),
      );
    }
    return samples;
  }

  /** Captures the gesture with a brush and returns the stored points. */
  function capture(brush: BrushSettings): StrokeSample[] {
    const builder = createBuilder(brush);
    for (const entry of gesture()) {
      builder.addSample(entry);
    }
    builder.finish();
    return builder.stroke.ys.map((y, index) => ({
      x: builder.stroke.xs[index],
      y,
      pressure: builder.stroke.pressures[index],
      time: builder.stroke.times[index],
    }));
  }

  /** How far the drawn path strays from the ideal line, on average. */
  function spread(points: readonly StrokeSample[]): number {
    const squares = points.map((point) => (point.y - 40) ** 2);
    return Math.sqrt(squares.reduce((total, square) => total + square, 0) / squares.length);
  }

  /** The length of the drawn path. */
  function length(points: readonly StrokeSample[]): number {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y,
      );
    }
    return total;
  }

  const raw = capture({ ...DEFAULT_BRUSH, stabilizer: 0, stabilizerMode: "off" });
  const smoothed = capture({ ...DEFAULT_BRUSH, stabilizer: 1, stabilizerMode: "smooth" });

  it("draws a calmer line with the stabilizer on", () => {
    // The raw path swings a full pixel either side of the line; the
    // stabilized path keeps a fraction of that.
    expect(spread(raw)).toBeGreaterThan(0.5);
    expect(spread(smoothed)).toBeLessThan(spread(raw) * 0.6);
  });

  it("draws a shorter line with the stabilizer on", () => {
    // The tremor is not only wider, it is longer: a shaky line wanders.
    expect(length(smoothed)).toBeLessThan(length(raw));
  });

  it("starts and ends in the same place either way", () => {
    expect(smoothed[0].x).toBe(raw[0].x);
    expect(smoothed[0].y).toBe(raw[0].y);
    expect(smoothed[smoothed.length - 1].x).toBeCloseTo(raw[raw.length - 1].x, 9);
    expect(smoothed[smoothed.length - 1].y).toBeCloseTo(raw[raw.length - 1].y, 9);
  });

  it("keeps the device's pressure and times either way", () => {
    // The gesture reports one pressure throughout, and so does the stroke:
    // the filter moves the point, not the pressure.
    expect(new Set(smoothed.map((point) => point.pressure))).toEqual(new Set([0.5]));
    expect(new Set(raw.map((point) => point.pressure))).toEqual(new Set([0.5]));
    // And the times are the device's, in order.
    const times = smoothed.map((point) => point.time);
    expect(times[0]).toBe(0);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]).toBeGreaterThanOrEqual(times[index - 1]);
    }
  });
});

describe("cloneStroke", () => {
  it("keeps the erase flag and gives the copy a fresh id", () => {
    const source = createStrokeRecord("layer-1", DEFAULT_BRUSH, true);
    const copy = cloneStroke(source, "layer-2");

    expect(copy.erase).toBe(true);
    expect(copy.id).not.toBe(source.id);
    expect(copy.layerId).toBe("layer-2");
    expect(copy.brush).not.toBe(source.brush);
  });
});
