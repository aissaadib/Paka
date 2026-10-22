/**
 * Layer groups and locked layers, end to end.
 *
 * A group is organization: it has no pixels, it changes nothing about how a
 * layer is drawn, and it is one undoable step like every other layer change.
 * A lock is a promise: the engine refuses every path that could change the
 * locked layer's pixels or its place in the stack.
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { layerTreeLayerIds, layerTreeRows } from "../core/document/layerTree";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { parseProject, serializeProject } from "../core/project/projectFormat";
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

function createEngine() {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
  });
}

/** The layer ids of the document, in painting order. */
function layerIds(engine: DrawingEngine): string[] {
  return engine.getState().document.layers.map((layer) => layer.id);
}

/** Paints one stroke with the brush tool. */
function paint(engine: DrawingEngine, x = 10, y = 10): void {
  engine.beginStroke(createSample({ docX: x, docY: y }));
  engine.extendStroke(createSample({ docX: x + 6, docY: y + 4 }));
  engine.finishStroke();
}

/** Selects the strokes a marquee meets. */
function selectAll(engine: DrawingEngine): void {
  engine.setTool("select");
  engine.handlePointerSample(createSample({ phase: "down", docX: 0, docY: 0 }));
  engine.handlePointerSample(createSample({ phase: "move", docX: 380, docY: 280 }));
  engine.handlePointerSample(createSample({ phase: "up", docX: 380, docY: 280 }));
}

describe("layer groups", () => {
  it("creates a group as one undoable step that marks the document dirty", () => {
    const engine = createEngine();
    const before = engine.getState().history.depth;

    const groupId = engine.createLayerGroup(null, "Ink");

    expect(groupId).not.toBeNull();
    expect(engine.getState().document.layerTree.groups).toHaveLength(1);
    expect(engine.getState().document.layerTree.groups[0].name).toBe("Ink");
    expect(engine.getState().history.depth).toBe(before + 1);
    expect(engine.getState().file.dirty).toBe(true);

    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layerTree.groups).toHaveLength(0);
    expect(engine.redo()).toBe(true);
    expect(engine.getState().document.layerTree.groups).toHaveLength(1);
  });

  it("moves a layer into a group and back out, one step each", () => {
    const engine = createEngine();
    engine.addLayer();
    const topId = engine.getState().document.activeLayerId as string;
    const bottomId = layerIds(engine)[0];
    const groupId = engine.createLayerGroup() as string;
    const depth = engine.getState().history.depth;

    engine.moveLayerToGroup(topId, groupId);

    // The layer sits in the group's slot in the stack, and the panel's order is
    // the painting order.
    expect(layerTreeLayerIds(engine.getState().document.layerTree)).toEqual([
      bottomId,
      topId,
    ]);
    expect(layerIds(engine)).toEqual([bottomId, topId]);
    expect(engine.getState().history.depth).toBe(depth + 1);

    expect(engine.undo()).toBe(true);
    expect(layerTreeLayerIds(engine.getState().document.layerTree)).toEqual([
      bottomId,
      topId,
    ]);
    expect(engine.redo()).toBe(true);
    expect(layerTreeLayerIds(engine.getState().document.layerTree)).toEqual([
      bottomId,
      topId,
    ]);

    engine.moveLayerToGroup(topId, null);
    expect(
      engine.getState().document.layerTree.root.some(
        (entry) => entry.kind === "layer" && entry.id === topId,
      ),
    ).toBe(true);
  });

  it("keeps a layer's strokes when the layer moves into a group", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    paint(engine);
    expect(engine.listStrokes(layerId)).toHaveLength(1);

    const groupId = engine.createLayerGroup() as string;
    engine.moveLayerToGroup(layerId, groupId);

    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });

  it("keeps each layer's own visibility inside a group", () => {
    const engine = createEngine();
    engine.addLayer();
    const topId = engine.getState().document.activeLayerId as string;
    const bottomId = layerIds(engine)[0];
    const groupId = engine.createLayerGroup() as string;
    engine.moveLayerToGroup(topId, groupId);

    engine.setLayerVisibility(topId, false);

    const layers = engine.getState().document.layers;
    // The group is not a visibility switch: the layer it holds is hidden and
    // its neighbour is not.
    expect(layers.find((layer) => layer.id === topId)?.visible).toBe(false);
    expect(layers.find((layer) => layer.id === bottomId)?.visible).toBe(true);
    // Hiding a layer changes no order.
    expect(layerIds(engine)).toEqual([bottomId, topId]);
  });

  it("renames, folds, reorders and removes a group as separate steps", () => {
    const engine = createEngine();
    const groupId = engine.createLayerGroup(null, "Ink") as string;
    const depth = engine.getState().history.depth;

    engine.renameLayerGroup(groupId, "Colour");
    expect(engine.getState().document.layerTree.groups[0].name).toBe("Colour");

    engine.setLayerGroupCollapsed(groupId, true);
    expect(engine.getState().document.layerTree.groups[0].collapsed).toBe(true);

    engine.moveLayerGroup(groupId, -1);
    expect(engine.getState().history.depth).toBe(depth + 3);

    engine.removeLayerGroup(groupId);
    expect(engine.getState().document.layerTree.groups).toHaveLength(0);
    // The layers that were in the group are still there.
    expect(engine.getState().document.layers).toHaveLength(1);
  });

  it("keeps the layers of a removed group", () => {
    const engine = createEngine();
    engine.addLayer();
    const topId = engine.getState().document.activeLayerId as string;
    const bottomId = layerIds(engine)[0];
    const groupId = engine.createLayerGroup() as string;
    engine.moveLayerToGroup(topId, groupId);

    engine.removeLayerGroup(groupId);

    expect(engine.getState().document.layerTree.groups).toHaveLength(0);
    expect(layerIds(engine).sort()).toEqual([bottomId, topId].sort());
  });

  it("refuses a group change while a gesture is in flight", () => {
    const engine = createEngine();
    engine.beginStroke(createSample());
    const depth = engine.getState().history.depth;

    expect(engine.createLayerGroup()).toBeNull();

    expect(engine.getState().history.depth).toBe(depth);
    engine.cancelStroke();
  });

  it("shows the groups in the panel's rows", () => {
    const engine = createEngine();
    engine.addLayer();
    const topId = engine.getState().document.activeLayerId as string;
    const groupId = engine.createLayerGroup(null, "Ink") as string;
    engine.moveLayerToGroup(topId, groupId);

    const rows = layerTreeRows(
      engine.getState().document.layerTree,
      engine.getState().document.layers,
    );

    expect(rows[0]).toMatchObject({ kind: "group", id: groupId, name: "Ink" });
    expect(rows.some((row) => row.kind === "layer" && row.id === topId)).toBe(true);
  });
});

describe("locked layers", () => {
  it("refuses to paint on a locked layer", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    engine.setLayerLocked(layerId, true);
    const depth = engine.getState().history.depth;

    paint(engine);

    expect(engine.listStrokes(layerId)).toHaveLength(0);
    // A refused stroke is not an edit: no history step, and the document is
    // no dirtier than the lock itself made it.
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("refuses to move, delete or copy the strokes of a locked layer", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    paint(engine);
    selectAll(engine);
    expect(engine.getState().selectedStrokes).toBe(1);

    engine.setLayerLocked(layerId, true);
    const depth = engine.getState().history.depth;

    expect(engine.nudgeSelection(4, 0)).toBe(false);
    expect(engine.deleteSelection()).toBe(false);
    expect(engine.duplicateSelection()).toBe(false);
    expect(engine.flipSelection("horizontal")).toBe(false);
    expect(engine.scaleSelection(2)).toBe(false);
    expect(engine.rotateSelection(45)).toBe(false);

    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });

  it("refuses to reorder or delete a locked layer", () => {
    const engine = createEngine();
    engine.addLayer();
    const topId = engine.getState().document.activeLayerId as string;
    engine.setLayerLocked(topId, true);
    const depth = engine.getState().history.depth;

    engine.moveLayer(topId, -1);
    engine.removeLayer(topId);

    expect(engine.getState().history.depth).toBe(depth);
    expect(layerIds(engine)).toContain(topId);
  });

  it("lets the stroke through once the layer is unlocked", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    engine.setLayerLocked(layerId, true);
    paint(engine);
    expect(engine.listStrokes(layerId)).toHaveLength(0);

    engine.setLayerLocked(layerId, false);
    paint(engine);

    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });

  it("records the lock as one undoable step", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    const depth = engine.getState().history.depth;

    engine.setLayerLocked(layerId, true);
    expect(engine.getState().document.layers[0].locked).toBe(true);
    expect(engine.getState().history.depth).toBe(depth + 1);

    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers[0].locked).toBeUndefined();

    expect(engine.redo()).toBe(true);
    expect(engine.getState().document.layers[0].locked).toBe(true);
  });

  it("gives a duplicated layer its own, unlocked, copy", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    engine.setLayerLocked(layerId, true);

    engine.duplicateLayer(layerId);

    const layers = engine.getState().document.layers;
    expect(layers).toHaveLength(2);
    expect(layers[0].locked).toBe(true);
    expect(layers[1].locked).toBe(false);
  });
});

describe("groups and locks in the project file", () => {
  it("keeps the groups and the lock through a save and reopen", () => {
    const engine = createEngine();
    engine.addLayer();
    const topId = engine.getState().document.activeLayerId as string;
    const groupId = engine.createLayerGroup(null, "Ink") as string;
    engine.moveLayerToGroup(topId, groupId);
    paint(engine, 20);
    engine.setLayerLocked(topId, true);

    const text = engine.serialize();
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const reopened = createEngine();
    reopened.loadProject(parsed.project, null);

    const document = reopened.getState().document;
    expect(document.layerTree.groups).toHaveLength(1);
    expect(document.layerTree.groups[0].name).toBe("Ink");
    expect(document.layerTree.groups[0].id).toBe(groupId);
    expect(document.layers.find((layer) => layer.id === topId)?.locked).toBe(true);
    // The strokes are still on the layer they were drawn on.
    expect(reopened.listStrokes(topId)).toHaveLength(1);
  });

  it("writes a document without groups exactly as it was before", () => {
    const engine = createEngine();
    const payload = JSON.parse(engine.serialize()) as {
      document: Record<string, unknown>;
    };

    expect(payload.document.layerTree).toBeUndefined();
  });

  it("opens an older file without groups flat, with the same layers in the same order", () => {
    const engine = createEngine();
    engine.addLayer();
    const topId = engine.getState().document.activeLayerId as string;
    const groupId = engine.createLayerGroup(null, "Ink") as string;
    engine.moveLayerToGroup(topId, groupId);

    // Take the file back to the shape it had before groups existed.
    const payload = JSON.parse(engine.serialize()) as {
      document: Record<string, unknown>;
      layers: Array<Record<string, unknown>>;
    };
    delete payload.document.layerTree;

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.project.document.layerTree.groups).toHaveLength(0);
    expect(parsed.project.document.layerTree.root).toHaveLength(
      parsed.project.document.layers.length,
    );
    expect(parsed.project.document.layers.map((layer) => layer.id)).toEqual(
      engine.getState().document.layers.map((layer) => layer.id),
    );
  });

  it("opens a file with a broken tree flat, and says so", () => {
    const engine = createEngine();
    const payload = JSON.parse(engine.serialize()) as {
      document: Record<string, unknown>;
    };
    payload.document.layerTree = {
      groups: [
        {
          id: "group-1",
          name: "Broken",
          collapsed: false,
          children: [{ kind: "layer", id: "layer-does-not-exist" }],
        },
      ],
      root: [{ kind: "group", id: "group-1" }],
    };

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.project.document.layerTree.groups).toHaveLength(0);
    expect(parsed.project.warnings.length).toBeGreaterThan(0);
  });

  it("refuses a file whose groups are nested in a loop", () => {
    const engine = createEngine();
    const payload = JSON.parse(engine.serialize()) as {
      document: Record<string, unknown>;
    };
    payload.document.layerTree = {
      groups: [
        {
          id: "group-a",
          name: "A",
          collapsed: false,
          children: [{ kind: "group", id: "group-b" }],
        },
        {
          id: "group-b",
          name: "B",
          collapsed: false,
          children: [{ kind: "group", id: "group-a" }],
        },
      ],
      root: [{ kind: "group", id: "group-a" }],
    };

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.project.document.layerTree.groups).toHaveLength(0);
    expect(parsed.project.warnings.length).toBeGreaterThan(0);
  });

  it("ignores a broken lock flag and opens the layer unlocked", () => {
    const engine = createEngine();
    const payload = JSON.parse(engine.serialize()) as {
      layers: Array<Record<string, unknown>>;
    };
    payload.layers[0].locked = "yes";

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.project.document.layers[0].locked).toBeUndefined();
    expect(parsed.project.warnings.length).toBeGreaterThan(0);
  });

  it("serializes the tree so that a reader can rebuild it", () => {
    const engine = createEngine();
    const groupId = engine.createLayerGroup(null, "Ink") as string;
    const layerId = engine.getState().document.activeLayerId as string;
    engine.moveLayerToGroup(layerId, groupId);

    const payload = JSON.parse(engine.serialize()) as {
      document: {
        layerTree: {
          groups: Array<{
            id: string;
            name: string;
            collapsed: boolean;
            children: Array<{ kind: string; id: string }>;
          }>;
          root: Array<{ kind: string; id: string }>;
        };
      };
    };

    expect(payload.document.layerTree.groups[0]).toMatchObject({
      id: groupId,
      name: "Ink",
      collapsed: false,
    });
    expect(payload.document.layerTree.root).toEqual([{ kind: "group", id: groupId }]);
    expect(payload.document.layerTree.groups[0].children).toEqual([
      { kind: "layer", id: layerId },
    ]);
  });

  it("writes a project the current reader accepts", () => {
    const engine = createEngine();
    const groupId = engine.createLayerGroup(null, "Ink") as string;
    engine.moveLayerToGroup(engine.getState().document.activeLayerId as string, groupId);

    const text = serializeProject(engine.getState().document, engine);
    const parsed = parseProject(text);

    expect(parsed.ok).toBe(true);
  });
});
