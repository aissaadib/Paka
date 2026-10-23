/**
 * The layers panel's contract with the engine.
 *
 * The React layer has no automated tests, so what is pinned here is the
 * *behaviour the panel asks for*: the reordering arithmetic lands a layer
 * where the marker said it would, every operation is one undoable step, and
 * the content the delete confirmation talks about is the layer's real
 * content.
 */

import { describe, expect, it } from "vitest";
import {
  canDeleteLayer,
  canDeleteNode,
  groupDeletionPrompt,
  layerDeletionPrompt,
} from "../core/document/layerDeletion";
import { dropSlot, markerIndex, moveDeltaForSlot } from "../core/document/layerOrdering";
import { findLayer } from "../core/document/layerGroups";
import { createDocument } from "../core/document/document";
import type { LayerId } from "../core/document/types";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import type { PointerSample } from "../types/pointer";

function createSample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    phase: "move",
    pointerId: 1,
    kind: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: 0,
    docY: 0,
    screenX: 0,
    screenY: 0,
    pressure: 0.7,
    hasPressure: true,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    ...overrides,
  };
}

/** An engine with three layers, so a reorder has somewhere to go. */
function createEngine(): DrawingEngine {
  const engine = new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
  });
  engine.addLayer();
  engine.addLayer();
  return engine;
}

/** The layer ids, top of the stack first - the order the panel shows. */
function topFirst(engine: DrawingEngine): LayerId[] {
  return engine
    .getState()
    .document.layers.map((layer) => layer.id)
    .reverse();
}

/**
 * Reorders a layer the way the panel does: the drop slot comes from the
 * pointer's position, the move from the slot.
 */
function dropLayer(
  engine: DrawingEngine,
  draggedId: LayerId,
  rowIndex: number,
  above: boolean,
): void {
  const stack = topFirst(engine);
  const dragged = stack.findIndex((id) => id === draggedId);
  const delta = moveDeltaForSlot(dragged, dropSlot(rowIndex, above, dragged));
  if (delta !== 0) {
    engine.moveLayer(draggedId, delta);
  }
}

describe("the panel's drag reorder", () => {
  it("lands the layer where the marker showed it would", () => {
    const engine = createEngine();
    const [top, middle, bottom] = topFirst(engine);

    // Drag the top layer below the bottom one.
    dropLayer(engine, top, 2, false);
    expect(topFirst(engine)).toEqual([middle, bottom, top]);

    // And the other way round: the bottom layer to the top.
    dropLayer(engine, bottom, 0, true);
    expect(topFirst(engine)).toEqual([bottom, middle, top]);
  });

  it("moves a layer one step at a time when it is dropped on its neighbour", () => {
    const engine = createEngine();
    const [top, middle, bottom] = topFirst(engine);

    // Below the middle row: the top layer moves down one.
    dropLayer(engine, top, 1, false);
    expect(topFirst(engine)).toEqual([middle, top, bottom]);

    // Above the top row: the middle layer moves up one.
    dropLayer(engine, middle, 0, true);
    expect(topFirst(engine)).toEqual([middle, top, bottom]);
  });

  it("records the whole drag as one undo step and restores the order", () => {
    const engine = createEngine();
    const before = topFirst(engine);
    const depth = engine.getState().history.depth;

    dropLayer(engine, before[0], 2, false);

    expect(engine.getState().history.depth).toBe(depth + 1);
    expect(engine.getState().history.undoLabel).toBe("Reorder Layers");

    expect(engine.undo()).toBe(true);
    expect(topFirst(engine)).toEqual(before);
  });

  it("records nothing when the drop leaves the layer where it is", () => {
    const engine = createEngine();
    const before = topFirst(engine);
    const depth = engine.getState().history.depth;

    // The top layer dropped back on itself.
    dropLayer(engine, before[0], 0, true);

    expect(topFirst(engine)).toEqual(before);
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("keeps the active layer and the selection across a reorder", () => {
    const engine = createEngine();
    const stack = topFirst(engine);
    engine.selectLayer(stack[1]);
    const depth = engine.getState().history.depth;

    dropLayer(engine, stack[0], 2, false);

    expect(engine.getState().document.activeLayerId).toBe(stack[1]);
    expect(engine.getState().history.depth).toBe(depth + 1);
  });

  it("puts the layer where the marker said it would", () => {
    // The marker is the gap the layer lands in. The two must agree, or the
    // artist drops a layer where the marker never said.
    const count = 3;
    for (let dragged = 0; dragged < count; dragged += 1) {
      for (let row = 0; row < count; row += 1) {
        for (const above of [true, false]) {
          const engine = createEngine();
          const before = topFirst(engine);
          const draggedId = before[dragged];
          const slot = dropSlot(row, above, dragged);
          const marker = markerIndex(dragged, slot);

          const delta = moveDeltaForSlot(dragged, slot);
          if (delta !== 0) {
            engine.moveLayer(draggedId, delta);
          }

          // The dragged layer ends up at the slot the marker named.
          const after = topFirst(engine);
          expect(after.indexOf(draggedId)).toBe(slot);
          // The marker is the gap right above the row that ends up above the
          // dragged layer - the gap the layer is dropped into.
          const aboveId: string | null = slot === 0 ? null : after[slot - 1];
          const expectedMarker = aboveId === null ? 0 : before.indexOf(aboveId) + 1;
          expect(marker).toBe(expectedMarker);
        }
      }
    }
  });
});

describe("the panel's other operations", () => {
  it("treats selecting a layer as not an edit", () => {
    const engine = createEngine();
    const stack = topFirst(engine);
    const depth = engine.getState().history.depth;
    const dirty = engine.getState().file.dirty;

    engine.selectLayer(stack[1]);

    expect(engine.getState().document.activeLayerId).toBe(stack[1]);
    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.getState().file.dirty).toBe(dirty);
  });

  it("records a visibility toggle as one undoable step", () => {
    const engine = createEngine();
    const stack = topFirst(engine);
    const depth = engine.getState().history.depth;

    engine.toggleLayerVisibility(stack[0]);
    expect(engine.getState().document.layers.find((l) => l.id === stack[0])?.visible).toBe(false);
    expect(engine.getState().history.depth).toBe(depth + 1);

    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers.find((l) => l.id === stack[0])?.visible).toBe(true);
  });

  it("collapses a quick opacity edit into one undoable step", () => {
    const engine = createEngine();
    const stack = topFirst(engine);
    const depth = engine.getState().history.depth;

    // The row's quick editor writes a few values while the artist types.
    engine.setLayerOpacity(stack[0], 0.8);
    engine.setLayerOpacity(stack[0], 0.6);
    engine.setLayerOpacity(stack[0], 0.5);

    expect(engine.getState().history.depth).toBe(depth + 1);
    expect(engine.getState().document.layers.find((l) => l.id === stack[0])?.opacity).toBe(0.5);

    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers.find((l) => l.id === stack[0])?.opacity).toBe(1);
  });

  it("asks about the layer's real content before deleting it", () => {
    const engine = createEngine();
    const stack = topFirst(engine);
    const layerId = stack[0];

    // An empty layer is removed without a question.
    expect(engine.listElements(layerId)).toHaveLength(0);
    expect(layerDeletionPrompt("Layer 3", engine.listElements(layerId).length)).toBeNull();

    // Paint something on it.
    engine.setTool("brush");
    engine.handlePointerSample(createSample({ phase: "down", docX: 40, docY: 40 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 120, docY: 40 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 120, docY: 40 }));

    expect(engine.listElements(layerId)).toHaveLength(1);
    const prompt = layerDeletionPrompt("Layer 3", engine.listElements(layerId).length);
    expect(prompt).not.toBeNull();
    expect(prompt?.body).toContain("1 item");
  });

  it("restores a deleted layer's content on undo", () => {
    const engine = createEngine();
    const stack = topFirst(engine);
    const layerId = stack[0];

    engine.setTool("brush");
    engine.handlePointerSample(createSample({ phase: "down", docX: 40, docY: 40 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 120, docY: 40 }));
    expect(engine.listElements(layerId)).toHaveLength(1);

    engine.removeLayer(layerId);
    expect(engine.getState().document.layers.map((l) => l.id)).not.toContain(layerId);

    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers.map((l) => l.id)).toContain(layerId);
    expect(engine.listElements(layerId)).toHaveLength(1);
  });

  it("keeps the last layer, and the panel never asks about it", () => {
    // One layer: the document model refuses to remove it, so the panel must
    // not ask the user to confirm a deletion that cannot happen.
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
    });
    const onlyLayer = engine.getState().document.layers[0]?.id as string;
    expect(canDeleteLayer(engine.getState().document.layers.length)).toBe(false);

    engine.removeLayer(onlyLayer);

    expect(engine.getState().document.layers.map((l) => l.id)).toEqual([onlyLayer]);
  });
});

describe("the panel's layer-group operations", () => {
  /** Paints one stroke on the active layer. */
  function paint(engine: DrawingEngine): void {
    engine.setTool("brush");
    engine.handlePointerSample(createSample({ phase: "down", docX: 40, docY: 40 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 120, docY: 40 }));
  }

  it("creates an empty group above the active layer, at its level, in one step", () => {
    const engine = createEngine();
    const [top, middle, bottom] = topFirst(engine);
    engine.selectLayer(middle);
    const depth = engine.getState().history.depth;

    const groupId = engine.createGroup();
    expect(groupId).not.toBeNull();
    if (!groupId) {
      return;
    }

    const document = engine.getState().document;
    expect(document.layers.map((layer) => layer.id)).toEqual([bottom, middle, groupId, top]);
    expect(findLayer(document.layers, groupId)?.kind).toBe("group");
    expect(findLayer(document.layers, groupId)?.children).toEqual([]);
    // A group owns no content, so the artist keeps the layer they were on.
    expect(document.activeLayerId).toBe(middle);
    expect(engine.getState().history.depth).toBe(depth + 1);
    expect(engine.getState().history.undoLabel).toBe("New Group");

    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers.map((layer) => layer.id)).toEqual([
      bottom,
      middle,
      top,
    ]);

    expect(engine.redo()).toBe(true);
    expect(findLayer(engine.getState().document.layers, groupId)).toBeDefined();
  });

  it("moves a layer into a group and back out, as one step each way", () => {
    const engine = createEngine();
    const [top, middle, bottom] = topFirst(engine);
    const groupId = engine.createGroup();
    expect(groupId).not.toBeNull();
    if (!groupId) {
      return;
    }
    const depth = engine.getState().history.depth;

    engine.moveLayerToParent(top, groupId, 0);
    expect(findLayer(engine.getState().document.layers, groupId)?.children.map((l) => l.id)).toEqual([
      top,
    ]);
    expect(engine.getState().document.activeLayerId).toBe(top);
    expect(engine.getState().history.depth).toBe(depth + 1);
    expect(engine.getState().history.undoLabel).toBe("Move Layer");

    engine.moveLayerToParent(top, null, 0);
    const document = engine.getState().document;
    expect(document.layers[0]?.id).toBe(top);
    expect(findLayer(document.layers, groupId)?.children).toEqual([]);
    expect(engine.getState().document.activeLayerId).toBe(top);

    expect(engine.undo()).toBe(true);
    expect(findLayer(engine.getState().document.layers, groupId)?.children.map((l) => l.id)).toEqual([
      top,
    ]);
    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers.map((layer) => layer.id)).toEqual([
      bottom,
      middle,
      top,
      groupId,
    ]);
  });

  it("toggles a nested layer's visibility without changing its group", () => {
    const engine = createEngine();
    const [top] = topFirst(engine);
    const groupId = engine.createGroup();
    if (!groupId) {
      return;
    }
    engine.moveLayerToParent(top, groupId, 0);
    const depth = engine.getState().history.depth;

    engine.toggleLayerVisibility(top);

    const document = engine.getState().document;
    expect(findLayer(document.layers, top)?.visible).toBe(false);
    expect(findLayer(document.layers, groupId)?.visible).toBe(true);
    expect(engine.getState().history.depth).toBe(depth + 1);

    expect(engine.undo()).toBe(true);
    expect(findLayer(engine.getState().document.layers, top)?.visible).toBe(true);
  });

  it("duplicates a nested layer beside itself, copying its content", () => {
    const engine = createEngine();
    const [top] = topFirst(engine);
    const groupId = engine.createGroup();
    if (!groupId) {
      return;
    }
    engine.moveLayerToParent(top, groupId, 0);
    engine.selectLayer(top);
    paint(engine);
    expect(engine.listElements(top)).toHaveLength(1);

    engine.duplicateLayer(top);

    const document = engine.getState().document;
    const group = findLayer(document.layers, groupId);
    expect(group?.children).toHaveLength(2);
    const copy = group?.children.find((layer) => layer.id !== top);
    expect(copy).toBeDefined();
    if (!copy) {
      return;
    }
    expect(engine.listElements(copy.id)).toHaveLength(1);
    expect(document.activeLayerId).toBe(copy.id);

    expect(engine.undo()).toBe(true);
    expect(findLayer(engine.getState().document.layers, copy.id)).toBeUndefined();
    expect(engine.listElements(copy.id)).toHaveLength(0);
  });

  it("deletes a group with its contents and restores every child on undo", () => {
    const engine = createEngine();
    const [top, middle] = topFirst(engine);
    const groupId = engine.createGroup();
    if (!groupId) {
      return;
    }
    engine.moveLayerToParent(top, groupId, 0);
    engine.moveLayerToParent(middle, groupId, 0);
    engine.selectLayer(top);
    paint(engine);
    engine.selectLayer(middle);
    paint(engine);
    expect(engine.listElements(top)).toHaveLength(1);
    expect(engine.listElements(middle)).toHaveLength(1);

    engine.removeLayer(groupId);
    expect(findLayer(engine.getState().document.layers, groupId)).toBeUndefined();
    expect(engine.getState().document.activeLayerId).not.toBe(groupId);
    expect(engine.getState().history.undoLabel).toBe("Delete Group");

    expect(engine.undo()).toBe(true);
    const restored = engine.getState().document;
    expect(findLayer(restored.layers, groupId)?.children.map((layer) => layer.id)).toEqual([
      middle,
      top,
    ]);
    expect(engine.listElements(top)).toHaveLength(1);
    expect(engine.listElements(middle)).toHaveLength(1);

    expect(engine.redo()).toBe(true);
    expect(findLayer(engine.getState().document.layers, groupId)).toBeUndefined();
    expect(engine.listElements(top)).toHaveLength(0);
    expect(engine.listElements(middle)).toHaveLength(0);
  });

  it("refuses to draw while a group is the active node", () => {
    const engine = createEngine();
    const groupId = engine.createGroup();
    if (!groupId) {
      return;
    }
    engine.selectLayer(groupId);
    const depth = engine.getState().history.depth;

    paint(engine);

    expect(engine.listElements(groupId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.getState().notice).toContain("layer group");
  });

  it("dissolves a group into its place and leaves a paintable layer active", () => {
    const engine = createEngine();
    const [top] = topFirst(engine);
    const groupId = engine.createGroup();
    if (!groupId) {
      return;
    }
    engine.moveLayerToParent(top, groupId, 0);
    engine.selectLayer(groupId);

    engine.dissolveGroup(groupId);

    const dissolved = engine.getState().document;
    expect(findLayer(dissolved.layers, groupId)).toBeUndefined();
    expect(findLayer(dissolved.layers, top)?.kind).toBe("layer");
    expect(dissolved.activeLayerId).toBe(top);

    expect(engine.undo()).toBe(true);
    expect(findLayer(engine.getState().document.layers, groupId)?.children.map((l) => l.id)).toEqual([
      top,
    ]);
  });

  it("refuses a group change while a stroke is in flight, then accepts it after a tool switch", () => {
    const engine = createEngine();
    const [top] = topFirst(engine);
    const groupId = engine.createGroup();
    if (!groupId) {
      return;
    }
    engine.moveLayerToParent(top, groupId, 0);
    engine.selectLayer(top);

    engine.setTool("brush");
    engine.handlePointerSample(createSample({ phase: "down", docX: 40, docY: 40 }));
    const depth = engine.getState().history.depth;

    // The pointer owns the interaction: a structural change now would leave
    // the in-flight stroke attached to a tree the artist can no longer see.
    expect(engine.createGroup()).toBeNull();
    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.getState().notice).toContain("Finish the current");

    // Switching tool lets the outgoing tool finish its stroke, which ends the
    // gesture; the group tree itself is untouched.
    engine.setTool("rectangle");
    engine.cancelStroke();

    const afterSwitch = engine.createGroup();
    expect(afterSwitch).not.toBeNull();
    const group = findLayer(engine.getState().document.layers, groupId);
    expect(group?.children.map((layer) => layer.id)).toEqual([top, afterSwitch]);
  });

  it("selects the strokes of a layer inside a group, never the group itself", () => {
    const engine = createEngine();
    const [top] = topFirst(engine);
    const groupId = engine.createGroup();
    if (!groupId) {
      return;
    }
    engine.moveLayerToParent(top, groupId, 0);
    engine.selectLayer(top);
    paint(engine);

    expect(engine.selectAll()).toBe(true);
    expect(engine.getState().selectedStrokes).toBe(1);

    // A group has no strokes to select; the gesture is refused rather than
    // selecting the children of a container that paints nothing.
    engine.selectLayer(groupId);
    expect(engine.selectAll()).toBe(false);
    expect(engine.getState().selectedStrokes).toBe(0);

    // The selection, the group and its child all survive a reorder.
    engine.selectLayer(top);
    engine.selectAll();
    engine.moveLayerToParent(top, groupId, 0);
    expect(findLayer(engine.getState().document.layers, groupId)?.children).toHaveLength(1);
    expect(engine.getState().selectedStrokes).toBe(1);
  });
});

describe("the panel's group deletion rules", () => {
  it("counts the layers inside a group in the question", () => {
    expect(groupDeletionPrompt("Group 1", 0)).toBeNull();
    const one = groupDeletionPrompt("Group 1", 1);
    expect(one?.body).toContain("1 layer");
    expect(one?.body).not.toContain("1 layers");
    const three = groupDeletionPrompt("Group 1", 3);
    expect(three?.body).toContain("3 layers");
    expect(three?.confirmLabel).toContain("group");
  });

  it("refuses to delete a group that holds the last paintable layer", () => {
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
    });
    const onlyLayer = engine.getState().document.layers[0]?.id as string;
    const groupId = engine.createGroup();
    if (!groupId) {
      throw new Error("the group was not created");
    }
    engine.moveLayerToParent(onlyLayer, groupId, 0);

    const document = engine.getState().document;
    expect(canDeleteNode(document, groupId)).toBe(false);
    expect(canDeleteNode(document, onlyLayer)).toBe(false);
  });

  it("allows deleting a group when another paintable layer remains", () => {
    const engine = createEngine();
    const [top] = topFirst(engine);
    const groupId = engine.createGroup();
    if (!groupId) {
      throw new Error("the group was not created");
    }
    engine.moveLayerToParent(top, groupId, 0);

    expect(canDeleteNode(engine.getState().document, groupId)).toBe(true);
    expect(canDeleteNode(engine.getState().document, "missing")).toBe(false);
  });
});
