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

import type { BrushSettings, StampTipKind } from "../../types/brush";
import type { Rgb } from "../../utils/color";
import { clamp } from "../../utils/math";
import { MAX_STAMP_SPACING, MIN_STAMP_SPACING } from "../brushes/defaults";
import { strokeDiameter } from "./canvas2dStroke";

/**
 * Smallest distance between two dab centres, in document pixels.
 *
 * A stroke's dab count is its path length divided by the spacing, so this
 * floor is what keeps a long stroke from placing millions of dabs. It is
 * small enough to be invisible next to any brush that matters.
 */
export const MIN_STAMP_SPACING_PX = 0.5;

/**
 * The most document pixels one stroke's dabs may cover, in total.
 *
 * The union of a dab touches its whole bounding box, so a stroke's cost grows
 * with the square of the brush radius and with the number of dabs - a 512 px
 * brush costs a million pixels per dab. A project file's path length is not
 * bounded (the parser only checks that the samples are finite numbers), so the
 * planner stops placing dabs once this much work is spent.
 *
 * The cut is at a **lattice index**: the dabs are placed in order along the
 * path, so the same first K dabs are produced whether the path holds ten
 * samples or ten thousand, and the live path and the rebuild path truncate
 * identically.
 */
export const MAX_STAMP_COVERAGE_WORK = 16_777_216;

/** Edge length of one coverage tile, in device pixels. */
export const COVERAGE_TILE_SIZE = 64;

/**
 * The shape of a dab's tip.
 *
 * The tip is the mask a dab is painted with. It is described by a shape and a
 * ratio rather than by pixels, so it costs a few numbers in a project file
 * and the parser can validate it.
 *
 * `aspect` is the tip's minor axis as a fraction of its major axis: `1` is a
 * tip as wide as it is long, and a smaller value makes it long and narrow.
 * A round tip ignores it - a disc has no minor axis to shorten.
 */
export interface StampTip {
  /** The shape of the tip. */
  readonly kind: StampTipKind;
  /** The minor axis as a fraction of the major axis, in `(0, 1]`. */
  readonly aspect: number;
}

/**
 * The tip a brush's dabs use, or `null` for the plain round disc.
 *
 * `null` is the fast path: a round dab is the disc the stamp engine has
 * always painted, and it keeps its own arithmetic, so a stroke without a tip
 * is byte for byte the stroke every earlier file produced.
 */
export function stampTipOf(brush: BrushSettings): StampTip | null {
  if (brush.stampTip === "round") {
    return null;
  }
  return { kind: brush.stampTip, aspect: brush.stampAspect };
}

/**
 * True when a tip is really a disc.
 *
 * An ellipse as wide as it is long is a disc, and a round tip is a disc, so
 * both take the plain round path: the picture is the same and the plain path
 * is the cheaper one.
 */
export function isRoundTip(tip: StampTip | null): boolean {
  if (tip === null || tip.kind === "round") {
    return true;
  }
  return tip.kind === "ellipse" && tip.aspect >= 0.999;
}

/** A dab placed on a stroke's path. */
export interface StampDab {
  /** Centre of the dab, in document pixels. */
  readonly x: number;
  /** Centre of the dab, in document pixels. */
  readonly y: number;
  /** Radius of the dab, in document pixels. */
  readonly radius: number;
  /**
   * The direction of the path at the dab, in radians.
   *
   * A round dab does not use it - it is the same disc whichever way it
   * points - but it is part of the dab's geometry, and it is what tells a
   * directional stamp texture which way the stroke was travelling. The first
   * dab carries no direction: the path has not continued yet, and a dab's
   * direction must not depend on samples that arrive later.
   */
  readonly angle: number;
  /**
   * The tip's direction at the dab, in radians.
   *
   * This is the angle the tip's major axis points at, and it is what makes a
   * tipped stroke directional: with the tip following the path it is the
   * path's direction plus the brush's offset, and with a fixed tip it is the
   * brush's angle whatever the stroke does. The first dab carries the same
   * angle as the others of a fixed tip, and the offset of a following one -
   * the path has not continued yet, so it has no direction to follow.
   */
  readonly tipAngle: number;
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
 * Above 100 % the dabs no longer touch, and the stroke reads as a dashed line.
 */
export function stampSpacing(brush: BrushSettings): number {
  const fraction = clamp(brush.stampSpacing, MIN_STAMP_SPACING, MAX_STAMP_SPACING);
  return Math.max(brush.size * fraction, MIN_STAMP_SPACING_PX);
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
  /** The tip's offset from the path's direction, in radians. */
  private readonly tipOffset: number;
  /** Whether the tip turns with the path. */
  private readonly tipFollows: boolean;
  private sampleIndex = 0;
  private carried = 0;
  private started = false;
  private previousX = 0;
  private previousY = 0;
  /** Document pixels of dab work already spent, against the budget. */
  private work = 0;

  constructor(brush: BrushSettings) {
    this.brush = brush;
    this.tipOffset = (brush.stampAngle * Math.PI) / 180;
    this.tipFollows = brush.stampAngleFollow === true;
  }

  /** Forgets the path, so the cursor can follow another one. */
  reset(): void {
    this.sampleIndex = 0;
    this.carried = 0;
    this.started = false;
    this.previousX = 0;
    this.previousY = 0;
    this.work = 0;
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
      const radius = strokeDiameter(this.brush, path.pressures[0] ?? 1) / 2;
      dabs.push({
        x: this.previousX,
        y: this.previousY,
        radius,
        angle: 0,
        // The path has not continued, so there is no direction to follow yet:
        // the first dab carries the tip's offset on its own.
        tipAngle: this.tipOffset,
      });
      this.work += dabWork(radius);
      this.sampleIndex = 1;
    }

    const spacing = stampSpacing(this.brush);
    for (let index = this.sampleIndex; index < count; index += 1) {
      const x = path.xs[index];
      const y = path.ys[index];
      const dx = x - this.previousX;
      const dy = y - this.previousY;
      const segment = Math.hypot(dx, dy);
      if (segment <= 0) {
        continue;
      }
      const angle = Math.atan2(dy, dx);
      const pressureStart = path.pressures[index - 1] ?? 1;
      const pressureEnd = path.pressures[index] ?? 1;
      let travelled = 0;
      while (this.carried + (segment - travelled) >= spacing) {
        travelled += spacing - this.carried;
        this.carried = 0;
        const t = travelled / segment;
        const radius =
          strokeDiameter(this.brush, pressureStart + (pressureEnd - pressureStart) * t) / 2;
        const work = dabWork(radius);
        if (this.work + work > MAX_STAMP_COVERAGE_WORK) {
          // The stroke's budget is spent. The cut is a lattice index: the dabs
          // placed so far are the same ones a full walk would have produced,
          // and the live and rebuild paths stop at the same place.
          this.sampleIndex = count;
          return dabs;
        }
        this.work += work;
        dabs.push({
          x: this.previousX + dx * t,
          y: this.previousY + dy * t,
          radius,
          angle,
          tipAngle: this.tipFollows ? angle + this.tipOffset : this.tipOffset,
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
 * The document pixels one dab's bounding box covers.
 *
 * This is the work the union spends on the dab: every pixel in the box is
 * looked at, whether or not the dab ends up covering it.
 */
function dabWork(radius: number): number {
  const box = radius * 2 + 1;
  return box * box;
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
 * The coverage a tipped dab has at a point, in `[0, 1]`.
 *
 * The point is given in the tip's own frame: `along` is the distance along the
 * tip's major axis and `across` the distance along its minor one, and `major`
 * and `minor` are the tip's half axes in the same units. A square tip reaches
 * its boundary along the axes and an elliptical one along an ellipse.
 *
 * This is the reference the painter's fast path implements: the two have to
 * agree pixel for pixel, and the test that says so is the one that catches a
 * change to only one of them.
 */
export function stampTipCoverage(
  along: number,
  across: number,
  major: number,
  minor: number,
  square: boolean,
  hardness: number,
): number {
  if (major <= 0) {
    return 0;
  }
  const clamped = clamp(hardness, 0, 1);
  const u = along / major;
  const v = across / minor;
  const shapeDistance = square
    ? Math.max(Math.abs(u), Math.abs(v))
    : Math.sqrt(u * u + v * v);
  if (shapeDistance <= 0) {
    // The tip's centre: the whole of it is covered.
    return 1;
  }
  const distance = Math.sqrt(along * along + across * across);
  const reach = distance / shapeDistance;
  const outer = reach + 0.5;
  if (distance >= outer) {
    return 0;
  }
  const core = Math.max(reach * clamped - 0.5, 0);
  if (distance <= core) {
    return 1;
  }
  const t = clamp((outer - distance) / (reach * (1 - clamped) + 1), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The number of bristle lanes across the brush's nominal diameter.
 *
 * The lanes are a property of the **brush**, not of a dab: they are measured
 * against the nominal size, so a lighter dab (a lower pressure) does not move
 * them, and the layout is the same in document pixels at every `rasterScale`.
 */
export const STAMP_TEXTURE_LANES = 4;

/**
 * The directional texture a dab's coverage is modulated with.
 *
 * The lanes run **along** the dab's direction, so the pattern follows the
 * path: a horizontal stroke leaves horizontal streaks, a diagonal one leaves
 * diagonal streaks. The lanes are laid out across the brush's centre line, so
 * the pattern is a function of the perpendicular offset only - which is what
 * makes it the *same* for every dab on a path, and therefore what lets the
 * per-pixel maximum union keep it instead of filling it in.
 */
export interface StampTexture {
  /**
   * The dab's direction, in radians.
   *
   * The first dab of a stroke carries `0`, because the path has not continued
   * yet and a dab's direction must not depend on samples that arrive later.
   */
  readonly angle: number;
  /** The distance between bristle lanes, in device pixels. */
  readonly laneWidth: number;
  /** How strongly the lanes modulate the coverage, in `[0, 1]`. */
  readonly strength: number;
}

/**
 * The distance between a brush's bristle lanes, in device pixels.
 *
 * The lanes are measured against the brush's **nominal** size, so the
 * pattern is anchored to the document: at `rasterScale` 2 the lanes are twice
 * as wide in device pixels and the same distance apart in document pixels.
 */
export function stampTextureLaneWidth(brush: BrushSettings, rasterScale: number): number {
  return Math.max(1, (brush.size * rasterScale) / STAMP_TEXTURE_LANES);
}

/**
 * A deterministic hash of one bristle lane, in `[0, 1]`.
 *
 * The same 32-bit xorshift the grain uses (`canvas2dStroke.ts`), so the two
 * textures in the app share one idiom and neither depends on a clock, a random
 * seed, or the order the dabs happen to be painted in.
 */
function laneHash(lane: number, salt: number): number {
  let hash = (lane + salt * 0x9e3779b9) >>> 0;
  hash ^= hash << 13;
  hash >>>= 0;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  hash >>>= 0;
  return hash / 0xffffffff;
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
   *
   * A `texture` modulates the dab's coverage **before** it is unioned, so the
   * union is still a maximum and the stroke still cannot darken where its
   * dabs overlap. A texture can therefore only ever remove ink.
   *
   * A `tip` is the mask the dab is painted with. `null` - and a tip that is
   * really a disc - keeps the plain round path, so a stroke without a tip is
   * byte for byte the stroke every earlier file produced. A tipped dab is
   * painted in the tip's own frame: `tipAngle` is the direction its major axis
   * points at, and the coverage falls off from the tip's boundary the same
   * way it does from a disc's, scaled by how far that boundary is along the
   * pixel's own ray.
   */
  paintDab(
    centerX: number,
    centerY: number,
    radius: number,
    hardness: number,
    texture: StampTexture | null = null,
    tip: StampTip | null = null,
    tipAngle = 0,
  ): StampRect | null {
    if (radius <= 0 || !Number.isFinite(centerX) || !Number.isFinite(centerY)) {
      return null;
    }
    const hardnessValue = clamp(hardness, 0, 1);
    const shaped = !isRoundTip(tip);
    const square = shaped && tip !== null && tip.kind === "square";
    // The tip's own axes, in device pixels: the major one is the dab's radius
    // and the minor one is that radius times the tip's aspect.
    const aspect = shaped && tip !== null ? clamp(tip.aspect, 0, 1) : 1;
    const major = radius;
    const minor = radius * aspect;
    // The tip's frame, turned once per dab rather than once per pixel.
    const tipCos = shaped ? Math.cos(tipAngle) : 1;
    const tipSin = shaped ? Math.sin(tipAngle) : 0;
    const inverseMajor = 1 / major;
    const inverseMinor = 1 / minor;

    // The box the dab can reach. A round dab reaches its radius in every
    // direction; a tipped one reaches its own shape's extent, turned by the
    // tip's angle.
    const halfWidth = shaped
      ? square
        ? major * Math.abs(tipCos) + minor * Math.abs(tipSin)
        : Math.sqrt(major * major * tipCos * tipCos + minor * minor * tipSin * tipSin)
      : radius;
    const halfHeight = shaped
      ? square
        ? major * Math.abs(tipSin) + minor * Math.abs(tipCos)
        : Math.sqrt(major * major * tipSin * tipSin + minor * minor * tipCos * tipCos)
      : radius;
    const left = Math.floor(centerX - halfWidth - 0.5);
    const right = Math.ceil(centerX + halfWidth + 0.5);
    const top = Math.floor(centerY - halfHeight - 0.5);
    const bottom = Math.ceil(centerY + halfHeight + 0.5);

    const band = radius * (1 - hardnessValue);
    const coreLimit = Math.max(radius - band - 0.5, 0);
    const outerLimit = radius + 0.5;
    const bandWidth = band + 1;

    // The bristle lanes run along the dab's direction, so the texture is laid
    // out in the dab's own frame rather than in the device's. `cos`/`sin` are
    // hoisted out of the pixel loop: they are the dab's, not the pixel's.
    const textured = texture !== null && texture.strength > 0 && texture.laneWidth > 0;
    const laneWidth = textured ? texture.laneWidth : 0;
    // The reciprocal is taken once per dab: the lane index is a multiply and
    // a truncation per pixel, not a division.
    const inverseLaneWidth = textured ? 1 / laneWidth : 0;
    const strength = textured ? texture.strength : 0;
    const directionX = textured ? Math.cos(texture.angle) : 0;
    const directionY = textured ? Math.sin(texture.angle) : 0;
    // The lane the pixels are currently in, and the bristle inside it. The
    // lane only changes a few times along a row, so the hash is computed on a
    // change rather than per pixel.
    let lane = -1;
    let bristleStart = 0;
    let bristleEnd = 0;

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
            let coverage: number;
            if (shaped) {
              // The pixel in the tip's own frame: `along` runs down the tip's
              // major axis and `across` across its minor one.
              const along = dx * tipCos + dy * tipSin;
              const across = -dx * tipSin + dy * tipCos;
              // The tip's shape distance: 1 on the boundary, less inside.
              const u = along * inverseMajor;
              const v = across * inverseMinor;
              const shapeDistance = square
                ? Math.max(Math.abs(u), Math.abs(v))
                : Math.sqrt(u * u + v * v);
              if (shapeDistance <= 0) {
                // The tip's centre: the whole of it is covered.
                coverage = 1;
              } else {
                const distance = Math.sqrt(along * along + across * across);
                // How far the tip's boundary is along this pixel's own ray.
                // The falloff is measured against it, so a long tip falls off
                // over a long stretch and a short one over a short stretch -
                // the same softness everywhere on the tip.
                const reach = distance / shapeDistance;
                const outer = reach + 0.5;
                if (distance >= outer) {
                  continue;
                }
                const core = Math.max(reach * hardnessValue - 0.5, 0);
                if (distance <= core) {
                  coverage = 1;
                } else {
                  const t = clamp((outer - distance) / (reach * (1 - hardnessValue) + 1), 0, 1);
                  coverage = t * t * (3 - 2 * t);
                }
              }
            } else {
              const distanceSquared = dx * dx + dySquared;
              if (distanceSquared >= outerLimit * outerLimit) {
                continue;
              }
              if (distanceSquared <= coreLimit * coreLimit) {
                coverage = 1;
              } else {
                const distance = Math.sqrt(distanceSquared);
                const t = clamp((outerLimit - distance) / bandWidth, 0, 1);
                coverage = t * t * (3 - 2 * t);
              }
            }
            let value: number;
            if (textured) {
              // The perpendicular offset from the brush's centre line. The
              // absolute value is used so the pattern does not depend on which
              // side of the line the pixel is on, and therefore does not
              // change when a stroke is drawn backwards.
              const perpendicular = Math.abs(-dx * directionY + dy * directionX);
              const currentLane = (perpendicular * inverseLaneWidth) | 0;
              if (currentLane !== lane) {
                lane = currentLane;
                const widthFraction = 0.45 + 0.55 * laneHash(currentLane, 0);
                const width = laneWidth * widthFraction;
                const start = laneWidth * laneHash(currentLane, 1) * (1 - widthFraction);
                bristleStart = start;
                bristleEnd = start + width;
              }
              const phase = perpendicular - currentLane * laneWidth;
              const inside = phase - bristleStart;
              const depth = inside < bristleEnd - inside ? inside : bristleEnd - inside;
              // A one-device-pixel ramp on each bristle edge.
              const bristle = depth >= 0.5 ? 1 : depth <= -0.5 ? 0 : depth + 0.5;
              value = Math.round(coverage * 255 * ((1 - strength) + strength * bristle));
            } else {
              value = Math.round(coverage * 255);
            }
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
