/**
 * The handles a selected gradient offers.
 *
 * A gradient is geometry plus colour stops, so editing it is a matter of
 * moving points:
 *
 *  - the two **end points** of its axis - the start and the end of a linear
 *    ramp, the centre and the radius handle of a radial one. The names are the
 *    same for both kinds, so the engine, the tool and the renderer can talk
 *    about "the end handle" without branching on the gradient's type; what the
 *    point *means* depends on the type, and the renderer draws it accordingly.
 *  - the **positions of the middle stops** along that axis. The ramp's first
 *    and last stop *are* the two end points, so a middle stop is the only
 *    stop that needs a handle of its own.
 *
 * Two spaces meet here, exactly as they do in `core/document/selectionHandles`:
 *
 *  - the handle **positions** are in document space, so a handle sits on the
 *    gradient's own point at any zoom;
 *  - the **grab radius** is in screen pixels, so a handle is equally easy to
 *    grab at 2 % and at 6400 %. The caller converts it with the live zoom.
 *
 * The module is pure and DOM-free: the geometry of the handles is the part
 * that has to be provable, so it is unit tested away from a browser.
 */

import type { Point } from "../../types/geometry";
import type { GradientRecord } from "../document/types";
import { MIN_GRADIENT_LENGTH } from "./gradientRecord";

/**
 * A handle that stands for one of the gradient's middle colour stops.
 *
 * The number is the stop's index in the record's ramp, so `stop:1` is the
 * first middle stop of a ramp whose endpoints are at index 0 and at the end.
 */
export type GradientStopHandleId = `stop:${number}`;

/**
 * Which handle a press grabbed.
 *
 * `start` is the first point of a linear axis and the **centre** of a radial
 * one; `end` is the second point of a linear axis and the point that sets a
 * radial one's **radius**. A `stop:` handle is a middle colour stop.
 */
export type GradientHandleId = "start" | "end" | GradientStopHandleId;

/** The kinds of handle a gradient offers. */
export type GradientHandleKind = "point" | "stop";

/** The handles of a gradient, in document space. */
export interface GradientHandles {
  /** The axis start (linear) or the centre (radial). */
  readonly start: Point;
  /** The axis end (linear) or the radius handle (radial). */
  readonly end: Point;
  /** The middle stops' positions, in the record's ramp order. */
  readonly stops: readonly Point[];
}

/**
 * How far, in screen pixels, a press may miss a handle and still grab it.
 *
 * The same radius the selection's transform handles use, so grabbing a
 * gradient handle and grabbing a selection handle feel like the same gesture.
 */
export const GRADIENT_HANDLE_GRAB_RADIUS_PX = 10;

/**
 * The CSS cursor each kind of handle shows.
 *
 * The two end points are dragged around the paper, so they get the "move"
 * cursor. A colour stop slides along the gradient's axis and nowhere else, so
 * it gets the precise placement cursor the gradient tool itself uses.
 */
export const GRADIENT_HANDLE_CURSORS: Readonly<Record<GradientHandleKind, string>> = {
  point: "move",
  stop: "crosshair",
};

/**
 * The smallest gap two neighbouring stops may keep.
 *
 * The file format requires a ramp's offsets to be *strictly* ascending, so a
 * stop that is dragged onto its neighbour would produce a file the reader
 * refuses. The gap keeps the ramp valid: the stop stops just short of its
 * neighbour instead of landing on it.
 */
export const MIN_STOP_GAP = 1e-6;

/**
 * The handles of a gradient, in document space.
 *
 * A radial gradient stores its radius as the distance from the centre to its
 * second point, so the radius handle sits on that point: the user drags the
 * circle outwards and the gradient follows.
 *
 * A middle stop sits on the axis at its own offset: the ramp runs from the
 * start to the end, and a stop at offset `t` is the point `t` of the way
 * along it. That is true for both kinds of gradient - for a radial one the
 * axis is the radius, and the ramp is measured along it.
 */
export function gradientHandles(gradient: GradientRecord): GradientHandles {
  const stops: Point[] = [];
  // The ramp's first and last stop are the geometry's own points, so only the
  // stops between them get a handle of their own.
  for (let index = 1; index < gradient.stops.length - 1; index += 1) {
    stops.push(gradientPointAtOffset(gradient, gradient.stops[index].offset));
  }
  return {
    start: { x: gradient.x1, y: gradient.y1 },
    end: { x: gradient.x2, y: gradient.y2 },
    stops,
  };
}

/**
 * The handle a press grabs, or `null` when it grabs none.
 *
 * The nearest handle within the grab radius wins, so a press near two handles
 * still picks the one the user aimed at. The end points are tested first, in a
 * fixed order, so the outcome never depends on the order the handles happen to
 * be listed in.
 *
 * `radius` is the grab radius in document units.
 */
export function findGradientHandle(
  handles: GradientHandles,
  docX: number,
  docY: number,
  radius: number,
): GradientHandleId | null {
  let best: GradientHandleId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  const consider = (id: GradientHandleId, point: Point): void => {
    const distance = Math.hypot(point.x - docX, point.y - docY);
    if (distance <= radius && distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  };

  consider("start", handles.start);
  consider("end", handles.end);
  handles.stops.forEach((point, index) => {
    consider(stopHandleId(index + 1), point);
  });
  return best;
}

/**
 * The distance from a point to a gradient's own geometry.
 *
 * A linear gradient's geometry is its axis: the segment from the start to the
 * end. A radial gradient's geometry is the circle its radius draws. The
 * distance is what the hit test measures, so "the axis" and "the circle" are
 * the two things a press can grab to select a gradient.
 */
export function gradientGeometryDistance(
  gradient: GradientRecord,
  docX: number,
  docY: number,
): number {
  if (gradient.type === "radial") {
    const radius = Math.hypot(gradient.x2 - gradient.x1, gradient.y2 - gradient.y1);
    return Math.abs(Math.hypot(docX - gradient.x1, docY - gradient.y1) - radius);
  }
  return distanceToSegment(docX, docY, gradient.x1, gradient.y1, gradient.x2, gradient.y2);
}

/**
 * True when a press lands on a gradient's own geometry.
 *
 * `radius` is the grab radius in document units. The test is against the
 * *geometry*, not against the pixels: a gradient paints its whole layer, so
 * every point of the paper belongs to it and only the axis or the circle can
 * say "this one".
 *
 * A radial gradient's **centre** counts as geometry too: it is one of the two
 * end handles, and it is the one point of the gradient that is certainly its
 * own.
 */
export function gradientGeometryHit(
  gradient: GradientRecord,
  docX: number,
  docY: number,
  radius: number,
): boolean {
  if (gradient.type === "radial") {
    const toCentre = Math.hypot(docX - gradient.x1, docY - gradient.y1);
    if (toCentre <= radius) {
      return true;
    }
  }
  return gradientGeometryDistance(gradient, docX, docY) <= radius;
}

/**
 * Moves one handle of a gradient, leaving everything else alone.
 *
 * The stops' **colours** and the opacity are untouched: moving a handle
 * changes where the ramp is, and the ramp is what the pixels are a function
 * of.
 *
 *  - the **start** handle moves the first point of the axis. For a radial
 *    gradient that is the centre, so the whole circle moves with it.
 *  - the **end** handle moves the second point of the axis. For a radial
 *    gradient that is the radius handle, so it sets the radius and keeps a
 *    **minimum radius**: a handle dragged onto the centre would draw nothing
 *    at all, so the handle is held at `MIN_GRADIENT_LENGTH` in the direction
 *    it was already pointing.
 *  - a **stop** handle slides the stop along the axis. The stop stays between
 *    its neighbours, so the ramp's offsets remain strictly ascending and the
 *    file the editor writes is one the reader accepts.
 *
 * The returned record is the same object when nothing changed, so a caller can
 * tell a no-op from a move. A move that cannot be made - a stop with no room
 * between its neighbours, a handle on a degenerate axis - is **refused**: the
 * record comes back untouched rather than repaired into something else.
 *
 * The caller clamps the point to the document before calling: a gradient's
 * endpoints live inside the paper, so an edited gradient is always a file the
 * reader accepts.
 */
export function moveGradientHandle(
  gradient: GradientRecord,
  handle: GradientHandleId,
  x: number,
  y: number,
): GradientRecord {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return gradient;
  }

  if (handle === "start") {
    if (gradient.x1 === x && gradient.y1 === y) {
      return gradient;
    }
    return { ...gradient, x1: x, y1: y };
  }

  if (handle === "end") {
    if (gradient.type === "radial") {
      return moveRadialRadius(gradient, x, y);
    }
    if (gradient.x2 === x && gradient.y2 === y) {
      return gradient;
    }
    return { ...gradient, x2: x, y2: y };
  }

  return moveGradientStop(gradient, handle, x, y);
}

/** True when two gradients have the same geometry, whatever their stops are. */
export function gradientGeometryEqual(a: GradientRecord, b: GradientRecord): boolean {
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

/** The handle id of the middle stop at `index` in the record's ramp. */
function stopHandleId(index: number): GradientStopHandleId {
  return `stop:${index}`;
}

/**
 * The index of the stop a stop handle stands for, or `null` when the handle
 * is not one.
 */
function stopHandleIndex(handle: GradientStopHandleId): number | null {
  const index = Number(handle.slice("stop:".length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** The point at `offset` along a gradient's axis. */
function gradientPointAtOffset(gradient: GradientRecord, offset: number): Point {
  return {
    x: gradient.x1 + (gradient.x2 - gradient.x1) * offset,
    y: gradient.y1 + (gradient.y2 - gradient.y1) * offset,
  };
}

/**
 * Moves a radial gradient's radius handle.
 *
 * The radius is the distance from the centre to the handle, so the handle
 * follows the pointer's direction and distance. A pointer inside the minimum
 * radius is pushed back out along the direction it came from, which keeps the
 * gradient drawable and keeps the handle under the pointer's side of the
 * centre.
 */
function moveRadialRadius(gradient: GradientRecord, x: number, y: number): GradientRecord {
  const dx = x - gradient.x1;
  const dy = y - gradient.y1;
  const distance = Math.hypot(dx, dy);
  const currentDx = gradient.x2 - gradient.x1;
  const currentDy = gradient.y2 - gradient.y1;
  const currentDistance = Math.hypot(currentDx, currentDy);

  if (distance < MIN_GRADIENT_LENGTH) {
    if (currentDistance < MIN_GRADIENT_LENGTH) {
      // No direction to keep: leave the degenerate gradient alone rather than
      // invent one.
      return gradient;
    }
    const scale = MIN_GRADIENT_LENGTH / currentDistance;
    const nextX = gradient.x1 + currentDx * scale;
    const nextY = gradient.y1 + currentDy * scale;
    if (gradient.x2 === nextX && gradient.y2 === nextY) {
      return gradient;
    }
    return { ...gradient, x2: nextX, y2: nextY };
  }

  if (gradient.x2 === x && gradient.y2 === y) {
    return gradient;
  }
  return { ...gradient, x2: x, y2: y };
}

/**
 * Slides one middle stop along the gradient's axis.
 *
 * The pointer's place on the axis decides the stop's new offset: the stop
 * follows the pointer onto the axis, the way a colour stop follows a drag in
 * any other tool. The new offset is then held between the stop's neighbours,
 * because the file format requires a ramp's offsets to be strictly ascending -
 * a stop that landed on its neighbour would be a file the reader refuses.
 *
 * A stop with no room between its neighbours is **refused**: the record comes
 * back untouched rather than repaired.
 */
function moveGradientStop(
  gradient: GradientRecord,
  handle: GradientStopHandleId,
  x: number,
  y: number,
): GradientRecord {
  const index = stopHandleIndex(handle);
  if (index === null) {
    return gradient;
  }
  const stop = gradient.stops[index];
  if (!stop) {
    return gradient;
  }
  // The ramp's own endpoints are the geometry's end points: they are moved by
  // the "start" and "end" handles, never by a stop handle.
  if (index === 0 || index === gradient.stops.length - 1) {
    return gradient;
  }

  const offset = offsetAtPoint(gradient, x, y);
  if (offset === null) {
    return gradient;
  }

  const previous = gradient.stops[index - 1];
  const next = gradient.stops[index + 1];
  const lower = previous ? previous.offset : 0;
  const upper = next ? next.offset : 1;
  const clamped = clampBetweenNeighbours(offset, lower, upper);
  if (clamped === null || clamped === stop.offset) {
    return gradient;
  }

  const stops = gradient.stops.map((entry, position) =>
    position === index ? { offset: clamped, color: entry.color } : entry,
  );
  return { ...gradient, stops };
}

/**
 * The offset of the point on a gradient's axis that is nearest to `(x, y)`.
 *
 * `null` when the axis has no direction at all - a gradient whose two points
 * coincide has no axis to slide a stop along.
 */
function offsetAtPoint(gradient: GradientRecord, x: number, y: number): number | null {
  const dx = gradient.x2 - gradient.x1;
  const dy = gradient.y2 - gradient.y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return null;
  }
  const offset = ((x - gradient.x1) * dx + (y - gradient.y1) * dy) / lengthSquared;
  return Math.min(1, Math.max(0, offset));
}

/**
 * Holds an offset between its neighbours, keeping the ramp strictly
 * ascending.
 *
 * `null` when the neighbours are already closer together than the smallest
 * gap the format allows: there is no offset that would be valid, so the move
 * is refused rather than repaired.
 */
function clampBetweenNeighbours(
  offset: number,
  lower: number,
  upper: number,
): number | null {
  const minimum = lower + MIN_STOP_GAP;
  const maximum = upper - MIN_STOP_GAP;
  if (minimum > maximum) {
    return null;
  }
  return Math.min(Math.max(offset, minimum), maximum);
}

/** The distance from a point to a line segment. */
function distanceToSegment(
  x: number,
  y: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(x - x0, y - y0);
  }
  const t = clamp01(((x - x0) * dx + (y - y0) * dy) / lengthSquared);
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

/** Clamps `value` into `[0, 1]`. */
function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
