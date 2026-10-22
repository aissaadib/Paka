/**
 * Brush cursor geometry.
 *
 * The cursor overlay is a *view* of the active brush: a ring whose diameter is
 * the brush's diameter in document pixels, mapped through the viewport zoom.
 *
 * Two rules make this overlay safe to draw on top of the artwork:
 *
 *  - It is drawn by the DOM overlay, never by the renderer. The ring therefore
 *    never reaches a layer surface, a PNG export, the document history or the
 *    project file. It is a cursor, not content.
 *  - It is a separate compositing layer, so it cannot flicker with the
 *    canvas. When the artwork repaints under it, the ring is redrawn by the
 *    browser, not by Paka.
 *
 * The device pixel ratio is part of the mapping, not an afterthought: the
 * overlay is laid out in CSS pixels, which the compositor scales by the ratio,
 * so a one-device-pixel outline is `1 / dpr` CSS pixels wide and stays crisp
 * on a high-density display.
 */

/** The smallest ring the overlay draws, in CSS pixels. */
export const MIN_RING_CSS_PX = 4;

/** The geometry of the brush ring on screen. */
export interface BrushRingGeometry {
  /** Ring diameter in CSS pixels. */
  readonly cssDiameter: number;
  /** Ring radius in CSS pixels. */
  readonly cssRadius: number;
  /** Ring diameter in device pixels: the CSS diameter times the ratio. */
  readonly deviceDiameter: number;
  /** Outline width in CSS pixels: one device pixel, so the ring stays crisp. */
  readonly hairlineCss: number;
  /** True when the brush is smaller on screen than the minimum ring. */
  readonly clamped: boolean;
}

/**
 * The ring that shows a brush of `sizeDocPx` document pixels at `zoom`.
 *
 * The brush diameter is a document measurement, so it is multiplied by the
 * viewport zoom to become a screen measurement; the device pixel ratio then
 * describes the same ring in the display's own pixels. A brush too small to
 * see is drawn at the minimum size, and the caller is told that it was
 * clamped so it can say so rather than draw a ring that lies.
 */
export function brushRingGeometry(
  sizeDocPx: number,
  zoom: number,
  devicePixelRatio: number,
): BrushRingGeometry {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const size = Number.isFinite(sizeDocPx) && sizeDocPx > 0 ? sizeDocPx : 0;
  const drawn = size * scale;
  const cssDiameter = Math.max(MIN_RING_CSS_PX, drawn);
  return {
    cssDiameter,
    cssRadius: cssDiameter / 2,
    deviceDiameter: cssDiameter * ratio,
    // One device pixel, but never thinner than half a CSS pixel: a hairline
    // below that stops being a line on some compositors.
    hairlineCss: Math.max(0.5, 1 / ratio),
    clamped: drawn < MIN_RING_CSS_PX,
  };
}

/**
 * What the brush cursor overlay should show right now.
 *
 * The engine owns this answer so the overlay has a single source of truth: it
 * is told the size, the zoom and the two states that change how the ring is
 * drawn, and it never has to guess.
 */
export interface BrushCursorReport {
  /** The brush size the ring shows, in document pixels. */
  readonly size: number;
  /** The viewport scale the ring is drawn at. */
  readonly zoom: number;
  /** True while the quick-resize gesture owns the pointer. */
  readonly resizing: boolean;
  /** True while a stroke is in flight; the ring fades so it cannot distract. */
  readonly drawing: boolean;
}
