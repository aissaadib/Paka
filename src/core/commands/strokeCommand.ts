/**
 * Element command host and stroke command.
 *
 * Layer content is one ordered list of strokes and fill patches. Removing a
 * stroke and re-inserting a fill patch are the same operation on that list, so
 * both commands share this host contract and the same re-rasterization path.
 *
 * The stroke data is retained while drawing, so undoing means removing it from
 * the store and letting the renderer re-rasterize the layer from what remains.
 * Redo inserts it back at its original element index, which keeps the painting
 * order inside the layer identical to what the user drew.
 */

import { createId } from "../../utils/id";
import type { StrokeStore } from "../document/strokeStore";
import type { LayerElement, LayerId, StrokeRecord } from "../document/types";
import type { Command } from "./types";

export interface StrokeCommandHost {
  /** Inserts an element, optionally at a specific index in the layer. */
  insert(element: LayerElement, index?: number): void;
  remove(element: LayerElement): void;
  /** Re-rasterizes a layer after its element list changed. */
  refresh(layerId: LayerId): void;
}

/** Adapts a `StrokeStore` (plus a layer refresh callback) to the host contract. */
export function createStrokeCommandHost(
  store: StrokeStore,
  refresh: (layerId: LayerId) => void,
): StrokeCommandHost {
  return {
    insert(element, index) {
      store.insert(element, index);
    },
    remove(element) {
      store.remove(element.layerId, element.id);
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
