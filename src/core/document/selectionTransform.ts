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
 *
 * A **corner** handle scales the selection uniformly about the frame's
 * centre. An **edge** handle stretches one axis, anchored at the opposite
 * edge, and the proportional modifier locks the other axis to the same
 * factor. Both are written as an anchor and a factor per axis
 * (`HandleScale`), so one map covers them.
 */

import type { Bounds, Point } from "../../types/geometry";
import type { ScaleAxis, ScaleSide } from "./selectionHandles";
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

/**
 * The factor the fixed-step scale applies.
 *
 * A fixed step is a **factor**, not a target size: it multiplies the
 * selection's geometry by this much, so applying it twice gives 2.25×, not
 * 150 % of what the selection used to be. The transform does not remember the
 * original size, so it could not honour a target even if one were asked for.
 *
 * The factor is uniform and about the centre of the selection's frame, exactly
 * like the corner handle's - the fixed step and the handle are the same
 * operation with a different way of choosing the number.
 */
export const FIXED_SCALE_FACTOR = 1.5;

/**
 * The angle the fixed-step rotation applies, in degrees, clockwise.
 *
 * It is the same 15-degree step the rotation handle snaps to, so the two
 * routes through the feature agree on what a step is. A positive angle turns
 * the content clockwise, because the document's y axis points down.
 */
export const FIXED_ROTATION_DEGREES = ROTATION_SNAP_DEGREES;

/**
 * The smallest a stretched axis may become, in document pixels.
 *
 * A free (one-axis) stretch may squash a side almost to nothing, but not to
 * nothing: a zero-width frame has no interior, and the handle that produced
 * it would have nothing left to pull. One document pixel is the floor - small
 * enough to be no obstacle, large enough to stay a frame.
 *
 * The **uniform** scale keeps the older, stricter floor of
 * `MIN_SCALE_FACTOR` instead: a selection that is scaled down as a whole
 * should stay recognisable, while a single side may be flattened on purpose.
 */
export const MIN_STRETCH_SIZE = 1;

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * A scale, written as an anchor and a factor per axis.
 *
 * The map is `x' = anchorX + (x - anchorX) * factorX`, and the same for y.
 * Two factors rather than one is what lets a side handle stretch one axis and
 * leave the other alone, and what lets the proportional modifier grow the
 * other axis by the same factor.
 *
 * The anchor is the point that does not move: the opposite edge for a free
 * side stretch, the frame's centre for a corner handle, and the centre of an
 * axis for the axis that is not being dragged.
 */
export interface HandleScale {
  /** The point the x axis is measured from. */
  readonly anchorX: number;
  /** The point the y axis is measured from. */
  readonly anchorY: number;
  /** The factor along x. */
  readonly factorX: number;
  /** The factor along y. */
  readonly factorY: number;
}

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
 * The corner of a frame opposite the given one.
 *
 * The opposite corner is the one on the other side **and** on the other row:
 * anchoring a corner drag there leaves that corner where it is, which is the
 * classic "the corner you did not drag stays put".
 */
export function oppositeCorner(frame: Bounds, corner: Point): Point {
  const centreX = frame.x + frame.width / 2;
  const centreY = frame.y + frame.height / 2;
  return {
    x: corner.x < centreX ? frame.x + frame.width : frame.x,
    y: corner.y < centreY ? frame.y + frame.height : frame.y,
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

/**
 * Clamps the factor of a free (one-axis) stretch.
 *
 * The floor is the one that keeps the stretched axis at least
 * `MIN_STRETCH_SIZE` document pixels wide, so a drag can flatten a side but
 * never erase it. The factor is never negative: a negative one would mirror
 * the content, which is a **flip** and has its own command.
 *
 * A factor that is not a number at all (a NaN from a degenerate frame) is
 * refused the same way the uniform scale refuses it: the selection stays
 * where it is.
 */
export function clampStretchFactor(factor: number, size: number): number {
  if (!Number.isFinite(factor) || !Number.isFinite(size) || size <= 0) {
    return 1;
  }
  return Math.max(MIN_STRETCH_SIZE / size, factor);
}

/**
 * The scale a **corner** handle asks for.
 *
 * The scale is uniform - the same factor on both axes - and it is measured
 * about `anchor`, the point that does not move. The default anchor is the
 * centre of the selection's frame; the user may ask for the opposite corner
 * instead, which is the classic "the corner you did not drag stays put".
 *
 * The factor is measured **from where the press landed**, for the same reason
 * the uniform scale is: a press that misses the handle by a little must not
 * jump the content.
 */
export function cornerScale(
  corner: Point,
  anchor: Point,
  press: Point,
  pointer: Point,
): HandleScale {
  const factor = clampScaleFactor(scaleFactorFrom(anchor, corner, press, pointer));
  return { anchorX: anchor.x, anchorY: anchor.y, factorX: factor, factorY: factor };
}

/**
 * The point an axis is measured from when a side handle pulls it.
 *
 * The **opposite edge** is the anchor by default: the side the user did not
 * drag stays where it is. The **centre** of the axis is the alternative: the
 * frame grows on both sides instead.
 */
function anchorOnAxis(
  low: number,
  high: number,
  centre: number,
  side: ScaleSide,
  fromCentre: boolean,
): number {
  if (fromCentre) {
    return centre;
  }
  return side === "end" ? low : high;
}

/**
 * The scale an **edge** handle asks for.
 *
 * A side handle pulls one axis and leaves the other alone, so the frame gets
 * wider or taller rather than bigger. The dragged edge tracks the pointer one
 * for one, which is what makes the gesture feel attached to the cursor:
 *
 *  - anchored at the **opposite edge** (the default) the other edge stays
 *    where it is and the frame grows away from it;
 *  - anchored at the **centre** (`fromCentre`) the frame grows on both sides,
 *    so the dragged edge still tracks the pointer but the opposite edge moves
 *    too.
 *
 * `proportional` locks the aspect ratio: the axis that is not dragged grows by
 * the same factor, about the centre of that axis, so the selection keeps its
 * proportions. The factor is then clamped against *both* axes, so neither can
 * be squashed to nothing by the other's size.
 *
 * The factor is measured **from where the press landed**, so a press that
 * misses the handle by a little does not jump the content.
 *
 * `frame` is the **content's** own bounds - the samples', without the paint's
 * padding - and that is what makes the rule above true of the frame the user
 * sees. The padding is a constant offset on both sides, so a content edge
 * that stays put keeps its painted edge still, and a content edge that
 * follows the pointer takes its painted edge with it. A selection with no
 * extent on an axis (a single horizontal stroke, stretched from above) has
 * nothing to stretch there, and the drag leaves it alone.
 */
export function edgeScale(
  frame: Bounds,
  axis: ScaleAxis,
  side: ScaleSide,
  press: Point,
  pointer: Point,
  options: { readonly proportional: boolean; readonly fromCentre: boolean },
): HandleScale {
  const size = axis === "x" ? frame.width : frame.height;
  const otherSize = axis === "x" ? frame.height : frame.width;
  const delta = axis === "x" ? pointer.x - press.x : pointer.y - press.y;
  const centreX = frame.x + frame.width / 2;
  const centreY = frame.y + frame.height / 2;

  const low = axis === "x" ? frame.x : frame.y;
  const high = axis === "x" ? frame.x + frame.width : frame.y + frame.height;
  // The anchor is the point that does not move: the opposite edge by default,
  // the centre of the axis when the frame is to grow on both sides.
  const anchor = anchorOnAxis(low, high, axis === "x" ? centreX : centreY, side, options.fromCentre);

  // How far the dragged edge travelled **away from the anchor**: the east and
  // south handles travel with the pointer, the west and north ones against
  // it, because they are the low end of their axis. The frame's size along
  // that axis changes by exactly that much.
  const travel = side === "end" ? delta : -delta;
  // The dragged edge tracks the pointer one for one, so the frame's size
  // along that axis changes by the pointer's travel. From the centre the
  // frame grows on both sides, so the size changes twice as fast.
  const raw = size > 0 ? 1 + (options.fromCentre ? 2 : 1) * (travel / size) : 1;
  const factor = clampStretchFactor(raw, size);
  // The locked case keeps the aspect ratio, so neither axis may be squashed
  // to nothing by the other's size: the factor is clamped against both.
  const locked =
    options.proportional && otherSize > 0
      ? Math.max(factor, MIN_STRETCH_SIZE / otherSize)
      : factor;

  if (axis === "x") {
    return {
      anchorX: anchor,
      anchorY: centreY,
      factorX: locked,
      factorY: options.proportional ? locked : 1,
    };
  }
  return {
    anchorX: centreX,
    anchorY: anchor,
    factorX: options.proportional ? locked : 1,
    factorY: locked,
  };
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

/**
 * The map a scale applies to a sample.
 *
 * The scale is written as an anchor and a factor per axis, so the same map
 * covers the uniform scale (the same factor twice, about the centre) and the
 * free one-axis stretch (one factor, the other axis untouched).
 */
export function createStretchTransform(scale: HandleScale, label = "Scale"): SampleTransform {
  return {
    label,
    mapX: (x, _y) => scale.anchorX + (x - scale.anchorX) * scale.factorX,
    mapY: (_x, y) => scale.anchorY + (y - scale.anchorY) * scale.factorY,
  };
}

/**
 * The map a uniform scale about a centre applies to a sample.
 *
 * The label is the history entry's name, which the undo button shows. It
 * defaults to the generic "Scale" of a corner-handle drag; a fixed-step
 * command passes a more specific one so the two are told apart in the
 * history.
 */
export function createScaleTransform(
  centre: Point,
  factor: number,
  label = "Scale",
): SampleTransform {
  const scale = clampScaleFactor(factor);
  return createStretchTransform(
    { anchorX: centre.x, anchorY: centre.y, factorX: scale, factorY: scale },
    label,
  );
}

/**
 * The map a rotation about a centre applies to a sample.
 *
 * The label is the history entry's name, which the undo button shows. It
 * defaults to the generic "Rotate" of a handle drag; a fixed-step command
 * passes a more specific one so the two are told apart in the history.
 */
export function createRotateTransform(
  centre: Point,
  radians: number,
  label = "Rotate",
): SampleTransform {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    label,
    mapX: (x, y) => centre.x + (x - centre.x) * cos - (y - centre.y) * sin,
    mapY: (x, y) => centre.y + (x - centre.x) * sin + (y - centre.y) * cos,
  };
}
