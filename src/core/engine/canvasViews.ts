/**
 * The engine's view state: what the canvas is showing, and how to move it.
 *
 * A **view** is a window onto the document: a transform (zoom and pan) and the
 * size of the surface it is drawn on. It is view state and not document state:
 * moving the view never touches the artwork, never enters history and never
 * marks the file dirty.
 *
 * The geometry lives here, away from the engine class, so it can be unit
 * tested without a canvas, a DOM or an engine - the same reason
 * `core/rendering/viewport.ts` exists for the transform itself.
 *
 * The rules agree with `core/shell/viewportState.ts`, which is the part of the
 * viewport that survives a resize or a restart: it remembers the *document*
 * point at the centre of the canvas rather than the screen offsets. Centring a
 * view here and reading that state back must give the same point, or the
 * navigator and the remembered viewport would disagree about where the user
 * is looking.
 *
 * The overview cache lives here too. An overview is a downscale of the
 * document, so it is a *rebuildable cache*: it is thrown away when the
 * document changes and rebuilt from it. It is display-only - it never reaches
 * a layer surface, a project file or a PNG export.
 */

import type { Bounds, Size } from "../../types/geometry";
import type { Viewport } from "../../types/viewport";
import { clampZoom } from "../rendering/viewport";

/**
 * The state of one canvas view: its transform and the size of its surface.
 *
 * The size is in CSS pixels - the same space the viewport's offsets are in -
 * so the two can be used together without a conversion.
 */
export interface ViewState {
  /** The transform from document space to the view's screen space. */
  readonly viewport: Viewport;
  /** The CSS size of the view's surface. */
  readonly size: Size;
}

/**
 * Moves the view's centre onto a document point.
 *
 * The zoom stays where it is: only the pan changes. The offset is the same
 * one `core/shell/viewportState.ts` uses to put a remembered point in the
 * middle of the canvas, so the two agree exactly - a view centred here reads
 * back as the same centre in the remembered state.
 */
export function centerViewOn(
  viewport: Viewport,
  viewportSize: Size,
  docX: number,
  docY: number,
): Viewport {
  const zoom = clampZoom(viewport.zoom);
  return {
    zoom,
    offsetX: viewportSize.width / 2 - docX * zoom,
    offsetY: viewportSize.height / 2 - docY * zoom,
  };
}

/**
 * The view at actual size, centred on a document point.
 *
 * One document pixel to one canvas pixel: the zoom is exactly one, whatever
 * the view was showing before.
 */
export function actualSizeViewport(
  viewportSize: Size,
  docX: number,
  docY: number,
): Viewport {
  return centerViewOn({ zoom: 1, offsetX: 0, offsetY: 0 }, viewportSize, docX, docY);
}

/**
 * The view that shows a selection, or `null` when there is nothing to show.
 *
 * A selection with no area (an empty marquee, a single pixel) cannot be
 * fitted, so the answer is `null` rather than an arbitrary zoom: the caller
 * keeps the view it had.
 */
export function fitSelectionView(
  viewportSize: Size,
  bounds: Bounds,
  padding = 32,
): Viewport | null {
  const width = Math.max(0, bounds.width);
  const height = Math.max(0, bounds.height);
  if (!(width > 0) || !(height > 0)) {
    return null;
  }
  const availableWidth = Math.max(1, viewportSize.width - padding * 2);
  const availableHeight = Math.max(1, viewportSize.height - padding * 2);
  const zoom = clampZoom(Math.min(availableWidth / width, availableHeight / height));
  return centerViewOn(
    { zoom, offsetX: 0, offsetY: 0 },
    viewportSize,
    bounds.x + width / 2,
    bounds.y + height / 2,
  );
}

/**
 * What an overview was made from.
 *
 * The document's *identity* and its revision are both part of the key: a new
 * document starts its revision at zero again, so the revision alone would let
 * an overview of the old document survive into the new one.
 */
export interface OverviewKey {
  /** The document the overview was made from, by identity. */
  readonly document: object;
  /** The document's revision: an edit rebuilds the overview. */
  readonly revision: number;
  /** The width the overview was made at, in pixels. */
  readonly width: number;
  /** The height the overview was made at, in pixels. */
  readonly height: number;
}

/** Whether two keys describe the same overview. */
export function sameOverviewKey(left: OverviewKey, right: OverviewKey): boolean {
  return (
    left.document === right.document &&
    left.revision === right.revision &&
    left.width === right.width &&
    left.height === right.height
  );
}

/**
 * A one-entry cache for the document's overview.
 *
 * The overview is a downscale of the composite, so it is expensive enough to
 * be worth keeping and cheap enough to be rebuilt on demand. The cache holds
 * one entry: the navigator asks for the same size over and over, and a
 * different size or a changed document replaces it.
 *
 * The cache knows nothing about pixels: it holds whatever the producer made
 * and hands it back while the key still matches. That keeps it free of the
 * DOM, so it can be unit tested on its own.
 */
export class OverviewCache<T> {
  private key: OverviewKey | null = null;
  private value: T | null = null;
  private builds = 0;

  /** How many times the cache asked for a fresh value. */
  get buildCount(): number {
    return this.builds;
  }

  /**
   * The cached value, or a fresh one.
   *
   * The producer is only called when the key does not match what is cached.
   * A producer that returns `null` (there is no document to show) clears the
   * cache rather than keeping a stale entry.
   */
  read(key: OverviewKey, produce: () => T | null): T | null {
    if (this.value !== null && this.key !== null && sameOverviewKey(this.key, key)) {
      return this.value;
    }
    this.builds += 1;
    const value = produce();
    if (value === null) {
      this.key = null;
      this.value = null;
      return null;
    }
    this.key = key;
    this.value = value;
    return value;
  }

  /**
   * The cached value, without building a new one.
   *
   * `null` when there is nothing cached. A caller that must not build - a
   * gesture in flight, say - uses this to keep the picture it already has.
   */
  peek(): T | null {
    return this.value;
  }

  /** Throws the cached value away. */
  clear(): void {
    this.key = null;
    this.value = null;
  }
}
