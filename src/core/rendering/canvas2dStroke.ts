/**
 * Canvas 2D stroke rasterization.
 *
 * A stroke is rasterized as round-capped segments between consecutive samples,
 * with the diameter and alpha derived from the interpolated pressure of each
 * pair. Segment stroking is deliberately simple: it produces continuous,
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

/** Stroke alpha for a given pressure. */
export function strokeAlpha(brush: BrushSettings, pressure: number): number {
  const factor = 1 - brush.pressureOpacity * (1 - pressure);
  return clamp(brush.opacity * factor, 0, 1);
}

export function stampDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  diameter: number,
  alpha: number,
  color: string,
): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(diameter / 2, 0.05), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Rasterizes a stroke, or just the newly appended part of it.
 *
 * `fromIndex` is the index of the first sample appended by the latest input
 * event; segments `(i - 1, i)` are drawn for every `i >= max(1, fromIndex)`,
 * which makes incremental drawing identical to a full re-rasterization of the
 * same stroke. Pass `0` to draw the whole stroke.
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
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = brush.color;
  ctx.fillStyle = brush.color;

  if (count === 1) {
    // A press without movement still deposits a dab.
    if (fromIndex === 0) {
      const pressure = stroke.pressures[0];
      stampDot(ctx, stroke.xs[0], stroke.ys[0], strokeDiameter(brush, pressure), strokeAlpha(brush, pressure), brush.color);
    }
    ctx.restore();
    return;
  }

  for (let index = Math.max(1, fromIndex); index < count; index += 1) {
    const pressure = (stroke.pressures[index - 1] + stroke.pressures[index]) / 2;
    ctx.globalAlpha = strokeAlpha(brush, pressure);
    ctx.lineWidth = Math.max(strokeDiameter(brush, pressure), 0.1);
    ctx.beginPath();
    ctx.moveTo(stroke.xs[index - 1], stroke.ys[index - 1]);
    ctx.lineTo(stroke.xs[index], stroke.ys[index]);
    ctx.stroke();
  }

  ctx.restore();
}
