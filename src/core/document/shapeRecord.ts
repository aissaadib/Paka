/**
 * Native shape records: the pure geometry of an editable primitive.
 *
 * A `ShapeRecord` stores what the shape tool drew, not the pixels it made:
 * the primitive, the parameters that reconstruct its outline, and the brush
 * it was drawn with. Everything in this module is DOM-free and knows nothing
 * about the engine, the renderer or React, so the rules that decide where a
 * shape is, whether a press hits it and what an edit does are testable on
 * their own.
 *
 * The outline is **not** re-derived by guessing. {@link shapeGeometryOutline}
 * is the inverse of the tool's `shapeSpecFromDrag`, and it is the one function
 * the renderer, the selection overlay and the export all call. A shape drawn,
 * committed, undone, reopened and exported therefore produces the same points
 * every time.
 *
 * Rotation semantics are the shape tool's: a box shape turns **rigidly about
 * the centre of its box**, so its side lengths and proportions never change.
 * A line turns its endpoints about their centre, because it has no box.
 */

import type { Bounds, Point } from "../../types/geometry";
import type { BrushSettings } from "../../types/brush";
import { brushSettingsEqual, normalizeBrush } from "../brushes/defaults";
import type { SymmetryMirror } from "./symmetry";
import { mirrorPoint } from "./symmetry";
import {
  MAX_SHAPE_INNER_RATIO,
  MAX_SHAPE_SIDES,
  MIN_SHAPE_INNER_RATIO,
  MIN_SHAPE_SIDES,
} from "../tools/shapeOptions";
import {
  shapeGeometryCorners,
  shapeGeometryOutline,
} from "../tools/shapeGeometry";
import type { SelectionHandleId, SelectionHandles } from "./selectionHandles";
import { findSelectionHandle } from "./selectionHandles";
import { distancePointToSegment, pointInPolygon } from "./strokeSelection";
import type {
  BoxShapeGeometry,
  LineShapeGeometry,
  ShapeGeometry,
  ShapeRecord,
  StrokeRecord,
} from "./types";

/** Smallest box side an edit may leave, in document pixels. */
export const MIN_SHAPE_SIZE = 1;

/** The rotation snap the shape editor applies while Shift is held. */
export const SHAPE_ROTATION_SNAP_DEGREES = 15;

/** Clamps a rotation into `[0, 360)`. */
export function normalizeShapeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  return ((degrees % 360) + 360) % 360;
}

/**
 * The brush a shape is drawn with.
 *
 * A shape is an outline (or a flat filled polygon), not a chain of dabs, so
 * the stamp strategy is always off. Every other field is kept verbatim: the
 * colour, width, opacity, hardness, texture, tip and pressure settings are
 * exactly what the artist had when the shape was drawn.
 */
export function shapeBrush(brush: BrushSettings): BrushSettings {
  return brush.stamp ? { ...brush, stamp: false } : brush;
}

/** The outline a committed shape draws. */
export function shapeRecordOutline(shape: ShapeRecord): Point[] {
  return shapeGeometryOutline(shape.geometry);
}

/** The shape's frame: the rotated box, or the line's bounding box. */
export function shapeRecordFrame(shape: ShapeRecord): Point[] {
  return shapeGeometryCorners(shape.geometry);
}

/**
 * The transform handles of a shape, in document space.
 *
 * The corners are the shape's own box corners, so a rotated shape offers
 * handles that turn with it rather than an axis-aligned box that no longer
 * describes it. `offset` is the rotation handle's distance above the top
 * edge, in document units (the caller converts screen pixels with the zoom).
 */
export function shapeRecordHandles(
  shape: ShapeRecord,
  offset: number,
): SelectionHandles | null {
  if (!Number.isFinite(offset) || offset < 0) {
    return null;
  }
  const corners = shapeRecordFrame(shape);
  if (corners.length !== 4) {
    return null;
  }
  const [nw, ne] = corners;
  const edgeX = ne.x - nw.x;
  const edgeY = ne.y - nw.y;
  const length = Math.hypot(edgeX, edgeY);
  // The outward normal of the top edge. For an unrotated box it is (0, -1),
  // which is exactly the direction the existing selection overlay uses.
  const normalX = length > 0 ? edgeY / length : 0;
  const normalY = length > 0 ? -edgeX / length : -1;
  const middle = { x: (nw.x + ne.x) / 2, y: (nw.y + ne.y) / 2 };
  return {
    corners,
    rotate: {
      x: middle.x + normalX * offset,
      y: middle.y + normalY * offset,
    },
  };
}

/** The handle a press grabs, or `null`. */
export function findShapeHandle(
  shape: ShapeRecord,
  docX: number,
  docY: number,
  offset: number,
  radius: number,
): SelectionHandleId | null {
  const handles = shapeRecordHandles(shape, offset);
  if (!handles) {
    return null;
  }
  return findSelectionHandle(handles, docX, docY, radius);
}

/** The painted bounds of a shape, or `null` when it has no finite geometry. */
export function shapeRecordBounds(shape: ShapeRecord): Bounds | null {
  const points = shapeRecordOutline(shape);
  if (points.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const padding = Math.max(0, shape.brush.size) / 2;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * Whether a document point hits a shape.
 *
 * A stroke-like hit test: within `tolerance` of any outline segment. A filled
 * shape also answers for its interior, because that is what the user sees and
 * what a press should select. The tolerance is the caller's: it is the
 * brush's half-width and the screen-space grab radius, whichever is larger.
 */
export function shapeHitTest(
  shape: ShapeRecord,
  docX: number,
  docY: number,
  tolerance: number,
): boolean {
  const points = shapeRecordOutline(shape);
  if (points.length === 0) {
    return false;
  }
  if (shape.fill && points.length >= 3 && pointInPolygon({ x: docX, y: docY }, points)) {
    return true;
  }
  if (points.length === 1) {
    return Math.hypot(points[0].x - docX, points[0].y - docY) <= tolerance;
  }
  for (let index = 1; index < points.length; index += 1) {
    if (distancePointToSegment({ x: docX, y: docY }, points[index - 1], points[index]) <= tolerance) {
      return true;
    }
  }
  return false;
}

/** Moves a shape by a document-space delta. */
export function translateShape(shape: ShapeRecord, dx: number, dy: number): ShapeRecord {
  const geometry = shape.geometry;
  if (geometry.shape === "line") {
    return {
      ...shape,
      geometry: {
        ...geometry,
        x1: geometry.x1 + dx,
        y1: geometry.y1 + dy,
        x2: geometry.x2 + dx,
        y2: geometry.y2 + dy,
      },
    };
  }
  return {
    ...shape,
    geometry: { ...geometry, x: geometry.x + dx, y: geometry.y + dy },
  };
}

/**
 * Resizes a shape from one of its corner handles.
 *
 * The pointer is brought into the shape's **local** frame first, so a rotated
 * box is resized along its own sides rather than along the screen axes. The
 * corner opposite the grabbed one stays fixed in world space. A line has no
 * box, so its endpoints are scaled inside their bounding box about the fixed
 * corner, which keeps its identity and its direction.
 *
 * `keepAspect` (Shift) makes the moving corner follow the larger of the two
 * local extents, exactly like the shape tool's Shift square.
 */
export function resizeShape(
  shape: ShapeRecord,
  handle: SelectionHandleId,
  pointer: Point,
  keepAspect: boolean,
): ShapeRecord {
  if (handle === "rotate") {
    return shape;
  }
  return shape.geometry.shape === "line"
    ? resizeLine(shape, shape.geometry, handle, pointer, keepAspect)
    : resizeBox(shape, shape.geometry, handle, pointer, keepAspect);
}

const CORNER_INDEX: Record<Exclude<SelectionHandleId, "rotate">, number> = {
  "scale-nw": 0,
  "scale-ne": 1,
  "scale-se": 2,
  "scale-sw": 3,
};

function oppositeIndex(handle: Exclude<SelectionHandleId, "rotate">): number {
  return (CORNER_INDEX[handle] + 2) % 4;
}

function resizeBox(
  shape: ShapeRecord,
  geometry: BoxShapeGeometry,
  handle: Exclude<SelectionHandleId, "rotate">,
  pointer: Point,
  keepAspect: boolean,
): ShapeRecord {
  const centre = {
    x: geometry.x + geometry.width / 2,
    y: geometry.y + geometry.height / 2,
  };
  const radians = (geometry.rotation * Math.PI) / 180;
  const local = rotatePoint(pointer, centre, -radians);
  const corners = shapeGeometryCorners(geometry);
  const fixed = corners[oppositeIndex(handle)];

  let movingX = local.x;
  let movingY = local.y;
  if (keepAspect) {
    const dx = movingX - fixed.x;
    const dy = movingY - fixed.y;
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    movingX = fixed.x + (dx < 0 ? -size : size);
    movingY = fixed.y + (dy < 0 ? -size : size);
  }

  const left = Math.min(fixed.x, movingX);
  const right = Math.max(fixed.x, movingX);
  const top = Math.min(fixed.y, movingY);
  const bottom = Math.max(fixed.y, movingY);
  const width = Math.max(MIN_SHAPE_SIZE, right - left);
  const height = Math.max(MIN_SHAPE_SIZE, bottom - top);

  // The fixed corner must stay fixed after the new box is turned back into
  // world space. The new local centre is rotated about the *old* centre, which
  // is the only point the rotation holds still.
  const localCentre = {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
  };
  const worldCentre = rotatePoint(localCentre, centre, radians);
  return {
    ...shape,
    geometry: {
      ...geometry,
      x: worldCentre.x - width / 2,
      y: worldCentre.y - height / 2,
      width,
      height,
    },
  };
}

function resizeLine(
  shape: ShapeRecord,
  geometry: LineShapeGeometry,
  handle: Exclude<SelectionHandleId, "rotate">,
  pointer: Point,
  keepAspect: boolean,
): ShapeRecord {
  const corners = shapeGeometryCorners(geometry);
  const fixed = corners[oppositeIndex(handle)];
  const moving = corners[CORNER_INDEX[handle]];
  const denominatorX = moving.x - fixed.x;
  const denominatorY = moving.y - fixed.y;
  let scaleX = denominatorX === 0 ? 1 : (pointer.x - fixed.x) / denominatorX;
  let scaleY = denominatorY === 0 ? 1 : (pointer.y - fixed.y) / denominatorY;
  if (!Number.isFinite(scaleX)) {
    scaleX = 1;
  }
  if (!Number.isFinite(scaleY)) {
    scaleY = 1;
  }
  if (keepAspect) {
    const uniform = Math.max(Math.abs(scaleX), Math.abs(scaleY));
    scaleX = uniform;
    scaleY = uniform;
  }
  // A line must not collapse to a point: the extent is kept at one pixel.
  const length = Math.hypot(
    (geometry.x2 - geometry.x1) * scaleX,
    (geometry.y2 - geometry.y1) * scaleY,
  );
  if (length < MIN_SHAPE_SIZE) {
    const grow = MIN_SHAPE_SIZE / Math.max(length, Number.EPSILON);
    scaleX *= grow;
    scaleY *= grow;
  }
  return {
    ...shape,
    geometry: {
      ...geometry,
      x1: fixed.x + (geometry.x1 - fixed.x) * scaleX,
      y1: fixed.y + (geometry.y1 - fixed.y) * scaleY,
      x2: fixed.x + (geometry.x2 - fixed.x) * scaleX,
      y2: fixed.y + (geometry.y2 - fixed.y) * scaleY,
    },
  };
}

/**
 * Turns a shape by a relative angle.
 *
 * A box shape accumulates the turn in its `rotation` parameter, so its sides
 * and proportions are unchanged. A line turns its endpoints about the centre
 * of their bounding box. `snap` rounds the **delta** to 15 degrees, which is
 * the existing transform snap.
 */
export function rotateShape(
  shape: ShapeRecord,
  deltaDegrees: number,
  snap: boolean,
): ShapeRecord {
  if (!Number.isFinite(deltaDegrees)) {
    return shape;
  }
  const delta = snap
    ? Math.round(deltaDegrees / SHAPE_ROTATION_SNAP_DEGREES) * SHAPE_ROTATION_SNAP_DEGREES
    : deltaDegrees;
  const geometry = shape.geometry;
  if (geometry.shape === "line") {
    const centre = {
      x: (geometry.x1 + geometry.x2) / 2,
      y: (geometry.y1 + geometry.y2) / 2,
    };
    const start = rotatePoint({ x: geometry.x1, y: geometry.y1 }, centre, (delta * Math.PI) / 180);
    const end = rotatePoint({ x: geometry.x2, y: geometry.y2 }, centre, (delta * Math.PI) / 180);
    return {
      ...shape,
      geometry: { ...geometry, x1: start.x, y1: start.y, x2: end.x, y2: end.y },
    };
  }
  return {
    ...shape,
    geometry: { ...geometry, rotation: normalizeShapeDegrees(geometry.rotation + delta) },
  };
}

/** Sets a box shape's absolute rotation. A line ignores it (it has no box). */
export function setShapeRotation(shape: ShapeRecord, degrees: number): ShapeRecord {
  if (shape.geometry.shape === "line") {
    return shape;
  }
  return {
    ...shape,
    geometry: { ...shape.geometry, rotation: normalizeShapeDegrees(degrees) },
  };
}

/** Sets a polygon's sides or a star's points. */
export function setShapeSides(shape: ShapeRecord, sides: number): ShapeRecord {
  if (shape.geometry.shape !== "polygon" && shape.geometry.shape !== "star") {
    return shape;
  }
  const next = Math.min(MAX_SHAPE_SIDES, Math.max(MIN_SHAPE_SIDES, Math.round(sides)));
  if (next === shape.geometry.sides) {
    return shape;
  }
  return { ...shape, geometry: { ...shape.geometry, sides: next } };
}

/** Sets a star's inner radius. */
export function setShapeInnerRatio(shape: ShapeRecord, ratio: number): ShapeRecord {
  if (shape.geometry.shape !== "star") {
    return shape;
  }
  const next = Math.min(
    MAX_SHAPE_INNER_RATIO,
    Math.max(MIN_SHAPE_INNER_RATIO, ratio),
  );
  if (next === shape.geometry.innerRatio) {
    return shape;
  }
  return { ...shape, geometry: { ...shape.geometry, innerRatio: next } };
}

/** Fills or unfills a shape. A line has no interior, so it is left alone. */
export function setShapeFill(shape: ShapeRecord, fill: boolean): ShapeRecord {
  if (shape.geometry.shape === "line" || shape.fill === fill) {
    return shape;
  }
  return { ...shape, fill };
}

/** Changes a box shape's size, keeping its top-left corner. */
export function setShapeSize(
  shape: ShapeRecord,
  width: number,
  height: number,
): ShapeRecord {
  if (shape.geometry.shape === "line") {
    return shape;
  }
  const nextWidth = Math.max(MIN_SHAPE_SIZE, width);
  const nextHeight = Math.max(MIN_SHAPE_SIZE, height);
  if (nextWidth === shape.geometry.width && nextHeight === shape.geometry.height) {
    return shape;
  }
  return {
    ...shape,
    geometry: { ...shape.geometry, width: nextWidth, height: nextHeight },
  };
}

/**
 * Patches a shape's brush, keeping the shape's rasterization rule.
 *
 * Every appearance field the editor offers is a brush field. The patch is
 * normalized exactly like a brush edit, and `stamp` is forced off so a shape
 * can never become a chain of dabs.
 */
export function setShapeBrush(
  shape: ShapeRecord,
  patch: Partial<BrushSettings>,
): ShapeRecord {
  const next = shapeBrush(normalizeBrush({ ...shape.brush, ...patch }));
  if (brushSettingsEqual(shape.brush, next)) {
    return shape;
  }
  return { ...shape, brush: next };
}

/** The image of a shape under a symmetry mirror. */
export function mirrorShape(shape: ShapeRecord, mirror: SymmetryMirror): ShapeRecord {
  const geometry = shape.geometry;
  if (geometry.shape === "line") {
    const start = mirrorPoint({ x: geometry.x1, y: geometry.y1 }, mirror);
    const end = mirrorPoint({ x: geometry.x2, y: geometry.y2 }, mirror);
    return {
      ...shape,
      geometry: { ...geometry, x1: start.x, y1: start.y, x2: end.x, y2: end.y },
    };
  }
  const centre = mirrorPoint(
    { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 },
    mirror,
  );
  let rotation = geometry.rotation;
  for (const axis of mirror) {
    rotation = axis.kind === "vertical" ? 180 - rotation : -rotation;
  }
  return {
    ...shape,
    geometry: {
      ...geometry,
      x: centre.x - geometry.width / 2,
      y: centre.y - geometry.height / 2,
      rotation: normalizeShapeDegrees(rotation),
    },
  };
}

/** A copy of a shape on another layer, with a fresh id. */
export function cloneShape(shape: ShapeRecord, layerId: string, id: string): ShapeRecord {
  return { ...shape, id, layerId };
}

/** Whether two geometries describe the same picture. */
export function shapeGeometryEqual(a: ShapeGeometry, b: ShapeGeometry): boolean {
  if (a.shape !== b.shape) {
    return false;
  }
  if (a.shape === "line" && b.shape === "line") {
    return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
  }
  if (a.shape !== "line" && b.shape !== "line") {
    return (
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height &&
      a.rotation === b.rotation &&
      a.sides === b.sides &&
      a.innerRatio === b.innerRatio
    );
  }
  return false;
}

/** Whether two records describe the same shape, appearance included. */
export function shapeRecordsEqual(a: ShapeRecord, b: ShapeRecord): boolean {
  return (
    a.id === b.id &&
    a.layerId === b.layerId &&
    a.kind === b.kind &&
    a.fill === b.fill &&
    brushSettingsEqual(a.brush, b.brush) &&
    shapeGeometryEqual(a.geometry, b.geometry)
  );
}

/**
 * The stroke the renderer uses to draw a shape.
 *
 * This is the bridge that keeps the picture identical to the baked shapes of
 * earlier versions: the outline goes through the existing stroke rasterizer
 * with pressure 1 and the shape's own brush. It is a *derived* record - it is
 * never stored, serialized or put in history.
 */
export function strokeFromShape(shape: ShapeRecord): StrokeRecord {
  const points = shapeRecordOutline(shape);
  return {
    id: shape.id,
    layerId: shape.layerId,
    brush: shape.brush,
    ...(shape.fill ? { fill: true as const } : {}),
    xs: points.map((point) => point.x),
    ys: points.map((point) => point.y),
    pressures: points.map(() => 1),
    times: points.map(() => 0),
    startTime: 0,
  };
}

function rotatePoint(point: Point, centre: Point, radians: number): Point {
  if (radians === 0) {
    return { x: point.x, y: point.y };
  }
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}
