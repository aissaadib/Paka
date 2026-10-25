/**
 * Shape commands: creating, editing and deleting a native shape.
 *
 * A shape is one element in the layer's ordered list, exactly like a stroke,
 * a fill patch or a gradient, so its commands reuse the same host contract and
 * the same re-rasterization path. That is what keeps one gesture one history
 * entry and keeps painting order intact across undo and redo.
 *
 * An edit keeps the shape's id and its position: the record is swapped in
 * place, so a redo after an undo restores the same z-order and the same
 * identity. A run of slider ticks coalesces through a merge key, so dragging a
 * side count is one step rather than one step per tick.
 */

import { createId } from "../../utils/id";
import type { ShapeRecord } from "../document/types";
import type { StrokeCommandHost } from "./strokeCommand";
import type { Command } from "./types";

/** Inserts one shape at a painting index. */
export function createShapeCommand(
  shape: ShapeRecord,
  index: number,
  host: StrokeCommandHost,
): Command {
  return {
    id: createId("cmd"),
    label: "Shape",
    apply(): void {
      host.insert(shape, index);
      host.refresh(shape.layerId);
    },
    revert(): void {
      host.remove(shape);
      host.refresh(shape.layerId);
    },
  };
}

/**
 * Inserts a shape and its symmetry copies as **one** history step.
 *
 * The shapes share a layer and the indices are in painting order, so undoing
 * the gesture takes the whole thing away and redo restores the exact order.
 */
export function createShapesCommand(
  shapes: readonly ShapeRecord[],
  indices: readonly number[],
  host: StrokeCommandHost,
): Command {
  const layerId = shapes[0]?.layerId;
  return {
    id: createId("cmd"),
    label: "Shape",
    apply(): void {
      shapes.forEach((shape, position) => {
        host.insert(shape, indices[position]);
      });
      if (layerId) {
        host.refresh(layerId);
      }
    },
    revert(): void {
      for (let position = shapes.length - 1; position >= 0; position -= 1) {
        host.remove(shapes[position]);
      }
      if (layerId) {
        host.refresh(layerId);
      }
    },
  };
}

/**
 * Replaces a shape with an edited version of itself.
 *
 * The before/after pair is the whole step: `apply` writes the edited record and
 * `revert` writes the press-time one back. Both keep the id, so the element
 * never leaves its place in the layer. `mergeKey` lets consecutive parameter
 * edits of the same shape collapse into one entry.
 */
export function createShapeEditCommand(
  before: ShapeRecord,
  after: ShapeRecord,
  host: StrokeCommandHost,
  options: { readonly label?: string; readonly mergeKey?: string } = {},
): Command {
  const { label = "Edit Shape", mergeKey } = options;
  const command: ShapeEditCommand = {
    id: createId("cmd"),
    label,
    after,
    ...(mergeKey === undefined ? {} : { mergeKey }),
    apply(): void {
      host.replace(after);
      host.refresh(after.layerId);
    },
    revert(): void {
      host.replace(before);
      host.refresh(before.layerId);
    },
    ...(mergeKey === undefined
      ? {}
      : {
          mergeWith(next: Command): Command {
            // The next command in the run edits the same record. The merged
            // step spans from *this* command's earliest revert point to the
            // next command's latest apply point.
            const merged = next as ShapeEditCommand;
            return createShapeEditCommand(before, merged.after, host, {
              label,
              mergeKey,
            });
          },
        }),
  };
  return command;
}

/** A shape edit command, carrying the record it applies. */
export interface ShapeEditCommand extends Command {
  readonly after: ShapeRecord;
}

/** Removes a shape as one history step. */
export function createShapeDeleteCommand(
  shape: ShapeRecord,
  index: number,
  host: StrokeCommandHost,
): Command {
  return {
    id: createId("cmd"),
    label: "Delete Shape",
    apply(): void {
      host.remove(shape);
      host.refresh(shape.layerId);
    },
    revert(): void {
      host.insert(shape, index);
      host.refresh(shape.layerId);
    },
  };
}
