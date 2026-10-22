/**
 * The ruler overlay: the chrome strips that measure the canvas.
 *
 * The overlay is registered with the shell's overlay registry, so it is
 * painted by the same path as every other overlay and it needs no special
 * case in the renderer's paint sequence.
 *
 * It is **display only**, and it stays that way by construction:
 *
 *  - it paints into the display canvas the renderer hands it, never into a
 *    layer surface, so a PNG export cannot contain a ruler;
 *  - it reads the viewport but never writes it, so the document does not move
 *    when the rulers appear and the pointer needs no offset to compensate;
 *  - the visibility, the selection's marks and the pointer's position are
 *    editor state: they add no history step and dirty nothing.
 *
 * The strips are painted over the canvas element's top and left edges. That
 * is a deliberate choice: the canvas keeps its own origin, its own size and
 * its own transform, so nothing about the document moves when the rulers are
 * switched on. The price is that the strips cover the top and the left of
 * the artwork; a shell that wants the artwork fully visible has to reserve
 * the space outside the canvas element, which is a layout decision and not
 * this module's to make.
 */

import type { Bounds, Point } from "../../types/geometry";
import {
  RULER_LEFT_SIZE_PX,
  RULER_SIZE_PX,
  clipRulerSpan,
  rulerGeometry,
  rulerScreenAt,
  rulerSelectionMarks,
  type RulerGeometry,
  type RulerSelectionMarks,
} from "./rulers";
import {
  registerOverlay,
  type OverlayDefinition,
  type OverlayPaintContext,
} from "../shell/overlayRegistry";

/** The overlay's id in the registry. */
export const RULER_OVERLAY_ID = "rulers";

/** The chrome behind the strips: the app's panel colour, nearly opaque. */
const RULER_BACKGROUND = "rgba(28, 31, 35, 0.94)";
/** The hairline that separates the chrome from the artwork. */
const RULER_BORDER = "rgba(138, 145, 155, 0.5)";
/** The ticks: quieter than the labels, so the numbers read first. */
const RULER_TICK_COLOR = "rgba(214, 217, 223, 0.65)";
/** The labels. */
const RULER_LABEL_COLOR = "rgba(214, 217, 223, 0.9)";
/** The selection's marks: the same accent the selection overlay uses. */
export const RULER_SELECTION_COLOR = "#2f7bff";
/** The pointer's position on a ruler. */
const RULER_CURSOR_COLOR = "rgba(214, 217, 223, 0.55)";
/** The length of a labelled tick, in CSS pixels. */
const RULER_MAJOR_TICK_PX = 8;
/** The length of an unlabelled tick, in CSS pixels. */
const RULER_MINOR_TICK_PX = 4;
/** The label's size, in CSS pixels. */
const RULER_LABEL_FONT_PX = 10;
/** The label's font stack. */
const RULER_LABEL_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/** The gap between a label and the tick it belongs to, in CSS pixels. */
const RULER_LABEL_GAP_PX = 4;

/**
 * What the ruler overlay needs to know that the paint context does not carry.
 *
 * The paint context has the viewport; the shell has the rest. The overlay
 * keeps that state here so that the painter itself stays a pure function of
 * its inputs.
 */
export interface RulerOverlayState {
  /** Whether the strips are drawn. */
  readonly visible: boolean;
  /** The selection's bounds in document pixels, or `null` when there is none. */
  readonly selection: Bounds | null;
  /** The pointer's position on the canvas, in canvas-local CSS pixels. */
  readonly cursor: Point | null;
  /**
   * The device pixel ratio the display canvas is at.
   *
   * The canvas element's backing store is `css size * dpr`, so the ruler's
   * CSS-sized chrome is measured from the backing store with this factor.
   */
  readonly devicePixelRatio: number;
}

/** The state a fresh installation starts with: no rulers, nothing marked. */
export const DEFAULT_RULER_OVERLAY_STATE: RulerOverlayState = {
  visible: false,
  selection: null,
  cursor: null,
  devicePixelRatio: 1,
};

let overlayState: RulerOverlayState = DEFAULT_RULER_OVERLAY_STATE;

/**
 * Sets the overlay's state, returning the state that is now in force.
 *
 * The state is editor state: it is display only, it adds no history step and
 * it never reaches a project file.
 */
export function setRulerOverlayState(next: Partial<RulerOverlayState>): RulerOverlayState {
  overlayState = { ...overlayState, ...next };
  return overlayState;
}

/** The overlay's state as it stands. */
export function getRulerOverlayState(): RulerOverlayState {
  return overlayState;
}

/** Puts the overlay's state back to the default. */
export function resetRulerOverlayState(): void {
  overlayState = DEFAULT_RULER_OVERLAY_STATE;
}

/** The bits the painter needs, gathered once per paint. */
interface RulerPaint {
  readonly ctx: CanvasRenderingContext2D;
  readonly viewport: OverlayPaintContext["viewport"];
  readonly geometry: RulerGeometry;
  readonly marks: RulerSelectionMarks;
  readonly cursor: Point | null;
  readonly cssWidth: number;
  readonly cssHeight: number;
}

/** Rounds a coordinate to a whole device pixel, for a crisp hairline. */
function crisp(value: number): number {
  return Math.round(value) + 0.5;
}

/** The width of a label, in CSS pixels. */
function measureLabel(ctx: CanvasRenderingContext2D, label: string): number {
  const metrics = ctx.measureText?.(label);
  const width = metrics?.width;
  return Number.isFinite(width) && width > 0 ? width : label.length * 6;
}

/** Paints the two strips and the hairlines that edge them. */
function paintStrips(paint: RulerPaint): void {
  const { ctx, cssWidth, cssHeight } = paint;
  ctx.fillStyle = RULER_BACKGROUND;
  // The top strip takes the corner: the corner belongs to the horizontal
  // ruler, so the two strips never overlap and never double their alpha.
  ctx.fillRect(0, 0, cssWidth, RULER_SIZE_PX);
  ctx.fillRect(0, RULER_SIZE_PX, RULER_LEFT_SIZE_PX, Math.max(0, cssHeight - RULER_SIZE_PX));

  ctx.strokeStyle = RULER_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE_PX - 0.5);
  ctx.lineTo(cssWidth, RULER_SIZE_PX - 0.5);
  ctx.moveTo(RULER_LEFT_SIZE_PX - 0.5, RULER_SIZE_PX);
  ctx.lineTo(RULER_LEFT_SIZE_PX - 0.5, cssHeight);
  ctx.stroke();
}

/** Paints the selection's marks: the band each ruler shows for the selection. */
function paintSelectionMarks(paint: RulerPaint): void {
  const { ctx, viewport, geometry, marks } = paint;

  const horizontal = clipRulerSpan(marks.horizontal, geometry.horizontal.range);
  if (horizontal) {
    const from = rulerScreenAt(viewport, "horizontal", horizontal.from);
    const to = rulerScreenAt(viewport, "horizontal", horizontal.to);
    ctx.fillStyle = RULER_SELECTION_COLOR;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(from, 0, Math.max(1, to - from), RULER_SIZE_PX);
    ctx.globalAlpha = 1;
  }

  const vertical = clipRulerSpan(marks.vertical, geometry.vertical.range);
  if (vertical) {
    const from = rulerScreenAt(viewport, "vertical", vertical.from);
    const to = rulerScreenAt(viewport, "vertical", vertical.to);
    ctx.fillStyle = RULER_SELECTION_COLOR;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(0, from, RULER_LEFT_SIZE_PX, Math.max(1, to - from));
    ctx.globalAlpha = 1;
  }
}

/** Paints the ticks: the labelled ones long, the unlabelled ones short. */
function paintTicks(paint: RulerPaint): void {
  const { ctx, geometry } = paint;
  ctx.strokeStyle = RULER_TICK_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (const tick of geometry.horizontal.minor) {
    const x = crisp(tick.screen);
    ctx.moveTo(x, RULER_SIZE_PX - RULER_MINOR_TICK_PX);
    ctx.lineTo(x, RULER_SIZE_PX);
  }
  for (const tick of geometry.horizontal.major) {
    const x = crisp(tick.screen);
    ctx.moveTo(x, RULER_SIZE_PX - RULER_MAJOR_TICK_PX);
    ctx.lineTo(x, RULER_SIZE_PX);
  }
  for (const tick of geometry.vertical.minor) {
    const y = crisp(tick.screen);
    ctx.moveTo(RULER_LEFT_SIZE_PX - RULER_MINOR_TICK_PX, y);
    ctx.lineTo(RULER_LEFT_SIZE_PX, y);
  }
  for (const tick of geometry.vertical.major) {
    const y = crisp(tick.screen);
    ctx.moveTo(RULER_LEFT_SIZE_PX - RULER_MAJOR_TICK_PX, y);
    ctx.lineTo(RULER_LEFT_SIZE_PX, y);
  }

  ctx.stroke();
}

/** Paints the numbers. */
function paintLabels(paint: RulerPaint): void {
  const { ctx, geometry } = paint;
  ctx.fillStyle = RULER_LABEL_COLOR;
  ctx.font = `${RULER_LABEL_FONT_PX}px ${RULER_LABEL_FONT}`;

  // The top ruler's numbers sit to the left of their tick, and move to its
  // right when there is no room for them in the corner.
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of geometry.horizontal.major) {
    const label = tick.label;
    if (label === "") {
      continue;
    }
    const gap = RULER_LABEL_GAP_PX;
    if (tick.screen - gap - measureLabel(ctx, label) < RULER_LEFT_SIZE_PX) {
      ctx.textAlign = "left";
      ctx.fillText(label, tick.screen + gap, RULER_SIZE_PX / 2);
      ctx.textAlign = "right";
    } else {
      ctx.fillText(label, tick.screen - gap, RULER_SIZE_PX / 2);
    }
  }

  // The left ruler's numbers sit above their tick, right-aligned to the
  // strip's inner edge, so they are read upright.
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  for (const tick of geometry.vertical.major) {
    if (tick.label === "") {
      continue;
    }
    ctx.fillText(tick.label, RULER_LEFT_SIZE_PX - RULER_LABEL_GAP_PX, tick.screen - RULER_LABEL_GAP_PX);
  }
}

/** Paints the pointer's position on the two rulers. */
function paintCursor(paint: RulerPaint): void {
  const { ctx, cursor, cssWidth, cssHeight } = paint;
  if (!cursor) {
    return;
  }
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
    return;
  }
  ctx.strokeStyle = RULER_CURSOR_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (cursor.x >= 0 && cursor.x <= cssWidth) {
    const x = crisp(cursor.x);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, RULER_SIZE_PX);
  }
  if (cursor.y >= 0 && cursor.y <= cssHeight) {
    const y = crisp(cursor.y);
    ctx.moveTo(0, y);
    ctx.lineTo(RULER_LEFT_SIZE_PX, y);
  }
  ctx.stroke();
}

/**
 * Paints the rulers over the canvas.
 *
 * The paint is a pure function of the paint context and the overlay's state:
 * the same context and the same state always draw the same pixels, so the
 * ruler never flickers and never disagrees with itself between two frames.
 */
export function paintRulers(context: OverlayPaintContext): void {
  const state = getRulerOverlayState();
  if (!state.visible) {
    return;
  }
  const ctx = context.ctx;
  const canvas = ctx.canvas;
  if (!canvas) {
    return;
  }
  const dpr = state.devicePixelRatio > 0 ? state.devicePixelRatio : 1;
  // The canvas element's backing store is its CSS size times the device
  // pixel ratio, so the chrome is measured back in CSS pixels.
  const cssWidth = canvas.width / dpr;
  const cssHeight = canvas.height / dpr;
  if (!(cssWidth > 0) || !(cssHeight > 0)) {
    return;
  }

  const paint: RulerPaint = {
    ctx,
    viewport: context.viewport,
    geometry: rulerGeometry(context.viewport, cssWidth, cssHeight),
    marks: rulerSelectionMarks(state.selection),
    cursor: state.cursor,
    cssWidth,
    cssHeight,
  };

  ctx.save();
  try {
    // One unit is one CSS pixel, so the chrome keeps its size at any zoom and
    // at any device pixel ratio.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintStrips(paint);
    paintSelectionMarks(paint);
    paintTicks(paint);
    paintLabels(paint);
    paintCursor(paint);
  } finally {
    ctx.restore();
  }
}

/**
 * The ruler overlay.
 *
 * It is registered when this module is evaluated, and it paints in the
 * "over" layer: the rulers are chrome, so they sit above the artwork and
 * above the guides.
 */
export const rulerOverlay: OverlayDefinition = registerOverlay({
  id: RULER_OVERLAY_ID,
  layer: "over",
  order: 100,
  paint: paintRulers,
});
