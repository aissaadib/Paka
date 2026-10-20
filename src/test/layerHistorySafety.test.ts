/**
 * History coalescing boundaries and layer/gesture safety.
 *
 * Two defects are pinned here:
 *  - an opacity drag could merge into a *previous* opacity drag when a layer
 *    selection, an undo, or another non-command action happened in between;
 *  - undoing a metadata edit restored the active layer that was current when
 *    the edit was made, which also dropped the user's current selection.
 *
 * Layer edits are also refused while a stroke, fill, gradient or selection
 * gesture is in flight, so release can never commit into a layer that was
 * removed from under the preview.
 */

import { describe, expect, it } from "vitest";
import { CommandStack } from "../core/commands/commandStack";
import type { Command } from "../core/commands/types";
import { createDocument } from "../core/document/document";
import type { Layer, LayerId } from "../core/document/types";
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

function createEngine(): DrawingEngine {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
  });
}

function handle(
  engine: DrawingEngine,
  points: ReadonlyArray<readonly [number, number]>,
  phase: PointerSample["phase"],
): void {
  const first = points[0];
  engine.handlePointerSample(createSample({ phase: "down", docX: first[0], docY: first[1] }));
  for (const point of points.slice(1)) {
    engine.handlePointerSample(createSample({ phase: "move", docX: point[0], docY: point[1] }));
  }
  const last = points[points.length - 1];
  engine.handlePointerSample(createSample({ phase, docX: last[0], docY: last[1] }));
}

/** Paints one dot/line with the brush tool and releases the pointer. */
function paint(engine: DrawingEngine, points: ReadonlyArray<readonly [number, number]>): void {
  engine.setTool("brush");
  handle(engine, points, "up");
}

/** Selects every stroke on the active layer with a marquee over the paper. */
function selectAll(engine: DrawingEngine): void {
  engine.setTool("select");
  handle(
    engine,
    [
      [0, 0],
      [400, 300],
    ],
    "up",
  );
}

function layer(engine: DrawingEngine, layerId: LayerId): Layer {
  const found = engine.getState().document.layers.find((candidate) => candidate.id === layerId);
  if (!found) {
    throw new Error(`Layer ${layerId} is missing`);
  }
  return found;
}

describe("CommandStack merge barrier", () => {
  function createMergeable(label: string, log: string[]): Command {
    return {
      id: label,
      label,
      mergeKey: "same-key",
      apply: () => log.push(`apply:${label}`),
      revert: () => log.push(`revert:${label}`),
      mergeWith(next) {
        return createMergeable(`${label}+${next.id}`, log);
      },
    };
  }

  it("starts a new entry when an external action breaks the run", () => {
    const log: string[] = [];
    const stack = new CommandStack();

    stack.execute(createMergeable("a", log));
    stack.execute(createMergeable("b", log));
    expect(stack.getState().depth).toBe(1);

    stack.breakMerge();
    stack.execute(createMergeable("c", log));

    expect(stack.getState().depth).toBe(2);
    expect(stack.getState().undoLabel).toBe("c");
  });
});

describe("layer opacity history boundaries", () => {
  it("starts a new drag after another layer is selected and the first one returns", () => {
    const engine = createEngine();
    engine.addLayer();
    const topLayerId = engine.getState().document.activeLayerId as string;
    const bottomLayerId = engine.getState().document.layers[0].id;
    const afterAdd = engine.getState().history.depth;

    engine.setLayerOpacity(topLayerId, 0.8);
    engine.setLayerOpacity(topLayerId, 0.6);
    expect(engine.getState().history.depth).toBe(afterAdd + 1);

    // Selecting another layer, then coming back, is two separate actions: the
    // second drag must not extend the first drag's undo step.
    engine.selectLayer(bottomLayerId);
    engine.selectLayer(topLayerId);
    engine.setLayerOpacity(topLayerId, 0.4);

    expect(engine.getState().history.depth).toBe(afterAdd + 2);
    expect(layer(engine, topLayerId).opacity).toBeCloseTo(0.4, 5);

    expect(engine.undo()).toBe(true);
    expect(layer(engine, topLayerId).opacity).toBeCloseTo(0.6, 5);
    expect(engine.undo()).toBe(true);
    expect(layer(engine, topLayerId).opacity).toBe(1);
  });

  it("starts a new drag after an unrelated step was undone", () => {
    const engine = createEngine();
    engine.addLayer();
    const topLayerId = engine.getState().document.activeLayerId as string;
    const afterAdd = engine.getState().history.depth;

    engine.setLayerOpacity(topLayerId, 0.8);
    engine.setLayerVisibility(topLayerId, false);
    expect(engine.getState().history.depth).toBe(afterAdd + 2);

    // Undoing the visibility step leaves the opacity run on top of the stack;
    // a new drag is still a new step, not a continuation across the undo.
    expect(engine.undo()).toBe(true);
    engine.setLayerOpacity(topLayerId, 0.5);
    expect(engine.getState().history.depth).toBe(afterAdd + 2);

    expect(engine.undo()).toBe(true);
    expect(layer(engine, topLayerId).opacity).toBeCloseTo(0.8, 5);
    expect(engine.undo()).toBe(true);
    expect(layer(engine, topLayerId).opacity).toBe(1);
  });
});

describe("layer metadata undo keeps the current selection", () => {
  const metadataOperations: ReadonlyArray<{
    readonly name: string;
    readonly change: (engine: DrawingEngine, layerId: LayerId) => void;
    readonly assertReverted: (engine: DrawingEngine, layerId: LayerId) => void;
  }> = [
    {
      name: "rename",
      change: (engine, layerId) => engine.renameLayer(layerId, "Ink"),
      assertReverted: (engine, layerId) => expect(layer(engine, layerId).name).toBe("Layer 2"),
    },
    {
      name: "visibility",
      change: (engine, layerId) => engine.setLayerVisibility(layerId, false),
      assertReverted: (engine, layerId) => expect(layer(engine, layerId).visible).toBe(true),
    },
    {
      name: "opacity",
      change: (engine, layerId) => engine.setLayerOpacity(layerId, 0.5),
      assertReverted: (engine, layerId) => expect(layer(engine, layerId).opacity).toBe(1),
    },
    {
      name: "blend mode",
      change: (engine, layerId) => engine.setLayerBlendMode(layerId, "multiply"),
      assertReverted: (engine, layerId) => expect(layer(engine, layerId).blendMode).toBe("normal"),
    },
    {
      name: "reorder",
      change: (engine, layerId) => engine.moveLayer(layerId, -1),
      assertReverted: (engine, layerId) =>
        expect(engine.getState().document.layers[1].id).toBe(layerId),
    },
  ];

  for (const operation of metadataOperations) {
    it(`undoing a ${operation.name} keeps the layer the user moved to`, () => {
      const engine = createEngine();
      engine.addLayer();
      const topLayerId = engine.getState().document.activeLayerId as string;
      const bottomLayerId = engine.getState().document.layers[0].id;

      paint(engine, [
        [40, 40],
        [80, 40],
      ]);

      // Give the other layer content too, so the selection we make later has
      // something to resolve against.
      engine.selectLayer(bottomLayerId);
      paint(engine, [
        [120, 120],
        [160, 120],
      ]);

      // Make the metadata edit while the top layer is active. This is the edit
      // whose snapshot remembers `topLayerId` as active.
      engine.selectLayer(topLayerId);
      operation.change(engine, topLayerId);

      // Move back to the other layer and make a selection there. The metadata
      // step is still the top history entry; undo must not jump back to the
      // layer that was active when the edit was made.
      engine.selectLayer(bottomLayerId);
      selectAll(engine);
      expect(engine.getState().selectedStrokes).toBe(1);

      expect(engine.undo()).toBe(true);
      expect(engine.getState().document.activeLayerId).toBe(bottomLayerId);
      expect(engine.getState().selectedStrokes).toBe(1);
      operation.assertReverted(engine, topLayerId);

      expect(engine.redo()).toBe(true);
      expect(engine.getState().document.activeLayerId).toBe(bottomLayerId);
      expect(engine.getState().selectedStrokes).toBe(1);
    });
  }

  it("still restores the active layer when undoing a structural delete", () => {
    const engine = createEngine();
    const bottomLayerId = engine.getState().document.activeLayerId as string;
    engine.addLayer();
    const topLayerId = engine.getState().document.activeLayerId as string;

    engine.removeLayer(topLayerId);
    expect(engine.getState().document.activeLayerId).toBe(bottomLayerId);

    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.activeLayerId).toBe(topLayerId);
  });
});

describe("layer edits during an active gesture", () => {
  it("refuses every layer mutation while a stroke is in flight and commits to its own layer", () => {
    const engine = createEngine();
    engine.addLayer();
    const topLayerId = engine.getState().document.activeLayerId as string;
    const bottomLayerId = engine.getState().document.layers[0].id;
    const afterAdd = engine.getState().history.depth;

    engine.beginStroke(createSample({ docX: 50, docY: 50 }));

    engine.addLayer();
    engine.duplicateLayer(topLayerId);
    engine.removeLayer(topLayerId);
    engine.renameLayer(topLayerId, "Renamed");
    engine.setLayerVisibility(topLayerId, false);
    engine.setLayerOpacity(topLayerId, 0.25);
    engine.setLayerBlendMode(topLayerId, "multiply");
    engine.moveLayer(topLayerId, -1);
    engine.selectLayer(bottomLayerId);

    const during = engine.getState();
    expect(during.document.layers.map((candidate) => candidate.id)).toEqual([
      bottomLayerId,
      topLayerId,
    ]);
    expect(during.document.activeLayerId).toBe(topLayerId);
    expect(layer(engine, topLayerId).name).toBe("Layer 2");
    expect(layer(engine, topLayerId).visible).toBe(true);
    expect(layer(engine, topLayerId).opacity).toBe(1);
    expect(layer(engine, topLayerId).blendMode).toBe("normal");
    expect(during.history.depth).toBe(afterAdd);
    expect(during.notice).toContain("Finish the current stroke or selection");

    engine.finishStroke();
    expect(engine.listStrokes(topLayerId)).toHaveLength(1);
    expect(engine.listStrokes(bottomLayerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(afterAdd + 1);

    expect(engine.undo()).toBe(true);
    expect(engine.listStrokes(topLayerId)).toHaveLength(0);
    engine.redo();
    expect(engine.listStrokes(topLayerId)).toHaveLength(1);
  });

  it("refuses a layer change during an active selection gesture, then completes the selection", () => {
    const engine = createEngine();
    engine.addLayer();
    const topLayerId = engine.getState().document.activeLayerId as string;
    const bottomLayerId = engine.getState().document.layers[0].id;
    paint(engine, [
      [50, 50],
      [100, 50],
    ]);
    const depth = engine.getState().history.depth;

    engine.setTool("select");
    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 120, docY: 120 }));

    engine.removeLayer(topLayerId);
    engine.setLayerOpacity(topLayerId, 0.5);
    engine.selectLayer(bottomLayerId);

    expect(engine.getState().document.layers).toHaveLength(2);
    expect(engine.getState().document.activeLayerId).toBe(topLayerId);
    expect(layer(engine, topLayerId).opacity).toBe(1);
    expect(engine.getState().history.depth).toBe(depth);

    engine.handlePointerSample(createSample({ phase: "up", docX: 120, docY: 120 }));
    expect(engine.getState().selectedStrokes).toBe(1);
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("refuses a layer change during an active gradient and still commits the gradient", () => {
    const engine = createEngine();
    engine.addLayer();
    const topLayerId = engine.getState().document.activeLayerId as string;
    const bottomLayerId = engine.getState().document.layers[0].id;
    const depth = engine.getState().history.depth;

    engine.setTool("gradient");
    engine.handlePointerSample(createSample({ phase: "down", docX: 40, docY: 40 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 160, docY: 40 }));

    engine.removeLayer(topLayerId);
    engine.addLayer();

    expect(engine.getState().document.layers).toHaveLength(2);
    expect(engine.getState().document.activeLayerId).toBe(topLayerId);
    expect(engine.getState().history.depth).toBe(depth);

    engine.handlePointerSample(createSample({ phase: "up", docX: 160, docY: 40 }));
    expect(engine.listElements(topLayerId)).toHaveLength(1);
    expect(engine.listElements(bottomLayerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(depth + 1);
  });

  it("cancels an in-flight stroke cleanly after a refused layer deletion", () => {
    const engine = createEngine();
    engine.addLayer();
    const topLayerId = engine.getState().document.activeLayerId as string;
    const afterAdd = engine.getState().history.depth;

    engine.beginStroke(createSample({ docX: 30, docY: 30 }));
    engine.removeLayer(topLayerId);
    expect(engine.getState().document.layers).toHaveLength(2);

    engine.cancelStroke();
    expect(engine.listElements(topLayerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(afterAdd);
    expect(engine.getState().document.activeLayerId).toBe(topLayerId);
  });
});
