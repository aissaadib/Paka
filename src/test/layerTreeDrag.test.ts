/**
 * Where a drag in the layers tree lands.
 *
 * The panel's drop marker has to agree with the move the engine performs, down
 * to the insertion index, and a group may never be dropped inside itself. Both
 * rules are pure, so they are pinned here rather than in the React layer.
 */

import { describe, expect, it } from "vitest";
import { addLayer, createDocument, updateLayer } from "../core/document/document";
import {
  addGroup,
  findLayer,
  groupLayers,
  layerLocation,
  moveLayerToParent,
} from "../core/document/layerGroups";
import {
  layerDropPosition,
  movableParentGroups,
  resolveLayerDrop,
} from "../core/document/layerTreeDrag";
import type { DrawingDocument, LayerId } from "../core/document/types";

/** Three sibling layers, bottom-first in the document. */
function threeLayers(): DrawingDocument {
  return addLayer(addLayer(createDocument({ name: "Test", width: 100, height: 80 })));
}

/**
 * Two layers grouped, plus a third that stays at the root:
 * root `[outer, top]`, outer children `[bottom, middle]`.
 */
function grouped(): {
  readonly document: DrawingDocument;
  readonly outer: LayerId;
  readonly bottom: LayerId;
  readonly middle: LayerId;
  readonly top: LayerId;
} {
  const document = threeLayers();
  const [bottom, middle, top] = document.layers;
  const groupedDocument = groupLayers(document, [bottom?.id ?? "", middle?.id ?? ""]);
  const outer = groupedDocument.layers.find((node) => node.kind === "group");
  if (!outer || !bottom || !middle || !top) {
    throw new Error("the fixture was not built");
  }
  return {
    document: groupedDocument,
    outer: outer.id,
    bottom: bottom.id,
    middle: middle.id,
    top: top.id,
  };
}

/** A group inside the grouped fixture, then `top` moved into it. */
function nested(): {
  readonly document: DrawingDocument;
  readonly outer: LayerId;
  readonly inner: LayerId;
  readonly bottom: LayerId;
  readonly middle: LayerId;
  readonly top: LayerId;
} {
  const base = grouped();
  const inner = addGroup(base.document, { parentId: base.outer });
  if (!inner) {
    throw new Error("the inner group was not created");
  }
  const document = moveLayerToParent(inner.document, base.top, inner.group.id, 0);
  return {
    document,
    outer: base.outer,
    inner: inner.group.id,
    bottom: base.bottom,
    middle: base.middle,
    top: base.top,
  };
}

describe("layerDropPosition", () => {
  it("offers a group its middle band for dropping inside", () => {
    expect(layerDropPosition(0, 0, 100, true)).toBe("above");
    expect(layerDropPosition(50, 0, 100, true)).toBe("into");
    expect(layerDropPosition(100, 0, 100, true)).toBe("below");
  });

  it("splits a layer row in half, because dropping onto it is ambiguous", () => {
    expect(layerDropPosition(0, 0, 100, false)).toBe("above");
    expect(layerDropPosition(49, 0, 100, false)).toBe("above");
    expect(layerDropPosition(50, 0, 100, false)).toBe("below");
    expect(layerDropPosition(99, 0, 100, false)).toBe("below");
  });

  it("still answers for a zero-height row", () => {
    expect(layerDropPosition(0, 0, 0, true)).toBe("into");
    expect(layerDropPosition(0, 0, 0, false)).toBe("below");
  });
});

describe("resolveLayerDrop", () => {
  it("appends a layer to the top of a group when dropped into it", () => {
    const fixture = grouped();
    const target = resolveLayerDrop(fixture.document.layers, fixture.top, fixture.outer, "into");

    expect(target).not.toBeNull();
    expect(target?.parentId).toBe(fixture.outer);
    expect(target?.index).toBe(2);
    expect(target?.changes).toBe(true);

    // The panel hands this straight to the engine; the result is the top child.
    const moved = moveLayerToParent(
      fixture.document,
      fixture.top,
      target?.parentId ?? null,
      target?.index ?? 0,
    );
    expect(findLayer(moved.layers, fixture.outer)?.children.map((node) => node.id)).toEqual([
      fixture.bottom,
      fixture.middle,
      fixture.top,
    ]);
  });

  it("resolves an above drop to the next stack position in the same parent", () => {
    const fixture = grouped();
    // `top` already sits directly above the group row, so dropping it above
    // the group would not move anything. The destination is still the root.
    const target = resolveLayerDrop(fixture.document.layers, fixture.top, fixture.outer, "above");

    expect(target).toEqual({
      parentId: null,
      index: (layerLocation(fixture.document.layers, fixture.outer)?.index ?? 0) + 1,
      changes: false,
    });
  });

  it("resolves a below drop to the index of the target", () => {
    const fixture = threeLayers();
    const [bottom, middle, top] = fixture.layers;
    if (!bottom || !middle || !top) {
      throw new Error("the fixture was not built");
    }

    const target = resolveLayerDrop(fixture.layers, top.id, bottom.id, "below");
    expect(target).toEqual({ parentId: null, index: 0, changes: true });

    const moved = moveLayerToParent(fixture, top.id, null, target?.index ?? 0);
    expect(moved.layers.map((node) => node.id)).toEqual([top.id, bottom.id, middle.id]);
  });

  it("reports no change when a row is dropped where it already is", () => {
    const fixture = threeLayers();
    const [bottom, middle, top] = fixture.layers;
    if (!bottom || !middle || !top) {
      throw new Error("the fixture was not built");
    }

    expect(resolveLayerDrop(fixture.layers, top.id, middle.id, "above")?.changes).toBe(false);
    expect(resolveLayerDrop(fixture.layers, bottom.id, middle.id, "below")?.changes).toBe(false);
    expect(resolveLayerDrop(fixture.layers, top.id, top.id, "above")).toBeNull();
  });

  it("refuses to drop a group inside itself", () => {
    const fixture = nested();
    expect(resolveLayerDrop(fixture.document.layers, fixture.outer, fixture.inner, "into")).toBeNull();
    expect(
      resolveLayerDrop(fixture.document.layers, fixture.outer, fixture.top, "above"),
    ).toBeNull();
    expect(
      resolveLayerDrop(fixture.document.layers, fixture.outer, fixture.inner, "below"),
    ).toBeNull();
  });

  it("refuses a paintable destination for an into drop", () => {
    const fixture = grouped();
    expect(
      resolveLayerDrop(fixture.document.layers, fixture.top, fixture.middle, "into"),
    ).toBeNull();
  });

  it("allows a nested layer to be dropped above a root row", () => {
    const fixture = grouped();
    const group = findLayer(fixture.document.layers, fixture.outer);
    if (!group) {
      throw new Error("the group was not found");
    }
    // bottom is inside the group; the target is the root row above it.
    const target = resolveLayerDrop(fixture.document.layers, fixture.bottom, fixture.top, "above");
    expect(target?.parentId).toBeNull();
    expect(target?.changes).toBe(true);
  });
});

describe("movableParentGroups", () => {
  it("offers every group except the node itself and its descendants", () => {
    const fixture = nested();
    const forTop = movableParentGroups(fixture.document.layers, fixture.top).map((node) => node.id);
    expect(forTop).toContain(fixture.outer);
    expect(forTop).toContain(fixture.inner);

    const forOuter = movableParentGroups(fixture.document.layers, fixture.outer).map(
      (node) => node.id,
    );
    expect(forOuter).not.toContain(fixture.outer);
    expect(forOuter).not.toContain(fixture.inner);

    const forInner = movableParentGroups(fixture.document.layers, fixture.inner).map(
      (node) => node.id,
    );
    expect(forInner).toContain(fixture.outer);
    expect(forInner).not.toContain(fixture.inner);
  });

  it("returns nothing for an unknown node", () => {
    const fixture = grouped();
    expect(movableParentGroups(fixture.document.layers, "missing")).toEqual([]);
  });
});

describe("a group's own metadata", () => {
  it("can be hidden and given an opacity without touching its children", () => {
    const fixture = grouped();
    const hidden = updateLayer(fixture.document, fixture.outer, { visible: false });
    const faded = updateLayer(hidden, fixture.outer, { opacity: 0.4 });

    expect(findLayer(faded.layers, fixture.outer)?.visible).toBe(false);
    expect(findLayer(faded.layers, fixture.outer)?.opacity).toBe(0.4);
    expect(findLayer(faded.layers, fixture.outer)?.children.every((node) => node.visible)).toBe(true);
  });
});
