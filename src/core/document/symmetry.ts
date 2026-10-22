/**
 * Symmetry: the drawing aid that repeats a stroke around a centre.
 *
 * Symmetry is **editor state**, like the grid: it describes the *next*
 * gesture, it is not part of the document, and it never reaches a layer
 * surface, a PNG export or the project file. What does reach the artwork is
 * the **copy** the symmetry generates: the mirrored or rotated strokes are
 * ordinary strokes with ordinary samples, so undo, redo, reopen and export
 * need no special case at all.
 *
 * Three modes, all measured from one centre:
 *
 *  - **vertical** - the stroke is repeated across a *vertical* axis through the
 *    centre, which is the classic left/right (bilateral) symmetry;
 *  - **horizontal** - the same across a *horizontal* axis, which is top/bottom
 *    symmetry;
 *  - **radial** - the stroke is repeated around the centre, `count` times
 *    evenly spaced over a full turn.
 *
 * The transforms are plain 2x3 affine matrices in the **canvas 2D
 * convention** (`x' = a*x + c*y + e`, `y' = b*x + d*y + f`), so the renderer
 * can hand one straight to `setTransform` and the engine can map a sample
 * with two multiplications. A matrix is used rather than a pair of functions
 * because the same matrix has to describe the copy to the *rasterizer* (which
 * mirrors the finished stroke) and to the *sample mapper* (which builds the
 * copy's samples) - one description, two uses, no chance of the preview and
 * the committed copy disagreeing about where a point lands.
 */

import type { Point } from "../../types/geometry";
import { clamp } from "../../utils/math";
import { createId } from "../../utils/id";
import type { StrokeRecord } from "./types";

/**
 * The symmetry modes.
 *
 * `vertical` and `horizontal` name the **axis** the stroke is mirrored across,
 * not the direction the stroke travels: a "vertical" symmetry mirrors left to
 * right across a vertical line.
 */
export type SymmetryMode = "vertical" | "horizontal" | "radial";

/** The mode a fresh installation starts with. */
export const DEFAULT_SYMMETRY_MODE: SymmetryMode = "vertical";

/** The fewest copies the radial mode may draw: the original and one copy. */
export const MIN_SYMMETRY_COUNT = 2;

/** The most copies the radial mode may draw. */
export const MAX_SYMMETRY_COUNT = 12;

/** The number of copies the radial mode starts with. */
export const DEFAULT_SYMMETRY_COUNT = 6;

/**
 * How close a press has to be to the symmetry centre to grab it, in CSS pixels.
 *
 * The same size as a toolbar target and the same as the guides' grab radius,
 * so the centre marker is as easy to hit as a guide.
 */
export const SYMMETRY_CENTER_GRAB_RADIUS_PX = 8;

/**
 * A 2x3 affine matrix, in the canvas 2D convention.
 *
 * `x' = a*x + c*y + e` and `y' = b*x + d*y + f`: the six numbers
 * `CanvasRenderingContext2D.setTransform` takes, so a transform can be
 * applied to the canvas without a translation into another convention.
 */
export interface SymmetryTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** The transform that changes nothing. */
export const IDENTITY_TRANSFORM: SymmetryTransform = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

/** The symmetry settings: what the next stroke will be repeated around. */
export interface SymmetrySettings {
  /** Whether the symmetry is on. Off by default. */
  readonly enabled: boolean;
  /** Which symmetry the copies use. */
  readonly mode: SymmetryMode;
  /** How many copies the radial mode draws (`2..12`). */
  readonly count: number;
  /** The centre, in document pixels. */
  readonly center: Point;
}

/** The symmetry a fresh installation starts with: off, mirrored left to right. */
export const DEFAULT_SYMMETRY_SETTINGS: SymmetrySettings = {
  enabled: false,
  mode: DEFAULT_SYMMETRY_MODE,
  count: DEFAULT_SYMMETRY_COUNT,
  center: { x: 0, y: 0 },
};

/**
 * Clamps a copy count into the range the editor offers.
 *
 * The count is a whole number: a radial symmetry with half a copy is not a
 * thing. A value that is not a number at all restores the default rather than
 * producing an unreadable setting.
 */
export function normalizeSymmetryCount(count: number): number {
  if (!Number.isFinite(count)) {
    return DEFAULT_SYMMETRY_COUNT;
  }
  return clamp(Math.round(count), MIN_SYMMETRY_COUNT, MAX_SYMMETRY_COUNT);
}

/** The mode a value names, or the default when it names none. */
export function normalizeSymmetryMode(mode: string): SymmetryMode {
  if (mode === "vertical" || mode === "horizontal" || mode === "radial") {
    return mode;
  }
  return DEFAULT_SYMMETRY_MODE;
}

/** Applies a transform to a point. */
export function applySymmetryTransform(
  transform: SymmetryTransform,
  x: number,
  y: number,
): Point {
  return {
    x: transform.a * x + transform.c * y + transform.e,
    y: transform.b * x + transform.d * y + transform.f,
  };
}

/** The mirror across the vertical line `x = cx`. */
function mirrorVertical(cx: number): SymmetryTransform {
  return { a: -1, b: 0, c: 0, d: 1, e: 2 * cx, f: 0 };
}

/** The mirror across the horizontal line `y = cy`. */
function mirrorHorizontal(cy: number): SymmetryTransform {
  return { a: 1, b: 0, c: 0, d: -1, e: 0, f: 2 * cy };
}

/** The turn by `angle` radians about `(cx, cy)`. */
function rotateAbout(cx: number, cy: number, angle: number): SymmetryTransform {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: cx - cos * cx + sin * cy,
    f: cy - sin * cx - cos * cy,
  };
}

/**
 * The transforms the symmetry produces, the original first.
 *
 * The list always starts with the identity, because the stroke the user drew
 * is one of the copies - it is not replaced by a symmetric pair. The rest are
 * the copies, in the order they are drawn.
 *
 * A disabled symmetry produces the identity alone, so the caller can use the
 * same list whether the symmetry is on or off.
 */
export function symmetryTransforms(settings: SymmetrySettings): SymmetryTransform[] {
  if (!settings.enabled) {
    return [IDENTITY_TRANSFORM];
  }
  const { center } = settings;
  if (settings.mode === "vertical") {
    return [IDENTITY_TRANSFORM, mirrorVertical(center.x)];
  }
  if (settings.mode === "horizontal") {
    return [IDENTITY_TRANSFORM, mirrorHorizontal(center.y)];
  }
  const count = normalizeSymmetryCount(settings.count);
  const transforms: SymmetryTransform[] = [IDENTITY_TRANSFORM];
  const step = (Math.PI * 2) / count;
  for (let index = 1; index < count; index += 1) {
    transforms.push(rotateAbout(center.x, center.y, step * index));
  }
  return transforms;
}

/**
 * The axes the symmetry overlay draws, as angles in radians.
 *
 * The angles are measured from the positive x axis, counter-clockwise in
 * mathematics and clockwise on the screen, which is the same convention the
 * document's y axis (pointing down) makes natural: an angle of `0` is a
 * horizontal line and `PI/2` a vertical one.
 *
 * The mirror modes draw the axis they mirror across; the radial mode draws
 * one spoke per copy, so the overlay shows where the copies will land.
 */
export function symmetryAxes(settings: SymmetrySettings): number[] {
  if (!settings.enabled) {
    return [];
  }
  if (settings.mode === "vertical") {
    return [Math.PI / 2];
  }
  if (settings.mode === "horizontal") {
    return [0];
  }
  const count = normalizeSymmetryCount(settings.count);
  const axes: number[] = [];
  const step = (Math.PI * 2) / count;
  for (let index = 0; index < count; index += 1) {
    axes.push(step * index);
  }
  return axes;
}

/**
 * The copies a stroke produces under a symmetry.
 *
 * Every copy is an **ordinary stroke**: the same brush, the same pressure and
 * timing, and the same samples mapped through the symmetry's transform. That
 * is what keeps the artwork self-describing - a reopened project, an undo and
 * a PNG export all reproduce the copies without knowing that a symmetry was
 * ever on.
 *
 * The copies are returned in painting order: the first one is the mirror (or
 * the first turn) and the last is the copy furthest round.
 */
export function createSymmetryCopies(
  stroke: StrokeRecord,
  settings: SymmetrySettings,
): StrokeRecord[] {
  const transforms = symmetryTransforms(settings);
  if (transforms.length < 2) {
    return [];
  }
  const copies: StrokeRecord[] = [];
  for (let index = 1; index < transforms.length; index += 1) {
    const transform = transforms[index];
    const xs: number[] = new Array(stroke.xs.length);
    const ys: number[] = new Array(stroke.ys.length);
    for (let sample = 0; sample < stroke.xs.length; sample += 1) {
      const point = applySymmetryTransform(transform, stroke.xs[sample], stroke.ys[sample]);
      xs[sample] = point.x;
      ys[sample] = point.y;
    }
    copies.push({
      id: createId("stroke"),
      layerId: stroke.layerId,
      brush: { ...stroke.brush },
      erase: stroke.erase,
      fill: stroke.fill,
      xs,
      ys,
      pressures: [...stroke.pressures],
      times: [...stroke.times],
      startTime: stroke.startTime,
    });
  }
  return copies;
}

/**
 * The distance from a document point to the symmetry centre, in document units.
 *
 * The grab radius is screen space - 8 CSS pixels - divided by the zoom, so the
 * centre marker is as easy to grab at 2 % as at 6400 %.
 */
export function symmetryCenterGrabRadius(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return SYMMETRY_CENTER_GRAB_RADIUS_PX;
  }
  return SYMMETRY_CENTER_GRAB_RADIUS_PX / zoom;
}

/**
 * True when a press lands on the symmetry centre.
 *
 * The centre is only grabbable while the symmetry is on: with it off there is
 * no marker on the canvas and nothing to grab.
 */
export function isOnSymmetryCenter(
  settings: SymmetrySettings,
  docX: number,
  docY: number,
  zoom: number,
): boolean {
  if (!settings.enabled) {
    return false;
  }
  const radius = symmetryCenterGrabRadius(zoom);
  const dx = docX - settings.center.x;
  const dy = docY - settings.center.y;
  return Math.hypot(dx, dy) <= radius;
}
