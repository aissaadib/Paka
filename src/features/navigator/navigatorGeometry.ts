/**
 * Navigator geometry: the mapping between the navigator's pixels and the
 * document's pixels.
 *
 * The navigator shows the whole document in a small rectangle and marks the
 * part of it the canvas is showing. That rectangle is *not* the canvas: it has
 * its own size, its own scale and its own centre, so every conversion between
 * the two goes through this module. Keeping it pure means the mapping can be
 * unit tested without a DOM, a canvas or an engine - the same reason
 * `core/rendering/viewport.ts` exists for the main canvas.
 *
 * Three spaces are in play:
 *
 *  - **document** - the artwork's own pixels, zoom-independent.
 *  - **canvas** - the drawing surface's CSS pixels, where a document point
 *    maps through the view transform (scale, rotation, mirror; see
 *    `core/rendering/viewport.ts`).
 *  - **navigator** - the overview panel's CSS pixels.
 *
 * The navigator always shows the document **upright**: a rotation or a mirror
 * is a property of the window, not of the artwork, so the overview shows the
 * artwork as it is and the visible area is drawn as the (possibly tilted)
 * quadrilateral the canvas is really showing.
 */

import type { Bounds, Point, Size } from "../../types/geometry";
import type { Viewport } from "../../types/viewport";
import { screenToDoc } from "../../core/rendering/viewport";

/**
 * Where the document sits inside the navigator panel.
 *
 * `scale` is document pixels per navigator pixel, so it is the *inverse* of
 * the canvas zoom: the navigator always shows the whole document, whatever
 * the canvas is zoomed to.
 */
export interface NavigatorLayout {
  /** Document pixels per navigator pixel. */
  readonly scale: number;
  /** Position of the document's top-left corner, in navigator pixels. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Size of the document rectangle, in navigator pixels. */
  readonly width: number;
  readonly height: number;
}

/**
 * A pointer position in the navigator, resolved against the current view.
 *
 * `offset` is the distance between the document point under the pointer and
 * the centre of the visible area. It is what a drag preserves: the artwork
 * follows the pointer instead of jumping to it.
 */
export interface NavigatorGrab {
  /** The document point under the pointer. */
  readonly doc: Point;
  /** The document-space offset between that point and the view's centre. */
  readonly offset: Point;
  /**
   * True when the pointer landed inside the visible area.
   *
   * A pointer inside the visible area *grabs* it (the view follows the
   * pointer); a pointer outside it *jumps* (the view centres on the point).
   * That is the familiar navigator behaviour: the rectangle you can see is the
   * one you can drag.
   */
  readonly inside: boolean;
}

/**
 * How far an arrow key moves the view, as a fraction of the visible area.
 *
 * A fraction of what is on screen rather than a fixed document distance, so
 * the step feels the same at every zoom.
 */
export const NAVIGATOR_KEY_STEP = 0.1;

/**
 * Fits the document into the navigator panel, preserving its aspect ratio.
 *
 * The document is centred in the panel: a tall document leaves empty space on
 * the sides, a wide one above and below. A zero-sized document or panel
 * yields an empty layout rather than a division by zero.
 */
export function navigatorLayout(documentSize: Size, panelSize: Size): NavigatorLayout {
  const panelWidth = Math.max(0, panelSize.width);
  const panelHeight = Math.max(0, panelSize.height);
  if (
    documentSize.width <= 0 ||
    documentSize.height <= 0 ||
    panelWidth <= 0 ||
    panelHeight <= 0
  ) {
    return { scale: 0, offsetX: 0, offsetY: 0, width: 0, height: 0 };
  }

  const scale = Math.min(panelWidth / documentSize.width, panelHeight / documentSize.height);
  const width = documentSize.width * scale;
  const height = documentSize.height * scale;
  return {
    scale,
    offsetX: (panelWidth - width) / 2,
    offsetY: (panelHeight - height) / 2,
    width,
    height,
  };
}

/** Maps a document point into navigator pixels. */
export function documentToNavigator(layout: NavigatorLayout, docX: number, docY: number): Point {
  return {
    x: layout.offsetX + docX * layout.scale,
    y: layout.offsetY + docY * layout.scale,
  };
}

/** Maps a navigator position back into a document point. */
export function navigatorToDocument(layout: NavigatorLayout, navX: number, navY: number): Point {
  if (!(layout.scale > 0)) {
    return { x: 0, y: 0 };
  }
  return {
    x: (navX - layout.offsetX) / layout.scale,
    y: (navY - layout.offsetY) / layout.scale,
  };
}

/**
 * The four corners of the canvas viewport, in document space.
 *
 * The corners are in canvas order (top-left, top-right, bottom-right,
 * bottom-left). With an upright view they are a rectangle; with a rotated or
 * mirrored one they are the tilted quadrilateral the canvas really shows,
 * which is what the navigator has to draw.
 */
export function viewportCorners(viewport: Viewport, viewportSize: Size): Point[] {
  const width = Math.max(0, viewportSize.width);
  const height = Math.max(0, viewportSize.height);
  return [
    screenToDoc(viewport, 0, 0),
    screenToDoc(viewport, width, 0),
    screenToDoc(viewport, width, height),
    screenToDoc(viewport, 0, height),
  ];
}

/** The same four corners, in navigator pixels. */
export function navigatorCorners(
  layout: NavigatorLayout,
  viewport: Viewport,
  viewportSize: Size,
): Point[] {
  return viewportCorners(viewport, viewportSize).map((corner) =>
    documentToNavigator(layout, corner.x, corner.y),
  );
}

/** The smallest rectangle that holds a set of points. */
export function boundsOf(points: readonly Point[]): Bounds {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The bounding box of the visible area, in navigator pixels.
 *
 * The rectangle the overlays have to cover: with a rotated view the visible
 * area is a quadrilateral, and its box is what a rectangular overlay (a
 * highlight, a hit area) can honestly use.
 */
export function viewportRect(
  layout: NavigatorLayout,
  viewport: Viewport,
  viewportSize: Size,
): Bounds {
  return boundsOf(navigatorCorners(layout, viewport, viewportSize));
}

/** The centre of the visible area, in document pixels. */
export function viewportCenter(viewport: Viewport, viewportSize: Size): Point {
  return screenToDoc(viewport, Math.max(0, viewportSize.width) / 2, Math.max(0, viewportSize.height) / 2);
}

/**
 * True when a point is inside a polygon.
 *
 * The crossing-number test: a ray from the point towards the right has to
 * cross the polygon's edge an odd number of times. It is exact for a convex
 * polygon, which the visible area always is.
 */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const last = polygon[previous];
    const straddles = current.y > point.y !== last.y > point.y;
    if (!straddles) {
      continue;
    }
    const crossing = ((last.x - current.x) * (point.y - current.y)) / (last.y - current.y) + current.x;
    if (point.x < crossing) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Resolves a pointer position in the navigator against the current view.
 *
 * The result says where the pointer is in the document, how far it is from the
 * centre of the visible area, and whether it landed inside that area.
 */
export function navigatorGrab(
  layout: NavigatorLayout,
  viewport: Viewport,
  viewportSize: Size,
  navX: number,
  navY: number,
): NavigatorGrab {
  const doc = navigatorToDocument(layout, navX, navY);
  const center = viewportCenter(viewport, viewportSize);
  const inside = pointInPolygon({ x: navX, y: navY }, navigatorCorners(layout, viewport, viewportSize));
  return {
    doc,
    offset: { x: doc.x - center.x, y: doc.y - center.y },
    inside,
  };
}

/**
 * The document point the view's centre should move to.
 *
 * A grabbed view keeps the offset it was grabbed with, so the artwork stays
 * under the pointer; a view that was not grabbed moves its centre onto the
 * pointer.
 */
export function navigatorTargetCenter(
  grab: NavigatorGrab,
  layout: NavigatorLayout,
  navX: number,
  navY: number,
): Point {
  const doc = navigatorToDocument(layout, navX, navY);
  if (!grab.inside) {
    return doc;
  }
  return { x: doc.x - grab.offset.x, y: doc.y - grab.offset.y };
}

/**
 * The document-space distance an arrow key moves the view.
 *
 * A fraction of the visible area, so the step feels the same whether the
 * canvas shows the whole document or one pixel of it.
 */
export function navigatorKeyStep(viewport: Viewport, viewportSize: Size): Point {
  const corners = viewportCorners(viewport, viewportSize);
  const bounds = boundsOf(corners);
  return {
    x: bounds.width * NAVIGATOR_KEY_STEP,
    y: bounds.height * NAVIGATOR_KEY_STEP,
  };
}

/** Clips a rectangle to the document rectangle, in navigator pixels. */
export function clipToDocument(layout: NavigatorLayout, rect: Bounds): Bounds {
  const left = Math.max(rect.x, layout.offsetX);
  const top = Math.max(rect.y, layout.offsetY);
  const right = Math.min(rect.x + rect.width, layout.offsetX + layout.width);
  const bottom = Math.min(rect.y + rect.height, layout.offsetY + layout.height);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
