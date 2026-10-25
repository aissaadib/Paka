/**
 * Brush cursor geometry.
 *
 * The cursor is a *view* of the active brush: a ring whose diameter is the
 * brush's real footprint, mapped through the viewport zoom. It answers the
 * three questions the overlay would otherwise have to guess:
 *
 *  - **what shape** the footprint has - a disc, or a tip's own shape;
 *  - **how big** it is on screen, at the real zoom;
 *  - **whether to draw it at all** - a brush bigger than the window cannot be
 *    shown by a ring, and a gesture in flight owns the pointer.
 *
 * Three rules keep the overlay safe:
 *
 *  - The radius comes from the rasterizer's own `strokeDiameter`, so the ring
 *    is the brush's *real* footprint rather than a restatement of the size
 *    slider: the pressure curve, the size floor and the pressure-to-size
 *    response all move it, because they move the ink. A brush with a soft
 *    edge has a blurred silhouette, so the blur length is reported next to
 *    the core radius.
 *  - It is drawn by the DOM overlay, never by the renderer. The ring therefore
 *    never reaches a layer surface, a PNG export, the document history or the
 *    project file. It is a cursor, not content.
 *  - It is a separate compositing layer, so it cannot flicker with the
 *    canvas: when the artwork repaints under it, the browser redraws the
 *    ring, not Paka.
 *
 * The device pixel ratio is part of the mapping, not an afterthought: the
 * overlay is laid out in CSS pixels, which the compositor scales by the ratio,
 * so a one-device-pixel outline is `1 / dpr` CSS pixels wide and stays crisp
 * on a high-density display.
 */

import type { BrushSettings } from "../../types/brush";
import { asRecord } from "../../utils/record";
import { strokeDiameter, strokeFeatherRadius } from "../rendering/canvas2dStroke";

/**
 * The smallest ring the overlay draws, in CSS pixels.
 *
 * A brush of one or two document pixels is invisible at a low zoom, and a ring
 * of no size at all is worse than no ring: the user cannot tell where the
 * brush will paint. The ring is therefore never smaller than this, and the
 * geometry says when it was clamped, so the overlay can say so rather than
 * draw a ring that lies.
 */
export const MIN_CURSOR_DIAMETER_CSS_PX = 4;

/** One point of a tip's outline, in tip-local coordinates. */
export interface BrushTipPoint {
  /** The point's distance across the tip, relative to the tip's radius. */
  readonly x: number;
  /** The point's distance along the tip, relative to the tip's radius. */
  readonly y: number;
}

/**
 * A tip, as the cursor needs to see it.
 *
 * The tip engine owns the tip's geometry; the cursor only needs to know that
 * the footprint is not a disc, what the tip is called, and how far it reaches.
 * The contract is deliberately narrow and structural, so the tip engine can
 * adopt it without this module having to change: a brush that carries no tip
 * - every brush today - has a round footprint.
 */
export interface BrushTipShape {
  /** The tip's name, e.g. "chisel". */
  readonly name: string;
  /**
   * The tip's outline, in tip-local coordinates.
   *
   * The coordinates are relative to the dab's centre and normalised so the
   * outline's furthest point sits at a distance of one: the overlay scales
   * them by the brush's radius. A tip with no outline is a disc of the same
   * radius, which is what a round tip is.
   */
  readonly outline?: readonly BrushTipPoint[];
}

/** The shape a brush's footprint takes at the cursor. */
export type BrushCursorShape = "round" | "tip";

/** The brush's footprint, in document pixels. */
export interface BrushCursorFootprint {
  /** The shape of the footprint. */
  readonly shape: BrushCursorShape;
  /** The tip's name, when the brush carries one. */
  readonly tipName?: string;
  /** The tip's outline in unit coordinates, when the tip has one. */
  readonly outline?: readonly BrushTipPoint[];
  /**
   * The radius of the footprint's core, in document pixels.
   *
   * This is the radius the ink reaches at full coverage: the brush's own
   * diameter, read through the rasterizer's own rule.
   */
  readonly radiusDocPx: number;
  /**
   * The blur length of a soft edge, in document pixels.
   *
   * `0` for a hard brush. A soft brush's silhouette fades out over roughly
   * three of these, so the faint tail reaches past the core radius.
   */
  readonly featherDocPx: number;
}

/** What the cursor overlay should draw. */
export type BrushCursorMarker = "ring" | "crosshair" | "hidden";

/** The geometry of the brush cursor on screen. */
export interface BrushCursorGeometry {
  /** What to draw. */
  readonly marker: BrushCursorMarker;
  /** False when nothing is drawn at all. */
  readonly visible: boolean;
  /** The brush's footprint, in document pixels. */
  readonly footprint: BrushCursorFootprint;
  /** The ring's diameter in CSS pixels. */
  readonly cssDiameter: number;
  /** The ring's radius in CSS pixels. */
  readonly cssRadius: number;
  /** The outline's width in CSS pixels: one device pixel, so it stays crisp. */
  readonly hairlineCss: number;
  /** True when the ring was clamped to the minimum size. */
  readonly clamped: boolean;
  /**
   * True when the brush is larger than the window.
   *
   * A ring that big would cover the canvas and tell the user nothing, so the
   * cursor becomes a crosshair and the size is read from the panel.
   */
  readonly oversized: boolean;
  /** The brush's diameter in document pixels. */
  readonly diameterDocPx: number;
}

/** What the cursor geometry needs to know about the surface it is drawn on. */
export interface BrushCursorInput {
  /** The brush the cursor shows. */
  readonly brush: BrushSettings;
  /** The viewport's scale: document pixels to CSS pixels. */
  readonly zoom: number;
  /** Device pixels per CSS pixel. `1` when the display does not say. */
  readonly devicePixelRatio?: number;
  /** The window's width in CSS pixels. `0` when it is not known. */
  readonly viewportWidth?: number;
  /** The window's height in CSS pixels. `0` when it is not known. */
  readonly viewportHeight?: number;
  /**
   * True while a pointer gesture is in flight on the canvas.
   *
   * A gesture owns the pointer: the brush is under it, and a ring on top of
   * the stroke being drawn is a distraction rather than a help. The quick
   * brush-size gesture counts too - the ring would be chasing the size it is
   * changing.
   */
  readonly gesture?: boolean;
  /** False when the pointer is outside the canvas. */
  readonly inside?: boolean;
}

/**
 * The brush's footprint, in document pixels.
 *
 * The radius is the rasterizer's own diameter at full pressure, so the ring
 * is the brush's real footprint: the pressure curve and the size floor are
 * already in it. A tip, when the brush carries one, replaces the disc with
 * the tip's own shape.
 */
export function brushCursorFootprint(
  brush: BrushSettings,
  tip?: BrushTipShape | null,
): BrushCursorFootprint {
  const radiusDocPx = strokeDiameter(brush, 1) / 2;
  const featherDocPx = strokeFeatherRadius(brush);
  const resolved = tip ?? readBrushTip(brush);
  if (!resolved) {
    return { shape: "round", radiusDocPx, featherDocPx };
  }
  return {
    shape: "tip",
    tipName: resolved.name,
    outline: resolved.outline,
    radiusDocPx,
    featherDocPx,
  };
}

/**
 * The tip a brush carries, read off the brush itself.
 *
 * The tip engine owns the tip; this is the narrow contract the cursor reads
 * it through, so the two slices do not have to land in a fixed order. A
 * brush without a tip, or with a tip this cannot read, has a round
 * footprint - which is what every brush has today.
 */
export function readBrushTip(brush: BrushSettings): BrushTipShape | null {
  const record = asRecord((brush as { tip?: unknown }).tip);
  if (!record) {
    return null;
  }
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name === "") {
    return null;
  }
  return { name, outline: readTipOutline(record.outline) };
}

/** The tip's outline, if it has one this can read. */
function readTipOutline(value: unknown): readonly BrushTipPoint[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const points: BrushTipPoint[] = [];
  for (const entry of value) {
    const point = asRecord(entry);
    if (!point) {
      return undefined;
    }
    const x = point.x;
    const y = point.y;
    if (typeof x !== "number" || typeof y !== "number") {
      return undefined;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return undefined;
    }
    points.push({ x, y });
  }
  return points.length > 0 ? points : undefined;
}

/**
 * True when a brush is too big on screen for a ring to show.
 *
 * The measure is the window's *smaller* side: a ring has to fit in both
 * directions to be readable, and a ring as wide as the canvas is a wash of
 * grey rather than an outline.
 */
export function brushCursorIsOversized(
  cssDiameter: number,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  if (width <= 0 || height <= 0) {
    // Without a window to measure against, nothing is known to be too big.
    return false;
  }
  return cssDiameter > Math.min(width, height);
}

/**
 * The geometry of the brush cursor, right now.
 *
 * The answer is a pure function of the brush and the surface it is drawn on,
 * so the overlay can ask for it whenever the brush, the zoom or the window
 * changes and get the same picture every time.
 */
export function brushCursorGeometry(input: BrushCursorInput): BrushCursorGeometry {
  const ratio =
    Number.isFinite(input.devicePixelRatio) && (input.devicePixelRatio ?? 0) > 0
      ? (input.devicePixelRatio as number)
      : 1;
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;
  const footprint = brushCursorFootprint(input.brush);

  const drawn = footprint.radiusDocPx * 2 * zoom;
  const cssDiameter = Math.max(MIN_CURSOR_DIAMETER_CSS_PX, drawn);
  const clamped = drawn < MIN_CURSOR_DIAMETER_CSS_PX;
  const oversized = brushCursorIsOversized(
    drawn,
    input.viewportWidth ?? 0,
    input.viewportHeight ?? 0,
  );
  const visible = input.inside !== false && input.gesture !== true;

  return {
    marker: visible ? (oversized ? "crosshair" : "ring") : "hidden",
    visible,
    footprint,
    cssDiameter,
    cssRadius: cssDiameter / 2,
    // One device pixel, but never thinner than half a CSS pixel: a hairline
    // below that stops being a line on some compositors.
    hairlineCss: Math.max(0.5, 1 / ratio),
    clamped,
    oversized,
    diameterDocPx: footprint.radiusDocPx * 2,
  };
}
