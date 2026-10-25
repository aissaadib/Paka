/**
 * Brush tips: the shape a stamped dab is masked with.
 *
 * A tip is a **mask, not a colour**. It multiplies a dab's coverage *before*
 * the dabs are unioned, so the union is still a maximum and a stroke still
 * cannot darken where it crosses itself. The stroke's opacity is applied once,
 * when the stroke's buffer composites, exactly as it is for a round dab.
 *
 * Every shape is a **bounded, documented silhouette** - a disc, a soft pad, a
 * chisel edge, a ragged blot, a bundle of bristles - and every one of them
 * fits inside the dab's own radius. That is what keeps the coverage map
 * footprint-bounded and the raster budget where it is: a tip can only ever
 * remove ink from the disc the dab already reserved, so it can never make a
 * stroke reach further than it did before.
 *
 * The mask is a pure function of the dab's own frame - its position and its
 * direction - so it is the same in live drawing, in a layer rebuild, after
 * undo/redo, in a reopened project and in a PNG export, at every zoom and at
 * every `rasterScale`. There is no randomness anywhere in this module: the
 * blot's ragged edge and the bristle lanes are built from a fixed hash, the
 * same 32-bit xorshift the grain and the per-dab texture use.
 *
 * This module is pure - no canvas, no DOM, no clock - so the React layer can
 * draw a preview from it and the tests can assert on it directly.
 */

import type { BrushTipShape } from "../../types/brush";
import { clamp } from "../../utils/math";

/**
 * The closed set of tip shapes.
 *
 * The set is closed on purpose: a tip is a shape the parser can validate, not
 * an arbitrary blob of pixels. A file that names a shape outside this list is
 * refused rather than drawn as the wrong thing.
 */
export const BRUSH_TIP_SHAPES = [
  "round",
  "felt",
  "chisel",
  "blot",
  "bristle",
] as const satisfies readonly BrushTipShape[];

/** A tip shape the list above does not claim. */
type UnlistedTipShape = Exclude<BrushTipShape, (typeof BRUSH_TIP_SHAPES)[number]>;

/**
 * Compile-time guard: every tip shape is in the list above.
 *
 * A shape added to `BrushTipShape` and not to `BRUSH_TIP_SHAPES` makes this
 * line fail to compile, because the reader would quietly fall back to the
 * round tip for it and drop it from every file written from that point on.
 */
export const EVERY_BRUSH_TIP_SHAPE_IS_LISTED: UnlistedTipShape extends never ? true : never = true;

/** The tip a brush has unless it asks for another: the plain round dab. */
export const DEFAULT_BRUSH_TIP: BrushTipShape = "round";

/** The shapes, as a set a string can be looked up in. */
const TIP_SHAPES = new Set<string>(BRUSH_TIP_SHAPES);

/** True when the value names one of the closed set of tip shapes. */
export function isBrushTipShape(value: unknown): value is BrushTipShape {
  return typeof value === "string" && TIP_SHAPES.has(value);
}

/**
 * The tip of an untrusted value, or the round tip.
 *
 * A malformed value falls back to the default instead of throwing: the tip is
 * a preference, and a hand-edited file must still open.
 */
export function normalizeBrushTip(value: unknown): BrushTipShape {
  return isBrushTipShape(value) ? value : DEFAULT_BRUSH_TIP;
}

/**
 * The dab's own frame: the tip's shape, the direction the dab points and the
 * dab's radius.
 *
 * The direction is a unit vector rather than an angle so the caller can hoist
 * the trigonometry out of the pixel loop - it is the dab's, not the pixel's.
 * The radius is in **device** pixels, like the coverage map the mask is
 * multiplied into, so a tip's edge is antialiased the same way the dab's own
 * edge is.
 */
export interface BrushTipFrame {
  /** The tip's shape. */
  readonly shape: BrushTipShape;
  /** The dab's direction, as a unit vector. */
  readonly directionX: number;
  /** The dab's direction, as a unit vector. */
  readonly directionY: number;
  /** The dab's radius, in device pixels. */
  readonly radius: number;
}

/** The fraction of the dab's radius a felt tip stays fully opaque inside. */
const FELT_CORE = 0.35;

/** The angle of the chisel's nib from the dab's direction, in radians. */
const CHISEL_NIB_ANGLE = Math.PI / 4;

/** The chisel nib's half-thickness, as a fraction of the dab's radius. */
const CHISEL_NIB_THICKNESS = 0.06;

/** How deep the blot's ragged edge cuts into the disc, as a fraction. */
const BLOT_DEPTH = 0.35;

/** The number of bristle lanes a bundle is split into. */
const BRISTLE_LANES = 5;

/**
 * A deterministic hash of one bristle lane, in `[0, 1]`.
 *
 * The same 32-bit xorshift the grain uses (`canvas2dStroke.ts`) and the
 * per-dab texture uses (`stampCoverage.ts`), so the three textures in the app
 * share one idiom and none of them depends on a clock, a random seed, or the
 * order the dabs happen to be painted in.
 */
function brushTipHash(lane: number, salt: number): number {
  let hash = (lane + salt * 0x9e3779b9) >>> 0;
  hash ^= hash << 13;
  hash >>>= 0;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  hash >>>= 0;
  return hash / 0xffffffff;
}

/**
 * The mask a tip puts over a dab's coverage, in `[0, 1]`.
 *
 * The mask is `1` where the tip is solid and `0` where it is not, with a
 * one-device-pixel ramp on every edge, so a tip never aliases. It is
 * multiplied into the dab's radial coverage, which is what keeps the union of
 * the dabs a maximum: a tip can only ever take ink away.
 *
 * `along` and `across` are the pixel's offsets from the dab's centre, in the
 * dab's own frame: `along` runs with the path and `across` runs across it.
 *
 * The mask is `0` outside the dab's radius for every shape, so a dab's
 * footprint - and therefore the coverage map's and the raster budget's - does
 * not move when a tip is used.
 */
export function brushTipMask(frame: BrushTipFrame, along: number, across: number): number {
  const radius = frame.radius;
  if (radius <= 0) {
    return 0;
  }
  // Every tip is bounded by the dab's own disc: a tip can only remove ink
  // from the disc the dab reserved, never add to it, and the one-pixel ramp
  // on the disc's edge keeps the tip from aliasing.
  const distanceSquared = along * along + across * across;
  const edge = clamp(radius + 0.5 - Math.sqrt(distanceSquared), 0, 1);
  const disc = edge * edge * (3 - 2 * edge);
  if (disc <= 0) {
    return 0;
  }
  switch (frame.shape) {
    case "round":
      return disc;
    case "felt":
      return disc * feltMask(radius, distanceSquared);
    case "chisel":
      return disc * chiselMask(radius, along, across);
    case "blot":
      return disc * blotMask(radius, along, across, distanceSquared);
    case "bristle":
      return disc * bristleMask(radius, across);
  }
}

/**
 * The mask of a felt tip: a soft pad with no hard rim.
 *
 * The pad is fully opaque in its middle and thins out towards the dab's
 * edge, so the dab has an absorbent, feathered silhouette instead of the
 * crisp disc a round tip stamps.
 */
function feltMask(radius: number, distanceSquared: number): number {
  const distance = Math.sqrt(distanceSquared);
  const t = clamp((distance - radius * FELT_CORE) / (radius * (1 - FELT_CORE)), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The mask of a chisel tip: a flat nib held at an angle to the path.
 *
 * The nib is a segment through the dab's centre, as long as the dab is
 * wide, held at 45 degrees to the direction of travel. Sweeping it along
 * the path is the calligraphic model: the stroke's width follows the
 * angle between the nib and the path, so the same brush draws a broad
 * band across the stroke and a narrow one along it.
 *
 * The nib's ends are at the dab's edge, so the nib never reaches past the
 * disc the dab already reserved.
 */
function chiselMask(radius: number, along: number, across: number): number {
  const cos = Math.cos(CHISEL_NIB_ANGLE);
  const sin = Math.sin(CHISEL_NIB_ANGLE);
  // The pixel's position along the nib, and its distance from the nib's line.
  const onNib = along * cos + across * sin;
  const offNib = -along * sin + across * cos;
  // The nib is a segment, not an infinite line: past its ends the distance
  // grows away from the tip of the nib.
  const beyond = Math.abs(onNib) - radius;
  const distance =
    beyond <= 0 ? Math.abs(offNib) : Math.sqrt(beyond * beyond + offNib * offNib);
  const halfThickness = Math.max(0.5, radius * CHISEL_NIB_THICKNESS);
  const t = clamp(halfThickness + 0.5 - distance, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The mask of a dry ink blot: a disc with a ragged edge.
 *
 * The edge's radius wobbles with the angle around the dab's centre, so the
 * blot is irregular without being random: the wobble is a fixed sum of
 * harmonics of that angle, and it is the same wobble in every dab. The wobble
 * only ever cuts *into* the disc, so the blot's footprint stays inside the
 * dab's radius.
 */
function blotMask(radius: number, along: number, across: number, distanceSquared: number): number {
  const distance = Math.sqrt(distanceSquared);
  if (distance <= 0) {
    return 1;
  }
  const cosine = along / distance;
  const sine = across / distance;
  // Two harmonics of the angle around the dab: a smooth, irregular outline.
  const harmonic =
    (0.8 * cosine +
      0.6 * sine +
      0.5 * (cosine * cosine - sine * sine) +
      0.6 * cosine * sine) /
    1.9;
  const limit = radius * (1 - BLOT_DEPTH * (0.5 + 0.5 * harmonic));
  const t = clamp(limit + 0.5 - distance, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The mask of a bristle bundle: parallel lanes with gaps between them.
 *
 * The lanes run **along** the path, so the stroke reads as a set of streaks
 * rather than a line of dots. Each lane holds one bristle of a fixed width
 * and position, so the bundle is uneven the way a real one is - and uneven in
 * the same way in every dab, because the widths come from a hash of the lane
 * index and not from a random seed.
 */
function bristleMask(radius: number, across: number): number {
  const width = radius * 2;
  const offset = across + radius;
  if (offset < 0 || offset > width) {
    return 0;
  }
  const laneWidth = width / BRISTLE_LANES;
  const lane = Math.floor(offset / laneWidth);
  const phase = offset - lane * laneWidth;
  // The bristle inside the lane: a fixed fraction of the lane's width, at a
  // fixed place in it.
  const widthFraction = 0.45 + 0.55 * brushTipHash(lane, 0);
  const bristleWidth = laneWidth * widthFraction;
  const start = laneWidth * brushTipHash(lane, 1) * (1 - widthFraction);
  const inside = phase - start;
  // The depth inside the bristle: positive inside it, negative in the gap.
  const depth = inside < bristleWidth - inside ? inside : bristleWidth - inside;
  const t = clamp(depth + 0.5, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The tip's silhouette, sampled on a square grid.
 *
 * This is what the preview draws: the mask itself, at the size the preview
 * shows it, with the coverage in the alpha channel. It is a pure function of
 * the tip and the size, so the preview is the engine's own picture of the tip
 * and not a drawing of one.
 *
 * The grid is `size` by `size` device pixels, with the tip's centre in the
 * middle and the tip's radius filling it.
 */
export function brushTipSilhouette(tip: BrushTipShape, size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size);
  const edge = Math.max(1, size / 2 - 1);
  const frame: BrushTipFrame = {
    shape: tip,
    directionX: 1,
    directionY: 0,
    radius: edge,
  };
  for (let y = 0; y < size; y += 1) {
    const across = y + 0.5 - size / 2;
    for (let x = 0; x < size; x += 1) {
      const along = x + 0.5 - size / 2;
      pixels[y * size + x] = Math.round(brushTipMask(frame, along, across) * 255);
    }
  }
  return pixels;
}
