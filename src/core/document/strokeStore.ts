/**
 * Stroke storage.
 *
 * Layer metadata lives in the document, the pixels produced by strokes live in
 * renderer surfaces, and the stroke data that produced those pixels lives here.
 * Keeping the data around is what makes stroke-level undo possible without
 * snapshotting bitmaps: undoing a stroke removes it from this store and the
 * renderer re-rasterizes the affected layer.
 */

import type { LayerId, StrokeRecord } from "./types";

export interface RemoveStrokeResult {
  readonly stroke: StrokeRecord;
  readonly index: number;
}

export class StrokeStore {
  private readonly byLayer = new Map<LayerId, StrokeRecord[]>();

  /**
   * Live array of strokes for a layer, bottom-most first. Callers must not
   * mutate it; it is returned directly to keep rendering allocation-free.
   */
  list(layerId: LayerId): readonly StrokeRecord[] {
    return this.byLayer.get(layerId) ?? EMPTY;
  }

  count(layerId: LayerId): number {
    return this.list(layerId).length;
  }

  get totalCount(): number {
    let total = 0;
    for (const strokes of this.byLayer.values()) {
      total += strokes.length;
    }
    return total;
  }

  /** Appends a stroke, or inserts it at `index` to restore history order. */
  insert(stroke: StrokeRecord, index?: number): void {
    const strokes = this.byLayer.get(stroke.layerId);
    if (!strokes) {
      this.byLayer.set(stroke.layerId, [stroke]);
      return;
    }
    const at = index === undefined ? strokes.length : Math.max(0, Math.min(index, strokes.length));
    strokes.splice(at, 0, stroke);
  }

  indexOf(layerId: LayerId, strokeId: string): number {
    return this.list(layerId).findIndex((stroke) => stroke.id === strokeId);
  }

  remove(layerId: LayerId, strokeId: string): RemoveStrokeResult | null {
    const strokes = this.byLayer.get(layerId);
    if (!strokes) {
      return null;
    }
    const index = strokes.findIndex((stroke) => stroke.id === strokeId);
    if (index === -1) {
      return null;
    }
    const [stroke] = strokes.splice(index, 1);
    if (!stroke) {
      return null;
    }
    return { stroke, index };
  }

  clearLayer(layerId: LayerId): void {
    this.byLayer.delete(layerId);
  }

  clear(): void {
    this.byLayer.clear();
  }
}

const EMPTY: readonly StrokeRecord[] = [];
