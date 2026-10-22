/**
 * Rulers: the measuring strips along the top and the left of the canvas.
 *
 * The rulers are a **display aid**, in the same family as the grid and the
 * composition guides: they are drawn on the display canvas above the artwork
 * and they never reach a layer surface, a PNG export or the project file.
 *
 * Two spaces are in play, exactly as for the guides:
 *
 *  - a tick's **position** is document space, so a tick means the same
 *    coordinate at every zoom and on every machine, and the ruler pans and
 *    zooms with the paper;
 *  - a tick's **spacing** on screen is what the eye reads, so the step
 *    between two labelled ticks is chosen from the live zoom: the ruler keeps
 *    a readable number of labels whatever the zoom, and the numbers it shows
 *    are always whole document pixels.
 *
 * Everything here is pure, so the step, the ticks and the hit test can be
 * unit tested without a canvas.
 */

/** The thickness of the top ruler strip, in CSS pixels. */
export const RULER_SIZE_PX = 20;

/**
 * The width of the left ruler strip, in CSS pixels.
 *
 * Wider than the top strip, because the numbers on a vertical ruler are read
 * upright and need room for their digits; the top strip's numbers sit above
 * their ticks and can be narrower.
 */
export const RULER_LEFT_SIZE_PX = 38;

/**
 * The smallest gap between two labelled ticks, in CSS pixels.
 *
 * Sixty pixels is about the width of a four-digit label, so the numbers do
 * not collide and the eye can find the one it is looking for.
 */
export const RULER_MIN_GAP_PX = 60;

/** The ruler a screen point is over: the top strip measures the horizontal
 * axis, the left strip measures the vertical one.
 */
export type RulerAxis = "horizontal" | "vertical";

/**
 * The ruler display settings.
 *
 * Overlay only: the rulers are drawn on the display canvas above the layers
 * and below nothing else, and they never reach a layer surface, the document
 * or a PNG export.
 */
export interface RulerSettings {
  /** Whether the ruler strips are drawn. */
  readonly visible: boolean;
}

/** The rulers a fresh installation starts with: hidden. */
export const DEFAULT_RULER_SETTINGS: RulerSettings = { visible: false };

/**
 * The distance between two labelled ticks, in document pixels.
 *
 * The step is a "round" number - 1, 2 or 5 times a power of ten - and it is
 * the smallest such number that keeps the ticks at least {@link
 * RULER_MIN_GAP_PX} apart on screen. A zoom of 100 % therefore labels every
 * 100 pixels, a zoom of 25 % every 400, and a zoom of 6400 % every pixel.
 */
export function rulerStep(zoom: number, minGapPx = RULER_MIN_GAP_PX): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return 1;
  }
  if (!Number.isFinite(minGapPx) || minGapPx <= 0) {
    return 1;
  }
  // The smallest step that would still fit on screen.
  const raw = minGapPx / zoom;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const factor of [1, 2, 5, 10]) {
    const candidate = factor * magnitude;
    if (candidate >= raw) {
      return candidate;
    }
  }
  return 10 * magnitude;
}

/**
 * The distance between two unlabelled ticks, in document pixels.
 *
 * A labelled step of 100 is divided into ten, a step of 50 into five and a
 * step of 2 into two, so the strip reads as a ruler rather than as a row of
 * dots. A step of 1 has no minor ticks: there is nothing between two whole
 * pixels.
 */
export function rulerMinorStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 0;
  }
  if (step % 10 === 0) {
    return step / 10;
  }
  if (step % 5 === 0) {
    return step / 5;
  }
  if (step % 2 === 0) {
    return step / 2;
  }
  return 0;
}

/**
 * The labelled ticks between two document coordinates, in ascending order.
 *
 * The bounds may be given in either order. A tick that falls exactly on a
 * bound is kept: the epsilon keeps a tick on the boundary from being lost to
 * a floating-point remainder.
 */
export function rulerTicks(from: number, to: number, step: number): number[] {
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(from) || !Number.isFinite(to)) {
    return [];
  }
  const lower = Math.min(from, to);
  const upper = Math.max(from, to);
  const first = Math.ceil(lower / step - 1e-9);
  const last = Math.floor(upper / step + 1e-9);
  const ticks: number[] = [];
  for (let index = first; index <= last; index += 1) {
    const tick = index * step;
    ticks.push(tick === 0 ? 0 : tick);
  }
  return ticks;
}

/**
 * The ruler a screen point is over, or `null` when it is over neither.
 *
 * The strips live along the top and the left edges of the canvas, in CSS
 * pixels. The corner belongs to the top strip, so a press in the corner is
 * never ambiguous.
 */
export function rulerAxisAt(
  screenX: number,
  screenY: number,
  top = RULER_SIZE_PX,
  left = RULER_LEFT_SIZE_PX,
): RulerAxis | null {
  if (screenY >= 0 && screenY < top) {
    return "horizontal";
  }
  if (screenX >= 0 && screenX < left) {
    return "vertical";
  }
  return null;
}

/**
 * The label a tick shows: its coordinate in document pixels.
 *
 * The number is always a whole document pixel, because the ticks are: a
 * ruler that showed fractions would be measuring something the document
 * cannot store.
 */
export function formatRulerLabel(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value);
  return rounded === 0 ? "0" : String(rounded);
}
