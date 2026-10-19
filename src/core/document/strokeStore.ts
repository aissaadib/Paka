/**
 * Layer content storage.
 *
 * Layer metadata lives in the document, the pixels produced by the content live
 * in renderer surfaces, and the content that produced those pixels lives here.
 * Keeping the records around is what makes undo possible without snapshotting
 * bitmaps: undoing an element removes it from this store and the renderer
 * re-rasterizes the affected layer.
 *
 * A layer's content is **one ordered element list**: strokes, bucket-fill
 * patches and gradients interleave exactly as the user made them. `list` is a
 * filtered view for stroke-only features (selection, transforms);
 * `listElements` is the painting order the renderer and project writer consume.
 */

import type { LayerElement, LayerId, StrokeRecord } from "./types";
import { isStroke } from "./types";

export interface RemoveElementResult {
  readonly element: LayerElement;
  readonly index: number;
}

export class StrokeStore {
  private readonly byLayer = new Map<LayerId, LayerElement[]>();

  /**
   * Live element list for a layer, bottom-most first. Callers must not mutate
   * it; it is returned directly to keep rendering allocation-free.
   */
  listElements(layerId: LayerId): readonly LayerElement[] {
    return this.byLayer.get(layerId) ?? EMPTY_ELEMENTS;
  }

  /**
   * The layer's strokes, in painting order, without fills or gradients.
   *
   * A filtered copy: stroke-only features must never see a non-stroke element as
   * if it were an editable path.
   */
  list(layerId: LayerId): readonly StrokeRecord[] {
    const elements = this.byLayer.get(layerId);
    if (!elements) {
      return EMPTY_STROKES;
    }
    const strokes: StrokeRecord[] = [];
    for (const element of elements) {
      if (isStroke(element)) {
        strokes.push(element);
      }
    }
    return strokes;
  }

  /** Number of strokes on a layer. */
  count(layerId: LayerId): number {
    return this.list(layerId).length;
  }

  /** Number of elements (strokes, fills and gradients) on a layer. */
  elementCount(layerId: LayerId): number {
    return this.listElements(layerId).length;
  }

  get totalCount(): number {
    let total = 0;
    for (const elements of this.byLayer.values()) {
      total += elements.length;
    }
    return total;
  }

  /** Appends an element, or inserts it at `index` to restore history order. */
  insert(element: LayerElement, index?: number): void {
    const elements = this.byLayer.get(element.layerId);
    if (!elements) {
      this.byLayer.set(element.layerId, [element]);
      return;
    }
    const at = index === undefined ? elements.length : Math.max(0, Math.min(index, elements.length));
    elements.splice(at, 0, element);
  }

  /**
   * Swaps an element for a new version with the same id, keeping its position.
   *
   * This is how an in-progress gradient is edited without touching history: the
   * preview stays one element in painting order while its endpoint moves.
   */
  replace(element: LayerElement): void {
    const elements = this.byLayer.get(element.layerId);
    if (!elements) {
      this.byLayer.set(element.layerId, [element]);
      return;
    }
    const index = elements.findIndex((candidate) => candidate.id === element.id);
    if (index === -1) {
      elements.push(element);
      return;
    }
    elements[index] = element;
  }

  /** Index of an element in its layer's painting order, or `-1`. */
  indexOf(layerId: LayerId, elementId: string): number {
    return this.listElements(layerId).findIndex((element) => element.id === elementId);
  }

  remove(layerId: LayerId, elementId: string): RemoveElementResult | null {
    const elements = this.byLayer.get(layerId);
    if (!elements) {
      return null;
    }
    const index = elements.findIndex((element) => element.id === elementId);
    if (index === -1) {
      return null;
    }
    const [element] = elements.splice(index, 1);
    if (!element) {
      return null;
    }
    return { element, index };
  }

  clearLayer(layerId: LayerId): void {
    this.byLayer.delete(layerId);
  }

  /** Replaces a layer's element list, used by layer commands on undo/redo. */
  restore(layerId: LayerId, elements: readonly LayerElement[]): void {
    this.byLayer.set(layerId, [...elements]);
  }

  clear(): void {
    this.byLayer.clear();
  }
}

const EMPTY_ELEMENTS: readonly LayerElement[] = [];
const EMPTY_STROKES: readonly StrokeRecord[] = [];
