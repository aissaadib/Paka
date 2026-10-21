/**
 * The geometry of transforming a selection.
 *
 * A transform in Paka is a **coordinate map**: it takes a point and returns
 * the point it becomes. That is the whole model. The engine writes the map
 * over a stroke's stored samples and commits one history step, exactly like a
 * move, so a scaled or rotated stroke is still an ordinary stroke - same
 * brush, same colour, same opacity, same pressure, same number of samples -
 * and it re-rasterizes, reopens and exports like any other.
 *
 * The module is pure and DOM-free on purpose. The transform geometry is the
 * part of the feature that has to be *provable*, so it lives where a unit
 * test can reach it without a canvas, a pointer or a browser.
 *
 * Two rules the rest of the feature leans on:
 *
 *  - **A transform is about a centre.** The scale and the rotation both use
 *    the centre of the selection's frame, and the centre is taken when the
 *    gesture starts. It does not move while the drag runs, so the content
 *    cannot drift under the pointer.
 *  - **A transform only moves samples.** Brush, colour, opacity, texture and
 *    pressure are untouched: a scaled stroke is the same stroke, drawn along
 *    a different path. The painted width is *not* scaled with it, so the
 *    frame of a scaled selection is the scaled frame of its samples plus the
 *    same padding - not the scaled frame.
 */

import type { Bounds, Point } from "../../types/geometry";
import type { StrokeRecord } from "./types";

/**
 * The smallest factor a selection may be scaled to.
 *
 * A scale that reaches zero would collapse the selection to a point and one
 * that goes negative would mirror it, which is a *flip*, not a scale. The
 * floor keeps a drag from doing either: the smallest a selection can be made
 * is 5 % of its size.
 */
export const MIN_SCALE_FACTOR = 0.05;

/**
 * The rotation snap, in degrees.
 *
 * A rotation of 15 degrees is the coarsest step that still feels precise
 * enough for a drawing app, and it divides a half turn exactly, so a snapped
 * rotation never lands off a quarter turn.
 */
export const ROTATION_SNAP_DEGREES = 15;

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * A coordinate map: what a transform does to one point.
 *
 * The shape is the one the history command already takes (`StrokeTransform`),
 * so a transform built here can be handed straight to it. The map is run
 * only from a stroke's stored **originals**, so it needs no inverse: undo
 * restores the copies.
 */
export interface SampleTransform {
  /** History label, e.g. `"Scale"`. */
  readonly label: string;
  mapX(x: number, y: number): number;
  mapY(x: number, y: number): number;
}

/** The centre of a frame. */
export function boundsCentre(bounds: Bounds): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

/**
 * The frame of a selection: the axis-aligned bounds of its strokes' samples,
 * widened by the padding each stroke's paint needs.
 *
 * Each stroke is widened by half its maximum diameter, because the pixels of
 * a stroke reach that far from its centreline and a frame hugging the
 * centreline would cut through wide brush work.
 *
 * The padding is supplied by the caller rather than computed here, so this
 * module stays free of brush and rendering knowledge: the caller knows half a
 * stroke's diameter.
 *
 * The frame is derived on demand from the strokes rather than remembered,
 * which is what keeps it correct after a move, a transform, an undo or a
 * redo without any state that could drift out of step with the document.
 */
export function selectionFrame(
  strokes: readonly StrokeRecord[],
  paddingOf: (stroke: StrokeRecord) => number,
): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const stroke of strokes) {
    const padding = paddingOf(stroke);
    for (let index = 0; index < stroke.xs.length; index += 1) {
      minX = Math.min(minX, stroke.xs[index] - padding);
      minY = Math.min(minY, stroke.ys[index] - padding);
      maxX = Math.max(maxX, stroke.xs[index] + padding);
      maxY = Math.max(maxY, stroke.ys[index] + padding);
    }
  }
  if (minX > maxX || minY > maxY) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Clamps a scale factor to the range a selection may take.
 *
 * A factor below `MIN_SCALE_FACTOR` would collapse the selection; a negative
 * one would mirror it, which is a flip and not a scale.
 *
 * A factor that is not a number at all (a NaN from a degenerate frame) is
 * refused differently: the selection **stays where it is** rather than being
 * thrown off the document. The identity is the safe answer - a selection that
 * is suddenly 5 % of its size is a surprise, and a selection that did not move
 * is not.
 */
export function clampScaleFactor(factor: number): number {
  if (!Number.isFinite(factor)) {
    return 1;
  }
  return Math.max(MIN_SCALE_FACTOR, factor);
}

/** The point a point becomes under a uniform scale about a centre. */
export function scaleAboutCentre(point: Point, centre: Point, factor: number): Point {
  return {
    x: centre.x + (point.x - centre.x) * factor,
    y: centre.y + (point.y - centre.y) * factor,
  };
}

/**
 * The point a point becomes under a rotation about a centre.
 *
 * The angle is in radians and turns the same way the screen does: with the
 * document's y axis pointing down, a positive angle turns the content
 * clockwise.
 */
export function rotateAboutCentre(point: Point, centre: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

/**
 * The uniform scale factor a pointer asks for.
 *
 * The grabbed corner keeps its **direction** from the centre: the factor is
 * the pointer's distance *along that direction*, relative to the corner's own
 * distance. Dragging away from the centre scales up, dragging towards it
 * scales down, and dragging sideways does nothing - the rule a proportional
 * corner handle follows in a vector editor, and the one that keeps the
 * scale uniform.
 *
 * The factor is signed, so a pointer past the centre asks for a negative
 * (mirrored) scale. `clampScaleFactor` refuses that, so a drag through the
 * centre cannot invert the selection.
 */
export function scaleFactorFor(centre: Point, corner: Point, pointer: Point): number {
  const dx = corner.x - centre.x;
  const dy = corner.y - centre.y;
  const squared = dx * dx + dy * dy;
  if (squared === 0) {
    // The corner sits on the centre: there is no direction to scale along.
    return 1;
  }
  const along = (pointer.x - centre.x) * dx + (pointer.y - centre.y) * dy;
  return along / squared;
}

/**
 * The rotation a pointer asks for, in radians, measured clockwise from "up".
 *
 * Zero is the pointer straight above the centre - which is where the rotation
 * handle rests - so grabbing the handle without moving it asks for no
 * rotation at all.
 */
export function rotationAngleFor(centre: Point, pointer: Point): number {
  return Math.atan2(pointer.x - centre.x, -(pointer.y - centre.y));
}

/**
 * Wraps an angle to `(-π, π]`.
 *
 * A turn measured from the press point can cross the ±π seam: the pointer may
 * move from just left of "up" to just right of it, and the turn is a couple of
 * degrees, not 358. The wrap keeps the shortest way round.
 */
export function normalizeAngle(radians: number): number {
  const full = Math.PI * 2;
  const wrapped = (((radians + Math.PI) % full) + full) % full - Math.PI;
  // `-π` and `π` are the same angle; the range is half-open at the bottom.
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/**
 * The scale factor a drag asks for, measured **from where the press landed**.
 *
 * The pointer may be up to a grab radius away from the handle it grabbed, so
 * the factor cannot be read from the pointer alone: an absolute reading would
 * jump the content at the press, before the user has moved anything. The drag
 * is therefore measured from the press point - the factor is 1 there - and it
 * changes by exactly how much the pointer moved along the corner's ray, in
 * units of the corner's own distance. Dragging the pointer one corner-distance
 * further out therefore doubles the selection, as it does in the absolute
 * rule.
 */
export function scaleFactorFrom(
  centre: Point,
  corner: Point,
  press: Point,
  pointer: Point,
): number {
  return (
    1 + (scaleFactorFor(centre, corner, pointer) - scaleFactorFor(centre, corner, press))
  );
}

/**
 * The rotation a drag asks for, measured **from where the press landed**.
 *
 * The same reason as the scale: the pointer may be off the handle by up to a
 * grab radius, and a turn read from the pointer alone would jump the content
 * at the press. The turn is the *change* since the press, wrapped to the
 * shortest way round.
 */
export function rotationAngleFrom(centre: Point, press: Point, pointer: Point): number {
  return normalizeAngle(rotationAngleFor(centre, pointer) - rotationAngleFor(centre, press));
}

/**
 * Snaps a rotation angle to the nearest 15 degrees.
 *
 * The snap is on the **angle**, not on the pointer, so the content lands on a
 * round rotation however the pointer got there.
 *
 * A tie - exactly 7.5 degrees between two steps - breaks **away from zero**,
 * so +7.5 degrees snaps to +15 and -7.5 degrees to -15. The two directions
 * must behave the same way, or a clockwise turn and its counter-clockwise
 * twin would land on different angles.
 */
export function snapRotationAngle(radians: number): number {
  const step = ROTATION_SNAP_DEGREES * DEGREES_TO_RADIANS;
  const rounded = Math.round(Math.abs(radians) / step);
  const signed = radians < 0 ? -rounded : rounded;
  return signed * step;
}

/** The map a uniform scale about a centre applies to a sample. */
export function createScaleTransform(centre: Point, factor: number): SampleTransform {
  const scale = clampScaleFactor(factor);
  return {
    label: "Scale",
    mapX: (x, _y) => centre.x + (x - centre.x) * scale,
    mapY: (_x, y) => centre.y + (y - centre.y) * scale,
  };
}

/** The map a rotation about a centre applies to a sample. */
export function createRotateTransform(centre: Point, radians: number): SampleTransform {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    label: "Rotate",
    mapX: (x, y) => centre.x + (x - centre.x) * cos - (y - centre.y) * sin,
    mapY: (x, y) => centre.y + (x - centre.x) * sin + (y - centre.y) * cos,
  };
}
