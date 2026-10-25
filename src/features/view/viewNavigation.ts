/**
 * View navigation: what a "go to" command should do to the view.
 *
 * Four intents a user can ask for - fit the document, show it at actual size,
 * fit the selection, centre on a point - live here as pure functions. Each one
 * takes the current view and returns the view the intent asks for, so the
 * rules can be unit tested without a DOM and the UI can stay a thin shell
 * over them.
 *
 * None of them touches the document: a view is a view, so none of these can
 * dirty a file, enter history or reach a project file.
 *
 * The geometry itself is in `core/engine/canvasViews.ts` and the transform in
 * `core/rendering/viewport.ts`; this module is the vocabulary the user
 * interface speaks.
 */

import {
  actualSizeViewport,
  centerViewOn,
  fitSelectionView,
} from "../../core/engine/canvasViews";
import { fitToViewport } from "../../core/rendering/viewport";
import type { Bounds, Point, Size } from "../../types/geometry";
import type { Viewport } from "../../types/viewport";

/** The room left around a fitted area, in canvas pixels. */
export const VIEW_FIT_PADDING = 32;

/**
 * The view that shows the whole document.
 *
 * The document is fitted with a margin around it, so the edge of the paper is
 * visible rather than flush with the edge of the canvas.
 */
export function zoomToFit(
  viewportSize: Size,
  documentSize: Size,
  padding = VIEW_FIT_PADDING,
): Viewport {
  return fitToViewport(viewportSize, documentSize, padding);
}

/**
 * The view at actual size, centred on a document point.
 *
 * One document pixel to one canvas pixel. The point is the one the user
 * asked about; without one the centre of the canvas is kept.
 */
export function zoomToActualSize(
  viewportSize: Size,
  docX: number,
  docY: number,
): Viewport {
  return actualSizeViewport(viewportSize, docX, docY);
}

/**
 * The view that shows a selection.
 *
 * `null` when there is nothing selected to show: an empty selection cannot
 * be fitted, and the caller keeps the view it had rather than guessing.
 */
export function zoomToSelection(
  viewportSize: Size,
  bounds: Bounds | null,
  padding = VIEW_FIT_PADDING,
): Viewport | null {
  if (!bounds) {
    return null;
  }
  return fitSelectionView(viewportSize, bounds, padding);
}

/**
 * The view with a document point in the middle, at the zoom it already had.
 *
 * This is what a click in the navigator does: the view moves, the zoom does
 * not.
 */
export function centerOnPoint(
  viewport: Viewport,
  viewportSize: Size,
  docX: number,
  docY: number,
): Viewport {
  return centerViewOn(viewport, viewportSize, docX, docY);
}

/** The things a user can ask the view to do. */
export type ViewNavigationIntent =
  /** Show the whole document. */
  | { readonly kind: "fit" }
  /** Show a point at actual size. */
  | { readonly kind: "actual-size"; readonly point: Point }
  /** Show a selection. */
  | { readonly kind: "selection"; readonly bounds: Bounds | null }
  /** Put a point in the middle, at the current zoom. */
  | { readonly kind: "point"; readonly point: Point };

/** What the intents need to know about the current view. */
export interface ViewNavigationContext {
  /** The view as it is now. */
  readonly viewport: Viewport;
  /** The CSS size of the canvas. */
  readonly viewportSize: Size;
  /** The size of the document. */
  readonly documentSize: Size;
}

/**
 * The view an intent asks for, or `null` when it cannot be satisfied.
 *
 * One place to turn "zoom to the selection" into a viewport, so a menu, a
 * keyboard chord and a panel all mean the same thing.
 */
export function resolveViewNavigation(
  intent: ViewNavigationIntent,
  context: ViewNavigationContext,
): Viewport | null {
  switch (intent.kind) {
    case "fit":
      return zoomToFit(context.viewportSize, context.documentSize);
    case "actual-size":
      return zoomToActualSize(
        context.viewportSize,
        intent.point.x,
        intent.point.y,
      );
    case "selection":
      return zoomToSelection(context.viewportSize, intent.bounds);
    case "point":
      return centerOnPoint(
        context.viewport,
        context.viewportSize,
        intent.point.x,
        intent.point.y,
      );
    default:
      return null;
  }
}
