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
import { legacyPressureMapping } from "../core/brushes/pressureMapping";
import { createStrokeRecord } from "../core/brushes/strokeBuilder";
import type { BrushSettings } from "../types/brush";
import {
  rasterizeStroke,
  SOFT_EDGE_RADIUS_RATIO,
  stampDot,
  strokeDiameter,
  strokeFeatherRadius,
  strokeOpacity,
  textureCoverage,
} from "../core/rendering/canvas2dStroke";
import { RecordingCanvas } from "./support/recordingCanvas";

function makeStroke(
  brush: BrushSettings = DEFAULT_BRUSH,
  xs: number[] = [0, 10, 20],
  ys: number[] = [0, 10, 0],
  pressures: number[] = [1, 1, 1],
  fill = false,
) {
  const stroke = createStrokeRecord("layer-1", brush, false, fill);
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
    const brush: BrushSettings = { ...DEFAULT_BRUSH, size: 10, pressureSize: legacyPressureMapping(1), minSizeRatio: 0.2 };
    expect(strokeDiameter(brush, 1)).toBeCloseTo(10, 10);
    expect(strokeDiameter(brush, 0.5)).toBeCloseTo(5, 10);
    expect(strokeDiameter(brush, 0)).toBeCloseTo(2, 10);
  });

  it("ignores pressure when pressureSize is zero", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, size: 7, pressureSize: legacyPressureMapping(0) };
    expect(strokeDiameter(brush, 0)).toBeCloseTo(7, 10);
    expect(strokeDiameter(brush, 1)).toBeCloseTo(7, 10);
  });
});

describe("strokeFeatherRadius", () => {
  it("is zero for a hard brush, so the hard segment path is untouched", () => {
    expect(strokeFeatherRadius(DEFAULT_BRUSH)).toBe(0);
    expect(strokeFeatherRadius({ ...DEFAULT_BRUSH, hardness: 1 })).toBe(0);
  });

  it("grows with softness and follows the brush diameter", () => {
    const size = 100;
    const half = strokeFeatherRadius({ ...DEFAULT_BRUSH, size, hardness: 0.5 });
    const full = strokeFeatherRadius({ ...DEFAULT_BRUSH, size, hardness: 0 });
    expect(full).toBeCloseTo(size * SOFT_EDGE_RADIUS_RATIO, 10);
    expect(half).toBeCloseTo(full / 2, 10);
    // The radius is proportional to size, so "soft" reads the same at any brush.
    expect(strokeFeatherRadius({ ...DEFAULT_BRUSH, size: 10, hardness: 0 })).toBeCloseTo(
      full / 10,
      10,
    );
  });

  it("clamps hardness into range", () => {
    expect(strokeFeatherRadius({ ...DEFAULT_BRUSH, hardness: -3 })).toBe(
      strokeFeatherRadius({ ...DEFAULT_BRUSH, hardness: 0 }),
    );
    expect(strokeFeatherRadius({ ...DEFAULT_BRUSH, hardness: 4 })).toBe(0);
  });
});

describe("strokeOpacity", () => {
  it("uses the brush opacity when pressure does not modulate it", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, opacity: 0.4, pressureOpacity: legacyPressureMapping(0) };
    expect(strokeOpacity(brush, [0.1, 1, 0.2])).toBeCloseTo(0.4, 10);
  });

  it("modulates with the stroke's mean pressure", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, opacity: 1, pressureOpacity: legacyPressureMapping(1) };
    expect(strokeOpacity(brush, [1, 1])).toBeCloseTo(1, 10);
    expect(strokeOpacity(brush, [0, 0])).toBeCloseTo(0, 10);
    // (0.2 + 0.8) / 2 = 0.5
    expect(strokeOpacity(brush, [0.2, 0.8])).toBeCloseTo(0.5, 10);
  });

  it("treats a stroke with no samples as full pressure", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, opacity: 0.5, pressureOpacity: legacyPressureMapping(1) };
    expect(strokeOpacity(brush, [])).toBeCloseTo(0.5, 10);
  });

  it("clamps opacity and pressure into range", () => {
    const opaque: BrushSettings = { ...DEFAULT_BRUSH, opacity: 2, pressureOpacity: legacyPressureMapping(0) };
    expect(strokeOpacity(opaque, [0.5])).toBe(1);

    const pressurable: BrushSettings = { ...DEFAULT_BRUSH, opacity: 1, pressureOpacity: legacyPressureMapping(1) };
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
    const brush: BrushSettings = { ...DEFAULT_BRUSH, size: 10, pressureSize: legacyPressureMapping(1), minSizeRatio: 0 };
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

  it("fills a shape's closed outline before tracing it", () => {
    const brush: BrushSettings = { ...DEFAULT_BRUSH, color: "#123456" };
    const { ctx, canvas } = context();
    // A square, as the shape tools emit it: the last point repeats the first.
    rasterizeStroke(ctx, makeStroke(brush, [0, 10, 10, 0, 0], [0, 0, 10, 10, 0], [1, 1, 1, 1, 1], true));

    const fills = canvas.named("fill");
    expect(fills).toHaveLength(1);
    // The interior takes the brush colour, at full coverage like the outline.
    expect(fills[0].fillStyle).toBe("#123456");
    expect(fills[0].alpha).toBe(1);

    // The polygon is traced from the samples and closed back to the start.
    const names = canvas.calls.map((call) => call.name);
    expect(names.slice(0, 3)).toEqual(["save", "beginPath", "moveTo"]);
    expect(canvas.named("closePath")).toHaveLength(1);
    expect(names.indexOf("fill")).toBeLessThan(names.indexOf("stroke"));

    // The outline is still traced on top, so the edge lands where an unfilled
    // shape's edge would: one segment per gap between samples.
    expect(canvas.named("stroke")).toHaveLength(4);
  });

  it("fills nothing for an outline that bounds no area", () => {
    const { ctx, canvas } = context();
    // Two samples are a line, not a region; a fill would be a degenerate sliver.
    rasterizeStroke(ctx, makeStroke(DEFAULT_BRUSH, [0, 10], [0, 10], [1, 1], true));
    expect(canvas.named("fill")).toHaveLength(0);
    expect(canvas.named("stroke")).toHaveLength(1);
  });

  it("does not fill when only part of a shape is redrawn", () => {
    const { ctx, canvas } = context();
    rasterizeStroke(
      ctx,
      makeStroke(DEFAULT_BRUSH, [0, 10, 10, 0], [0, 0, 10, 10], [1, 1, 1, 1], true),
      2,
    );
    // Filling is a whole-shape operation: an appended segment cannot fill.
    expect(canvas.named("fill")).toHaveLength(0);
    expect(canvas.named("stroke")).toHaveLength(2);
  });

  it("treats a stroke with no fill flag as an outline", () => {
    const { ctx, canvas } = context();
    rasterizeStroke(ctx, makeStroke(DEFAULT_BRUSH, [0, 10, 10, 0, 0], [0, 0, 10, 10, 0], [1, 1, 1, 1, 1]));
    expect(canvas.named("fill")).toHaveLength(0);
    expect(canvas.named("closePath")).toHaveLength(0);
  });

  it("rasterizes a soft brush exactly like a hard one, with no filter", () => {
    // Hardness is an edge treatment of the finished silhouette, applied once
    // when the buffer composites. Rasterization itself is unchanged - which is
    // what keeps the hard path byte-identical and stops the falloff from being
    // applied (and re-applied) per segment.
    const hard = context();
    rasterizeStroke(hard.ctx, makeStroke(DEFAULT_BRUSH));
    const soft = context();
    rasterizeStroke(soft.ctx, makeStroke({ ...DEFAULT_BRUSH, hardness: 0 }));

    expect(soft.canvas.calls.map((call) => call.name)).toEqual(
      hard.canvas.calls.map((call) => call.name),
    );
    expect(soft.canvas.calls.every((call) => call.filter === "none")).toBe(true);
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

describe("textureCoverage", () => {
  it("leaves the stroke exactly opaque at strength 0", () => {
    expect(textureCoverage(0, 0)).toBe(1);
    expect(textureCoverage(1234, 0)).toBe(1);
  });

  it("is deterministic for a tile index and stays inside 0-1", () => {
    for (let index = 0; index < 500; index += 1) {
      const value = textureCoverage(index, 0.7);
      expect(value).toBe(textureCoverage(index, 0.7));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(textureCoverage(17, 0.7)).not.toBe(textureCoverage(18, 0.7));
  });

  it("keeps at least a usable floor of coverage at full strength", () => {
    for (let index = 0; index < 500; index += 1) {
      expect(textureCoverage(index, 1)).toBeGreaterThanOrEqual(0.28);
      const half = textureCoverage(index, 0.5);
      expect(half).toBeGreaterThanOrEqual(0.64);
      expect(half).toBeLessThanOrEqual(1);
    }
  });
});
