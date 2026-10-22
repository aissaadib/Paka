/**
 * The handles a selected gradient offers.
 *
 * A gradient is geometry plus stops, so editing it is a matter of moving two
 * points: the **start** and the **end** of a linear axis, or the **centre** and
 * the **radius handle** of a radial one. The names are the same for both kinds
 * so the engine, the tool and the renderer can talk about "the end handle"
 * without branching on the gradient's type; what the point *means* depends on
 * the type, and the renderer draws it accordingly.
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
 * Which handle a press grabbed.
 *
 * `start` is the first point of a linear axis and the **centre** of a radial
 * one; `end` is the second point of a linear axis and the point that sets a
 * radial one's **radius**.
 */
export type GradientHandleId = "start" | "end";

/** The handles of a gradient, in document space. */
export interface GradientHandles {
  /** The axis start (linear) or the centre (radial). */
  readonly start: Point;
  /** The axis end (linear) or the radius handle (radial). */
  readonly end: Point;
}

/**
 * How far, in screen pixels, a press may miss a handle and still grab it.
 *
 * The same radius the selection's transform handles use, so grabbing a
 * gradient handle and grabbing a selection handle feel like the same gesture.
 */
export const GRADIENT_HANDLE_GRAB_RADIUS_PX = 10;

/**
 * The CSS cursor each handle shows.
 *
 * Both handles move a point, so both ask for the move cursor: the press will
 * move that point of the gradient rather than draw a new one.
 */
export const GRADIENT_HANDLE_CURSORS: Record<GradientHandleId, string> = {
  start: "move",
  end: "move",
};

/**
 * The handles of a gradient, in document space.
 *
 * A radial gradient stores its radius as the distance from the centre to its
 * second point, so the radius handle sits on that point: the user drags the
 * circle outwards and the gradient follows.
 */
export function gradientHandles(gradient: GradientRecord): GradientHandles {
  return {
    start: { x: gradient.x1, y: gradient.y1 },
    end: { x: gradient.x2, y: gradient.y2 },
  };
}

/**
 * The handle a press grabs, or `null` when it grabs none.
 *
 * The nearest handle within the grab radius wins, so a press near two handles
 * still picks the one the user aimed at. The start is tested first, so the
 * outcome never depends on the order the handles happen to be listed in.
 *
 * `radius` is the grab radius in document units.
 */
export function findGradientHandle(
  handles: GradientHandles,
  docX: number,
  docY: number,
  radius: number,
): GradientHandleId | null {
  const startDistance = Math.hypot(handles.start.x - docX, handles.start.y - docY);
  if (startDistance <= radius) {
    return "start";
  }
  const endDistance = Math.hypot(handles.end.x - docX, handles.end.y - docY);
  if (endDistance <= radius) {
    return "end";
  }
  return null;
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
  return distanceToSegment(
    docX,
    docY,
    gradient.x1,
    gradient.y1,
    gradient.x2,
    gradient.y2,
  );
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
 * handles, and it is the one point of the gradient that is certainly its own.
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
 * The stops, the opacity and the type are untouched: moving a handle changes
 * the geometry, and the geometry is what the pixels are a function of.
 *
 * A radial gradient's radius handle keeps a **minimum radius**: a handle
 * dragged onto the centre would draw nothing at all, so the handle is held at
 * `MIN_GRADIENT_LENGTH` in the direction it was already pointing. The returned
 * record is the same object when nothing changed, so a caller can tell a
 * no-op from a move.
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

  if (gradient.type === "radial" && handle === "end") {
    return moveRadialRadius(gradient, x, y);
  }

  if (handle === "start") {
    if (gradient.x1 === x && gradient.y1 === y) {
      return gradient;
    }
    return { ...gradient, x1: x, y1: y };
  }
  if (gradient.x2 === x && gradient.y2 === y) {
    return gradient;
  }
  return { ...gradient, x2: x, y2: y };
}

/**
 * Moves a radial gradient's radius handle.
 *
 * The radius is the distance from the centre to the handle, so the handle
 * follows the pointer's direction and distance. A pointer inside the minimum
 * radius is pushed back out along the direction the handle already had, which
 * keeps the gradient drawable instead of collapsing it to nothing.
 */
function moveRadialRadius(
  gradient: GradientRecord,
  x: number,
  y: number,
): GradientRecord {
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

/** True when two gradients have the same geometry, whatever their stops are. */
export function gradientGeometryEqual(a: GradientRecord, b: GradientRecord): boolean {
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
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
