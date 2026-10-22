/**
 * Viewport state: the transform between document coordinates and canvas-local
 * screen coordinates (CSS pixels).
 *
 * The viewport never changes document dimensions. Zoom, pan, rotation and the
 * mirror are display concerns only, so `document.width/height` remain the
 * authoritative logical size regardless of zoom, pan, window size or device
 * pixel ratio.
 *
 * The device pixel ratio is deliberately *not* part of this transform: it is a
 * property of the display surface and is applied by the renderer when it sizes
 * the backing store, not when mapping input to document coordinates.
 */

/**
 * The orientation of the view.
 *
 * A view transform is **display only**: it never changes a document pixel, it
 * is never part of a project file, and it never dirties a document. It is the
 * pair of things a drawing program lets the user turn on the *window* rather
 * than on the artwork: a rotation of the whole canvas and a left-right mirror.
 *
 * The rotation is in radians and is positive **clockwise on screen** (the same
 * sense as a clock face, with the screen's y axis pointing down).
 */
export interface ViewTransform {
  /** Clockwise rotation of the view in radians; `0` is upright. */
  readonly rotation: number;
  /** True when the view is mirrored left to right. */
  readonly mirrored: boolean;
}

/**
 * The identity of a view over the document.
 *
 * A view is a *window* on the document, not a copy of it. The ids are stable
 * for the lifetime of the editor: the main canvas is always the primary view,
 * and the optional second canvas is always the secondary one.
 */
export type ViewId = "primary" | "secondary";

/** The id of the view the main canvas is registered under. */
export const PRIMARY_VIEW_ID: ViewId = "primary";

/** The id of the view the optional second canvas is registered under. */
export const SECONDARY_VIEW_ID: ViewId = "secondary";

export interface Viewport {
  /** Scale factor: 1 means one document pixel maps to one CSS pixel. */
  readonly zoom: number;
  /**
   * Screen position (CSS px) of the document origin (top-left corner).
   *
   * With a rotation or a mirror the document origin is no longer a corner on
   * screen, so these two numbers are the **translation** of the view
   * transform: the screen position of the document point `(0, 0)` after the
   * linear part (scale, rotation, mirror) has been applied.
   */
  readonly offsetX: number;
  readonly offsetY: number;
  /**
   * The view's orientation.
   *
   * Optional on purpose: a viewport without one is an upright, unmirrored
   * view, which is what every plain `{ zoom, offsetX, offsetY }` literal means.
   */
  readonly transform?: ViewTransform;
}
