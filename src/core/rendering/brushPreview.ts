/**
 * The live brush preview.
 *
 * A small canvas that shows what the current brush will draw, redrawn when
 * the brush changes and at no other time. It is deliberately *not* a document
 * render: it paints one synthetic stroke into a canvas of its own, so moving
 * a slider costs a few hundred pixels rather than a whole layer, and no
 * pointer sample is ever involved.
 *
 * The preview reuses the engine's own primitives - `rasterizeStroke`,
 * `strokeDiameter`, `strokeOpacity`, `strokeFeatherRadius`, `textureCoverage`
 * and the stamp engine's dab plan - so a property that changes a stroke
 * changes the preview the same way. The one thing the preview cannot show is
 * the brush's absolute size: it is zoomed so the brush fits the swatch, and
 * the size is read from the number box beside it.
 */

import type { BrushSettings } from "../../types/brush";
import { hexToRgb } from "../../utils/color";
import { clamp } from "../../utils/math";
import type { StrokeRecord } from "../document/types";
import {
  TEXTURE_TILE_SIZE,
  rasterizeStroke,
  strokeDiameter,
  strokeFeatherRadius,
  strokeOpacity,
  textureCoverage,
} from "./canvas2dStroke";
import {
  StampCoverage,
  stampDabs,
  stampTextureLaneWidth,
  unionStampRect,
  type StampRect,
} from "./stampCoverage";

/** The preview's width, in CSS pixels. */
export const PREVIEW_CSS_WIDTH = 104;

/** The preview's height, in CSS pixels. */
export const PREVIEW_CSS_HEIGHT = 24;

/** The room the stroke keeps from the preview's edges, in CSS pixels. */
export const PREVIEW_MARGIN = 3;

/**
 * How far the preview's path waves, as a fraction of the brush's diameter.
 *
 * The wave is what makes the preview show a *stroke* rather than a line, and
 * what makes the pressure ramp visible: the path starts at its lightest and
 * ends at its full width.
 */
const PREVIEW_AMPLITUDE = 0.15;

/** The pressure the preview's path starts at; a light touch, not a full one. */
const PREVIEW_START_PRESSURE = 0.35;

/** How many segments the preview's path has. */
const PREVIEW_SEGMENTS = 48;

/** The grain tiles, cached per strength, as the renderer caches its own. */
const grainTiles = new Map<number, HTMLCanvasElement>();

/**
 * The zoom the preview uses so the brush fits its height.
 *
 * The brush's widest diameter fills the swatch, whatever it is, so the
 * preview shows the *shape* of the mark rather than its size. The number box
 * beside the preview is where the size is read.
 */
export function previewFit(brush: BrushSettings): number {
  const diameter = Math.max(1, strokeDiameter(brush, 1));
  const room = PREVIEW_CSS_HEIGHT - PREVIEW_MARGIN * 2;
  return Math.max(0.0001, room / (diameter * (1 + PREVIEW_AMPLITUDE)));
}

/**
 * The stroke the preview draws.
 *
 * A short wave with a pressure ramp: it starts light and ends at full
 * pressure, so the pressure controls, the pressure curve and the width the
 * brush produces are all visible in one glance. The samples are fixed, so the
 * preview is the same picture for the same brush every time.
 */
export function buildPreviewStroke(brush: BrushSettings): StrokeRecord {
  const fit = previewFit(brush);
  const diameter = Math.max(1, strokeDiameter(brush, 1));
  const length = Math.max(1, (PREVIEW_CSS_WIDTH - PREVIEW_MARGIN * 2) / fit - diameter);
  const amplitude = PREVIEW_AMPLITUDE * diameter;

  const xs: number[] = [];
  const ys: number[] = [];
  const pressures: number[] = [];
  const times: number[] = [];
  for (let index = 0; index <= PREVIEW_SEGMENTS; index += 1) {
    const t = index / PREVIEW_SEGMENTS;
    xs.push(diameter / 2 + t * length);
    ys.push(diameter / 2 + Math.sin(t * Math.PI) * amplitude);
    pressures.push(PREVIEW_START_PRESSURE + (1 - PREVIEW_START_PRESSURE) * t);
    times.push(index);
  }

  return {
    id: "brush-preview",
    layerId: "",
    brush,
    xs,
    ys,
    pressures,
    times,
    startTime: 0,
  };
}

/** How the preview is drawn. */
export interface BrushPreviewOptions {
  /** Device pixels per CSS pixel. */
  readonly pixelRatio: number;
  /** The colour painted behind the stroke. */
  readonly background: string;
}

/**
 * Paints the preview stroke into a context.
 *
 * The stroke is drawn at full coverage into a scratch canvas first, exactly
 * as the renderer draws it into its stroke buffer, and is composited onto the
 * target with the stroke's own opacity. A soft edge is a blur of that
 * coverage, and the grain multiplies its alpha, in the same order the
 * renderer uses them - so the preview and the stroke agree.
 */
export function renderBrushPreview(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeRecord,
  options: BrushPreviewOptions,
): void {
  const brush = stroke.brush;
  const ratio = Math.max(1, options.pixelRatio);
  const scale = ratio * previewFit(brush);
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  resetContext(ctx);
  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, width, height);

  const coverage = createScratch(width, height);
  const coverageCtx = coverage.getContext("2d");
  if (!coverageCtx) {
    return;
  }
  resetContext(coverageCtx);
  coverageCtx.setTransform(scale, 0, 0, scale, 0, 0);
  if (brush.stamp) {
    paintStampCoverage(coverageCtx, stroke, scale);
  } else {
    rasterizeStroke(coverageCtx, stroke, 0);
  }

  const radius = strokeFeatherRadius(brush);
  const texture = clamp(brush.texture, 0, 1);
  let source = coverage;
  if (radius > 0 || texture > 0) {
    const softened = createScratch(width, height);
    const softCtx = softened.getContext("2d");
    if (!softCtx) {
      return;
    }
    resetContext(softCtx);
    softCtx.filter = radius > 0 ? `blur(${radius * scale}px)` : "none";
    softCtx.drawImage(coverage, 0, 0);
    softCtx.filter = "none";
    if (texture > 0) {
      applyGrain(softCtx, texture, scale);
    }
    source = softened;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = strokeOpacity(brush, stroke.pressures);
  ctx.drawImage(source, 0, 0);
  ctx.globalAlpha = 1;
}

/** A scratch canvas of the given device size. */
function createScratch(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Puts a context back into a known state before it is used. */
function resetContext(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/**
 * Paints the stamp's dabs into the coverage canvas.
 *
 * The dabs, their union and the lane width come from the stamp engine, so
 * the preview shows the same dabs a stamped stroke would leave.
 */
function paintStampCoverage(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeRecord,
  scale: number,
): void {
  const brush = stroke.brush;
  const dabs = stampDabs(stroke, brush);
  if (dabs.length === 0) {
    return;
  }
  const coverage = new StampCoverage();
  const laneWidth = stampTextureLaneWidth(brush, scale);
  const strength = brush.stampTexture;
  let dirty: StampRect | null = null;
  for (const dab of dabs) {
    const rect = coverage.paintDab(
      dab.x * scale,
      dab.y * scale,
      dab.radius * scale,
      brush.stampHardness,
      strength > 0 ? { angle: dab.angle, laneWidth, strength } : null,
    );
    if (rect) {
      dirty = unionStampRect(dirty, rect);
    }
  }
  if (!dirty) {
    return;
  }
  const rgb = hexToRgb(brush.color) ?? { r: 0, g: 0, b: 0 };
  const image = ctx.createImageData(dirty.width, dirty.height);
  coverage.writeRect(image.data, dirty.width, dirty, rgb);
  ctx.putImageData(image, dirty.left, dirty.top);
}

/**
 * Multiplies the coverage's alpha by the document-anchored grain.
 *
 * The tile is the renderer's own: 128 document pixels across, anchored to the
 * preview's origin, so the grain a stroke would carry over a small area is
 * the grain the preview shows.
 */
function applyGrain(ctx: CanvasRenderingContext2D, strength: number, scale: number): void {
  const pattern = ctx.createPattern(grainTile(strength), "repeat");
  if (!pattern) {
    return;
  }
  pattern.setTransform({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** The white grain tile for one strength, cached. */
function grainTile(strength: number): HTMLCanvasElement {
  const key = Math.round(clamp(strength, 0, 1) * 20) / 20;
  const cached = grainTiles.get(key);
  if (cached) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_TILE_SIZE;
  canvas.height = TEXTURE_TILE_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const image = ctx.createImageData(TEXTURE_TILE_SIZE, TEXTURE_TILE_SIZE);
    for (let index = 0; index < TEXTURE_TILE_SIZE * TEXTURE_TILE_SIZE; index += 1) {
      const coverage = textureCoverage(index, key);
      const offset = index * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(coverage * 255);
    }
    ctx.putImageData(image, 0, 0);
  }
  grainTiles.set(key, canvas);
  return canvas;
}
