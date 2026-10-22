/**
 * Viewport state: what the shell remembers about where the user is looking.
 *
 * The viewport *geometry* - zoom, offsets, the screen/document mapping - is in
 * `core/rendering/viewport.ts` and is not duplicated here. This module is the
 * layer above it: the part of the viewport that survives a window resize, a
 * restart or a different screen.
 *
 * The offsets are deliberately not remembered. They are screen pixels, so they
 * mean nothing once the window is a different size. What does survive is the
 * **document point at the centre of the canvas**, which means the same thing
 * at every window size, together with the zoom and whether the user asked to
 * see the whole document.
 */

import { clampZoom, fitToViewport } from "../rendering/viewport";
import type { Size } from "../../types/geometry";
import type { Viewport } from "../../types/viewport";

/** How the viewport decides its zoom. */
export type ViewportMode = "free" | "fit";

/** The remembered viewport. */
export interface ViewportState {
  /** The zoom factor, clamped to the renderer's range. */
  readonly zoom: number;
  /** The document point shown at the centre of the canvas. */
  readonly centerX: number;
  readonly centerY: number;
  /** `"fit"` follows the document's size; `"free"` keeps the remembered zoom. */
  readonly mode: ViewportMode;
}

/** The viewport a fresh installation starts from. */
export const DEFAULT_VIEWPORT_STATE: ViewportState = Object.freeze({
  zoom: 1,
  centerX: 0,
  centerY: 0,
  mode: "fit",
});

/**
 * Reads the remembered viewport out of a live one.
 *
 * The centre of the canvas is the document point under the canvas's midpoint,
 * so the conversion is exact even at a fractional zoom.
 */
export function viewportStateFrom(
  viewport: Viewport,
  canvasSize: Size,
): ViewportState {
  const zoom = clampZoom(viewport.zoom);
  const centerDocX = (canvasSize.width / 2 - viewport.offsetX) / zoom;
  const centerDocY = (canvasSize.height / 2 - viewport.offsetY) / zoom;
  return { zoom, centerX: centerDocX, centerY: centerDocY, mode: "free" };
}

/**
 * Rebuilds a live viewport from a remembered one.
 *
 * In `"fit"` mode the zoom follows the document and the canvas, so the whole
 * document is visible whatever the window is. In `"free"` mode the remembered
 * zoom is used and the remembered centre is placed at the canvas's midpoint.
 */
export function viewportFromState(
  state: ViewportState,
  canvasSize: Size,
  documentSize: Size,
): Viewport {
  if (state.mode === "fit") {
    return fitToViewport(canvasSize, documentSize);
  }
  const zoom = clampZoom(state.zoom);
  // The remembered point, not the document's centre, is what goes in the
  // middle of the canvas: the document may be much larger than the canvas,
  // and the user was looking at one corner of it.
  return {
    zoom,
    offsetX: canvasSize.width / 2 - state.centerX * zoom,
    offsetY: canvasSize.height / 2 - state.centerY * zoom,
  };
}

/**
 * Reads a remembered viewport out of an untrusted value.
 *
 * A missing or malformed field falls back to the default rather than throwing:
 * a corrupt preferences file must not stop the editor from opening.
 */
export function normalizeViewportState(value: unknown): ViewportState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_VIEWPORT_STATE;
  }
  const record = value as {
    zoom?: unknown;
    centerX?: unknown;
    centerY?: unknown;
    mode?: unknown;
  };
  const zoom =
    typeof record.zoom === "number" && Number.isFinite(record.zoom)
      ? clampZoom(record.zoom)
      : DEFAULT_VIEWPORT_STATE.zoom;
  const centerX =
    typeof record.centerX === "number" && Number.isFinite(record.centerX)
      ? record.centerX
      : DEFAULT_VIEWPORT_STATE.centerX;
  const centerY =
    typeof record.centerY === "number" && Number.isFinite(record.centerY)
      ? record.centerY
      : DEFAULT_VIEWPORT_STATE.centerY;
  const mode: ViewportMode = record.mode === "free" ? "free" : "fit";
  return { zoom, centerX, centerY, mode };
}

/** Whether two remembered viewports are the same. */
export function viewportStateEqual(a: ViewportState, b: ViewportState): boolean {
  return (
    a.zoom === b.zoom &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.mode === b.mode
  );
}
