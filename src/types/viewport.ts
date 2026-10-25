/**
 * Viewport state: the transform between document coordinates and canvas-local
 * screen coordinates (CSS pixels).
 *
 * The viewport never changes document dimensions. Zoom and pan are display
 * concerns only, so `document.width/height` remain the authoritative logical
 * size regardless of zoom, pan, window size or device pixel ratio.
 *
 * The device pixel ratio is deliberately *not* part of this transform: it is a
 * property of the display surface and is applied by the renderer when it sizes
 * the backing store, not when mapping input to document coordinates.
 */
export interface Viewport {
  /** Scale factor: 1 means one document pixel maps to one CSS pixel. */
  readonly zoom: number;
  /** Screen position (CSS px) of the document origin (top-left corner). */
  readonly offsetX: number;
  readonly offsetY: number;
}
