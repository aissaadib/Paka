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
