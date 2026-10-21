/**
 * The grid overlay and the pointer snap.
 *
 * Two things live here, and they are the same thing seen from two sides:
 *
 *  - the **grid**: a lattice of lines at a fixed distance from each other that
 *    is drawn over the paper;
 *  - the **snap**: the rule that moves a pointer's document position onto one
 *    of those lines, or onto a composition guide.
 *
 * Everything here is pure and in **document space**. A spacing of 50 means 50
 * document pixels, never 50 CSS pixels: the grid means the same thing at every
 * zoom and on every monitor, and it is anchored to the document rather than to
 * the window, so panning slides the grid with the paper.
 *
 * The snap is a **magnet**, not a lattice lock: a point is pulled onto a
 * target only when it is within {@link SNAP_TOLERANCE_PX} CSS pixels of one.
 * The tolerance is screen space and is converted with the live zoom, so the
 * same physical gesture snaps identically at 100 % and at 400 %. Between the
 * magnet zones a point is left exactly where it is, which is what keeps a
 * drawing from being dragged around by a grid the user cannot even see.
 *
 * The rules that decide the target:
 *
 *  - the **nearest** target wins, whether it is a guide or a grid line;
 *  - on an exact tie a **guide** wins over a grid line, because a guide is a
 *    mark the user placed on purpose, and between two guides the **lower**
 *    position wins, so the answer never depends on the order the guides
 *    happen to be listed in;
 *  - each axis is decided on its own: a vertical guide can pull the x while
 *    the y still falls on a grid line.
 */

import type { Guide, GuideAxis } from "./types";
import { clamp } from "../../utils/math";

/** The distance between grid lines a fresh installation starts with, in document px. */
export const DEFAULT_GRID_SPACING = 50;

/** The smallest grid spacing, in document px. */
export const MIN_GRID_SPACING = 2;

/** The largest grid spacing, in document px. */
export const MAX_GRID_SPACING = 500;

/** The step the spacing control moves in, in document px. */
export const GRID_SPACING_STEP = 1;

/**
 * How close a point has to be to a target for the target to pull it in, in
 * CSS pixels on screen.
 *
 * Six pixels is about the size of a toolbar target: close enough to feel
 * magnetic, far enough that the grid does not fight the pointer. The distance
 * is screen space, so it is converted with the live zoom - a grid is equally
 * magnetic at 2 % and at 6400 %.
 */
export const SNAP_TOLERANCE_PX = 6;

/**
 * The grid the renderer paints and the snap measures against.
 *
 * Overlay only: the grid is drawn on the display canvas above the layers and
 * below the guides, and it never reaches a layer surface, the document or a
 * PNG export.
 */
export interface GridSettings {
  /** Whether the grid is drawn over the paper. */
  readonly visible: boolean;
  /** The distance between grid lines, in document pixels. */
  readonly spacing: number;
  /** Whether a drawing sample follows the guides and the grid lines. */
  readonly snap: boolean;
}

/** The grid settings a fresh installation starts with: no grid, no snapping. */
export const DEFAULT_GRID_SETTINGS: GridSettings = {
  visible: false,
  spacing: DEFAULT_GRID_SPACING,
  snap: false,
};

/**
 * What a snap may pull a point towards.
 *
 * The grid and the guides are separate targets: a `spacing` of `0` means "the
 * grid does not snap", and an empty `guides` list means "the guides do not
 * snap".
 */
export interface SnapTargets {
  /** Whether snapping happens at all. */
  readonly enabled: boolean;
  /** The guides that may attract the point; empty disables guide snapping. */
  readonly guides: readonly Guide[];
  /** The grid spacing in document pixels; `0` disables the grid as a target. */
  readonly spacing: number;
  /** The live zoom, which turns the screen-space tolerance into document units. */
  readonly zoom: number;
  /** The tolerance in CSS pixels; {@link SNAP_TOLERANCE_PX} by default. */
  readonly tolerancePx?: number;
}

/** The result of a snap: where the point ended up, and which axes found a target. */
export interface SnapResult {
  /** The snapped document x. */
  readonly x: number;
  /** The snapped document y. */
  readonly y: number;
  /** Whether the x found a target to sit on. */
  readonly snappedX: boolean;
  /** Whether the y found a target to sit on. */
  readonly snappedY: boolean;
}

/**
 * Clamps a spacing into the range the editor offers.
 *
 * The spacing is a whole document pixel: a fractional grid would draw a soft
 * edge at some zooms, exactly like a guide's position. A value that is not a
 * number at all restores the default rather than poisoning the grid.
 */
export function normalizeGridSpacing(spacing: number): number {
  if (!Number.isFinite(spacing)) {
    return DEFAULT_GRID_SPACING;
  }
  return clamp(Math.round(spacing), MIN_GRID_SPACING, MAX_GRID_SPACING);
}

/**
 * The grid line nearest to a coordinate, or `null` when there is no grid.
 *
 * The lines sit at whole multiples of the spacing, so the grid is anchored to
 * the document's origin rather than to the window. A coordinate that is
 * already on a line comes back unchanged, and a coordinate exactly between two
 * lines rounds up (towards positive infinity), which is the usual `Math.round`
 * rule and is the same on both sides of the origin.
 *
 * A spacing of `0` (or less), or a coordinate that is not a number, means
 * "there is no line here".
 */
export function nearestGridLine(value: number, spacing: number): number | null {
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(value)) {
    return null;
  }
  const line = Math.round(value / spacing) * spacing;
  // `Math.round(-0.4)` is `-0`, which compares equal to `0` but is a
  // different value; it would leak a `-0` into a saved document.
  return line === 0 ? 0 : line;
}

/**
 * The grid lines between two coordinates, in ascending order.
 *
 * The renderer draws these, so the drawn grid and the snapped grid are the
 * same lines by construction: what the user sees is what the pointer lands
 * on. The two bounds may be given in either order.
 */
export function gridLinesBetween(from: number, to: number, spacing: number): number[] {
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(from) || !Number.isFinite(to)) {
    return [];
  }
  const lower = Math.min(from, to);
  const upper = Math.max(from, to);
  // The epsilon keeps a line that is exactly on the boundary from being lost
  // to a floating-point remainder.
  const first = Math.ceil(lower / spacing - 1e-9);
  const last = Math.floor(upper / spacing + 1e-9);
  const lines: number[] = [];
  for (let step = first; step <= last; step += 1) {
    const line = step * spacing;
    lines.push(line === 0 ? 0 : line);
  }
  return lines;
}

/**
 * The distance in which a target attracts a point, in document units.
 *
 * Screen space (6 CSS pixels) divided by the zoom, so the magnet is the same
 * size on screen at every zoom. A zoom that is not a positive number falls
 * back to 1x.
 */
export function snapTolerance(zoom: number, tolerancePx = SNAP_TOLERANCE_PX): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return tolerancePx;
  }
  return tolerancePx / zoom;
}

/** One candidate target on an axis, with the distance that made it a candidate. */
interface Candidate {
  readonly position: number;
  readonly distance: number;
  readonly isGuide: boolean;
}

/**
 * True when `candidate` beats `best`.
 *
 * The nearer target wins. On an exact tie a guide beats a grid line, and
 * between two guides the lower position wins, so the answer never depends on
 * the order the guides happen to be listed in.
 */
function isBetter(candidate: Candidate, best: Candidate): boolean {
  if (candidate.distance !== best.distance) {
    return candidate.distance < best.distance;
  }
  if (candidate.isGuide !== best.isGuide) {
    return candidate.isGuide;
  }
  return candidate.position < best.position;
}

/**
 * The best target on one axis, or `null` when nothing is in reach.
 *
 * A guide is a candidate when the pointer is within the tolerance of it; the
 * nearest grid line is a candidate on the same terms. The nearest candidate
 * wins.
 */
function bestTarget(
  guides: readonly Guide[],
  axis: GuideAxis,
  value: number,
  spacing: number,
  tolerance: number,
): Candidate | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  let best: Candidate | null = null;

  for (const guide of guides) {
    if (guide.axis !== axis) {
      continue;
    }
    const distance = Math.abs(value - guide.position);
    if (!Number.isFinite(distance) || distance > tolerance) {
      continue;
    }
    const candidate: Candidate = { position: guide.position, distance, isGuide: true };
    if (best === null || isBetter(candidate, best)) {
      best = candidate;
    }
  }

  const line = nearestGridLine(value, spacing);
  if (line !== null) {
    const distance = Math.abs(value - line);
    if (distance <= tolerance) {
      const candidate: Candidate = { position: line, distance, isGuide: false };
      if (best === null || isBetter(candidate, best)) {
        best = candidate;
      }
    }
  }

  return best;
}

/**
 * Moves a document point onto the nearest target within reach.
 *
 * Each axis is decided on its own, and an axis with no target in reach keeps
 * its coordinate. The point is *not* clamped to the document here - that is
 * the caller's rule, because only the caller knows the paper's size.
 */
export function snapDocumentPoint(x: number, y: number, targets: SnapTargets): SnapResult {
  if (!targets.enabled) {
    return { x, y, snappedX: false, snappedY: false };
  }

  const tolerance = snapTolerance(targets.zoom, targets.tolerancePx ?? SNAP_TOLERANCE_PX);
  const targetX = bestTarget(targets.guides, "vertical", x, targets.spacing, tolerance);
  const targetY = bestTarget(targets.guides, "horizontal", y, targets.spacing, tolerance);

  return {
    x: targetX ? targetX.position : x,
    y: targetY ? targetY.position : y,
    snappedX: targetX !== null,
    snappedY: targetY !== null,
  };
}
