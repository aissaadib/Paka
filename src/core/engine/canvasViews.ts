/**
 * The views over one document.
 *
 * A **view** is a canvas plus the transform that maps the document onto it.
 * Two views are two windows on the same drawing: they share the document, the
 * history, the dirty flag and the rasterized pixels, and they differ only in
 * their transform.
 *
 * That is the whole point of a second view of the canvas. It is not a second
 * copy of the document, so it cannot disagree with the first one about what
 * the document contains, and a stroke drawn in either view is one stroke in
 * one document.
 */

import type { Size } from "../../types/geometry";
import {
  PRIMARY_VIEW_ID,
  SECONDARY_VIEW_ID,
  type ViewId,
  type Viewport,
} from "../../types/viewport";

export { PRIMARY_VIEW_ID, SECONDARY_VIEW_ID };
export type { ViewId };

/**
 * What a panel needs to describe a view.
 *
 * A summary is a read-only picture of a view: it never holds the transform
 * itself, so a panel cannot change the view by editing what it was told.
 */
export interface ViewSummary {
  readonly id: ViewId;
  /** The zoom factor of the view. */
  readonly zoom: number;
  /** The rotation of the view, in radians, clockwise. */
  readonly rotation: number;
  /** Whether the view is mirrored left to right. */
  readonly mirrored: boolean;
  /** The CSS width of the view's surface. */
  readonly width: number;
  /** The CSS height of the view's surface. */
  readonly height: number;
}

/** A view over the document: a transform and the size of the canvas it fills. */
export interface CanvasView {
  readonly id: ViewId;
  /** The transform from document space to this view's screen space. */
  viewport: Viewport;
  /** The CSS size of the view's surface. */
  size: Size;
  /** True once the view has a size and has been fitted to the document. */
  laidOut: boolean;
}

/** A view with the given identity and transform, not yet laid out. */
export function createCanvasView(id: ViewId, viewport: Viewport): CanvasView {
  return { id, viewport, size: { width: 0, height: 0 }, laidOut: false };
}

/**
 * The orientation of a view, with the defaults filled in.
 *
 * A viewport without a transform is upright and unmirrored, so the answer is
 * read from the transform when there is one and defaulted when there is not.
 */
export function viewOrientation(viewport: Viewport): {
  readonly rotation: number;
  readonly mirrored: boolean;
} {
  const transform = viewport.transform;
  return {
    rotation: transform?.rotation ?? 0,
    mirrored: transform?.mirrored === true,
  };
}

/** The summary of a view. */
export function summarizeView(view: CanvasView): ViewSummary {
  const orientation = viewOrientation(view.viewport);
  return {
    id: view.id,
    zoom: view.viewport.zoom,
    rotation: orientation.rotation,
    mirrored: orientation.mirrored,
    width: view.size.width,
    height: view.size.height,
  };
}

/** Whether two summaries describe the same view in the same state. */
export function sameViewSummary(left: ViewSummary, right: ViewSummary): boolean {
  return (
    left.id === right.id &&
    left.zoom === right.zoom &&
    left.rotation === right.rotation &&
    left.mirrored === right.mirrored &&
    left.width === right.width &&
    left.height === right.height
  );
}

/** Whether two lists of summaries describe the same views in the same state. */
export function sameViewSummaries(
  left: readonly ViewSummary[],
  right: readonly ViewSummary[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!sameViewSummary(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

/**
 * The set of views over the document.
 *
 * The registry owns the *identity* of the views and which one is active. It
 * deliberately owns nothing about the document: the artwork, the history and
 * the dirty flag live in the engine, so a view can never hold a second copy of
 * any of them.
 */
export class CanvasViewRegistry {
  private readonly views = new Map<ViewId, CanvasView>();
  private activeViewId: ViewId = PRIMARY_VIEW_ID;

  /** Adds a view, replacing any view with the same id. */
  add(view: CanvasView): void {
    this.views.set(view.id, view);
  }

  /**
   * Removes a view.
   *
   * The active view falls back to the primary one, because the commands must
   * always have a view to act on.
   */
  remove(id: ViewId): void {
    if (!this.views.delete(id)) {
      return;
    }
    if (this.activeViewId === id) {
      this.activeViewId = PRIMARY_VIEW_ID;
    }
  }

  get(id: ViewId): CanvasView | undefined {
    return this.views.get(id);
  }

  has(id: ViewId): boolean {
    return this.views.has(id);
  }

  /** The view the commands act on. */
  get active(): CanvasView {
    const view = this.views.get(this.activeViewId) ?? this.views.get(PRIMARY_VIEW_ID);
    if (!view) {
      throw new Error("The view registry has no primary view.");
    }
    return view;
  }

  /** The id of the active view. */
  get activeId(): ViewId {
    return this.activeViewId;
  }

  /**
   * Makes a view the active one.
   *
   * Returns `false` when the view is unknown, so a caller cannot focus a
   * window that is not there.
   */
  setActive(id: ViewId): boolean {
    if (!this.views.has(id)) {
      return false;
    }
    this.activeViewId = id;
    return true;
  }

  /** Every view, in the order they were added. */
  all(): readonly CanvasView[] {
    return [...this.views.values()];
  }

  /** The summary of every view. */
  summaries(): readonly ViewSummary[] {
    return this.all().map(summarizeView);
  }
}
