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
  /** Swaps an element for a new version with the same id, keeping its index. */
  replace(element: LayerElement): void;
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
    replace(element) {
      store.replace(element);
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

/**
 * Inserts several strokes as **one** history step.
 *
 * Symmetry commits the original and its mirrored copies together: undoing one
 * gesture must take the whole thing away, not one copy at a time. The strokes
 * share a layer (a mirror stays on the layer it was drawn on) and the indices
 * are in painting order, so a redo restores exactly the order they were first
 * inserted in.
 */
export function createStrokesCommand(
  strokes: readonly StrokeRecord[],
  indices: readonly number[],
  host: StrokeCommandHost,
): Command {
  const layerId = strokes[0]?.layerId;
  return {
    id: createId("cmd"),
    label: strokes.some((stroke) => stroke.erase === true) ? "Erase" : "Stroke",
    apply(): void {
      strokes.forEach((stroke, position) => {
        host.insert(stroke, indices[position]);
      });
      if (layerId) {
        host.refresh(layerId);
      }
    },
    revert(): void {
      for (let position = strokes.length - 1; position >= 0; position -= 1) {
        host.remove(strokes[position]);
      }
      if (layerId) {
        host.refresh(layerId);
      }
    },
  };
}
