/**
 * Shape geometry.
 *
 * Pure functions that turn a drag - an anchor and a current point, plus the
 * Shift/Alt modifiers - into the outline a shape tool previews and commits.
 * Every kind reads the options it is drawn with from the one model
 * (`shapeOptions.ts`): the side count, the inner ratio and the rotation. The
 * line reads none of them - its angle is the drag itself.
 *
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
import type { BoxShapeGeometry, ShapeGeometry } from "../document/types";
import {
  DEFAULT_SHAPE_OPTIONS,
  normalizeShapeOptions,
  type ShapeKind,
  type ShapeOptions,
} from "./shapeOptions";

/**
 * The options model.
 *
 * It lives in its own module so that the geometry, the engine and the controls
 * can all read it, and it is re-exported here because the geometry has always
 * been where the shape options were reached for.
 */
export {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_INNER_RATIO,
  DEFAULT_SHAPE_OPTIONS,
  DEFAULT_SHAPE_ROTATION,
  DEFAULT_SHAPE_SIDES,
  MAX_SHAPE_INNER_RATIO,
  MAX_SHAPE_ROTATION,
  MAX_SHAPE_SIDES,
  MIN_SHAPE_INNER_RATIO,
  MIN_SHAPE_ROTATION,
  MIN_SHAPE_SIDES,
  SHAPE_INNER_RATIO_STEP,
  SHAPE_ROTATION_STEP,
  normalizeShapeOptions,
} from "./shapeOptions";
export type {
  ShapeKind,
  ShapeOptionField,
  ShapeOptionId,
  ShapeOptions,
} from "./shapeOptions";

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

/**
 * The outline for a shape dragged from `anchor` to `current`.
 *
 * Every kind reads the options it is drawn with from the one model
 * (`shapeOptions.ts`). The line reads none of them: its angle is the drag.
 * The parameter has a default, so a call site that does not care about the
 * options still draws the default shape.
 */
export function shapeOutline(
  kind: ShapeKind,
  drag: ShapeDrag,
  options: ShapeOptions = DEFAULT_SHAPE_OPTIONS,
): ShapePoint[] {
  return shapeGeometryOutline(shapeSpecFromDrag(kind, drag, options));
}

/**
 * The native geometry a drag produces.
 *
 * This is the **one** place where the modifier rules (Shift, Alt) are turned
 * into stored geometry. The tool previews the outline of this value and the
 * engine commits this value as a `ShapeRecord`, so the preview, the committed
 * element, the layer rebuild after undo and the reopened project all derive
 * their outline from the same parameters.
 *
 * A line keeps its two endpoints: the drag direction is part of the shape and
 * a box cannot represent it without losing which end is which. Every other
 * kind stores the normalized drag box and the options the gesture started
 * with.
 */
export function shapeSpecFromDrag(
  kind: ShapeKind,
  drag: ShapeDrag,
  options: ShapeOptions = DEFAULT_SHAPE_OPTIONS,
): ShapeGeometry {
  if (kind === "line") {
    const [start, end] = lineOutline(drag);
    return {
      shape: "line",
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
    };
  }
  const { minX, minY, maxX, maxY } = dragBox(drag);
  const normalized = normalizeShapeOptions(options);
  return {
    shape: kind,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rotation: normalized.rotation,
    sides: normalized.sides,
    innerRatio: normalized.innerRatio,
  };
}

/**
 * The outline of stored geometry.
 *
 * The inverse of {@link shapeSpecFromDrag}: a committed shape, an edited shape
 * and a shape read back from a project file all become the very points the
 * tool drew. The renderer and the selection overlay both call this.
 */
export function shapeGeometryOutline(geometry: ShapeGeometry): ShapePoint[] {
  if (geometry.shape === "line") {
    return [
      { x: geometry.x1, y: geometry.y1 },
      { x: geometry.x2, y: geometry.y2 },
    ];
  }
  const minX = geometry.x;
  const minY = geometry.y;
  const maxX = geometry.x + geometry.width;
  const maxY = geometry.y + geometry.height;
  const options: ShapeOptions = {
    sides: geometry.sides,
    innerRatio: geometry.innerRatio,
    rotation: geometry.rotation,
  };
  switch (geometry.shape) {
    case "rectangle":
      return rectangleOutline(minX, minY, maxX, maxY, options);
    case "ellipse":
      return ellipseOutline(minX, minY, maxX, maxY, options);
    case "polygon":
      return polygonOutline(minX, minY, maxX, maxY, options);
    case "star":
      return starOutline(minX, minY, maxX, maxY, options);
  }
}

/** The four corners of a box geometry's unrotated frame, in document space. */
export function shapeGeometryCorners(geometry: ShapeGeometry): ShapePoint[] {
  if (geometry.shape === "line") {
    const minX = Math.min(geometry.x1, geometry.x2);
    const minY = Math.min(geometry.y1, geometry.y2);
    const maxX = Math.max(geometry.x1, geometry.x2);
    const maxY = Math.max(geometry.y1, geometry.y2);
    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
  }
  return boxCorners(geometry);
}

function boxCorners(geometry: BoxShapeGeometry): ShapePoint[] {
  const { x, y, width, height } = geometry;
  const centre = { x: x + width / 2, y: y + height / 2 };
  const placed: ShapePoint[] = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  if (geometry.rotation % 360 === 0) {
    return placed;
  }
  return rotateAboutCentre(placed, centre.x, centre.y, geometry.rotation);
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

/**
 * The rectangle's outline.
 *
 * The four corners are placed in the dragged box and then **turned** about the
 * box's centre, so the rotation is a rigid one: the rectangle keeps its side
 * lengths, its distances and its size. Folding the rotation into the box
 * instead would morph it.
 *
 * A rotation of a whole turn is the identity, and the identity is returned
 * *exactly*: the default rectangle is the very same list of points it was
 * before the rotation option reached it.
 */
function rectangleOutline(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  options: ShapeOptions,
): ShapePoint[] {
  const placed: ShapePoint[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  // Closed: the last point repeats the first, so the closing edge is drawn.
  return closedOutline(placed, (minX + maxX) / 2, (minY + maxY) / 2, options);
}

/**
 * The ellipse's outline.
 *
 * The samples are placed on the ellipse of the dragged box and then **turned**
 * about the box's centre, exactly like the polygon's vertices are: a rigid
 * turn, so the ellipse keeps its size and only changes its tilt.
 */
function ellipseOutline(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  options: ShapeOptions,
): ShapePoint[] {
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radiusX = (maxX - minX) / 2;
  const radiusY = (maxY - minY) / 2;
  const segments = ellipseSegments(radiusX, radiusY);
  const placed: ShapePoint[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    placed.push({
      x: centerX + radiusX * Math.cos(angle),
      y: centerY + radiusY * Math.sin(angle),
    });
  }
  // Close the outline exactly: the last point repeats the first, so the
  // closing edge is drawn and the polyline is a proper loop.
  return closedOutline(placed, centerX, centerY, options);
}

/**
 * Closes a placed outline, turning it about the box's centre when it is asked
 * to.
 *
 * The turn is the rigid one from `rotateAboutCentre`. A rotation of a whole
 * turn is the identity, and it is skipped rather than computed, so the points
 * come back **exactly** as they were placed: the default rectangle and the
 * default ellipse are the very points they were before the rotation option
 * existed.
 */
function closedOutline(
  placed: readonly ShapePoint[],
  centerX: number,
  centerY: number,
  options: ShapeOptions,
): ShapePoint[] {
  const { rotation } = normalizeShapeOptions(options);
  const points =
    rotation % 360 === 0
      ? placed.map((point) => ({ x: point.x, y: point.y }))
      : rotateAboutCentre(placed, centerX, centerY, rotation);
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

/**
 * The ellipse a polygon or a star is inscribed in.
 *
 * It is the drag's box: its centre and its half-extents. A polygon that
 * follows the ellipse rule is the familiar one - the rule Photoshop,
 * Procreate and Illustrator use - and the star follows the same ellipse, so
 * the two tools agree on where a tip sits.
 *
 * The polygon's own bounding box is therefore *not* the drag's box: it equals
 * it when the side count is a multiple of four (the vertices sit on all four
 * extremes), it is narrower in one axis when the side count is two more than a
 * multiple of four, and it is smaller in both axes when the side count is odd.
 */
function boxEllipse(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
} {
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    radiusX: (maxX - minX) / 2,
    radiusY: (maxY - minY) / 2,
  };
}

/**
 * Turns a placed outline about the box's centre.
 *
 * The rotation is a **rigid** turn: the vertices are placed first, and then
 * they are turned about the centre, so the shape keeps its side lengths, its
 * distances and its size. Folding the rotation into the ellipse's *parameter*
 * instead would morph the shape on a non-square box - the side lengths would
 * change with the angle - which is not a rotation.
 *
 * The angle is measured the way the placement measures it: from the +x axis
 * towards +y, which is clockwise on a screen where y grows downwards.
 */
function rotateAboutCentre(
  points: readonly ShapePoint[],
  centerX: number,
  centerY: number,
  rotationDegrees: number,
): ShapePoint[] {
  const radians = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((point) => {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return {
      x: centerX + dx * cos - dy * sin,
      y: centerY + dx * sin + dy * cos,
    };
  });
}

/**
 * Turns the placed outline about the centre and closes it.
 *
 * The closing repeat is the *turned* first point, so the outline is a proper
 * loop: the last point repeats the first exactly.
 */
function turnedOutline(
  placed: readonly ShapePoint[],
  centerX: number,
  centerY: number,
  rotationDegrees: number,
): ShapePoint[] {
  const turned = rotateAboutCentre(placed, centerX, centerY, rotationDegrees);
  turned.push({ x: turned[0].x, y: turned[0].y });
  return turned;
}

/**
 * A regular polygon inscribed in the drag's ellipse.
 *
 * Vertex `k` sits at `-π/2 + 2πk/n`, so the first vertex is at the top and
 * the sides are equal when the box is a square (which `Shift` guarantees). The
 * rotation is applied afterwards, about the box's centre, so the shape turns
 * rigidly and the first vertex ends up at `-π/2 + rotation`.
 */
function polygonOutline(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  options: ShapeOptions,
): ShapePoint[] {
  const { sides, rotation } = normalizeShapeOptions(options);
  const { centerX, centerY, radiusX, radiusY } = boxEllipse(minX, minY, maxX, maxY);
  const placed: ShapePoint[] = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / sides;
    placed.push({
      x: centerX + radiusX * Math.cos(angle),
      y: centerY + radiusY * Math.sin(angle),
    });
  }
  return turnedOutline(placed, centerX, centerY, rotation);
}

/**
 * A star: the classic `2p`-vertex outline, an outer and an inner vertex
 * alternating around the ellipse's centre.
 *
 * It is deliberately **not** a pentagram - the five vertices connected in a
 * skipping order. A pentagram crosses itself, and the rasterizer fills a
 * shape with the non-zero rule, so a self-crossing outline would fill its
 * crossings as one blob instead of as a star.
 *
 * The outer vertices are the polygon's vertices, and the inner ones are the
 * same ellipse scaled by `innerRatio` about the centre, so a ratio of `1`
 * gives a regular `2p`-gon and the star's valleys always point between two
 * tips. The rotation is applied afterwards, about the box's centre, so the
 * star turns rigidly and keeps the ratio between its tips and its valleys.
 */
function starOutline(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  options: ShapeOptions,
): ShapePoint[] {
  const { sides, innerRatio, rotation } = normalizeShapeOptions(options);
  const { centerX, centerY, radiusX, radiusY } = boxEllipse(minX, minY, maxX, maxY);
  const placed: ShapePoint[] = [];
  for (let index = 0; index < sides; index += 1) {
    const outer = -Math.PI / 2 + (2 * Math.PI * index) / sides;
    placed.push({
      x: centerX + radiusX * Math.cos(outer),
      y: centerY + radiusY * Math.sin(outer),
    });
    const inner = -Math.PI / 2 + (2 * Math.PI * (index + 0.5)) / sides;
    placed.push({
      x: centerX + radiusX * innerRatio * Math.cos(inner),
      y: centerY + radiusY * innerRatio * Math.sin(inner),
    });
  }
  return turnedOutline(placed, centerX, centerY, rotation);
}
