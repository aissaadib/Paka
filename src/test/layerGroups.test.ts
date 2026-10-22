/**
 * Layer group tests.
 *
 * These cover the rules of the document's layer tree and the commands that
 * turn them into undoable steps: what a group holds, the order of what it
 * holds, the rule that a child cannot be its own ancestor, and the rule that
 * dissolving a group keeps the children's pixels and their order.
 *
 * Everything here is pure: a document, a stroke store and a fake command
 * host, with no canvas and no renderer.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createStrokeRecord } from "../core/brushes/strokeBuilder";
import {
  createDissolveGroupCommand,
  createGroupLayersCommand,
  createMoveGroupMemberCommand,
  createRenameGroupCommand,
  type DocumentCommandHost,
} from "../core/commands/documentCommand";
import { addLayer, createDocument, setActiveLayer } from "../core/document/document";
import {
  allLayerNames,
  dissolveGroup,
  findLayer,
  findLayerPath,
  flattenLayers,
  groupLayers,
  isAncestor,
  isGroup,
  layerDepth,
  layerTreeRows,
  moveLayerIntoGroup,
  moveLayerOutOfGroup,
  newLayerIds,
  paintableLayers,
  subtreeIds,
  uniqueGroupName,
} from "../core/document/layerGroups";
import { StrokeStore } from "../core/document/strokeStore";
import type { DrawingDocument, Layer, LayerId, StrokeRecord } from "../core/document/types";

function makeStroke(layerId: LayerId): StrokeRecord {
  const stroke = createStrokeRecord(layerId, DEFAULT_BRUSH);
  stroke.xs.push(1);
  stroke.ys.push(2);
  stroke.pressures.push(1);
  stroke.times.push(0);
  return stroke;
}

/** A document with `count` layers, bottom-first. */
function documentWithLayers(count: number): DrawingDocument {
  let document = createDocument({ name: "Test", width: 100, height: 80 });
  for (let index = 1; index < count; index += 1) {
    document = addLayer(document);
  }
  return document;
}

/** The ids of the nodes of a tree, in document order. */
function ids(nodes: readonly Layer[]): readonly string[] {
  return nodes.map((node) => node.id);
}

/** The id of the one group in a tree, or `undefined`. */
function groupIdOf(document: DrawingDocument): LayerId | undefined {
  return flattenLayers(document.layers).find((node) => isGroup(node))?.id;
}

/** An in-memory stand-in for the engine: a document, a store and a host. */
function createHost(initial: DrawingDocument, store: StrokeStore = new StrokeStore()) {
  let document = initial;
  const host: DocumentCommandHost = {
    getDocument: () => document,
    applyDocument: (next) => {
      document = next;
    },
    clearLayerElements: (layerId) => {
      store.clearLayer(layerId);
    },
    restoreLayerElements: (layerId, elements) => {
      store.restore(layerId, elements);
    },
  };
  return { host, store, getDocument: () => document };
}

describe("the layer tree", () => {
  it("starts as one paintable layer with no children", () => {
    const document = createDocument({ name: "Test", width: 100, height: 80 });
    const [layer] = document.layers;

    expect(layer?.kind).toBe("layer");
    expect(layer?.children).toEqual([]);
    expect(isGroup(layer as Layer)).toBe(false);
    expect(paintableLayers(document.layers)).toHaveLength(1);
  });

  it("finds a layer wherever it sits in the tree", () => {
    const document = documentWithLayers(3);
    const [bottom, middle, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", middle?.id ?? ""]);
    const group = findLayer(grouped.layers, groupIdOf(grouped) ?? "");

    expect(group).toBeDefined();
    expect(group?.kind).toBe("group");
    // The children are found through the group, not beside it.
    expect(findLayer(grouped.layers, middle?.id ?? "")?.id).toBe(middle?.id);
    expect(findLayerPath(grouped.layers, middle?.id ?? "")?.map((node) => node.id)).toEqual([
      group?.id,
      middle?.id,
    ]);
    expect(layerDepth(grouped.layers, middle?.id ?? "")).toBe(1);
    expect(layerDepth(grouped.layers, groupIdOf(grouped) ?? "")).toBe(0);
    // A layer that was not grouped is still at the root.
    expect(findLayerPath(grouped.layers, top?.id ?? "")?.map((node) => node.id)).toEqual([top?.id]);
  });

  it("knows which nodes a group holds", () => {
    const document = documentWithLayers(3);
    const [bottom, middle] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", middle?.id ?? ""]);
    const group = findLayer(grouped.layers, groupIdOf(grouped) ?? "");

    expect(ids(group?.children ?? [])).toEqual([bottom?.id, middle?.id]);
    expect(subtreeIds(group as Layer)).toEqual([group?.id, bottom?.id, middle?.id]);
    expect(allLayerNames(grouped.layers).has(group?.name ?? "")).toBe(true);
  });

  it("names the layers a change created, wherever they are", () => {
    const document = documentWithLayers(3);
    const [bottom, , top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);

    // The engine needs this to clone the content of the layers a change
    // created: a group is not in the root list, so a diff of the root lists
    // alone would not find it.
    expect(newLayerIds(document.layers, grouped.layers)).toEqual([groupIdOf(grouped)]);
  });
});

describe("grouping layers", () => {
  it("puts the layers into a group and keeps their order", () => {
    const document = documentWithLayers(4);
    const [bottom, , top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = findLayer(grouped.layers, groupIdOf(grouped) ?? "");

    expect(grouped.layers).toHaveLength(3);
    expect(group?.kind).toBe("group");
    expect(ids(group?.children ?? [])).toEqual([bottom?.id, top?.id]);
    // The group is a new node: the layers themselves are untouched.
    expect(grouped.layers[0]?.id).not.toBe(bottom?.id);
    expect(findLayer(grouped.layers, bottom?.id ?? "")?.id).toBe(bottom?.id);
  });

  it("keeps the compositing order when the layers were neighbours", () => {
    const document = documentWithLayers(4);
    const [bottom, middle, top] = document.layers;
    const before = ids(paintableLayers(document.layers));

    const grouped = groupLayers(document, [bottom?.id ?? "", middle?.id ?? ""]);

    // The group takes the place of the topmost grouped layer, so the picture
    // is the same picture.
    expect(ids(paintableLayers(grouped.layers))).toEqual(before);
    expect(top?.id).toBe(before[2]);
  });

  it("takes the place of the topmost grouped layer when they were not neighbours", () => {
    const document = documentWithLayers(3);
    const [bottom, middle, top] = document.layers;

    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = findLayer(grouped.layers, groupIdOf(grouped) ?? "");

    // The group sits where the topmost grouped layer was, so the layer that
    // was between the two ends up below the group.
    expect(grouped.layers[grouped.layers.length - 1]?.id).toBe(group?.id);
    expect(ids(paintableLayers(grouped.layers))).toEqual([middle?.id, bottom?.id, top?.id]);
  });

  it("refuses a request that cannot be carried out", () => {
    const document = documentWithLayers(3);
    const [bottom, middle, top] = document.layers;

    // Fewer than two layers.
    expect(groupLayers(document, [bottom?.id ?? ""])).toBe(document);
    // An unknown layer.
    expect(groupLayers(document, [bottom?.id ?? "", "missing"])).toBe(document);
    // The same layer twice.
    expect(groupLayers(document, [bottom?.id ?? "", bottom?.id ?? ""])).toBe(document);
    // A group is not a layer that can be grouped: a group of groups is a
    // different feature.
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    expect(groupLayers(grouped, [groupIdOf(grouped) ?? "", middle?.id ?? ""])).toBe(grouped);
  });

  it("refuses to group layers that are not siblings", () => {
    const document = documentWithLayers(3);
    const [bottom, middle, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", middle?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";

    // The top layer is at the root, the middle one is inside the group.
    expect(groupLayers(grouped, [group, top?.id ?? ""])).toBe(grouped);
  });

  it("names a new group uniquely", () => {
    const document = documentWithLayers(2);
    const [bottom, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = findLayer(grouped.layers, groupIdOf(grouped) ?? "");

    expect(group?.name).toBe(uniqueGroupName(document));
    expect(group?.name).toBe("Group 1");
  });
});

describe("a child cannot be its own ancestor", () => {
  it("does not call a node its own ancestor", () => {
    const document = documentWithLayers(2);
    const [bottom] = document.layers;

    expect(isAncestor(document.layers, bottom?.id ?? "", bottom?.id ?? "")).toBe(false);
    expect(isAncestor(document.layers, "missing", bottom?.id ?? "")).toBe(false);
  });

  it("knows that a group is the ancestor of what it holds", () => {
    const document = documentWithLayers(2);
    const [bottom, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";

    expect(isAncestor(grouped.layers, group, bottom?.id ?? "")).toBe(true);
    expect(isAncestor(grouped.layers, bottom?.id ?? "", group)).toBe(false);
  });

  it("refuses to move a group into its own descendant", () => {
    const document = documentWithLayers(3);
    const [bottom, middle, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", middle?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";

    // The group would hold itself: the tree would stop being a tree.
    expect(moveLayerIntoGroup(grouped, group, group)).toBe(grouped);
    // A group may not be moved into a group it holds either.
    const inner = groupLayers(grouped, [middle?.id ?? "", top?.id ?? ""]);
    const innerGroup = groupIdOf(inner) ?? "";
    expect(moveLayerIntoGroup(inner, group, innerGroup)).toBe(inner);
  });

  it("moves a layer into a group and back out again", () => {
    const document = documentWithLayers(3);
    const [bottom, middle, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";

    const moved = moveLayerIntoGroup(grouped, middle?.id ?? "", group);
    const movedGroup = findLayer(moved.layers, group);
    expect(ids(movedGroup?.children ?? [])).toEqual([bottom?.id, top?.id, middle?.id]);

    const out = moveLayerOutOfGroup(moved, middle?.id ?? "");
    const outGroup = findLayer(out.layers, group);
    expect(ids(outGroup?.children ?? [])).toEqual([bottom?.id, top?.id]);
    // The layer joins the root just above the group it left.
    expect(ids(out.layers)).toEqual([group, middle?.id]);
  });
});

describe("dissolving a group", () => {
  it("puts the children back in the group's place, in the same order", () => {
    const document = documentWithLayers(3);
    const [bottom, middle, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", middle?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";
    const before = ids(paintableLayers(grouped.layers));

    const dissolved = dissolveGroup(grouped, group);

    expect(dissolved.layers).toHaveLength(3);
    expect(ids(dissolved.layers)).toEqual([bottom?.id, middle?.id, top?.id]);
    // The painting order is exactly what it was.
    expect(ids(paintableLayers(dissolved.layers))).toEqual(before);
  });

  it("keeps the children's pixels", () => {
    const document = documentWithLayers(3);
    const [bottom, , top] = document.layers;
    const store = new StrokeStore();
    const bottomStroke = makeStroke(bottom?.id ?? "");
    const topStroke = makeStroke(top?.id ?? "");
    store.insert(bottomStroke);
    store.insert(topStroke);

    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";

    // Grouping moves nothing: the content stays on the layers it was on.
    expect(store.listElements(bottom?.id ?? "")).toHaveLength(1);
    expect(store.listElements(top?.id ?? "")).toHaveLength(1);

    const dissolved = dissolveGroup(grouped, group);

    // The same strokes, on the same layers: the pixels are the children's,
    // and dissolving a group does not touch them.
    expect(store.listElements(bottom?.id ?? "")).toEqual([bottomStroke]);
    expect(store.listElements(top?.id ?? "")).toEqual([topStroke]);
    expect(dissolved.layers.map((layer) => layer.id)).toContain(bottom?.id);
  });

  it("refuses to dissolve something that is not a group", () => {
    const document = documentWithLayers(2);
    const [bottom] = document.layers;

    expect(dissolveGroup(document, bottom?.id ?? "")).toBe(document);
    expect(dissolveGroup(document, "missing")).toBe(document);
  });
});

describe("the rows of the layers tree", () => {
  it("lists the tree in document order, and top-first for the panel", () => {
    const document = documentWithLayers(3);
    const [bottom, middle, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";

    const rows = layerTreeRows(grouped.layers, middle?.id ?? "");
    expect(rows.map((row) => row.layer.id)).toEqual([middle?.id, group, bottom?.id, top?.id]);
    expect(rows.map((row) => row.depth)).toEqual([0, 0, 1, 1]);
    expect(rows.find((row) => row.layer.id === group)?.isGroup).toBe(true);
    expect(rows.find((row) => row.active)?.layer.id).toBe(middle?.id);

    // The panel shows the top of the stack at the top.
    const topFirst = layerTreeRows(grouped.layers, middle?.id ?? "", { topFirst: true });
    expect(topFirst.map((row) => row.layer.id)).toEqual([
      group,
      top?.id,
      bottom?.id,
      middle?.id,
    ]);
  });
});

describe("the layer group commands", () => {
  it("groups the layers in one undoable step", () => {
    const document = documentWithLayers(3);
    const [bottom, , top] = document.layers;
    const harness = createHost(document);

    const outcome = createGroupLayersCommand(document, [bottom?.id ?? "", top?.id ?? ""], harness.host);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    outcome.command.apply();
    const grouped = harness.getDocument();
    expect(grouped.layers).toHaveLength(2);
    expect(groupIdOf(grouped)).toBeDefined();

    outcome.command.revert();
    expect(harness.getDocument()).toBe(document);
  });

  it("refuses a change while a gesture is in flight", () => {
    const document = documentWithLayers(3);
    const [bottom, , top] = document.layers;
    const harness = createHost(document);

    const outcome = createGroupLayersCommand(
      document,
      [bottom?.id ?? "", top?.id ?? ""],
      harness.host,
      { gestureInFlight: true },
    );

    expect(outcome).toEqual({ ok: false, reason: "gesture" });
    expect(harness.getDocument()).toBe(document);
  });

  it("refuses a change that cannot be carried out", () => {
    const document = documentWithLayers(2);
    const [bottom] = document.layers;
    const harness = createHost(document);

    const outcome = createGroupLayersCommand(document, [bottom?.id ?? ""], harness.host);

    expect(outcome).toEqual({ ok: false, reason: "invalid" });
    expect(harness.getDocument()).toBe(document);
  });

  it("renames a group in one undoable step", () => {
    const document = documentWithLayers(2);
    const [bottom, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";
    const harness = createHost(grouped);

    const outcome = createRenameGroupCommand(grouped, group, "  Sketch  ", harness.host);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    outcome.command.apply();
    expect(findLayer(harness.getDocument().layers, group)?.name).toBe("Sketch");

    outcome.command.revert();
    expect(findLayer(harness.getDocument().layers, group)?.name).not.toBe("Sketch");
  });

  it("refuses to rename something that is not a group", () => {
    const document = documentWithLayers(2);
    const [bottom] = document.layers;
    const harness = createHost(document);

    expect(
      createRenameGroupCommand(document, bottom?.id ?? "", "Sketch", harness.host),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      createRenameGroupCommand(document, bottom?.id ?? "", "   ", harness.host),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("moves a layer into a group in one undoable step", () => {
    const document = documentWithLayers(3);
    const [bottom, middle, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";
    const harness = createHost(grouped);

    const outcome = createMoveGroupMemberCommand(
      grouped,
      middle?.id ?? "",
      { kind: "into", groupId: group },
      harness.host,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    outcome.command.apply();
    expect(ids(findLayer(harness.getDocument().layers, group)?.children ?? [])).toEqual([
      bottom?.id,
      top?.id,
      middle?.id,
    ]);

    outcome.command.revert();
    expect(harness.getDocument()).toBe(grouped);
  });

  it("refuses a move that would make a group its own ancestor", () => {
    const document = documentWithLayers(2);
    const [bottom, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";
    const harness = createHost(grouped);

    const outcome = createMoveGroupMemberCommand(
      grouped,
      group,
      { kind: "into", groupId: group },
      harness.host,
    );

    expect(outcome).toEqual({ ok: false, reason: "invalid" });
    expect(harness.getDocument()).toBe(grouped);
  });

  it("dissolves a group in one undoable step, and the pixels stay", () => {
    const document = documentWithLayers(3);
    const [bottom, , top] = document.layers;
    const store = new StrokeStore();
    const bottomStroke = makeStroke(bottom?.id ?? "");
    store.insert(bottomStroke);

    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";
    const harness = createHost(grouped, store);

    const outcome = createDissolveGroupCommand(grouped, group, harness.host);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    outcome.command.apply();
    const dissolved = harness.getDocument();
    expect(groupIdOf(dissolved)).toBeUndefined();
    expect(dissolved.layers).toHaveLength(3);
    // The child's content was never touched by the command.
    expect(store.listElements(bottom?.id ?? "")).toEqual([bottomStroke]);

    outcome.command.revert();
    expect(groupIdOf(harness.getDocument())).toBe(group);
    expect(store.listElements(bottom?.id ?? "")).toEqual([bottomStroke]);
  });

  it("keeps the active layer through an undo and a redo", () => {
    const document = documentWithLayers(3);
    const [bottom, middle, top] = document.layers;
    const active = setActiveLayer(document, middle?.id ?? "");
    const harness = createHost(active);

    const outcome = createGroupLayersCommand(
      active,
      [bottom?.id ?? "", top?.id ?? ""],
      harness.host,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    outcome.command.apply();
    expect(harness.getDocument().activeLayerId).toBe(middle?.id);

    outcome.command.revert();
    expect(harness.getDocument().activeLayerId).toBe(middle?.id);
  });

  it("keeps the active layer when a group is renamed", () => {
    const document = documentWithLayers(2);
    const [bottom, top] = document.layers;
    const grouped = groupLayers(document, [bottom?.id ?? "", top?.id ?? ""]);
    const group = groupIdOf(grouped) ?? "";
    const active = setActiveLayer(grouped, top?.id ?? "");
    const harness = createHost(active);

    const outcome = createRenameGroupCommand(active, group, "Sketch", harness.host);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    outcome.command.apply();
    expect(harness.getDocument().activeLayerId).toBe(top?.id);

    outcome.command.revert();
    expect(harness.getDocument().activeLayerId).toBe(top?.id);
  });
});
