/**
 * Stroke rasterization tests.
 *
 * The rasterizer is pure: it takes a context and a stroke and paints. A
 * recording context is enough to pin down the two rules that matter - coverage
 * is always full, so overlapping segments cannot accumulate into a darker line,
 * and width still follows pressure per segment. Real pixel coverage is verified
 * in the running app, not here.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createStrokeRecord } from "../core/brushes/strokeBuilder";
import type { BrushSettings } from "../types/brush";
import {
  rasterizeStroke,
  stampDot,
  strokeDiameter,
  strokeOpacity,
} from "../core/rendering/canvas2dStroke";
import { RecordingCanvas } from "./support/recordingCanvas";

function makeStroke(
  brush: BrushSettings = DEFAULT_BRUSH,
  xs: number[] = [0, 10, 20],
  ys: number[] = [0, 10, 0],
  pressures: number[] = [1, 1, 1],
) {
  const stroke = createStrokeRecord("layer-1", brush);
  stroke.xs.push(...xs);
  stroke.ys.push(...ys);
  stroke.pressures.push(...pressures);
  stroke.times.push(...xs.map(() => 0));
  return stroke;
}

function context(): { ctx: CanvasRenderingContext2D; canvas: RecordingCanvas } {
  const canvas = new RecordingCanvas();
  return { ctx: canvas.ctx, canvas };
}

describe("strokeDiameter", () => {
  it("scales with pressure between the floor and the full size", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, size: 10, pressureSize: 1, minSizeRatio: 0.2 };
    expect(strokeDiameter(brush, 1)).toBeCloseTo(10, 10);
    expect(strokeDiameter(brush, 0.5)).toBeCloseTo(5, 10);
    expect(strokeDiameter(brush, 0)).toBeCloseTo(2, 10);
  });

  it("ignores pressure when pressureSize is zero", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, size: 7, pressureSize: 0 };
    expect(strokeDiameter(brush, 0)).toBeCloseTo(7, 10);
    expect(strokeDiameter(brush, 1)).toBeCloseTo(7, 10);
  });
});

describe("strokeOpacity", () => {
  it("uses the brush opacity when pressure does not modulate it", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, opacity: 0.4, pressureOpacity: 0 };
    expect(strokeOpacity(brush, [0.1, 1, 0.2])).toBeCloseTo(0.4, 10);
  });

  it("modulates with the stroke's mean pressure", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, opacity: 1, pressureOpacity: 1 };
    expect(strokeOpacity(brush, [1, 1])).toBeCloseTo(1, 10);
    expect(strokeOpacity(brush, [0, 0])).toBeCloseTo(0, 10);
    // (0.2 + 0.8) / 2 = 0.5
    expect(strokeOpacity(brush, [0.2, 0.8])).toBeCloseTo(0.5, 10);
  });

  it("treats a stroke with no samples as full pressure", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, opacity: 0.5, pressureOpacity: 1 };
    expect(strokeOpacity(brush, [])).toBeCloseTo(0.5, 10);
  });

  it("clamps opacity and pressure into range", () => {
    const opaque: BrushSettings = { ...DEFAULT_BRUSH, opacity: 2, pressureOpacity: 0 };
    expect(strokeOpacity(opaque, [0.5])).toBe(1);

    const pressurable: BrushSettings = { ...DEFAULT_BRUSH, opacity: 1, pressureOpacity: 1 };
    expect(strokeOpacity(pressurable, [-1])).toBe(0);
    expect(strokeOpacity(pressurable, [2])).toBe(1);
  });
});

describe("rasterizeStroke", () => {
  it("paints at full coverage so overlapping segments cannot darken", () => {
    const { ctx, canvas } = context();
    rasterizeStroke(ctx, makeStroke({ ...DEFAULT_BRUSH, opacity: 0.3 }));

    const segments = canvas.named("stroke");
    expect(segments.length).toBeGreaterThan(0);
    for (const call of segments) {
      expect(call.alpha).toBe(1);
    }
  });

  it("still varies line width with pressure", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, size: 10, pressureSize: 1, minSizeRatio: 0 };
    const { ctx, canvas } = context();
    rasterizeStroke(ctx, makeStroke(brush, [0, 10, 20], [0, 0, 0], [1, 0, 0]));

    const widths = canvas.named("stroke").map((call) => call.lineWidth);
    // Segment widths come from the mean pressure of each pair: 0.5, then 0.
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBeCloseTo(5, 5);
    // A zero-width segment is floored so it still paints something.
    expect(widths[1]).toBeCloseTo(0.1, 5);
  });

  it("deposits a single full-coverage dab for a press without movement", () => {
    const { ctx, canvas } = context();
    rasterizeStroke(ctx, makeStroke(DEFAULT_BRUSH, [5], [6], [1]));

    expect(canvas.named("stroke")).toHaveLength(0);
    const arcs = canvas.named("arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0].args.slice(0, 2)).toEqual([5, 6]);
    expect(arcs[0].alpha).toBe(1);
  });

  it("draws nothing for a stroke with no samples", () => {
    const { ctx, canvas } = context();
    rasterizeStroke(ctx, makeStroke(DEFAULT_BRUSH, [], [], []));
    expect(canvas.calls).toHaveLength(0);
  });

  it("redraws only the appended part when given a fromIndex", () => {
    const { ctx, canvas } = context();
    rasterizeStroke(
      ctx,
      makeStroke(DEFAULT_BRUSH, [0, 10, 20, 30], [0, 0, 0, 0], [1, 1, 1, 1]),
      2,
    );
    // Only segments (1,2) and (2,3) are drawn, not the earlier ones.
    expect(canvas.named("stroke")).toHaveLength(2);
  });
});

describe("stampDot", () => {
  it("fills a round dab at full coverage", () => {
    const { ctx, canvas } = context();
    stampDot(ctx, 3, 4, 8, "#000000");

    const [arc] = canvas.named("arc");
    expect(arc.args.slice(0, 3)).toEqual([3, 4, 4]);
    const fills = canvas.named("fill");
    expect(fills).toHaveLength(1);
    expect(fills[0].alpha).toBe(1);
  });
});
