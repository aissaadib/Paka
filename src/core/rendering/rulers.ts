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
 * Everything here is pure, so the step, the ticks, the hit test and the
 * selection's marks can be unit tested without a canvas.
 *
 * The rulers are **chrome**: they are painted over the canvas's top and left
 * edges and they never touch the viewport. The document does not move when
 * they appear, and no pointer offset is needed to compensate for them.
 */

import type { Bounds } from "../../types/geometry";
import type { Viewport } from "../../types/viewport";
import { docToScreen, screenToDoc } from "./viewport";

/** The thickness of the top ruler strip, in CSS pixels. */
export const RULER_SIZE_PX = 20;

/**
 * The width of the left ruler strip, in CSS pixels.
 *
 * Wider than the top strip, because the numbers on a vertical ruler are read
 * upright and need room for their digits; the top strip's numbers sit beside
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

/**
 * The ruler a screen point is over: the top strip measures the horizontal
 * axis, the left strip measures the vertical one.
 */
export type RulerAxis = "horizontal" | "vertical";

/**
 * The ruler display settings.
 *
 * Overlay only: the rulers are painted on the display canvas above the layers
 * and they never reach a layer surface, the document or a PNG export.
 */
export interface RulerSettings {
  /** Whether the ruler strips are drawn. */
  readonly visible: boolean;
}

/** The rulers a fresh installation starts with: hidden. */
export const DEFAULT_RULER_SETTINGS: RulerSettings = { visible: false };

/**
 * The space the ruler strips take at the top and the left of the canvas, in
 * CSS pixels.
 *
 * The strips are chrome that is painted *over* the canvas element, so the
 * insets are the ruler's own measurements rather than a hole cut out of the
 * canvas: the document underneath is not moved out of the way.
 */
export interface RulerInsets {
  /** The height of the top strip. */
  readonly top: number;
  /** The width of the left strip. */
  readonly left: number;
}

/** The strips' own measurements: the top strip and the left strip. */
export const DEFAULT_RULER_INSETS: RulerInsets = {
  top: RULER_SIZE_PX,
  left: RULER_LEFT_SIZE_PX,
};

/** A range along one axis, in document pixels; `from` is never above `to`. */
export interface RulerRange {
  /** The range's start, in document pixels. */
  readonly from: number;
  /** The range's end, in document pixels. */
  readonly to: number;
}

/** A span along one axis, in document pixels; `from` is never above `to`. */
export interface RulerSpan {
  /** The span's start, in document pixels. */
  readonly from: number;
  /** The span's end, in document pixels. */
  readonly to: number;
}

/** One tick, as the ruler shows it. */
export interface RulerTick {
  /** The tick's coordinate, in document pixels. */
  readonly value: number;
  /**
   * The tick's position on screen, in CSS pixels from the canvas's left edge
   * (horizontal ruler) or its top edge (vertical ruler).
   */
  readonly screen: number;
  /** The tick's label; empty for an unlabelled tick. */
  readonly label: string;
}

/** One ruler's ticks: what it shows and how far apart they are. */
export interface RulerLayout {
  /** The axis the layout measures. */
  readonly axis: RulerAxis;
  /** The distance between two labelled ticks, in document pixels. */
  readonly step: number;
  /**
   * The distance between two unlabelled ticks, in document pixels; `0` when
   * the step has no division, which is the case for a step of one.
   */
  readonly minorStep: number;
  /** The document range the ruler shows. */
  readonly range: RulerRange;
  /** The labelled ticks, in ascending order. */
  readonly major: readonly RulerTick[];
  /** The unlabelled ticks, in ascending order. */
  readonly minor: readonly RulerTick[];
}

/** Both rulers at once: the geometry the painter needs. */
export interface RulerGeometry {
  /** The top ruler, which measures the horizontal axis. */
  readonly horizontal: RulerLayout;
  /** The left ruler, which measures the vertical axis. */
  readonly vertical: RulerLayout;
}

/** The marks a selection leaves on the two rulers. */
export interface RulerSelectionMarks {
  /** The horizontal ruler's marked span, or `null` when there is no selection. */
  readonly horizontal: RulerSpan | null;
  /** The vertical ruler's marked span, or `null` when there is no selection. */
  readonly vertical: RulerSpan | null;
}

/**
 * The distance between two labelled ticks, in document pixels.
 *
 * The step is a "round" number - 1, 2 or 5 times a power of ten - and it is
 * the smallest such number that keeps the ticks at least {@link
 * RULER_MIN_GAP_PX} apart on screen. A zoom of 100 % therefore labels every
 * 100 pixels, a zoom of 25 % every 500, and a zoom of 6400 % every pixel.
 *
 * The rule is a pure function of the zoom, so the ruler reads the same way
 * every time it is drawn: the same zoom always gives the same step, and the
 * step never depends on where the canvas is scrolled to.
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
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const factor of [1, 2, 5]) {
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
 * A labelled step is divided into ten parts when ten is a whole number of
 * parts, into five when it is not, and into two otherwise, so the strip reads
 * as a ruler rather than as a row of dots. A step of 100 is divided every 10
 * units, a step of 50 every 5 and a step of 2 every 1. A step of 1 has no
 * minor ticks: there is nothing between two whole pixels.
 *
 * Because the labelled step is always at least a screenful of pixels wide,
 * the unlabelled ticks are never closer than about six pixels together, so
 * they stay readable at every zoom.
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
 * The unlabelled ticks between two document coordinates, in ascending order.
 *
 * The ticks that carry a label are left out: they are drawn by
 * {@link rulerTicks} and drawing them twice would double their weight. The
 * test is made on the tick's *index*, so a tick and its label coincide
 * exactly, whatever the step is.
 */
export function rulerMinorTicks(
  from: number,
  to: number,
  minorStep: number,
  majorStep = 0,
): number[] {
  if (!Number.isFinite(minorStep) || minorStep <= 0 || !Number.isFinite(from) || !Number.isFinite(to)) {
    return [];
  }
  const lower = Math.min(from, to);
  const upper = Math.max(from, to);
  const divisions = majorStep > 0 ? Math.round(majorStep / minorStep) : 0;
  const first = Math.ceil(lower / minorStep - 1e-9);
  const last = Math.floor(upper / minorStep + 1e-9);
  const ticks: number[] = [];
  for (let index = first; index <= last; index += 1) {
    if (divisions > 0 && index % divisions === 0) {
      continue;
    }
    const tick = index * minorStep;
    ticks.push(tick === 0 ? 0 : tick);
  }
  return ticks;
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

/**
 * The ruler a screen point is over, or `null` when it is over neither.
 *
 * The strips live along the top and the left edges of the canvas, in CSS
 * pixels. The corner belongs to the top strip, so a press in the corner is
 * never ambiguous, and a point outside the canvas is over neither: the
 * strips run along the canvas's own edges.
 */
export function rulerAxisAt(
  screenX: number,
  screenY: number,
  top = RULER_SIZE_PX,
  left = RULER_LEFT_SIZE_PX,
): RulerAxis | null {
  if (screenX < 0 || screenY < 0) {
    return null;
  }
  if (screenY < top) {
    return "horizontal";
  }
  if (screenX < left) {
    return "vertical";
  }
  return null;
}

/**
 * The document coordinate of a screen point along one axis.
 *
 * The horizontal ruler measures the x coordinate and the vertical ruler the
 * y coordinate; the other coordinate is ignored, because the ruler only ever
 * measures along its own axis.
 */
export function rulerDocumentAt(
  viewport: Viewport,
  axis: RulerAxis,
  screenX: number,
  screenY: number,
): number {
  const point = screenToDoc(viewport, screenX, screenY);
  return axis === "horizontal" ? point.x : point.y;
}

/**
 * The nearest labelled tick to a coordinate, in document pixels.
 *
 * A coordinate that is already on a tick comes back unchanged, and one that
 * is exactly between two ticks rounds up, the same rule the grid's nearest
 * line follows.
 */
export function nearestRulerTick(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return 0;
  }
  const tick = Math.round(value / step) * step;
  // `Math.round(-0.5)` is `-0`, which is a number that compares equal to `0`
  // but is not the same value.
  return tick === 0 ? 0 : tick;
}

/** Where the pointer is on a ruler. */
export interface RulerCursor {
  /** The ruler the pointer is over. */
  readonly axis: RulerAxis;
  /** The pointer's position along the axis, in document pixels. */
  readonly value: number;
  /** The nearest labelled tick, in document pixels. */
  readonly snapped: number;
}

/**
 * Where the pointer is on a ruler: the coordinate it is over and the tick it
 * would snap to.
 *
 * The two are kept apart on purpose. The continuous position is what a
 * gesture follows, and the snapped one is what a guide dragged out of the
 * ruler would land on.
 */
export function rulerCursorAt(
  viewport: Viewport,
  axis: RulerAxis,
  screenX: number,
  screenY: number,
  step?: number,
): RulerCursor {
  const value = rulerDocumentAt(viewport, axis, screenX, screenY);
  const resolvedStep = step ?? rulerStep(viewport.zoom);
  return { axis, value, snapped: nearestRulerTick(value, resolvedStep) };
}

/**
 * The document range a ruler shows.
 *
 * The range is what is on screen between the strip's inner edge and the far
 * edge of the canvas, so the ruler never shows a tick that belongs to the
 * strip itself.
 */
export function rulerVisibleRange(
  viewport: Viewport,
  axis: RulerAxis,
  cssSize: number,
  insets: RulerInsets = DEFAULT_RULER_INSETS,
): RulerRange {
  const zoom = viewport.zoom;
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return { from: 0, to: 0 };
  }
  const start = axis === "horizontal" ? insets.left : insets.top;
  const end = Number.isFinite(cssSize) && cssSize > start ? cssSize : start;
  // The horizontal ruler is measured from the canvas's left edge and the
  // vertical one from its top edge, so each axis is converted on its own.
  const from =
    axis === "horizontal"
      ? screenToDoc(viewport, start, 0).x
      : screenToDoc(viewport, 0, start).y;
  const to =
    axis === "horizontal"
      ? screenToDoc(viewport, end, 0).x
      : screenToDoc(viewport, 0, end).y;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

/**
 * The screen position of a document coordinate along one axis.
 *
 * The coordinate is measured from the canvas's left edge on the horizontal
 * ruler and from its top edge on the vertical one.
 */
export function rulerScreenAt(viewport: Viewport, axis: RulerAxis, value: number): number {
  const point = axis === "horizontal" ? docToScreen(viewport, value, 0) : docToScreen(viewport, 0, value);
  return axis === "horizontal" ? point.x : point.y;
}

/**
 * The ticks a ruler shows, for a given viewport and canvas size.
 *
 * The layout is a pure function of the viewport, the canvas size and the
 * zoom: the same inputs always give the same ticks, in the same places, so
 * the ruler can be drawn, measured and tested without a canvas.
 *
 * The canvas size is the *CSS* size of the canvas element, not its backing
 * store: the ruler is chrome, measured in the same units as the pointer.
 */
export function rulerLayout(
  viewport: Viewport,
  axis: RulerAxis,
  cssSize: number,
  options: { insets?: RulerInsets; minGapPx?: number } = {},
): RulerLayout {
  const insets = options.insets ?? DEFAULT_RULER_INSETS;
  const step = rulerStep(viewport.zoom, options.minGapPx ?? RULER_MIN_GAP_PX);
  const minorStep = rulerMinorStep(step);
  const range = rulerVisibleRange(viewport, axis, cssSize, insets);
  // A zoom that is not a positive number is a broken viewport: the ruler
  // shows nothing rather than a stray tick at the origin.
  if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
    return { axis, step, minorStep, range: { from: 0, to: 0 }, major: [], minor: [] };
  }

  const major = rulerTicks(range.from, range.to, step).map((value) => ({
    value,
    screen: rulerScreenAt(viewport, axis, value),
    label: formatRulerLabel(value),
  }));
  const minor =
    minorStep > 0
      ? rulerMinorTicks(range.from, range.to, minorStep, step).map((value) => ({
          value,
          screen: rulerScreenAt(viewport, axis, value),
          label: "",
        }))
      : [];

  return { axis, step, minorStep, range, major, minor };
}

/**
 * Both rulers' geometry for a viewport and a canvas size.
 *
 * The two layouts are independent: the top ruler measures the horizontal axis
 * and the left one the vertical, so each is laid out over its own range.
 */
export function rulerGeometry(
  viewport: Viewport,
  cssWidth: number,
  cssHeight: number,
  options: { insets?: RulerInsets; minGapPx?: number } = {},
): RulerGeometry {
  return {
    horizontal: rulerLayout(viewport, "horizontal", cssWidth, options),
    vertical: rulerLayout(viewport, "vertical", cssHeight, options),
  };
}

/**
 * The marks a selection leaves on the two rulers.
 *
 * The marks are the selection's own edges in document space: the horizontal
 * ruler is marked from the selection's left edge to its right edge, and the
 * vertical one from its top edge to its bottom edge. There is no selection,
 * there are no marks.
 */
export function rulerSelectionMarks(bounds: Bounds | null): RulerSelectionMarks {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return { horizontal: null, vertical: null };
  }
  const width = Number.isFinite(bounds.width) ? bounds.width : 0;
  const height = Number.isFinite(bounds.height) ? bounds.height : 0;
  return {
    horizontal: {
      from: bounds.x + Math.min(0, width),
      to: bounds.x + Math.max(0, width),
    },
    vertical: {
      from: bounds.y + Math.min(0, height),
      to: bounds.y + Math.max(0, height),
    },
  };
}

/**
 * Clips a span to a range, or drops it when it lies outside.
 *
 * The ruler can only mark what it shows, so a selection that is scrolled out
 * of sight leaves no mark on that ruler.
 */
export function clipRulerSpan(span: RulerSpan | null, range: RulerRange): RulerSpan | null {
  if (!span) {
    return null;
  }
  const from = Math.max(span.from, range.from);
  const to = Math.min(span.to, range.to);
  if (to < from) {
    return null;
  }
  return { from, to };
}
