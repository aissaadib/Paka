/**
 * The layer tree: the folders the panel groups the layers into.
 *
 * A group is **organization, not compositing**. It has no pixels, no opacity
 * and no blend mode, so putting a layer into a group never changes what the
 * drawing looks like: the layer keeps its own visibility, opacity and blend
 * mode, and it is composited against the paper and its neighbours exactly as
 * before. What a group does say is *where the layer sits in the panel*.
 *
 * The tree is stored in the document, and the document's flat `layers` list is
 * kept in step with it: the members of a group occupy one **contiguous run**
 * of the flat list. That is what makes the panel order and the painting order
 * the same order - a layer inside a group is drawn between the group below it
 * and the group above it, never somewhere else - and it is why the renderer
 * needs no change at all: it still walks the flat list.
 *
 * Every function here is pure: it takes a tree and returns a new one. The
 * engine turns them into history entries, exactly as it does for the other
 * document operations.
 */

import { createId } from "../../utils/id";
import { clamp } from "../../utils/math";
import type { Layer, LayerGroup, LayerId, LayerTree, LayerTreeEntry } from "./types";

/**
 * A tree, indexed for reading.
 *
 * The stored tree keeps every group in one flat list and names the groups in
 * the child lists, so a group is looked up in one place. This index is the
 * working shape the mutations use: the groups by id, each group's parent, and
 * each parent's child list.
 */
interface TreeIndex {
  readonly groups: Map<string, LayerGroup>;
  /** The group a group sits in; `null` for a top-level group. */
  readonly parentOf: Map<string, string | null>;
  /** The children of a group; the key `null` holds the root's children. */
  readonly childrenOf: Map<string | null, LayerTreeEntry[]>;
}

/** An empty tree: no groups, no entries. */
export function createLayerTree(): LayerTree {
  return { groups: [], root: [] };
}

/**
 * A tree with every layer at the root, in the given order.
 *
 * This is the tree a document without groups has, and the tree an older
 * project file is read as: the layers keep the order they were written in, and
 * no folder is invented for them.
 */
export function layerTreeFromLayers(layers: readonly Layer[]): LayerTree {
  return {
    groups: [],
    root: layers.map((layer) => ({ kind: "layer", id: layer.id })),
  };
}

/** Indexes a tree for reading. */
function indexTree(tree: LayerTree): TreeIndex {
  const groups = new Map<string, LayerGroup>();
  for (const group of tree.groups) {
    groups.set(group.id, group);
  }

  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string | null, LayerTreeEntry[]>();
  childrenOf.set(null, [...tree.root]);

  const visit = (entries: readonly LayerTreeEntry[], parent: string | null): void => {
    for (const entry of entries) {
      if (entry.kind !== "group") {
        continue;
      }
      parentOf.set(entry.id, parent);
      const group = groups.get(entry.id);
      const children = group ? [...group.children] : [];
      childrenOf.set(entry.id, children);
      visit(children, entry.id);
    }
  };
  visit(tree.root, null);

  return { groups, parentOf, childrenOf };
}

/**
 * Rebuilds a tree from an index.
 *
 * Only the groups that are reachable from the root are kept: a group nobody
 * can reach is not part of the tree, and dropping it is better than keeping a
 * folder that the panel could never show.
 */
function buildTree(index: TreeIndex): LayerTree {
  const groups: LayerGroup[] = [];
  const visit = (parent: string | null): void => {
    for (const entry of index.childrenOf.get(parent) ?? []) {
      if (entry.kind !== "group") {
        continue;
      }
      const group = index.groups.get(entry.id);
      if (!group) {
        continue;
      }
      const children = index.childrenOf.get(entry.id) ?? [];
      groups.push({ ...group, children });
      visit(entry.id);
    }
  };
  visit(null);
  return { groups, root: index.childrenOf.get(null) ?? [] };
}

/** The group with this id, if the tree has one. */
export function findLayerGroup(tree: LayerTree, groupId: string): LayerGroup | undefined {
  return tree.groups.find((group) => group.id === groupId);
}

/** The group a group sits in; `null` for a top-level group or an unknown one. */
export function layerGroupParent(tree: LayerTree, groupId: string): string | null {
  const index = indexTree(tree);
  return index.parentOf.get(groupId) ?? null;
}

/**
 * The group a layer sits in; `null` for a layer at the root or an unknown one.
 */
export function layerGroupOfLayer(tree: LayerTree, layerId: LayerId): string | null {
  const index = indexTree(tree);
  for (const [parent, children] of index.childrenOf) {
    if (children.some((entry) => entry.kind === "layer" && entry.id === layerId)) {
      return parent;
    }
  }
  return null;
}

/**
 * True when `groupId` sits inside `ancestorId`, at any depth.
 *
 * This is the guard that keeps a folder from being moved into itself: a group
 * inside a group that the user is dragging would otherwise build a cycle, and
 * a cycle in the tree is a tree that cannot be drawn, saved or read back.
 */
export function isLayerGroupDescendant(
  tree: LayerTree,
  ancestorId: string,
  groupId: string,
): boolean {
  const index = indexTree(tree);
  let current = index.parentOf.get(groupId);
  while (current !== undefined && current !== null) {
    if (current === ancestorId) {
      return true;
    }
    current = index.parentOf.get(current);
  }
  return false;
}

/**
 * The layer ids of the tree, in painting order.
 *
 * The order is the tree walked bottom-first: a group's members come out
 * together, in the place the group holds in the stack. It is the order the
 * flat layer list must be in.
 */
export function layerTreeLayerIds(tree: LayerTree): LayerId[] {
  const index = indexTree(tree);
  const ids: LayerId[] = [];
  const visit = (parent: string | null): void => {
    for (const entry of index.childrenOf.get(parent) ?? []) {
      if (entry.kind === "layer") {
        ids.push(entry.id);
        continue;
      }
      visit(entry.id);
    }
  };
  visit(null);
  return ids;
}

/**
 * The flat layer list, reordered to match the tree.
 *
 * A layer the tree does not mention keeps its place at the end rather than
 * disappearing: the list is the document's content, and content is never lost
 * to a bookkeeping mistake.
 */
export function syncLayersToTree(
  tree: LayerTree,
  layers: readonly Layer[],
): readonly Layer[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const ordered: Layer[] = [];
  const placed = new Set<LayerId>();
  for (const id of layerTreeLayerIds(tree)) {
    const layer = byId.get(id);
    if (!layer || placed.has(id)) {
      continue;
    }
    placed.add(id);
    ordered.push(layer);
  }
  for (const layer of layers) {
    if (!placed.has(layer.id)) {
      ordered.push(layer);
    }
  }
  return ordered;
}

/** A group name that is not used yet in the tree. */
export function nextLayerGroupName(tree: LayerTree): string {
  const used = new Set(tree.groups.map((group) => group.name));
  for (let index = 1; ; index += 1) {
    const candidate = `Group ${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

/** Suffixes `base` with a number until it is unique in the tree. */
export function uniqueLayerGroupName(tree: LayerTree, base: string): string {
  const used = new Set(tree.groups.map((group) => group.name));
  if (!used.has(base)) {
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

export interface CreateLayerGroupOptions {
  /** The name of the new group. */
  readonly name?: string;
  /** The group it goes into; `null` puts it at the top level. */
  readonly parentId?: string | null;
  /** Where it goes among its new siblings; the end (the top) by default. */
  readonly index?: number;
}

/**
 * Creates a group and returns the new tree and the group's id.
 *
 * The group is empty: a folder with nothing in it is a legitimate thing to
 * make - it is where the next layer will go - and an empty group holds no
 * pixels, so it changes nothing about the drawing.
 */
export function createLayerGroup(
  tree: LayerTree,
  options: CreateLayerGroupOptions = {},
): { readonly tree: LayerTree; readonly id: string } {
  const index = indexTree(tree);
  const parentId = options.parentId ?? null;
  if (parentId !== null && !index.groups.has(parentId)) {
    return { tree, id: "" };
  }

  const id = createId("group");
  const name = options.name ?? nextLayerGroupName(tree);
  const siblings = index.childrenOf.get(parentId) ?? [];
  const at = clamp(options.index ?? siblings.length, 0, siblings.length);
  const children = [...siblings];
  children.splice(at, 0, { kind: "group", id });

  index.childrenOf.set(parentId, children);
  index.groups.set(id, { id, name, collapsed: false, children: [] });
  return { tree: buildTree(index), id };
}

/** Renames a group. An empty name is refused. */
export function renameLayerGroup(tree: LayerTree, groupId: string, name: string): LayerTree {
  const index = indexTree(tree);
  const group = index.groups.get(groupId);
  const trimmed = name.trim();
  if (!group || trimmed === "") {
    return tree;
  }
  index.groups.set(groupId, { ...group, name: trimmed });
  return buildTree(index);
}

/**
 * Folds a group away or opens it again.
 *
 * The flag is display-only: a collapsed group still holds its layers and they
 * are still composited exactly as before.
 */
export function setLayerGroupCollapsed(
  tree: LayerTree,
  groupId: string,
  collapsed: boolean,
): LayerTree {
  const index = indexTree(tree);
  const group = index.groups.get(groupId);
  if (!group || group.collapsed === collapsed) {
    return tree;
  }
  index.groups.set(groupId, { ...group, collapsed });
  return buildTree(index);
}

/**
 * Moves a group among its siblings.
 *
 * A positive `delta` moves it towards the top of the stack, like the layer
 * reorder does. A group is never moved into itself or into one of its own
 * children.
 */
export function moveLayerGroup(tree: LayerTree, groupId: string, delta: number): LayerTree {
  const index = indexTree(tree);
  const parentId = index.parentOf.get(groupId);
  if (parentId === undefined) {
    return tree;
  }
  const siblings = index.childrenOf.get(parentId) ?? [];
  const at = siblings.findIndex((entry) => entry.kind === "group" && entry.id === groupId);
  if (at === -1) {
    return tree;
  }
  const target = clamp(at + delta, 0, siblings.length - 1);
  if (target === at) {
    return tree;
  }
  const children = [...siblings];
  const [moved] = children.splice(at, 1);
  if (!moved) {
    return tree;
  }
  children.splice(target, 0, moved);
  index.childrenOf.set(parentId, children);
  return buildTree(index);
}

/**
 * Moves a layer into a group, or out of every group back to the top level.
 *
 * `groupId` of `null` puts the layer at the root. The layer lands at the end
 * of its new siblings - the top of the group - unless an index says otherwise.
 * Every other layer keeps its place, so moving one layer never shuffles the
 * rest of the stack.
 *
 * A layer that **leaves** a group keeps the place it had: it comes out just
 * below the slot the group holds, so taking a layer out of a folder does not
 * throw it to the top of the drawing. A layer that goes **into** a group joins
 * the group's slot, at the top of it.
 */
export function moveLayerToGroup(
  tree: LayerTree,
  layerId: LayerId,
  groupId: string | null,
  index?: number,
): LayerTree {
  const treeIndex = indexTree(tree);
  if (groupId !== null && !treeIndex.groups.has(groupId)) {
    return tree;
  }

  // Take the layer out of wherever it is now.
  let source: string | null = null;
  let sourceAt = -1;
  for (const [parent, children] of treeIndex.childrenOf) {
    const at = children.findIndex(
      (entry) => entry.kind === "layer" && entry.id === layerId,
    );
    if (at !== -1) {
      source = parent;
      sourceAt = at;
      break;
    }
  }
  if (sourceAt === -1) {
    return tree;
  }

  const sourceChildren = treeIndex.childrenOf.get(source) ?? [];
  const withoutLayer = [...sourceChildren];
  withoutLayer.splice(sourceAt, 1);
  treeIndex.childrenOf.set(source, withoutLayer);

  const target = treeIndex.childrenOf.get(groupId) ?? [];
  const at = clamp(index ?? landingIndex(treeIndex, source, groupId), 0, target.length);
  const children = [...target];
  children.splice(at, 0, { kind: "layer", id: layerId });
  treeIndex.childrenOf.set(groupId, children);

  return buildTree(treeIndex);
}

/**
 * Moves a layer among its siblings.
 *
 * The siblings are the entries the layer shares a parent with - the other
 * layers and the groups beside it. A positive `delta` moves the layer towards
 * the top of the stack. The layer never leaves its group this way: moving it
 * out is `moveLayerToGroup`'s job.
 */
export function moveLayerInTree(
  tree: LayerTree,
  layerId: LayerId,
  delta: number,
): LayerTree {
  const index = indexTree(tree);
  for (const [parent, children] of index.childrenOf) {
    const at = children.findIndex(
      (entry) => entry.kind === "layer" && entry.id === layerId,
    );
    if (at === -1) {
      continue;
    }
    const target = clamp(at + delta, 0, children.length - 1);
    if (target === at) {
      return tree;
    }
    const next = [...children];
    const [moved] = next.splice(at, 1);
    if (!moved) {
      return tree;
    }
    next.splice(target, 0, moved);
    index.childrenOf.set(parent, next);
    return buildTree(index);
  }
  return tree;
}

/**
 * Removes a layer from the tree.
 *
 * The layer's pixels are not touched here - the caller owns the content - but
 * the tree must not keep pointing at a layer the document no longer holds.
 */
export function removeLayerFromTree(tree: LayerTree, layerId: LayerId): LayerTree {
  const index = indexTree(tree);
  for (const [parent, children] of index.childrenOf) {
    const at = children.findIndex(
      (entry) => entry.kind === "layer" && entry.id === layerId,
    );
    if (at === -1) {
      continue;
    }
    const kept = [...children];
    kept.splice(at, 1);
    index.childrenOf.set(parent, kept);
    return buildTree(index);
  }
  return tree;
}

/**
 * Puts a copy of a layer directly above the original.
 *
 * The copy lands in the same group as the original, right above it, so a
 * duplicated layer is drawn where the user expects it: just above the layer
 * it was copied from.
 */
export function insertLayerAbove(tree: LayerTree, layerId: LayerId, copyId: LayerId): LayerTree {
  const index = indexTree(tree);
  for (const [parent, children] of index.childrenOf) {
    const at = children.findIndex(
      (entry) => entry.kind === "layer" && entry.id === layerId,
    );
    if (at === -1) {
      continue;
    }
    const next = [...children];
    next.splice(at + 1, 0, { kind: "layer", id: copyId });
    index.childrenOf.set(parent, next);
    return buildTree(index);
  }
  return tree;
}

/**
 * Where a layer lands in its new home.
 *
 * A layer that leaves a group comes out just below the slot the group holds,
 * so it keeps the place it had in the stack. A layer that joins a group lands
 * at the top of that group, which is the group's own slot. The end of the
 * list - the top of the stack - is the fallback.
 */
function landingIndex(index: TreeIndex, source: string | null, target: string | null): number {
  const siblings = index.childrenOf.get(target) ?? [];
  if (target !== null || source === null) {
    return siblings.length;
  }
  // The layer came out of a group: it lands where that group sat in the root.
  const root = index.childrenOf.get(null) ?? [];
  const at = root.findIndex(
    (entry) => entry.kind === "group" && entry.id === source,
  );
  return at === -1 ? siblings.length : at;
}

/**
 * Removes a group and keeps everything that was in it.
 *
 * The group's children move up into the group that held it, in the same
 * order, so removing a folder never removes a layer - and never a pixel with
 * it. A group that held nothing simply disappears.
 */
export function removeLayerGroup(tree: LayerTree, groupId: string): LayerTree {
  const index = indexTree(tree);
  const parentId = index.parentOf.get(groupId);
  if (parentId === undefined) {
    return tree;
  }
  const siblings = index.childrenOf.get(parentId) ?? [];
  const at = siblings.findIndex((entry) => entry.kind === "group" && entry.id === groupId);
  if (at === -1) {
    return tree;
  }

  const children = index.childrenOf.get(groupId) ?? [];
  const kept = [...siblings];
  kept.splice(at, 1, ...children);
  index.childrenOf.set(parentId, kept);
  index.groups.delete(groupId);
  index.childrenOf.delete(groupId);
  index.parentOf.delete(groupId);
  return buildTree(index);
}

/**
 * True when the tree still describes the same layers as the flat list.
 *
 * The tree and the list are two views of one thing, and this is the invariant
 * that keeps them the same thing: every layer is in the tree exactly once.
 */
export function isLayerTreeConsistent(
  tree: LayerTree,
  layers: readonly Layer[],
): boolean {
  const ids = layerTreeLayerIds(tree);
  if (ids.length !== layers.length) {
    return false;
  }
  const known = new Set(layers.map((layer) => layer.id));
  const seen = new Set<LayerId>();
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
  }
  return true;
}

/** One row of the layer panel: a group header or a layer. */
export interface LayerTreeRow {
  readonly kind: "layer" | "group";
  /** The layer id or the group id. */
  readonly id: string;
  readonly name: string;
  /** How deep the row sits: 0 at the top level, 1 inside a group, and so on. */
  readonly depth: number;
  /** True for a folded group; always false for a layer. */
  readonly collapsed: boolean;
  /** The layer itself, on a layer row. */
  readonly layer?: Layer;
}

/**
 * The panel's rows: the tree as the user sees it.
 *
 * The list is **top-first**, like the canvas composites, and a folded group
 * shows only its own row. The rows carry the layer's own record, so a panel
 * does not have to look the layer up again.
 */
export function layerTreeRows(tree: LayerTree, layers: readonly Layer[]): LayerTreeRow[] {
  const index = indexTree(tree);
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const rows: LayerTreeRow[] = [];

  const visit = (parent: string | null, depth: number): void => {
    const children = index.childrenOf.get(parent) ?? [];
    for (let position = children.length - 1; position >= 0; position -= 1) {
      const entry = children[position];
      if (!entry) {
        continue;
      }
      if (entry.kind === "layer") {
        const layer = byId.get(entry.id);
        rows.push({
          kind: "layer",
          id: entry.id,
          name: layer?.name ?? "Layer",
          depth,
          collapsed: false,
          ...(layer ? { layer } : {}),
        });
        continue;
      }
      const group = index.groups.get(entry.id);
      if (!group) {
        continue;
      }
      rows.push({
        kind: "group",
        id: group.id,
        name: group.name,
        depth,
        collapsed: group.collapsed,
      });
      if (!group.collapsed) {
        visit(group.id, depth + 1);
      }
    }
  };
  visit(null, 0);
  return rows;
}
