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

  it("lags a stabilized path and settles on the raw release point", () => {
    const builder = createBuilder({
      ...DEFAULT_BRUSH,
      size: 200,
      spacing: 2,
      stabilizer: 1,
    });
    builder.addSample(sample(0, 0, 0, 0));
    builder.addSample(sample(10, 0, 1, 10));
    builder.addSample(sample(20, 0, 1, 20));

    // follow = 1 - STABILIZER_MAX_LAG = 0.25:
    // 0 -> 2.5 -> 6.875, then finish appends the raw 20.
    expect(builder.stroke.xs).toEqual([0, 2.5, 6.875]);
    expect(builder.stroke.pressures).toEqual([0, 0.25, 0.4375]);

    builder.finish();
    expect(builder.stroke.xs).toEqual([0, 2.5, 6.875, 20]);
    expect(builder.stroke.pressures).toEqual([0, 0.25, 0.4375, 1]);
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
