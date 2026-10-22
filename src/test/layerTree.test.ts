/**
 * The layer tree: the folders, the order they hold, and the promise that the
 * panel's order is the painting order.
 *
 * A group is organization, not compositing: it has no pixels and no opacity of
 * its own. What it does say is where a layer sits in the panel - and because
 * the flat layer list is kept in step with the tree, where it sits in the
 * stack as well.
 */

import { describe, expect, it } from "vitest";
import {
  addLayer,
  createDocument,
  moveLayer,
  moveLayerIntoGroup,
  removeLayer,
} from "../core/document/document";
import {
  createLayerGroup,
  findLayerGroup,
  isLayerGroupDescendant,
  isLayerTreeConsistent,
  layerGroupOfLayer,
  layerTreeFromLayers,
  layerTreeLayerIds,
  layerTreeRows,
  moveLayerGroup,
  moveLayerToGroup,
  removeLayerGroup,
  renameLayerGroup,
  setLayerGroupCollapsed,
  syncLayersToTree,
} from "../core/document/layerTree";
import type { DrawingDocument } from "../core/document/types";

/** Adds a folder to a document, the way the engine does. */
function withGroup(
  document: DrawingDocument,
  name: string,
  parentId: string | null = null,
): { readonly document: DrawingDocument; readonly groupId: string } {
  const created = createLayerGroup(document.layerTree, { name, parentId });
  return {
    document: { ...document, layerTree: created.tree },
    groupId: created.id,
  };
}

/** The layer ids of the flat list, in painting order. */
function flatIds(document: DrawingDocument): string[] {
  return document.layers.map((layer) => layer.id);
}

/** A document with three layers: bottom, middle, top. */
function threeLayers(): DrawingDocument {
  const document = createDocument({ width: 100, height: 100 });
  const withTwo = addLayer(document);
  return addLayer(withTwo);
}

describe("the layer tree", () => {
  it("starts flat: no folders, every layer at the root", () => {
    const document = createDocument({ width: 100, height: 100 });

    expect(document.layerTree.groups).toHaveLength(0);
    expect(document.layerTree.root).toEqual([
      { kind: "layer", id: document.layers[0].id },
    ]);
    expect(layerTreeLayerIds(document.layerTree)).toEqual([document.layers[0].id]);
    expect(isLayerTreeConsistent(document.layerTree, document.layers)).toBe(true);
  });

  it("holds a layer in a group, and the group's members stay together in the stack", () => {
    const document = threeLayers();
    const [bottom, middle, top] = document.layers;

    const { document: withFolder, groupId } = withGroup(document, "Ink");
    const moved = moveLayerIntoGroup(withFolder, middle.id, groupId);

    // The group is a slot in the stack: the layer it holds is drawn there, so
    // the panel order and the painting order are the same order.
    expect(layerTreeLayerIds(moved.layerTree)).toEqual([bottom.id, top.id, middle.id]);
    expect(flatIds(moved)).toEqual([bottom.id, top.id, middle.id]);
    expect(layerGroupOfLayer(moved.layerTree, middle.id)).toBe(groupId);
    expect(layerGroupOfLayer(moved.layerTree, bottom.id)).toBeNull();
    expect(isLayerTreeConsistent(moved.layerTree, moved.layers)).toBe(true);
  });

  it("keeps the other layers in place when one layer moves into a group", () => {
    const document = threeLayers();
    const [bottom, middle, top] = document.layers;

    const { document: withFolder, groupId } = withGroup(document, "Ink");
    const moved = moveLayerIntoGroup(withFolder, bottom.id, groupId);

    // The two layers that did not move keep their order relative to each other.
    const others = flatIds(moved).filter((id) => id !== bottom.id);
    expect(others).toEqual([middle.id, top.id]);
  });

  it("nests a group inside a group", () => {
    const document = threeLayers();
    const [bottom, middle, top] = document.layers;

    const outer = withGroup(document, "Artwork");
    const inner = withGroup(outer.document, "Ink", outer.groupId);
    const moved = moveLayerIntoGroup(inner.document, middle.id, inner.groupId);

    expect(layerGroupOfLayer(moved.layerTree, middle.id)).toBe(inner.groupId);
    expect(isLayerGroupDescendant(moved.layerTree, outer.groupId, inner.groupId)).toBe(true);
    expect(isLayerGroupDescendant(moved.layerTree, inner.groupId, outer.groupId)).toBe(false);
    // The nested group holds the layer, and the outer group holds the inner one.
    expect(layerTreeLayerIds(moved.layerTree)).toEqual([bottom.id, top.id, middle.id]);
    expect(isLayerTreeConsistent(moved.layerTree, moved.layers)).toBe(true);
  });

  it("holds an empty group, which changes nothing about the drawing", () => {
    const document = threeLayers();
    const { document: withFolder, groupId } = withGroup(document, "Empty");

    expect(withFolder.layerTree.groups).toHaveLength(1);
    expect(findLayerGroup(withFolder.layerTree, groupId)?.children).toEqual([]);
    expect(flatIds(withFolder)).toEqual(flatIds(document));
  });

  it("renames a group without touching anything else", () => {
    const document = threeLayers();
    const { document: withFolder, groupId } = withGroup(document, "Ink");

    const renamed = renameLayerGroup(withFolder.layerTree, groupId, "  Colour  ");

    expect(findLayerGroup(renamed, groupId)?.name).toBe("Colour");
    // An empty name is refused rather than leaving a nameless folder behind.
    expect(renameLayerGroup(renamed, groupId, "   ")).toBe(renamed);
  });

  it("folds a group away without moving a single layer", () => {
    const document = threeLayers();
    const [bottom, middle, top] = document.layers;
    const { document: withFolder, groupId } = withGroup(document, "Ink");
    const moved = moveLayerIntoGroup(withFolder, middle.id, groupId);

    const collapsed = setLayerGroupCollapsed(moved.layerTree, groupId, true);

    expect(findLayerGroup(collapsed, groupId)?.collapsed).toBe(true);
    // The fold is display-only: the drawing is exactly the drawing it was.
    expect(layerTreeLayerIds(collapsed)).toEqual([bottom.id, top.id, middle.id]);
  });

  it("moves a group among its siblings", () => {
    const document = threeLayers();
    const first = withGroup(document, "First");
    const second = withGroup(first.document, "Second");

    const moved = moveLayerGroup(second.document.layerTree, second.groupId, -1);

    const groupIds = moved.root
      .filter((entry) => entry.kind === "group")
      .map((entry) => (entry.kind === "group" ? entry.id : ""));
    expect(groupIds).toEqual([second.groupId, first.groupId]);
    // Moving a group moves the slot it holds, so the layers under it move too.
    expect(layerTreeLayerIds(moved)).toEqual(flatIds(document));
  });

  it("keeps the layers of a removed group, in order", () => {
    const document = threeLayers();
    const [bottom, middle, top] = document.layers;
    const { document: withFolder, groupId } = withGroup(document, "Ink");
    const moved = moveLayerIntoGroup(withFolder, middle.id, groupId);

    const without = removeLayerGroup(moved.layerTree, groupId);

    expect(without.groups).toHaveLength(0);
    // The layer that was in the group is still there, and nothing was lost.
    const kept = syncLayersToTree(without, moved.layers).map((layer) => layer.id);
    expect(kept).toEqual(expect.arrayContaining([bottom.id, middle.id, top.id]));
    expect(layerTreeLayerIds(without)).toContain(middle.id);
  });

  it("takes a layer out of a group and back to the top level", () => {
    const document = threeLayers();
    const [bottom, middle, top] = document.layers;
    const { document: withFolder, groupId } = withGroup(document, "Ink");
    const moved = moveLayerIntoGroup(withFolder, middle.id, groupId);

    const out = moveLayerToGroup(moved.layerTree, middle.id, null);

    expect(layerGroupOfLayer(out, middle.id)).toBeNull();
    expect(layerTreeLayerIds(out)).toEqual([bottom.id, top.id, middle.id]);
  });

  it("keeps a layer where it was when it leaves a group", () => {
    const document = threeLayers();
    const [, middle] = document.layers;
    const { document: withFolder, groupId } = withGroup(document, "Ink");
    const moved = moveLayerIntoGroup(withFolder, middle.id, groupId);
    const before = layerTreeLayerIds(moved.layerTree);

    const out = moveLayerToGroup(moved.layerTree, middle.id, null);

    // The layer comes out just below the slot its group held, so it keeps the
    // place it had in the stack instead of jumping to the top.
    expect(layerTreeLayerIds(out)).toEqual(before);
  });

  it("removes a layer from the tree when the layer goes", () => {
    const document = threeLayers();
    const [bottom, middle, top] = document.layers;
    const { document: withFolder, groupId } = withGroup(document, "Ink");
    const moved = moveLayerIntoGroup(withFolder, middle.id, groupId);

    const without = removeLayer(moved, middle.id);

    expect(layerTreeLayerIds(without.layerTree)).toEqual([bottom.id, top.id]);
    expect(isLayerTreeConsistent(without.layerTree, without.layers)).toBe(true);
  });

  it("shows the panel's rows top-first, and a folded group hides its children", () => {
    const document = threeLayers();
    const [bottom, middle, top] = document.layers;
    const { document: withFolder, groupId } = withGroup(document, "Ink");
    const moved = moveLayerIntoGroup(withFolder, middle.id, groupId);

    const rows = layerTreeRows(moved.layerTree, moved.layers);

    // The group's slot is the top of the stack, so its header comes first and
    // the layer it holds sits right under it.
    expect(rows.map((row) => row.id)).toEqual([groupId, middle.id, top.id, bottom.id]);
    expect(rows[0]).toMatchObject({ kind: "group", depth: 0, collapsed: false });
    expect(rows[1]).toMatchObject({ kind: "layer", depth: 1 });
    expect(rows[1].layer?.id).toBe(middle.id);
    expect(rows[2]).toMatchObject({ kind: "layer", depth: 0 });

    const collapsed = setLayerGroupCollapsed(moved.layerTree, groupId, true);
    const collapsedRows = layerTreeRows(collapsed, moved.layers);
    expect(collapsedRows.map((row) => row.id)).toEqual([groupId, top.id, bottom.id]);
  });

  it("reads a tree that does not match the layers as inconsistent", () => {
    const document = threeLayers();
    const { document: withFolder, groupId } = withGroup(document, "Ink");

    expect(isLayerTreeConsistent(withFolder.layerTree, withFolder.layers)).toBe(true);
    // A tree that lost a layer is not consistent with the list.
    const broken = {
      ...withFolder.layerTree,
      root: withFolder.layerTree.root.slice(0, 1),
    };
    expect(isLayerTreeConsistent(broken, withFolder.layers)).toBe(false);
    expect(groupId).not.toBe("");
  });

  it("builds a flat tree from a list of layers", () => {
    const document = threeLayers();
    const tree = layerTreeFromLayers(document.layers);

    expect(tree.groups).toHaveLength(0);
    expect(layerTreeLayerIds(tree)).toEqual(flatIds(document));
  });
});

describe("the layer tree under a run of changes", () => {
  /**
   * A tiny deterministic generator, so the run below is the same every time
   * and a failure can be reproduced.
   */
  function makeRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  it("keeps the tree and the layer list in step through any run of changes", () => {
    const random = makeRandom(20261022);
    let document = threeLayers();
    const knownGroups = new Set<string>();

    for (let step = 0; step < 200; step += 1) {
      const roll = random();
      const layerId =
        document.layers[Math.floor(random() * document.layers.length)]?.id ?? "";
      const groupIds = [...knownGroups];
      const groupId = groupIds[Math.floor(random() * groupIds.length)] ?? "";

      if (roll < 0.25) {
        // Make a group, sometimes inside another one.
        const parent = random() < 0.5 ? null : groupId || null;
        const created = createLayerGroup(document.layerTree, { parentId: parent });
        if (created.id !== "") {
          knownGroups.add(created.id);
          document = { ...document, layerTree: created.tree };
        }
      } else if (roll < 0.5 && layerId !== "") {
        // Move a layer into a group, or out of every group.
        const target = random() < 0.6 ? groupId || null : null;
        document = moveLayerIntoGroup(document, layerId, target);
      } else if (roll < 0.7 && groupId !== "") {
        // Rename, fold or reorder a group.
        const tree =
          random() < 0.5
            ? renameLayerGroup(document.layerTree, groupId, `Group ${step}`)
            : setLayerGroupCollapsed(document.layerTree, groupId, random() < 0.5);
        document = { ...document, layerTree: tree };
      } else if (roll < 0.85 && groupId !== "") {
        // Remove a group; its layers move up into the group that held it.
        const tree = removeLayerGroup(document.layerTree, groupId);
        knownGroups.delete(groupId);
        document = { ...document, layerTree: tree };
      } else if (layerId !== "") {
        // Reorder a layer among its siblings.
        document = moveLayer(document, layerId, random() < 0.5 ? 1 : -1);
      }

      // The invariant after every single change: the tree describes exactly
      // the layers the document has, in the order they are painted, and no
      // layer is lost or duplicated.
      const ids = layerTreeLayerIds(document.layerTree);
      expect(ids).toEqual(flatIds(document));
      expect(new Set(ids).size).toBe(ids.length);
      expect(isLayerTreeConsistent(document.layerTree, document.layers)).toBe(true);
      expect(document.layers).toHaveLength(3);
    }
  });
});
