/**
 * Pure viewport math.
 *
 * Kept free of DOM and renderer state so the transform can be unit tested and
 * reused (input mapping, overlays, status bar) without pulling in rendering.
 *
 * Convention: a document point maps to canvas-local CSS pixels via an affine
 * map
 *
 *     screen = M · doc + t
 *
 * where `M` is the linear part (scale, then rotation, then the mirror) and
 * `t` is the translation (`offsetX`, `offsetY`). Screen coordinates are
 * relative to the canvas element's top-left corner, never to the window.
 *
 * With no rotation and no mirror `M` is `zoom · I`, so the map degenerates to
 * the familiar `screen = doc · zoom + offset` and every existing caller keeps
 * its meaning. The rotation and the mirror are **view state**: they change
 * where the artwork is seen, never what the artwork is.
 */

import type { Point, Size } from "../../types/geometry";
import type { Viewport, ViewTransform } from "../../types/viewport";
import { clamp } from "../../utils/math";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;
/** Multiplicative step for a single wheel notch / zoom command. */
export const ZOOM_STEP = 1.2;
/**
 * The turn a single "rotate the view" command makes, in degrees clockwise.
 *
 * A quarter turn is the one a user can predict: the paper's edges stay
 * horizontal or vertical, so the artwork can be read either way up.
 */
export const VIEW_ROTATION_DEGREES = 90;

/** The view transform of an ordinary, upright and unmirrored view. */
export const DEFAULT_VIEW_TRANSFORM: ViewTransform = { rotation: 0, mirrored: false };

/**
 * The linear part of the view transform, in the canvas matrix convention.
 *
 * `a`, `b`, `c` and `d` are the four numbers `CanvasRenderingContext2D
 * .setTransform` wants: a screen x is `a · docX + c · docY` and a screen y is
 * `b · docX + d · docY`, both in CSS pixels.
 */
export interface ViewMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/**
 * Wraps an angle into `(-π, π]`.
 *
 * A rotation is stored wrapped, so the number in the state is always the
 * smallest turn that describes the view: `0` really means "upright", and a
 * rotation of 360° reads as "upright" too rather than as a large angle that
 * has to be reduced every time it is drawn.
 */
export function normalizeRotation(radians: number): number {
  if (!Number.isFinite(radians)) {
    return 0;
  }
  const fullTurn = Math.PI * 2;
  let value = radians % fullTurn;
  if (value <= -Math.PI) {
    value += fullTurn;
  } else if (value > Math.PI) {
    value -= fullTurn;
  }
  // `-0` would compare equal to `0` but is a different number to print and to
  // serialize; it is normalized away here.
  return value === 0 ? 0 : value;
}

/** The view's orientation, with the defaults filled in. */
export function viewTransformOf(viewport: Viewport): ViewTransform {
  const transform = viewport.transform;
  if (!transform) {
    return DEFAULT_VIEW_TRANSFORM;
  }
  return {
    rotation: normalizeRotation(transform.rotation),
    mirrored: transform.mirrored === true,
  };
}

/**
 * The linear part of a viewport's transform.
 *
 * `M = zoom · R(rotation) · F(mirrored)`: the document is scaled, then
 * mirrored left to right, then turned clockwise on screen. The order matters
 * only for the pair (rotation, mirror), and it is fixed here so that the
 * renderer, the input mapping and the status bar all agree on what "mirrored
 * and rotated" looks like.
 */
export function viewMatrix(viewport: Viewport): ViewMatrix {
  const { rotation, mirrored } = viewTransformOf(viewport);
  const zoom = viewport.zoom;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  if (mirrored) {
    // R · F with F = diag(-1, 1).
    return { a: -zoom * cos, b: -zoom * sin, c: -zoom * sin, d: zoom * cos };
  }
  return { a: zoom * cos, b: zoom * sin, c: -zoom * sin, d: zoom * cos };
}

/**
 * Copies a viewport with new numbers, keeping the view transform.
 *
 * A viewport without a transform stays without one, so the plain
 * `{ zoom, offsetX, offsetY }` shape keeps meaning "upright and unmirrored"
 * all the way through the code.
 */
function withNumbers(
  viewport: Viewport,
  zoom: number,
  offsetX: number,
  offsetY: number,
): Viewport {
  if (viewport.transform === undefined) {
    return { zoom, offsetX, offsetY };
  }
  return { zoom, offsetX, offsetY, transform: viewport.transform };
}

export function screenToDoc(viewport: Viewport, screenX: number, screenY: number): Point {
  const m = viewMatrix(viewport);
  const determinant = m.a * m.d - m.b * m.c;
  if (determinant === 0 || !Number.isFinite(determinant)) {
    // A degenerate zoom cannot be inverted; the origin is the only honest
    // answer, and the caller clamps the result to the paper anyway.
    return { x: 0, y: 0 };
  }
  const dx = screenX - viewport.offsetX;
  const dy = screenY - viewport.offsetY;
  return {
    x: (m.d * dx - m.c * dy) / determinant,
    y: (m.a * dy - m.b * dx) / determinant,
  };
}

export function docToScreen(viewport: Viewport, docX: number, docY: number): Point {
  const m = viewMatrix(viewport);
  return {
    x: m.a * docX + m.c * docY + viewport.offsetX,
    y: m.b * docX + m.d * docY + viewport.offsetY,
  };
}

/**
 * Zooms to an absolute level while keeping the document point under
 * `(screenX, screenY)` pinned to that screen position.
 *
 * The anchor is the document point under the pointer *before* the zoom, and
 * the new offsets are computed from it, so the point stays under the pointer
 * at any rotation and under a mirror as well.
 */
export function zoomToAt(
  viewport: Viewport,
  screenX: number,
  screenY: number,
  zoom: number,
): Viewport {
  const nextZoom = clampZoom(zoom);
  const anchor = screenToDoc(viewport, screenX, screenY);
  const m = viewMatrix({ ...viewport, zoom: nextZoom });
  return withNumbers(
    viewport,
    nextZoom,
    screenX - (m.a * anchor.x + m.c * anchor.y),
    screenY - (m.b * anchor.x + m.d * anchor.y),
  );
}

/** Multiplies the current zoom, pinning the document point under the cursor. */
export function zoomAt(
  viewport: Viewport,
  screenX: number,
  screenY: number,
  factor: number,
): Viewport {
  return zoomToAt(viewport, screenX, screenY, viewport.zoom * factor);
}

export function panBy(viewport: Viewport, deltaX: number, deltaY: number): Viewport {
  return withNumbers(
    viewport,
    viewport.zoom,
    viewport.offsetX + deltaX,
    viewport.offsetY + deltaY,
  );
}

/**
 * The part of the document the viewport shows, in document coordinates.
 *
 * The rectangle is the axis-aligned box that contains the four screen
 * corners, so it stays correct when the view is rotated or mirrored: a rotated
 * viewport sees a bigger, tilted patch of the paper, and the box around it is
 * what the overlays have to cover.
 */
export function visibleDocumentRect(
  viewport: Viewport,
  viewWidth: number,
  viewHeight: number,
): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } {
  const corners = [
    screenToDoc(viewport, 0, 0),
    screenToDoc(viewport, viewWidth, 0),
    screenToDoc(viewport, 0, viewHeight),
    screenToDoc(viewport, viewWidth, viewHeight),
  ];
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    left = Math.min(left, corner.x);
    top = Math.min(top, corner.y);
    right = Math.max(right, corner.x);
    bottom = Math.max(bottom, corner.y);
  }
  return { left, top, right, bottom };
}

/**
 * Re-anchors a viewport so that the document point under the centre of the
 * window stays under the centre of the window.
 *
 * This is what a rotation or a mirror does: the paper turns around the middle
 * of the window rather than around its own corner, so the part of the
 * artwork the user was looking at is still there afterwards.
 */
function anchorAtViewportCentre(
  next: Viewport,
  previous: Viewport,
  viewportSize: Size,
): Viewport {
  const centreX = viewportSize.width / 2;
  const centreY = viewportSize.height / 2;
  const anchor = screenToDoc(previous, centreX, centreY);
  const m = viewMatrix(next);
  return {
    ...next,
    offsetX: centreX - (m.a * anchor.x + m.c * anchor.y),
    offsetY: centreY - (m.b * anchor.x + m.d * anchor.y),
  };
}

/**
 * Turns the view clockwise by `deltaRadians`, about the centre of the window.
 *
 * View state: no document pixel changes, nothing is recorded in the history
 * and the document does not become unsaved.
 */
export function rotateView(
  viewport: Viewport,
  viewportSize: Size,
  deltaRadians: number,
): Viewport {
  const current = viewTransformOf(viewport);
  const rotation = normalizeRotation(current.rotation + deltaRadians);
  const next: Viewport = {
    ...viewport,
    transform: { rotation, mirrored: current.mirrored },
  };
  return anchorAtViewportCentre(next, viewport, viewportSize);
}

/**
 * Mirrors the view left to right (or back), about the centre of the window.
 *
 * View state, like the rotation: the artwork is unchanged and the document
 * does not become unsaved.
 */
export function toggleViewMirror(viewport: Viewport, viewportSize: Size): Viewport {
  const current = viewTransformOf(viewport);
  const next: Viewport = {
    ...viewport,
    transform: { rotation: current.rotation, mirrored: !current.mirrored },
  };
  return anchorAtViewportCentre(next, viewport, viewportSize);
}

/** Centers the document in the viewport at the given zoom. */
export function centerOn(
  viewportSize: Size,
  documentSize: Size,
  zoom: number,
  transform?: ViewTransform,
): Viewport {
  const nextZoom = clampZoom(zoom);
  const m = viewMatrix({
    zoom: nextZoom,
    offsetX: 0,
    offsetY: 0,
    ...(transform ? { transform } : {}),
  });
  const documentCentreX = documentSize.width / 2;
  const documentCentreY = documentSize.height / 2;
  return {
    zoom: nextZoom,
    offsetX: viewportSize.width / 2 - (m.a * documentCentreX + m.c * documentCentreY),
    offsetY: viewportSize.height / 2 - (m.b * documentCentreX + m.d * documentCentreY),
    ...(transform ? { transform } : {}),
  };
}

/**
 * Picks the largest zoom that fits the document, then centers it.
 *
 * With a rotation or a mirror the document is not an axis-aligned rectangle
 * on screen any more, so the fit is computed from the bounding box of the
 * *turned* document: the whole paper still fits, and it is still centred.
 */
export function fitToViewport(
  viewportSize: Size,
  documentSize: Size,
  padding = 32,
  transform?: ViewTransform,
): Viewport {
  const availableWidth = Math.max(1, viewportSize.width - padding * 2);
  const availableHeight = Math.max(1, viewportSize.height - padding * 2);
  if (documentSize.width <= 0 || documentSize.height <= 0) {
    return centerOn(viewportSize, documentSize, 1, transform);
  }

  // The document rectangle turned by the view transform, at zoom 1.
  const unit = viewMatrix({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    ...(transform ? { transform } : {}),
  });
  const corners = [
    { x: 0, y: 0 },
    { x: documentSize.width, y: 0 },
    { x: 0, y: documentSize.height },
    { x: documentSize.width, y: documentSize.height },
  ].map((corner) => ({
    x: unit.a * corner.x + unit.c * corner.y,
    y: unit.b * corner.x + unit.d * corner.y,
  }));
  const boxWidth = Math.max(
    ...corners.map((corner) => corner.x),
  ) - Math.min(...corners.map((corner) => corner.x));
  const boxHeight = Math.max(...corners.map((corner) => corner.y)) - Math.min(...corners.map((corner) => corner.y));
  if (boxWidth <= 0 || boxHeight <= 0) {
    return centerOn(viewportSize, documentSize, 1, transform);
  }

  const zoom = Math.min(availableWidth / boxWidth, availableHeight / boxHeight);
  return centerOn(viewportSize, documentSize, zoom, transform);
}

/**
 * The default view: the whole document, upright and unmirrored.
 *
 * This is what **Reset View** restores. It is display only, like every other
 * view action.
 */
export function resetView(viewportSize: Size, documentSize: Size, padding = 32): Viewport {
  return fitToViewport(viewportSize, documentSize, padding);
}
