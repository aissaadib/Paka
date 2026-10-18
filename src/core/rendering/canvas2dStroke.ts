/**
 * Canvas 2D stroke rasterization.
 *
 * A stroke is rasterized as round-capped segments between consecutive samples,
 * with the diameter derived from the interpolated pressure of each pair and
 * **full coverage** alpha. Opacity is not applied per segment: it is applied
 * once, when the stroke's buffer is composited (see `strokeOpacity`). That is
 * what stops a semi-transparent stroke from darkening wherever consecutive
 * segments overlap - which is every joint.
 *
 * Segment stroking is deliberately simple: it produces continuous,
 * pressure-tapered strokes without a stamp-based brush engine, and every
 * function here works in document coordinates so the caller controls the
 * transform (screen zoom never affects rasterized pixel data).
 */

import type { BrushSettings } from "../../types/brush";
import type { StrokeRecord } from "../document/types";
import { clamp } from "../../utils/math";

/** Diameter in document pixels for a given pressure. */
export function strokeDiameter(brush: BrushSettings, pressure: number): number {
  const factor = 1 - brush.pressureSize * (1 - pressure);
  return Math.max(brush.size * brush.minSizeRatio, brush.size * factor);
}

/**
 * Opacity for a whole stroke, in `[0, 1]`.
 *
 * A stroke is one shape, so it gets one alpha. Pressure-driven opacity cannot
 * vary *within* a stroke without per-pixel max blending, which Canvas 2D does
 * not expose - drawing each segment at its own alpha is exactly what piles up
 * into a darker line at every overlap. So `pressureOpacity` contributes through
 * the stroke's mean pressure instead: a lighter pass yields a lighter stroke,
 * without the build-up. A GPU backend can do true per-dab opacity later.
 */
export function strokeOpacity(brush: BrushSettings, pressures: readonly number[]): number {
  let meanPressure = 1;
  if (pressures.length > 0) {
    let sum = 0;
    for (const pressure of pressures) {
      sum += clamp(pressure, 0, 1);
    }
    meanPressure = sum / pressures.length;
  }
  const factor = 1 - brush.pressureOpacity * (1 - meanPressure);
  return clamp(brush.opacity * factor, 0, 1);
}

/**
 * Fills a round dab at full coverage.
 *
 * A single-sample press deposits one dot. The stroke's opacity is applied when
 * the buffer composites, never here, so a dot and a long stroke of the same
 * brush look the same opacity.
 */
export function stampDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  diameter: number,
  color: string,
): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(diameter / 2, 0.05), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Rasterizes a stroke, or just the newly appended part of it, at full coverage.
 *
 * `fromIndex` is the index of the first sample appended by the latest input
 * event; segments `(i - 1, i)` are drawn for every `i >= max(1, fromIndex)`,
 * which makes incremental drawing identical to a full re-rasterization of the
 * same stroke. Pass `0` to draw the whole stroke.
 *
 * Alpha is fixed at 1 for every call: two opaque segments that overlap stay
 * opaque, which is the whole point. The caller composites the finished buffer
 * with `strokeOpacity(stroke.brush, stroke.pressures)`.
 */
export function rasterizeStroke(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeRecord,
  fromIndex = 0,
): void {
  const count = stroke.xs.length;
  if (count === 0) {
    return;
  }

  const brush = stroke.brush;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = brush.color;
  ctx.fillStyle = brush.color;

  if (count === 1) {
    // A press without movement still deposits a dab.
    if (fromIndex === 0) {
      stampDot(
        ctx,
        stroke.xs[0],
        stroke.ys[0],
        strokeDiameter(brush, stroke.pressures[0]),
        brush.color,
      );
    }
    ctx.restore();
    return;
  }

  for (let index = Math.max(1, fromIndex); index < count; index += 1) {
    const pressure = (stroke.pressures[index - 1] + stroke.pressures[index]) / 2;
    ctx.lineWidth = Math.max(strokeDiameter(brush, pressure), 0.1);
    ctx.beginPath();
    ctx.moveTo(stroke.xs[index - 1], stroke.ys[index - 1]);
    ctx.lineTo(stroke.xs[index], stroke.ys[index]);
    ctx.stroke();
  }

  ctx.restore();
}
