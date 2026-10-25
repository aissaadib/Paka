/**
 * Layer groups: the rules of the document's layer tree.
 *
 * A document's layers are a **tree**, not a list. A node is either a
 * paintable layer (it owns strokes, fills and gradients) or a **group**, a
 * container that holds other nodes and paints nothing itself. The tree is
 * what the layers panel draws, and it is what the compositing order is
 * derived from.
 *
 * Three rules decide everything:
 *
 * 1. **A group's children keep their order.** The children are held
 *    bottom-first, exactly like the root list, and the compositing order of
 *    the whole document is the depth-first, bottom-first walk of the tree.
 * 2. **A child cannot be its own ancestor.** A group may not hold itself, and
 *    a group may not be moved into one of its own descendants: the tree would
 *    stop being a tree, and the walk would never end.
 * 3. **Dissolving a group keeps the children's pixels and their order.** The
 *    children take the group's place in its parent, in the same order, and
 *    their content is untouched: a group owns no content of its own, so
 *    dissolving it is a pure change of the tree - nothing is re-rasterized
 *    and nothing is lost.
 *
 * Everything here is a pure function over immutable documents. There is no
 * rendering, no React and no history in this module: the commands that turn
 * these rules into undoable steps live in `commands/documentCommand.ts`.
 */

import { createId } from "../../utils/id";
import { clamp } from "../../utils/math";
import type { DrawingDocument, Layer, LayerId } from "./types";

/** The default name of a new group. */
export const DEFAULT_GROUP_NAME = "Group";

/** True when the node is a group (a container of layers) rather than a paintable layer. */
export function isGroup(node: Layer): boolean {
  return node.kind === "group";
}

/**
 * Every node of the tree, depth-first and bottom-first.
 *
 * The order is the document's own order: a group is followed by its
 * children, which is the order a reader walks the file in.
 */
export function flattenLayers(layers: readonly Layer[]): readonly Layer[] {
  const flat: Layer[] = [];
  const visit = (nodes: readonly Layer[]): void => {
    for (const node of nodes) {
      flat.push(node);
      visit(node.children);
    }
  };
  visit(layers);
  return flat;
}

/**
 * The paintable layers of the tree, depth-first and bottom-first.
 *
 * This is the **compositing order**: a group paints nothing, so the layers
 * that carry pixels are the leaves of the tree, in the order the walk finds
 * them. The renderer needs this list, not the tree.
 */
export function paintableLayers(layers: readonly Layer[]): readonly Layer[] {
  const flat: Layer[] = [];
  const visit = (nodes: readonly Layer[]): void => {
    for (const node of nodes) {
      if (isGroup(node)) {
        visit(node.children);
      } else {
        flat.push(node);
      }
    }
  };
  visit(layers);
  return flat;
}

/** The node with `id`, wherever it sits in the tree, or `undefined`. */
export function findLayer(layers: readonly Layer[], id: LayerId): Layer | undefined {
  for (const node of layers) {
    if (node.id === id) {
      return node;
    }
    const found = findLayer(node.children, id);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * The chain of nodes from the root down to `id`, inclusive.
 *
 * `undefined` when the id is not in the tree. The chain is what answers
 * "is this node an ancestor of that one?".
 */
export function findLayerPath(
  layers: readonly Layer[],
  id: LayerId,
): readonly Layer[] | undefined {
  for (const node of layers) {
    if (node.id === id) {
      return [node];
    }
    const path = findLayerPath(node.children, id);
    if (path) {
      return [node, ...path];
    }
  }
  return undefined;
}

/** The node that holds `id`, or `undefined` for a node at the root. */
export function findParent(layers: readonly Layer[], id: LayerId): Layer | undefined {
  const path = findLayerPath(layers, id);
  if (!path || path.length < 2) {
    return undefined;
  }
  return path[path.length - 2];
}

/**
 * True when `ancestorId` is an ancestor of `descendantId`.
 *
 * A node is **not** its own ancestor: the rule that keeps a tree a tree is
 * about the strict ancestor relation, so a group can never hold itself.
 */
export function isAncestor(
  layers: readonly Layer[],
  ancestorId: LayerId,
  descendantId: LayerId,
): boolean {
  if (ancestorId === descendantId) {
    return false;
  }
  const path = findLayerPath(layers, descendantId);
  if (!path) {
    return false;
  }
  return path.slice(0, -1).some((node) => node.id === ancestorId);
}

/** How deep a node sits: 0 at the root, 1 inside a root group, and so on. */
export function layerDepth(layers: readonly Layer[], id: LayerId): number {
  const path = findLayerPath(layers, id);
  return path ? path.length - 1 : -1;
}

/** The ids of a node's whole subtree, the node itself first. */
export function subtreeIds(node: Layer): readonly LayerId[] {
  return flattenLayers([node]).map((child) => child.id);
}

/** Every name used anywhere in the tree. */
export function allLayerNames(layers: readonly Layer[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const node of flattenLayers(layers)) {
    names.add(node.name);
  }
  return names;
}

/**
 * Suffixes `base` with a number until it is not in `used`.
 *
 * The rule the layer names have always followed, kept in one place so the
 * tree and the flat list name things the same way.
 */
export function uniqueNameAmong(used: ReadonlySet<string>, base: string): string {
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

/** The ids in `after` that are not in `before`: the layers a change created. */
export function newLayerIds(
  before: readonly Layer[],
  after: readonly Layer[],
): readonly LayerId[] {
  const known = new Set(flattenLayers(before).map((node) => node.id));
  return flattenLayers(after)
    .filter((node) => !known.has(node.id))
    .map((node) => node.id);
}

/**
 * Rebuilds a list of nodes, replacing the node with `id` by `transform`.
 *
 * `transform` returns the replacement, or `undefined` to drop the node (and,
 * with it, its whole subtree). The list is returned unchanged when the id is
 * not in it, so a caller can tell "nothing changed" from "changed".
 */
function replaceNode(
  nodes: readonly Layer[],
  id: LayerId,
  transform: (node: Layer) => Layer | undefined,
): readonly Layer[] {
  let changed = false;
  const next: Layer[] = [];
  for (const node of nodes) {
    if (node.id === id) {
      const replacement = transform(node);
      changed = true;
      if (replacement) {
        next.push(replacement);
      }
      continue;
    }
    if (node.children.length === 0) {
      next.push(node);
      continue;
    }
    const children = replaceNode(node.children, id, transform);
    if (children === node.children) {
      next.push(node);
      continue;
    }
    changed = true;
    next.push({ ...node, children });
  }
  return changed ? next : nodes;
}

/**
 * Rebuilds a list of nodes, applying `transform` to every node.
 *
 * `transform` returns the replacement, or `undefined` to drop the node.
 */
function mapNodes(
  nodes: readonly Layer[],
  transform: (node: Layer) => Layer | undefined,
): readonly Layer[] {
  const next: Layer[] = [];
  let changed = false;
  for (const node of nodes) {
    const replacement = transform(node);
    if (replacement !== node) {
      changed = true;
    }
    if (!replacement) {
      continue;
    }
    if (replacement.children.length === 0) {
      next.push(replacement);
      continue;
    }
    const children = mapNodes(replacement.children, transform);
    if (children !== replacement.children) {
      changed = true;
      next.push({ ...replacement, children });
      continue;
    }
    next.push(replacement);
  }
  return changed ? next : nodes;
}

/** Builds a group node. A group owns no content: it only holds nodes. */
export function createGroup(name: string, children: readonly Layer[] = []): Layer {
  return {
    id: createId("group"),
    name,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    kind: "group",
    children,
  };
}

/**
 * Puts the given layers into a new group.
 *
 * The layers must be **siblings**: the group is created in the place of the
 * topmost of them, and the others move into it. The children's order is
 * kept, and so is their content - a group is a container, not a merge.
 *
 * The document is returned unchanged when the request cannot be honoured:
 * fewer than two layers, an unknown id, a layer that is not a sibling of the
 * others, or a group among them (a group of groups is a different feature).
 */
export function groupLayers(
  document: DrawingDocument,
  layerIds: readonly LayerId[],
  name?: string,
): DrawingDocument {
  if (layerIds.length < 2) {
    return document;
  }

  const wanted = new Set(layerIds);
  if (wanted.size !== layerIds.length) {
    return document;
  }

  // The layers must all sit in the same parent, and none of them may be a
  // group: grouping a group would nest a container in a container, which the
  // panel does not offer.
  const parentIds = new Set<LayerId | null>();
  for (const id of layerIds) {
    const node = findLayer(document.layers, id);
    if (!node || isGroup(node)) {
      return document;
    }
    const parent = findParent(document.layers, id);
    parentIds.add(parent ? parent.id : null);
  }
  if (parentIds.size !== 1) {
    return document;
  }

  const parentId = parentIds.values().next().value ?? null;
  const siblings =
    parentId === null
      ? document.layers
      : (findLayer(document.layers, parentId)?.children ?? []);
  const positions = siblings
    .map((node, index) => (wanted.has(node.id) ? index : -1))
    .filter((index) => index >= 0);
  if (positions.length !== layerIds.length) {
    return document;
  }

  // The children keep their order, bottom-first.
  const children = positions
    .map((index) => siblings[index])
    .filter((node): node is Layer => Boolean(node));

  // The group takes the place of the **topmost** grouped child, so the layers
  // that were below it stay below the group.
  const topmost = positions[positions.length - 1] ?? 0;
  const insertAt = topmost - (positions.length - 1);
  const remaining = siblings.filter((node) => !wanted.has(node.id));
  const nextSiblings = [...remaining];
  const group = createGroup(name ?? uniqueGroupName(document), children);
  nextSiblings.splice(Math.max(0, Math.min(insertAt, remaining.length)), 0, group);

  const layers =
    parentId === null
      ? nextSiblings
      : replaceNode(document.layers, parentId, (node) => ({ ...node, children: nextSiblings }));

  if (layers === document.layers) {
    return document;
  }
  return { ...document, layers };
}

/** The name a new group gets when the caller does not name it. */
export function uniqueGroupName(document: DrawingDocument): string {
  const used = allLayerNames(document.layers);
  for (let index = 1; ; index += 1) {
    const candidate = `${DEFAULT_GROUP_NAME} ${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

/** Where a node sits: its parent (`null` at the root) and its index there. */
export interface LayerLocation {
  readonly parentId: LayerId | null;
  readonly index: number;
}

/**
 * The place a node occupies in the tree.
 *
 * `undefined` when the id is not in the tree. The index is in the parent's
 * children list, which is bottom-first like every other list in the model.
 */
export function layerLocation(
  layers: readonly Layer[],
  id: LayerId,
): LayerLocation | undefined {
  const path = findLayerPath(layers, id);
  if (!path) {
    return undefined;
  }
  const parent = path.length >= 2 ? path[path.length - 2] : undefined;
  const siblings = parent ? parent.children : layers;
  const index = siblings.findIndex((node) => node.id === id);
  if (index === -1) {
    return undefined;
  }
  return { parentId: parent ? parent.id : null, index };
}

/**
 * Inserts `node` into the tree at `parentId` / `index`.
 *
 * `index` is clamped to the list, so a drop past the end means "top". Returns
 * `undefined` when the parent cannot hold children (it does not exist or is a
 * paintable layer).
 */
function insertNodeAt(
  layers: readonly Layer[],
  node: Layer,
  parentId: LayerId | null,
  index: number,
): readonly Layer[] | undefined {
  if (parentId === null) {
    const next = [...layers];
    next.splice(clamp(Math.trunc(index), 0, next.length), 0, node);
    return next;
  }
  const parent = findLayer(layers, parentId);
  if (!parent || !isGroup(parent)) {
    return undefined;
  }
  return replaceNode(layers, parentId, (owner) => {
    const children = [...owner.children];
    children.splice(clamp(Math.trunc(index), 0, children.length), 0, node);
    return { ...owner, children };
  });
}

/**
 * Creates an empty group and inserts it into the tree.
 *
 * A group owns no content, so it starts empty. The caller decides where it
 * goes; `index` is in the destination's children list (bottom-first) and is
 * clamped, so "above the active layer" is `location.index + 1`.
 *
 * Returns `null` when the destination cannot hold a group. The document is
 * untouched in that case, which is what lets a command refuse without a
 * partial mutation.
 */
export function addGroup(
  document: DrawingDocument,
  options: {
    readonly name?: string;
    readonly parentId?: LayerId | null;
    readonly index?: number;
  } = {},
): { readonly document: DrawingDocument; readonly group: Layer } | null {
  const parentId = options.parentId ?? null;
  const destination =
    parentId === null ? document.layers : findLayer(document.layers, parentId)?.children;
  if (!destination) {
    return null;
  }
  if (parentId !== null) {
    const parent = findLayer(document.layers, parentId);
    if (!parent || !isGroup(parent)) {
      return null;
    }
  }
  const group = createGroup(options.name ?? uniqueGroupName(document));
  const layers = insertNodeAt(
    document.layers,
    group,
    parentId,
    options.index ?? destination.length,
  );
  if (!layers || layers === document.layers) {
    return null;
  }
  return { document: { ...document, layers }, group };
}

/**
 * Moves a node to an explicit parent and index.
 *
 * This is the general form of `moveLayerIntoGroup` / `moveLayerOutOfGroup`:
 * the panel needs to say exactly where a drop lands, and a move between two
 * levels must be one operation rather than a move plus a reorder.
 *
 * `index` is counted in the destination's **current** children list, before
 * the node is taken out (the same convention as `splice`). It is clamped, and
 * a node already in that list adjusts the index so "insert before the node
 * that is now at position N" means what it says.
 *
 * The document is returned unchanged for an unknown node, a destination that
 * is not a group, or a move that would make a group its own ancestor. A move
 * that lands the node where it already is also changes nothing.
 */
export function moveLayerToParent(
  document: DrawingDocument,
  layerId: LayerId,
  parentId: LayerId | null,
  index: number,
): DrawingDocument {
  const node = findLayer(document.layers, layerId);
  if (!node) {
    return document;
  }
  if (parentId !== null) {
    if (parentId === layerId) {
      return document;
    }
    const parent = findLayer(document.layers, parentId);
    if (!parent || !isGroup(parent)) {
      return document;
    }
    // The rule that keeps the tree a tree.
    if (isAncestor(document.layers, layerId, parentId)) {
      return document;
    }
  }

  const location = layerLocation(document.layers, layerId);
  if (!location) {
    return document;
  }
  const sameParent = location.parentId === parentId;

  // Take the node out of its current parent first. The destination index is
  // then counted in the destination's current list (the `splice` convention),
  // with the node already gone from its old place.
  const currentParent =
    location.parentId === null ? undefined : findLayer(document.layers, location.parentId);
  const currentSiblings = currentParent ? currentParent.children : document.layers;
  const withoutNodeSiblings = currentSiblings.filter((candidate) => candidate.id !== layerId);
  const withoutNode =
    location.parentId === null
      ? withoutNodeSiblings
      : replaceNode(document.layers, location.parentId, (owner) => ({
          ...owner,
          children: withoutNodeSiblings,
        }));
  if (withoutNode === document.layers) {
    return document;
  }

  const destinationParent =
    parentId === null ? undefined : findLayer(withoutNode, parentId);
  if (parentId !== null && !destinationParent) {
    return document;
  }
  const destinationSiblings = destinationParent ? destinationParent.children : withoutNode;

  let insertAt = Number.isFinite(index) ? Math.trunc(index) : destinationSiblings.length;
  if (sameParent && location.index < insertAt) {
    insertAt -= 1;
  }
  insertAt = clamp(insertAt, 0, destinationSiblings.length);
  if (sameParent && location.index === insertAt) {
    return document;
  }

  const nextSiblings = [...destinationSiblings];
  nextSiblings.splice(insertAt, 0, node);

  const layers =
    parentId === null
      ? nextSiblings
      : replaceNode(withoutNode, parentId, (owner) => ({
          ...owner,
          children: nextSiblings,
        }));
  if (layers === document.layers) {
    return document;
  }
  return { ...document, layers };
}

/**
 * Dissolves a group: its children take its place, in the same order.
 *
 * The children's content is **not** touched - a group owns no content of its
 * own, so the pixels that were inside it stay exactly where they were, on
 * the same layers, in the same painting order. Dissolving is therefore a
 * change of the tree alone.
 *
 * The document is returned unchanged when the id is not a group.
 */
export function dissolveGroup(document: DrawingDocument, groupId: LayerId): DrawingDocument {
  const group = findLayer(document.layers, groupId);
  if (!group || !isGroup(group)) {
    return document;
  }

  const parent = findParent(document.layers, groupId);
  const siblings = parent ? parent.children : document.layers;
  const index = siblings.findIndex((node) => node.id === groupId);
  if (index === -1) {
    return document;
  }

  // The children take the group's place, in the group's own order.
  const nextSiblings = [...siblings];
  nextSiblings.splice(index, 1, ...group.children);

  const layers = parent
    ? replaceNode(document.layers, parent.id, (node) => ({ ...node, children: nextSiblings }))
    : nextSiblings;

  if (layers === document.layers) {
    return document;
  }
  // A group that was the active node cannot stay active once it is gone.
  // Prefer the first paintable layer it held, then any paintable layer.
  const activeLayerId =
    document.activeLayerId === groupId
      ? (paintableLayers(group.children)[0]?.id ?? paintableLayers(layers)[0]?.id ?? null)
      : document.activeLayerId;
  return { ...document, layers, activeLayerId };
}

/**
 * Moves a layer into a group.
 *
 * The layer is appended at the top of the group, so it keeps painting above
 * the group's other children.
 *
 * The move is refused when it would break the tree: a group may not be moved
 * into itself, nor into one of its own descendants - a child cannot be its
 * own ancestor. The document is returned unchanged in that case.
 */
export function moveLayerIntoGroup(
  document: DrawingDocument,
  layerId: LayerId,
  groupId: LayerId,
): DrawingDocument {
  if (layerId === groupId) {
    return document;
  }
  const group = findLayer(document.layers, groupId);
  const layer = findLayer(document.layers, layerId);
  if (!group || !layer || !isGroup(group)) {
    return document;
  }
  // The rule that keeps the tree a tree.
  if (isAncestor(document.layers, layerId, groupId)) {
    return document;
  }

  // Take the layer out of its current place first, then put it in the group.
  const withoutLayer = removeNode(document.layers, layerId);
  const groupAfter = findLayer(withoutLayer, groupId);
  if (!groupAfter) {
    return document;
  }
  const layers = replaceNode(withoutLayer, groupId, (node) => ({
    ...node,
    children: [...node.children, layer],
  }));
  if (layers === document.layers) {
    return document;
  }
  return { ...document, layers };
}

/**
 * Moves a layer out of its group, into the group above it.
 *
 * The group keeps the children it still holds, and the layer joins the group
 * above it **just above the group it left** - the place a layer dragged out
 * of a group lands in. A layer that is not inside a group is returned
 * unchanged.
 */
export function moveLayerOutOfGroup(document: DrawingDocument, layerId: LayerId): DrawingDocument {
  const parent = findParent(document.layers, layerId);
  if (!parent) {
    return document;
  }
  const index = parent.children.findIndex((node) => node.id === layerId);
  if (index === -1) {
    return document;
  }
  const layer = parent.children[index];
  if (!layer) {
    return document;
  }

  const nextChildren = parent.children.filter((node) => node.id !== layerId);
  const withoutLayer = replaceNode(document.layers, parent.id, (node) => ({
    ...node,
    children: nextChildren,
  }));

  const grandparent = findParent(withoutLayer, parent.id);
  if (!grandparent) {
    // The group is at the root: the layer joins the root, just above it.
    const rootIndex = withoutLayer.findIndex((node) => node.id === parent.id);
    if (rootIndex === -1) {
      return document;
    }
    const nextRoot = [...withoutLayer];
    nextRoot.splice(rootIndex + 1, 0, layer);
    return { ...document, layers: nextRoot };
  }

  const siblings = grandparent.children;
  const parentIndex = siblings.findIndex((node) => node.id === parent.id);
  if (parentIndex === -1) {
    return document;
  }
  const nextSiblings = [...siblings];
  nextSiblings.splice(parentIndex + 1, 0, layer);
  const layers = replaceNode(withoutLayer, grandparent.id, (node) => ({
    ...node,
    children: nextSiblings,
  }));
  if (layers === document.layers) {
    return document;
  }
  return { ...document, layers };
}

/** Removes a node (and its subtree) from a list of nodes. */
function removeNode(nodes: readonly Layer[], id: LayerId): readonly Layer[] {
  return mapNodes(nodes, (node) => (node.id === id ? undefined : node));
}

/**
 * Removes a node, and everything it holds, from the tree.
 *
 * The list is returned unchanged when the id is not in it.
 */
export function removeLayerNode(layers: readonly Layer[], id: LayerId): readonly Layer[] {
  return removeNode(layers, id);
}

/**
 * Replaces a node of the tree.
 *
 * `transform` receives the node and returns its replacement, or `undefined`
 * to drop it. The list is returned unchanged when the id is not in it.
 */
export function replaceLayerNode(
  layers: readonly Layer[],
  id: LayerId,
  transform: (node: Layer) => Layer | undefined,
): readonly Layer[] {
  return replaceNode(layers, id, transform);
}

/** One row of the layers tree, ready for the panel to draw. */
export interface LayerTreeRow {
  /** The node this row shows. */
  readonly layer: Layer;
  /** The node that holds it, or `null` at the root. */
  readonly parentId: LayerId | null;
  /** 0 for a node at the root, 1 inside a root group, and so on. */
  readonly depth: number;
  /** True when the node is a group: a container rather than a paintable layer. */
  readonly isGroup: boolean;
  /** True when the node is the document's active layer. */
  readonly active: boolean;
}

/**
 * The rows of the layers tree, ready to render.
 *
 * The rows come out in **document order** (bottom-first) by default, which
 * is the order the model stores. The panel shows the top of the stack at the
 * top, so it asks for `topFirst`: the rows of every level are then reversed,
 * while the hierarchy - a child always follows its group - is kept.
 *
 * `collapsed` hides a group's children without touching the document: the
 * group row is still returned, so it can be expanded again. This is view
 * state; it is deliberately not part of the document or the project file.
 */
export function layerTreeRows(
  layers: readonly Layer[],
  activeLayerId: LayerId | null,
  options: {
    readonly topFirst?: boolean;
    readonly collapsed?: ReadonlySet<LayerId>;
  } = {},
): readonly LayerTreeRow[] {
  const collapsed = options.collapsed ?? new Set<LayerId>();
  const rows: LayerTreeRow[] = [];
  const visit = (nodes: readonly Layer[], depth: number, parentId: LayerId | null): void => {
    for (const node of nodes) {
      rows.push({
        layer: node,
        parentId,
        depth,
        isGroup: isGroup(node),
        active: node.id === activeLayerId,
      });
      if (!collapsed.has(node.id)) {
        visit(node.children, depth + 1, node.id);
      }
    }
  };
  visit(layers, 0, null);
  if (!options.topFirst) {
    return rows;
  }

  // Reverse each level, keeping every child under its own group.
  const topFirst: LayerTreeRow[] = [];
  const visitTop = (nodes: readonly Layer[], depth: number, parentId: LayerId | null): void => {
    for (const node of [...nodes].reverse()) {
      topFirst.push({
        layer: node,
        parentId,
        depth,
        isGroup: isGroup(node),
        active: node.id === activeLayerId,
      });
      if (!collapsed.has(node.id)) {
        visitTop(node.children, depth + 1, node.id);
      }
    }
  };
  visitTop(layers, 0, null);
  return topFirst;
}
