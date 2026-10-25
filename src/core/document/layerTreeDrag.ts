/**
 * Where a drag in the layers tree lands.
 *
 * The panel shows the tree **top-first** and indented; the document stores it
 * **bottom-first**. A drop target is therefore expressed in the document's own
 * terms - a parent and an index in that parent's children list - so the same
 * answer can be handed to `moveLayerToParent` without a second conversion.
 *
 * Three drop zones exist:
 *
 *  - the top quarter of a row inserts **above** it;
 *  - the bottom quarter inserts **below** it;
 *  - the middle of a **group** row drops **into** it, at the top of the group.
 *
 * A layer row has no middle zone: dropping onto a layer would be ambiguous
 * between "above" and "below", so the pointer's half decides.
 *
 * This module is pure and has no DOM types. `layerDropPosition` takes a
 * pointer's Y and a row rectangle; everything else takes the tree.
 */

import { findLayer, isAncestor, layerLocation } from "./layerGroups";
import type { Layer, LayerId } from "./types";

/** Which part of a row the pointer is over. */
export type LayerDropPosition = "above" | "below" | "into";

/** A resolved drop: the destination and whether it would move anything. */
export interface LayerDropTarget {
  /** The group that will hold the node, or `null` for the root. */
  readonly parentId: LayerId | null;
  /**
   * The insertion index in the destination's **current** children list,
   * before the node is taken out. This is the convention
   * `moveLayerToParent` takes.
   */
  readonly index: number;
  /**
   * False when the node already sits at that exact place. The panel then
   * shows no marker and issues no command, so a drop on the current position
   * never creates an empty history step.
   */
  readonly changes: boolean;
}

/**
 * The drop zone for a pointer at `pointerY` in a row starting at `top` with
 * `height`.
 *
 * A group offers its middle band for "into"; a layer does not. Short rows still
 * get usable bands because the ratio, not a pixel threshold, decides.
 */
export function layerDropPosition(
  pointerY: number,
  top: number,
  height: number,
  targetIsGroup: boolean,
): LayerDropPosition {
  const ratio = height <= 0 ? 0.5 : (pointerY - top) / height;
  if (targetIsGroup) {
    if (ratio < 0.28) {
      return "above";
    }
    if (ratio > 0.72) {
      return "below";
    }
    return "into";
  }
  return ratio < 0.5 ? "above" : "below";
}

/**
 * Resolves a drop of `draggedId` on `targetId`.
 *
 * Returns `null` when the drop is not a valid move: an unknown node, a
 * paintable destination for "into", a node dropped on itself, or a group
 * dropped inside its own subtree. The panel uses `null` as "show no marker and
 * refuse the drop"; the engine would refuse it too, so no history entry can be
 * created by a stale marker.
 *
 * The index is computed in the destination's current list. For a sibling
 * reorder, "above" is a higher stack position (a larger index in the
 * bottom-first list), which is why it adds one.
 */
export function resolveLayerDrop(
  layers: readonly Layer[],
  draggedId: LayerId,
  targetId: LayerId,
  position: LayerDropPosition,
): LayerDropTarget | null {
  if (draggedId === targetId) {
    return null;
  }
  const dragged = findLayer(layers, draggedId);
  const target = findLayer(layers, targetId);
  const targetLocation = layerLocation(layers, targetId);
  if (!dragged || !target || !targetLocation) {
    return null;
  }

  if (position === "into") {
    if (target.kind !== "group") {
      return null;
    }
    // A group cannot become its own ancestor.
    if (isAncestor(layers, draggedId, targetId)) {
      return null;
    }
    const index = target.children.length;
    const draggedLocation = layerLocation(layers, draggedId);
    const changes = !(
      draggedLocation?.parentId === targetId &&
      draggedLocation.index === target.children.length - 1
    );
    return { parentId: targetId, index, changes };
  }

  const parentId = targetLocation.parentId;
  // Dropping above or below a row inside the dragged group would put the group
  // inside itself just as surely as "into" would.
  if (parentId === draggedId || (parentId !== null && isAncestor(layers, draggedId, parentId))) {
    return null;
  }
  const index = position === "above" ? targetLocation.index + 1 : targetLocation.index;
  const draggedLocation = layerLocation(layers, draggedId);

  let changes = true;
  if (draggedLocation?.parentId === parentId) {
    changes = !(
      (position === "above" && draggedLocation.index === targetLocation.index + 1) ||
      (position === "below" && draggedLocation.index === targetLocation.index - 1)
    );
  }
  return { parentId, index, changes };
}

/**
 * The groups a node may be moved into: every group except the node itself and
 * the groups inside it.
 *
 * The panel uses this for its accessible "Inside" selector. The engine checks
 * the same rule again, so a stale option can never create a cycle.
 */
export function movableParentGroups(
  layers: readonly Layer[],
  layerId: LayerId,
): readonly Layer[] {
  const node = findLayer(layers, layerId);
  if (!node) {
    return [];
  }
  const groups: Layer[] = [];
  const visit = (nodes: readonly Layer[]): void => {
    for (const candidate of nodes) {
      if (candidate.kind !== "group") {
        continue;
      }
      if (candidate.id !== layerId && !isAncestor(layers, layerId, candidate.id)) {
        groups.push(candidate);
      }
      visit(candidate.children);
    }
  };
  visit(layers);
  return groups;
}
