/**
 * Stamp engine: dab placement and coverage.
 *
 * The stamp engine rasterizes a stroke as a chain of round dabs placed along
 * the stored path, instead of stroking the segment between two samples. The
 * dabs overlap, so their coverage has to be combined with a **maximum** - a
 * union, not a sum. Canvas 2D has no max-alpha composite operation (its
 * `lighten` blend mode compares colours, not alpha), so repeated `source-over`
 * would darken every overlap and would flatten a dab's own hardness curve
 * wherever a neighbour's opaque core covers it.
 *
 * The union is therefore computed here, in plain numbers, and handed to the
 * canvas as pixels: the renderer owns the pixels, this module owns the
 * geometry and the coverage map.
 *
 * Everything here is pure - no canvas, no DOM, no clock, no randomness - so
 * the same stroke rasterizes to the same coverage in live drawing, in a layer
 * rebuild, after undo/redo, in a reopened project and in a PNG export. The
 * stored samples stay the authoritative record; a stamp is a rasterization
 * strategy, not a new kind of content.
 */

import type { BrushSettings } from "/src/types/brush";
import type { Rgb } from "/src/utils/color";
import { clamp } from "/src/utils/math";
import { strokeDiameter } from "/src/core/rendering/canvas2dStroke";

/**
 * Smallest distance between two dab centres, in document pixels.
 *
 * A stroke's dab count is its path length divided by the spacing, so this
 * floor is what keeps a long stroke from placing millions of dabs. It is
 * small enough to be invisible next to any brush that matters.
 */
export const MIN_STAMP_SPACING_PX = 0.5;

/** Edge length of one coverage tile, in device pixels. */
export const COVERAGE_TILE_SIZE = 64;

/** A dab placed on a stroke's path. */
export interface StampDab {
  /** Centre of the dab, in document pixels. */
  readonly x: number;
  /** Centre of the dab, in document pixels. */
  readonly y: number;
  /** Radius of the dab, in document pixels. */
  readonly radius: number;
}

/** The part of a stroke the dabs are placed along. */
export interface StampPath {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly pressures: readonly number[];
}

/** A rectangle in device pixels. */
export interface StampRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The distance between two dab centres, in document pixels.
 *
 * The spacing is a fraction of the brush's **nominal size**, not of the
 * pressure-varying diameter, so the dab positions are a pure function of the
 * path: the same stroke always produces the same dabs, wherever it is drawn.
 */
export function stampSpacing(brush: BrushSettings): number {
  return Math.max(brush.size * clamp(brush.stampSpacing, 0, 1), MIN_STAMP_SPACING_PX);
}

/**
 * The dabs a stroke's path produces.
 *
 * The first dab sits on the first sample, and the rest are placed every
 * `spacing` document pixels of **arc length** along the path - not once per
 * sample. That is what makes the placement independent of the sample density:
 * a stroke stored with dense samples and the same stroke stored with sparse
 * samples produce the same dabs at the same places, so `spacing` (the sample
 * density) cannot change what a stamped stroke looks like.
 *
 * The dab's radius follows the pressure at its own position, interpolated
 * between the two samples it lies between, exactly like the segment path's
 * width does.
 */
export function stampDabs(path: StampPath, brush: BrushSettings): StampDab[] {
  return new StampDabCursor(brush).advance(path);
}

/**
 * Places the dabs of a stroke as its path grows.
 *
 * The cursor is an accelerator, not a second source of truth: it walks the
 * same path as {@link stampDabs} and keeps the remainder of the last segment,
 * so the dabs it returns are exactly the ones the full walk would produce.
 * That is what lets the live path touch only the samples the pointer just
 * added, while the rebuild path - which has no cursor - still lands on the
 * same coverage.
 *
 * A cursor belongs to one stroke: it must be reset when the path it follows
 * changes, because a dab's place depends on the path before it.
 */
export class StampDabCursor {
  private readonly brush: BrushSettings;
  private sampleIndex = 0;
  private carried = 0;
  private started = false;
  private previousX = 0;
  private previousY = 0;

  constructor(brush: BrushSettings) {
    this.brush = brush;
  }

  /** Forgets the path, so the cursor can follow another one. */
  reset(): void {
    this.sampleIndex = 0;
    this.carried = 0;
    this.started = false;
    this.previousX = 0;
    this.previousY = 0;
  }

  /** The dabs the path has gained since the last call. */
  advance(path: StampPath): StampDab[] {
    const count = path.xs.length;
    if (count === 0) {
      return [];
    }
    const dabs: StampDab[] = [];
    if (!this.started) {
      this.started = true;
      this.previousX = path.xs[0];
      this.previousY = path.ys[0];
      dabs.push({
        x: this.previousX,
        y: this.previousY,
        radius: strokeDiameter(this.brush, path.pressures[0] ?? 1) / 2,
      });
      this.sampleIndex = 1;
    }

    const spacing = stampSpacing(this.brush);
    for (let index = this.sampleIndex; index < count; index += 1) {
      const x = path.xs[index];
      const y = path.ys[index];
      const segment = Math.hypot(x - this.previousX, y - this.previousY);
      if (segment <= 0) {
        continue;
      }
      const pressureStart = path.pressures[index - 1] ?? 1;
      const pressureEnd = path.pressures[index] ?? 1;
      let travelled = 0;
      while (this.carried + (segment - travelled) >= spacing) {
        travelled += spacing - this.carried;
        this.carried = 0;
        const t = travelled / segment;
        dabs.push({
          x: this.previousX + (x - this.previousX) * t,
          y: this.previousY + (y - this.previousY) * t,
          radius:
            strokeDiameter(this.brush, pressureStart + (pressureEnd - pressureStart) * t) / 2,
        });
      }
      this.carried += segment - travelled;
      this.previousX = x;
      this.previousY = y;
    }
    this.sampleIndex = count;
    return dabs;
  }
}

/**
 * The coverage one dab has at a distance from its centre, in `[0, 1]`.
 *
 * `hardness` `1` is a crisp dab with a one-pixel antialiased rim. Lower
 * values widen the falloff towards the dab's centre, which is a true hardness
 * curve - the edge thins out inside the dab - rather than a blur of a hard
 * dab. The falloff never reaches past the dab's radius, so a dab's footprint
 * stays inside the brush radius the renderer reserves for it.
 */
export function stampDabCoverage(distance: number, radius: number, hardness: number): number {
  if (radius <= 0 || distance >= radius + 0.5) {
    return 0;
  }
  const band = radius * (1 - clamp(hardness, 0, 1));
  const core = radius - band;
  if (distance <= core - 0.5) {
    return 1;
  }
  const t = clamp((radius + 0.5 - distance) / (band + 1), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The union of the dabs painted so far, in device pixels.
 *
 * Coverage is kept in tiles so the map never has to be re-anchored when a
 * stroke grows: a tile is addressed by its position in the document's device
 * grid, and only the tiles a stroke actually touches are allocated. The map is
 * therefore bounded by the stroke's own footprint - like the feather scratch -
 * and never adds a document-sized surface.
 */
export class StampCoverage {
  private readonly tiles = new Map<number, Uint8ClampedArray>();

  /**
   * Unions one dab into the map.
   *
   * The dab is given in device pixels, because that is the grid the coverage
   * is kept on: the same stroke at `rasterScale` 2 simply paints twice as many
   * pixels. The returned rectangle is the area the dab can reach.
   */
  paintDab(centerX: number, centerY: number, radius: number, hardness: number): StampRect | null {
    if (radius <= 0 || !Number.isFinite(centerX) || !Number.isFinite(centerY)) {
      return null;
    }
    const left = Math.floor(centerX - radius - 0.5);
    const right = Math.ceil(centerX + radius + 0.5);
    const top = Math.floor(centerY - radius - 0.5);
    const bottom = Math.ceil(centerY + radius + 0.5);

    const band = radius * (1 - clamp(hardness, 0, 1));
    const coreLimit = Math.max(radius - band - 0.5, 0);
    const outerLimit = radius + 0.5;
    const bandWidth = band + 1;

    const firstTileX = Math.floor(left / COVERAGE_TILE_SIZE);
    const lastTileX = Math.floor((right - 1) / COVERAGE_TILE_SIZE);
    const firstTileY = Math.floor(top / COVERAGE_TILE_SIZE);
    const lastTileY = Math.floor((bottom - 1) / COVERAGE_TILE_SIZE);

    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
        const tile = this.tile(tileX, tileY);
        const tileLeft = tileX * COVERAGE_TILE_SIZE;
        const tileTop = tileY * COVERAGE_TILE_SIZE;
        const startX = Math.max(left, tileLeft);
        const endX = Math.min(right, tileLeft + COVERAGE_TILE_SIZE);
        const startY = Math.max(top, tileTop);
        const endY = Math.min(bottom, tileTop + COVERAGE_TILE_SIZE);
        for (let y = startY; y < endY; y += 1) {
          const dy = y + 0.5 - centerY;
          const dySquared = dy * dy;
          const rowOffset = (y - tileTop) * COVERAGE_TILE_SIZE;
          for (let x = startX; x < endX; x += 1) {
            const index = rowOffset + (x - tileLeft);
            if (tile[index] === 255) {
              // Already fully covered: a maximum cannot raise it.
              continue;
            }
            const dx = x + 0.5 - centerX;
            const distanceSquared = dx * dx + dySquared;
            if (distanceSquared >= outerLimit * outerLimit) {
              continue;
            }
            let coverage: number;
            if (distanceSquared <= coreLimit * coreLimit) {
              coverage = 1;
            } else {
              const distance = Math.sqrt(distanceSquared);
              const t = clamp((outerLimit - distance) / bandWidth, 0, 1);
              coverage = t * t * (3 - 2 * t);
            }
            const value = Math.round(coverage * 255);
            if (value > tile[index]) {
              tile[index] = value;
            }
          }
        }
      }
    }
    return { left, top, width: right - left, height: bottom - top };
  }

  /**
   * Writes the coverage of a rectangle into an RGBA buffer.
   *
   * The buffer is laid out the way an `ImageData` is: `dataWidth` pixels per
   * row, four bytes per pixel. The colour is written everywhere and the
   * coverage is the alpha, so the result can be uploaded with `putImageData`.
   */
  writeRect(
    data: Uint8ClampedArray,
    dataWidth: number,
    rect: StampRect,
    rgb: Rgb,
  ): void {
    const { left, top, width, height } = rect;
    if (width <= 0 || height <= 0) {
      return;
    }
    const firstTileX = Math.floor(left / COVERAGE_TILE_SIZE);
    const lastTileX = Math.floor((left + width - 1) / COVERAGE_TILE_SIZE);
    const firstTileY = Math.floor(top / COVERAGE_TILE_SIZE);
    const lastTileY = Math.floor((top + height - 1) / COVERAGE_TILE_SIZE);

    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      const tileTop = tileY * COVERAGE_TILE_SIZE;
      const startY = Math.max(top, tileTop);
      const endY = Math.min(top + height, tileTop + COVERAGE_TILE_SIZE);
      for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
        const tileLeft = tileX * COVERAGE_TILE_SIZE;
        const startX = Math.max(left, tileLeft);
        const endX = Math.min(left + width, tileLeft + COVERAGE_TILE_SIZE);
        const tile = this.tiles.get(tileKey(tileX, tileY));
        for (let y = startY; y < endY; y += 1) {
          const targetRow = (y - top) * dataWidth;
          const tileRow = (y - tileTop) * COVERAGE_TILE_SIZE;
          for (let x = startX; x < endX; x += 1) {
            const target = (targetRow + (x - left)) * 4;
            const coverage = tile ? tile[tileRow + (x - tileLeft)] : 0;
            data[target] = rgb.r;
            data[target + 1] = rgb.g;
            data[target + 2] = rgb.b;
            data[target + 3] = coverage;
          }
        }
      }
    }
  }

  /** Releases every tile, so the map can be reused for another stroke. */
  clear(): void {
    this.tiles.clear();
  }

  private tile(tileX: number, tileY: number): Uint8ClampedArray {
    const key = tileKey(tileX, tileY);
    const existing = this.tiles.get(key);
    if (existing) {
      return existing;
    }
    const created = new Uint8ClampedArray(COVERAGE_TILE_SIZE * COVERAGE_TILE_SIZE);
    this.tiles.set(key, created);
    return created;
  }
}

/** The key of a tile in the coverage map. */
function tileKey(tileX: number, tileY: number): number {
  return tileY * 1_048_576 + tileX;
}

/**
 * The smallest rectangle containing both rectangles.
 *
 * `null` means "no rectangle yet", which is how the caller collects the
 * area a stroke has touched without allocating a rectangle per dab.
 */
export function unionStampRect(current: StampRect | null, next: StampRect): StampRect {
  if (!current) {
    return next;
  }
  const left = Math.min(current.left, next.left);
  const top = Math.min(current.top, next.top);
  const right = Math.max(current.left + current.width, next.left + next.width);
  const bottom = Math.max(current.top + current.height, next.top + next.height);
  return { left, top, width: right - left, height: bottom - top };
}
