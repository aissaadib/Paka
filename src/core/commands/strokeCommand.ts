/**
 * Stroke command: stroke-level undo without bitmap snapshots.
 *
 * The stroke data is retained while drawing, so undoing means removing it from
 * the stroke store and letting the renderer re-rasterize the layer from the
 * strokes that remain. Redo inserts it back at its original index, which keeps
 * the painting order inside the layer identical to what the user drew.
 */

import { createId } from "../../utils/id";
import type { StrokeStore } from "../document/strokeStore";
import type { LayerId, StrokeRecord } from "../document/types";
import type { Command } from "./types";

export interface StrokeCommandHost {
  /** Inserts a stroke, optionally at a specific index in the layer. */
  insert(stroke: StrokeRecord, index?: number): void;
  remove(stroke: StrokeRecord): void;
  /** Re-rasterizes a layer after its stroke list changed. */
  refresh(layerId: LayerId): void;
}

/** Adapts a `StrokeStore` (plus a layer refresh callback) to the host contract. */
export function createStrokeCommandHost(
  store: StrokeStore,
  refresh: (layerId: LayerId) => void,
): StrokeCommandHost {
  return {
    insert(stroke, index) {
      store.insert(stroke, index);
    },
    remove(stroke) {
      store.remove(stroke.layerId, stroke.id);
    },
    refresh,
  };
}

export function createStrokeCommand(
  stroke: StrokeRecord,
  index: number,
  host: StrokeCommandHost,
): Command {
  return {
    id: createId("cmd"),
    label: stroke.erase === true ? "Erase" : "Stroke",
    apply(): void {
      host.insert(stroke, index);
      host.refresh(stroke.layerId);
    },
    revert(): void {
      host.remove(stroke);
      host.refresh(stroke.layerId);
    },
  };
}
