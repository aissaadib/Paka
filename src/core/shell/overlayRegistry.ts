/**
 * Overlay registry: the list of things drawn over the canvas.
 *
 * The canvas draws the document, and then it draws a few things that are not
 * part of the document: the grid, the composition guides, the selection
 * marquee, the brush cursor. Each of those used to be a special case in the
 * renderer's paint path.
 *
 * The registry turns them into a list. An overlay registers itself, the
 * renderer paints the list, and a feature that wants an overlay adds one
 * without touching the renderer's paint sequence.
 *
 * An overlay is **display only**. It never reaches a layer surface, never
 * reaches a PNG export and never changes a pixel of the document. That is the
 * rule that lets overlays be added freely.
 */

import type { Bounds } from "../../types/geometry";
import type { Viewport } from "../../types/viewport";

/** Whether an overlay is drawn under or over the document's pixels. */
export type OverlayLayer = "under" | "over";

/** What an overlay is handed when it paints. */
export interface OverlayPaintContext {
  /** The canvas context the renderer is already drawing into. */
  readonly ctx: CanvasRenderingContext2D;
  /** The transform in force, so the overlay can map document points. */
  readonly viewport: Viewport;
  /** The document's size in document pixels. */
  readonly documentWidth: number;
  readonly documentHeight: number;
  /** The renderer's scale factor: document pixels to backing-store pixels. */
  readonly scale: number;
  /**
   * The selection's frame in document pixels, or `null` when nothing is
   * selected.
   *
   * The renderer owns the selection overlay already, so an overlay that marks
   * it on another strip - the rulers do - reads it here rather than keeping a
   * second copy of the same state.
   */
  readonly selectionBounds?: Bounds | null;
  /**
   * The display canvas's device pixel ratio.
   *
   * Chrome measured in CSS pixels - the rulers' strips - needs it to draw at
   * the size the user sees whatever the screen's scale factor.
   */
  readonly devicePixelRatio?: number;
}

/** One overlay. */
export interface OverlayDefinition {
  /** Stable id, unique across the registry. */
  readonly id: string;
  /** Whether the overlay is drawn under or over the document's pixels. */
  readonly layer: OverlayLayer;
  /** Draw order within the layer; lower numbers come first. */
  readonly order: number;
  /** The overlay's paint. An overlay with none draws nothing. */
  readonly paint?: (context: OverlayPaintContext) => void;
}

const overlays = new Map<string, OverlayDefinition>();

/**
 * Adds an overlay, or replaces the one already registered under the same id.
 *
 * Registering the same id twice is a replacement, so an overlay whose module
 * is evaluated twice does not paint twice.
 */
export function registerOverlay(definition: OverlayDefinition): OverlayDefinition {
  if (definition.id.trim() === "") {
    throw new Error("an overlay needs a non-empty id");
  }
  if (definition.layer !== "under" && definition.layer !== "over") {
    throw new Error(`overlay "${definition.id}" names an unknown layer`);
  }
  overlays.set(definition.id, definition);
  return definition;
}

/** Removes an overlay. Returns whether one was there. */
export function unregisterOverlay(id: string): boolean {
  return overlays.delete(id);
}

/** Every registered overlay, ordered by layer, then order, then id. */
export function listOverlays(): readonly OverlayDefinition[] {
  return [...overlays.values()].sort((a, b) => {
    if (a.layer !== b.layer) {
      return a.layer === "under" ? -1 : 1;
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The overlays in one layer, in draw order. */
export function overlaysForLayer(layer: OverlayLayer): readonly OverlayDefinition[] {
  return listOverlays().filter((overlay) => overlay.layer === layer);
}

/** One overlay by id, or `undefined`. */
export function findOverlay(id: string): OverlayDefinition | undefined {
  return overlays.get(id);
}

/**
 * Empties the registry.
 *
 * Only for tests: overlays register themselves when their module is
 * evaluated, and nothing in the running app should empty the list.
 */
export function resetOverlayRegistry(): void {
  overlays.clear();
}
