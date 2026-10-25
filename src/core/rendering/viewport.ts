/**
 * Pure viewport math.
 *
 * Kept free of DOM and renderer state so the transform can be unit tested and
 * reused (input mapping, overlays, status bar) without pulling in rendering.
 *
 * Convention: a document point maps to canvas-local CSS pixels via
 * `screen = doc * zoom + offset`. Screen coordinates are relative to the
 * canvas element's top-left corner, never to the window.
 */

import type { Point, Size } from "../../types/geometry";
import type { Viewport } from "../../types/viewport";
import { clamp } from "../../utils/math";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;
/** Multiplicative step for a single wheel notch / zoom command. */
export const ZOOM_STEP = 1.2;

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

export function screenToDoc(viewport: Viewport, screenX: number, screenY: number): Point {
  return {
    x: (screenX - viewport.offsetX) / viewport.zoom,
    y: (screenY - viewport.offsetY) / viewport.zoom,
  };
}

export function docToScreen(viewport: Viewport, docX: number, docY: number): Point {
  return {
    x: docX * viewport.zoom + viewport.offsetX,
    y: docY * viewport.zoom + viewport.offsetY,
  };
}

/**
 * Zooms to an absolute level while keeping the document point under
 * `(screenX, screenY)` pinned to that screen position.
 */
export function zoomToAt(
  viewport: Viewport,
  screenX: number,
  screenY: number,
  zoom: number,
): Viewport {
  const nextZoom = clampZoom(zoom);
  const anchor = screenToDoc(viewport, screenX, screenY);
  return {
    zoom: nextZoom,
    offsetX: screenX - anchor.x * nextZoom,
    offsetY: screenY - anchor.y * nextZoom,
  };
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
  return {
    zoom: viewport.zoom,
    offsetX: viewport.offsetX + deltaX,
    offsetY: viewport.offsetY + deltaY,
  };
}

/** Centers the document in the viewport at the given zoom. */
export function centerOn(viewportSize: Size, documentSize: Size, zoom: number): Viewport {
  const nextZoom = clampZoom(zoom);
  return {
    zoom: nextZoom,
    offsetX: (viewportSize.width - documentSize.width * nextZoom) / 2,
    offsetY: (viewportSize.height - documentSize.height * nextZoom) / 2,
  };
}

/** Picks the largest zoom that fits the document, then centers it. */
export function fitToViewport(
  viewportSize: Size,
  documentSize: Size,
  padding = 32,
): Viewport {
  const availableWidth = Math.max(1, viewportSize.width - padding * 2);
  const availableHeight = Math.max(1, viewportSize.height - padding * 2);
  if (documentSize.width <= 0 || documentSize.height <= 0) {
    return centerOn(viewportSize, documentSize, 1);
  }
  const zoom = Math.min(availableWidth / documentSize.width, availableHeight / documentSize.height);
  return centerOn(viewportSize, documentSize, zoom);
}
