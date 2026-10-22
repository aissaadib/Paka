/**
 * View navigation helpers.
 *
 * The rules that decide what a zoom readout says and what a typed zoom means,
 * kept apart from React so they can be unit tested without a DOM.
 *
 * Everything here is about the *view*: a zoom percentage, a rotation, a
 * mirror. None of it touches the document, so none of it can dirty a file.
 */

import { MAX_ZOOM, MIN_ZOOM, clampZoom } from "../../core/rendering/viewport";
import type { ViewTransform } from "../../types/viewport";

export { VIEW_ROTATION_DEGREES } from "../../core/rendering/viewport";

/**
 * The zoom as a percentage, with the precision the value deserves.
 *
 * A whole number of percent reads as a whole number (`100`), and a small zoom
 * keeps one decimal (`12.5%`), because at 2 % the difference between 2 and 3
 * is a quarter of the screen.
 */
export function formatZoomPercent(zoom: number): string {
  const percent = zoom * 100;
  if (!Number.isFinite(percent)) {
    return "0%";
  }
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/**
 * The zoom as the plain number an editable field shows.
 *
 * The field holds a number and the unit sits next to it, so the user can
 * select the number and type over it.
 */
export function zoomPercentText(zoom: number): string {
  const percent = Math.round(zoom * 100 * 10) / 10;
  if (!Number.isFinite(percent)) {
    return "0";
  }
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

/**
 * Reads a zoom out of what the user typed.
 *
 * Three forms are understood, because all three are natural to type:
 *
 *  - `150` - a percentage, the way the field is labelled;
 *  - `150%` - the same, written out;
 *  - `1.5x` - a factor, the way a scale is written.
 *
 * The result is clamped to the zoom range the viewport supports, so the field
 * can never ask for a zoom the canvas cannot show. `null` means the text is
 * not a zoom at all, and the caller keeps what it had.
 */
export function parseZoomPercent(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }

  let body = trimmed;
  let factor = false;
  if (/[%]$/.test(body)) {
    body = body.slice(0, -1).trim();
  } else if (/x$/i.test(body)) {
    body = body.slice(0, -1).trim();
    factor = true;
  }
  if (body === "") {
    return null;
  }

  const value = Number(body);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return clampZoom(factor ? value : value / 100);
}

/** The zoom range the field accepts, as a percentage. */
export const MIN_ZOOM_PERCENT = MIN_ZOOM * 100;
export const MAX_ZOOM_PERCENT = MAX_ZOOM * 100;

/**
 * A short description of how the view is turned.
 *
 * Only the facts that are not the default are named, so an upright view has no
 * label at all and a turned one says by how much.
 */
export function describeViewTransform(transform: ViewTransform): string {
  const degrees = Math.round((transform.rotation * 180) / Math.PI);
  if (degrees === 0) {
    return transform.mirrored ? "mirrored" : "upright";
  }
  const turned = `rotated ${Math.abs(degrees)}°`;
  return transform.mirrored ? `${turned} · mirrored` : turned;
}
