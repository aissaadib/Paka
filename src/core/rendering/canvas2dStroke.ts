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
import { evaluatePressureCurve } from "../brushes/pressureCurve";
import { taperWidthFactors } from "../brushes/taper";
import { buildTaperedPath, drawTaperedPath } from "./taperStroke";

/**
 * Blur length applied to a stroke's finished silhouette at hardness `0`, as a
 * fraction of the stroke's diameter.
 *
 * The radius is proportional to `size`, so "soft" means the same thing for a
 * 6 px pen and a 200 px brush. It is deliberately small: a Gaussian blur
 * lightens the *interior* of a shape whose width is not much larger than the
 * blur, so the ratio is chosen from measured coverage - at `0.1` the core of
 * even a 4 px stroke stays at full alpha, while the outer tenth of the radius
 * still carries a visible falloff band (see ARCHITECTURE.md).
 */
export const SOFT_EDGE_RADIUS_RATIO = 0.1;

/**
 * Blur length in document pixels for a stroke's soft edge.
 *
 * `0` means the stroke is hard and takes the plain segment path unchanged - so
 * every existing drawing (and every mouse stroke on a default brush) renders
 * exactly as before. The value is read from the *stroke's own brush*, never
 * from editor state, which is what makes live drawing, undo/redo, reopen and
 * export agree.
 */
export function strokeFeatherRadius(brush: BrushSettings): number {
  const softness = 1 - clamp(brush.hardness, 0, 1);
  if (softness <= 0) {
    return 0;
  }
  return brush.size * SOFT_EDGE_RADIUS_RATIO * softness;
}

/** Edge length of the repeating grain tile, in document pixels. */
export const TEXTURE_TILE_SIZE = 128;
/** Strongest grain leaves a little less than a third of the coverage. */
const TEXTURE_MIN_COVERAGE = 0.28;

/**
 * Deterministic coverage multiplier for one grain-tile pixel.
 *
 * The tile is generated once per strength and repeats in document space, so
 * the result depends only on the strength and the fixed tile index - never on
 * time, zoom or a random seed. `0` returns exactly `1`, preserving the plain
 * stroke, and `1` leaves a visible grain without punching holes through the
 * whole stroke.
 */
export function textureCoverage(index: number, strength: number): number {
  const amount = clamp(strength, 0, 1);
  if (amount <= 0) {
    return 1;
  }
  let hash = (index + 0x9e3779b9) >>> 0;
  hash ^= hash << 13;
  hash >>>= 0;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  hash >>>= 0;
  const noise = hash / 0xffffffff;
  const floor = 1 - (1 - TEXTURE_MIN_COVERAGE) * amount;
  return floor + (1 - floor) * noise;
}

/** Diameter in document pixels for a given pressure. */
export function strokeDiameter(brush: BrushSettings, pressure: number): number {
  const mapped = evaluatePressureCurve(brush.pressureCurve, pressure);
  const factor = 1 - brush.pressureSize * (1 - mapped);
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
      sum += evaluatePressureCurve(brush.pressureCurve, clamp(pressure, 0, 1));
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
 * Draws a stroke whose width changes along its path.
 *
 * The width at each sample is the pressure's diameter multiplied by the
 * taper's factor, so the taper narrows the stroke *after* the pressure
 * response and can take it below the brush's minimum size - that is what
 * makes a point possible. The whole stroke is one path, filled once, so the
 * tip is exactly as wide as the taper says and the stroke cannot darken
 * where it overlaps itself.
 *
 * `fromIndex` does not apply: the path is the whole stroke, so it is always
 * drawn in full. The caller clears the buffer first, which is what keeps the
 * live preview and a rebuild identical.
 */
function rasterizeTaperedStroke(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeRecord,
  factors: readonly number[],
): void {
  const brush = stroke.brush;
  const count = stroke.xs.length;
  const halfWidths = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    const pressure = stroke.pressures[index] ?? 1;
    const diameter = strokeDiameter(brush, pressure) * factors[index];
    halfWidths[index] = Math.max(diameter, 0) / 2;
  }

  drawTaperedPath(ctx, buildTaperedPath(stroke.xs, stroke.ys, halfWidths));
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
 *
 * A stroke flagged `fill` also fills the polygon its samples trace, so a filled
 * shape is one solid silhouette rather than an outline: the interior takes the
 * brush colour, and the outline is still traced on top so the edge lands exactly
 * where an unfilled shape's edge would. Neither pass can darken the other -
 * both are drawn at full coverage and the stroke's alpha is applied once, when
 * the buffer composites. Filling only happens on a full re-rasterization
 * (`fromIndex === 0`), which is the only way a shape is ever drawn.
 *
 * A stroke with a taper is drawn as one path instead of as segments, and the
 * path ignores `fromIndex`: the tip's width depends on how far the stroke has
 * travelled, so the whole path is drawn every time.
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

  if (stroke.fill === true && fromIndex === 0 && count > 2) {
    // The samples are a closed outline (the last point repeats the first), so
    // the path is filled with the default non-zero rule: no winding can cancel
    // inside a single simple loop.
    ctx.beginPath();
    ctx.moveTo(stroke.xs[0], stroke.ys[0]);
    for (let index = 1; index < count; index += 1) {
      ctx.lineTo(stroke.xs[index], stroke.ys[index]);
    }
    ctx.closePath();
    ctx.fill();
  }

  // A tapered stroke is one path of the whole stroke. The factor list is
  // empty when the taper does not apply, and the plain segment path below
  // runs unchanged - byte for byte what every stroke drawn before the taper
  // existed produces.
  const factors = taperWidthFactors(brush.taper, brush.size, stroke.xs, stroke.ys);
  if (factors.length > 0) {
    rasterizeTaperedStroke(ctx, stroke, factors);
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
