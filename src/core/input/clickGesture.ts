/**
 * Click versus drag.
 *
 * The canvas menu opens on a right-button *click*, and a right-button *drag*
 * paints with the secondary colour. The two share one button, so the gesture
 * has to be classified before it is acted on.
 *
 * The distance is in CSS pixels: it is what the hand actually did, and it does
 * not change with the zoom, the display density or the document size. A
 * document-space distance would grow with the zoom and stop meaning "a small
 * movement" at all.
 */

/**
 * How far the pointer may travel and still count as a click.
 *
 * Four CSS pixels is the usual drag threshold, so a right-drag that paints is
 * recognised from its first pixel of movement and a right-click that opens the
 * menu is not mistaken for a hesitant drag.
 */
export const CLICK_SLOP_PX = 4;

/** A point in CSS pixels, relative to whatever the caller measures against. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The distance between two points, in CSS pixels. */
export function distanceBetween(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** True when a gesture that started at `from` and ended at `to` was a click. */
export function isClickGesture(from: Point, to: Point): boolean {
  return distanceBetween(from, to) <= CLICK_SLOP_PX;
}
