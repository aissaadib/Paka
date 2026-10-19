/**
 * Shape geometry.
 *
 * Pure functions that turn a drag - an anchor and a current point, plus the
 * Shift/Alt modifiers - into the outline a shape tool previews and commits.
 * Nothing here knows about the engine, the renderer or the pointer: a shape is
 * just an ordered list of document-space points, and the stroke pipeline treats
 * it exactly like a brush path (see `ShapeTool`).
 *
 * The outlines are open or closed **polylines**, not filled areas or vector
 * primitives. That is deliberate: a committed shape is an ordinary
 * `StrokeRecord`, so it reuses history, persistence and re-rasterization rather
 * than introducing a second kind of document content. The cost is honest and
 * visible - corners are drawn with the brush's round joins, so a rectangle has
 * slightly rounded corners.
 */

import { clamp } from "../../utils/math";

export type ShapeKind = "line" | "rectangle" | "ellipse";

export interface ShapePoint {
  readonly x: number;
  readonly y: number;
}

export interface ShapeDrag {
  readonly anchor: ShapePoint;
  readonly current: ShapePoint;
  /** Constrain: 45-degree lines, squares and circles. */
  readonly shift: boolean;
  /** Draw from the centre: the anchor is the midpoint of the shape. */
  readonly alt: boolean;
}

/**
 * Ellipse resolution. Chosen from the larger radius so a small ellipse is not
 * over-sampled and a large one still looks round, and clamped so one shape can
 * never produce an unreasonable number of samples in the project file. Both
 * bounds are multiples of four for the reason given in `ellipseSegments`.
 */
const MIN_ELLIPSE_SEGMENTS = 24;
const MAX_ELLIPSE_SEGMENTS = 180;
const ELLIPSE_SEGMENTS_PER_RADIUS = 1.5;

/** The outline for a shape dragged from `anchor` to `current`. */
export function shapeOutline(kind: ShapeKind, drag: ShapeDrag): ShapePoint[] {
  switch (kind) {
    case "line":
      return lineOutline(drag);
    case "rectangle":
      return rectangleOutline(drag);
    case "ellipse":
      return ellipseOutline(drag);
  }
}

/**
 * Largest distance across an outline's bounding box. Zero means the drag never
 * moved, which the tools treat as a bare click and discard.
 */
export function outlineExtent(points: readonly ShapePoint[]): number {
  if (points.length === 0) {
    return 0;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/** The raw drag vector, from the anchor to the current point. */
function dragVector(drag: ShapeDrag): { dx: number; dy: number } {
  return { dx: drag.current.x - drag.anchor.x, dy: drag.current.y - drag.anchor.y };
}

function lineOutline(drag: ShapeDrag): ShapePoint[] {
  let { dx, dy } = dragVector(drag);
  // Shift constrains a line to the nearest 45-degree direction, keeping its
  // length. Rectangles and ellipses constrain differently (a square or circle),
  // so this lives here rather than in the shared vector.
  if (drag.shift && (dx !== 0 || dy !== 0)) {
    const angle = Math.atan2(dy, dx);
    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const length = Math.hypot(dx, dy);
    dx = Math.cos(snapped) * length;
    dy = Math.sin(snapped) * length;
  }
  const { anchor } = drag;
  if (drag.alt) {
    // The anchor is the midpoint: the drag reaches equally both ways.
    return [
      { x: anchor.x - dx, y: anchor.y - dy },
      { x: anchor.x + dx, y: anchor.y + dy },
    ];
  }
  return [
    { x: anchor.x, y: anchor.y },
    { x: anchor.x + dx, y: anchor.y + dy },
  ];
}

/** The axis-aligned box a rectangle or ellipse is built in. */
function dragBox(drag: ShapeDrag): { minX: number; minY: number; maxX: number; maxY: number } {
  let { dx, dy } = dragVector(drag);
  if (drag.shift) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * size;
    dy = (dy < 0 ? -1 : 1) * size;
  }
  const { anchor } = drag;
  if (drag.alt) {
    const halfX = Math.abs(dx);
    const halfY = Math.abs(dy);
    return {
      minX: anchor.x - halfX,
      minY: anchor.y - halfY,
      maxX: anchor.x + halfX,
      maxY: anchor.y + halfY,
    };
  }
  const x1 = anchor.x + dx;
  const y1 = anchor.y + dy;
  return {
    minX: Math.min(anchor.x, x1),
    minY: Math.min(anchor.y, y1),
    maxX: Math.max(anchor.x, x1),
    maxY: Math.max(anchor.y, y1),
  };
}

function rectangleOutline(drag: ShapeDrag): ShapePoint[] {
  const { minX, minY, maxX, maxY } = dragBox(drag);
  // Closed: the last point repeats the first, so the closing edge is drawn.
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: minY },
  ];
}

function ellipseOutline(drag: ShapeDrag): ShapePoint[] {
  const { minX, minY, maxX, maxY } = dragBox(drag);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radiusX = (maxX - minX) / 2;
  const radiusY = (maxY - minY) / 2;
  const segments = ellipseSegments(radiusX, radiusY);
  const points: ShapePoint[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push({
      x: centerX + radiusX * Math.cos(angle),
      y: centerY + radiusY * Math.sin(angle),
    });
  }
  // Close the outline exactly: the last point repeats the first, so the
  // closing edge is drawn and the polyline is a proper loop.
  points.push({ x: points[0].x, y: points[0].y });
  return points;
}

function ellipseSegments(radiusX: number, radiusY: number): number {
  const radius = Math.max(radiusX, radiusY);
  const ideal = Math.ceil(radius * ELLIPSE_SEGMENTS_PER_RADIUS);
  // A multiple of four puts a vertex on each axis, so the outline touches the
  // bounding box exactly instead of merely approaching it.
  return clamp(roundUpToFour(ideal), MIN_ELLIPSE_SEGMENTS, MAX_ELLIPSE_SEGMENTS);
}

function roundUpToFour(value: number): number {
  return Math.ceil(value / 4) * 4;
}
