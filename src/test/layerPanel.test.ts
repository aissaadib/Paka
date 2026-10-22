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
import { layerDeletionPrompt } from "../core/document/layerDeletion";
import { dropSlot, moveDeltaForSlot } from "../core/document/layerOrdering";
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
});
