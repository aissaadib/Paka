/**
 * Engine-level tests.
 *
 * These run without a canvas: `DrawingEngine` accepts a null renderer until a
 * canvas is attached, so document, brush, history and stroke-capture behaviour
 * are all testable in plain Node. Rendering itself (Canvas 2D surfaces) is not
 * covered here - the project has no canvas implementation in the test
 * environment.
 */

import { describe, expect, it, vi } from "vitest";
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from "../core/brushes/defaults";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import type { DrawingRenderer } from "../core/rendering/types";
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
  return new DrawingEngine({ document: createDocument({ name: "Test", width: 400, height: 300 }) });
}

/**
 * A renderer that records what the engine asks of it. Passing one in keeps the
 * engine off Canvas 2D, so surface-invalidation policy can be asserted in Node.
 */
function createSpyRenderer() {
  const invalidated: string[] = [];
  let documents = 0;
  let renders = 0;

  const renderer: DrawingRenderer = {
    kind: "canvas2d",
    setDocument: () => {
      documents += 1;
    },
    setViewport: () => {},
    setDisplaySize: () => {},
    setRasterScale: () => {},
    invalidateLayer: (layerId) => {
      invalidated.push(layerId);
    },
    beginStroke: () => {},
    extendStroke: () => {},
    endStroke: () => {},
    cancelStroke: () => {},
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    render: () => {},
    requestRender: () => {
      renders += 1;
    },
    destroy: () => {},
  };

  return { renderer, invalidated, getDocuments: () => documents, getRenders: () => renders };
}

describe("DrawingEngine state", () => {
  it("starts with a single active layer, the brush tool and an empty history", () => {
    const engine = createEngine();
    const state = engine.getState();

    expect(state.document.layers).toHaveLength(1);
    expect(state.document.activeLayerId).toBe(state.document.layers[0].id);
    expect(state.toolId).toBe("brush");
    expect(state.history.canUndo).toBe(false);
    expect(engine.getCursor()).toBe("none");
  });

  it("switches tools without notifying when the tool is unchanged", () => {
    const engine = createEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setTool("brush");
    expect(listener).not.toHaveBeenCalled();

    engine.setTool("pan");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(engine.getCursor()).toBe("grab");
  });

  it("clamps brush updates and skips no-op changes", () => {
    const engine = createEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setBrush({ size: MAX_BRUSH_SIZE + 500 });
    expect(engine.getState().brush.size).toBe(MAX_BRUSH_SIZE);
    expect(listener).toHaveBeenCalledTimes(1);

    engine.setBrush({ size: MAX_BRUSH_SIZE + 900 });
    expect(listener).toHaveBeenCalledTimes(1);

    engine.setBrush({ size: MIN_BRUSH_SIZE - 5 });
    expect(engine.getState().brush.size).toBe(MIN_BRUSH_SIZE);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("updates the viewport through zoom commands", () => {
    const engine = createEngine();
    engine.zoomTo(2);
    expect(engine.getState().viewport.zoom).toBe(2);

    engine.zoomOut();
    expect(engine.getState().viewport.zoom).toBeLessThan(2);

    // Nothing is laid out in this test, so fitting leaves the viewport alone.
    const before = engine.getState().viewport;
    engine.zoomToFit();
    expect(engine.getState().viewport).toBe(before);
  });
});

describe("DrawingEngine stroke capture", () => {
  it("commits a stroke to the active layer and to history", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.beginStroke(createSample({ docX: 10, docY: 10 }));
    engine.extendStroke(createSample({ docX: 60, docY: 40, timeStamp: 16 }));
    engine.extendStroke(createSample({ docX: 120, docY: 40, timeStamp: 32 }));

    // The stroke is only in the renderer's buffer until it is finished.
    expect(engine.listStrokes(layerId)).toHaveLength(0);

    engine.finishStroke();

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].layerId).toBe(layerId);
    expect(strokes[0].xs.length).toBeGreaterThan(2);
    expect(strokes[0].pressures[0]).toBe(0.7);
    expect(strokes[0].brush).toEqual(engine.getState().brush);
    expect(engine.getState().history).toMatchObject({ depth: 1, canUndo: true, undoLabel: "Stroke" });
  });

  it("records eraser strokes as erasers, and only those", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("eraser");
    expect(engine.getCursor()).toBe("none");

    engine.beginStroke(createSample({ docX: 20, docY: 20 }));
    engine.extendStroke(createSample({ docX: 80, docY: 60, timeStamp: 16 }));
    engine.finishStroke();

    const erased = engine.listStrokes(layerId)[0];
    expect(erased.erase).toBe(true);
    expect(engine.getState().history).toMatchObject({ undoLabel: "Erase" });

    engine.setTool("brush");
    engine.beginStroke(createSample({ docX: 20, docY: 40 }));
    engine.extendStroke(createSample({ docX: 80, docY: 40, timeStamp: 32 }));
    engine.finishStroke();

    // Back on the brush the same gesture paints, and the label says so.
    expect(engine.listStrokes(layerId)[1].erase).toBe(false);
    expect(engine.getState().history).toMatchObject({ depth: 2, undoLabel: "Stroke" });

    // The erasure is a normal history entry: undoing it removes the stroke.
    expect(engine.undo()).toBe(true);
    expect(engine.listStrokes(layerId)).toEqual([erased]);
    expect(engine.undo()).toBe(true);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.redo()).toBe(true);
    expect(engine.listStrokes(layerId)[0].erase).toBe(true);
  });

  it("does not publish React-facing state while drawing", () => {
    const engine = createEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.beginStroke(createSample());
    engine.extendStroke(createSample({ docX: 30, docY: 30 }));
    engine.extendStroke(createSample({ docX: 60, docY: 10 }));
    expect(listener).not.toHaveBeenCalled();

    engine.finishStroke();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("undoes and redoes at stroke granularity", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.beginStroke(createSample({ docX: 0, docY: 0 }));
    engine.extendStroke(createSample({ docX: 50, docY: 50 }));
    engine.finishStroke();

    engine.beginStroke(createSample({ docX: 100, docY: 0 }));
    engine.extendStroke(createSample({ docX: 150, docY: 60 }));
    engine.finishStroke();

    expect(engine.listStrokes(layerId)).toHaveLength(2);

    expect(engine.undo()).toBe(true);
    expect(engine.listStrokes(layerId)).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.undo()).toBe(false);

    expect(engine.redo()).toBe(true);
    expect(engine.redo()).toBe(true);
    expect(engine.listStrokes(layerId)).toHaveLength(2);
    // Painting order is preserved across redo.
    expect(engine.listStrokes(layerId)[0].xs[0]).toBe(0);
    expect(engine.listStrokes(layerId)[1].xs[0]).toBe(100);
  });

  it("refuses to undo while a stroke is being drawn", () => {
    const engine = createEngine();
    engine.beginStroke(createSample());
    expect(engine.undo()).toBe(false);
    engine.cancelStroke();
  });

  it("discards a cancelled stroke without touching the layer", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.beginStroke(createSample());
    engine.extendStroke(createSample({ docX: 40, docY: 20 }));
    engine.cancelStroke();

    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("ignores a second begin without a finish", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    engine.beginStroke(createSample());
    engine.beginStroke(createSample({ docX: 200, docY: 200 }));
    engine.finishStroke();
    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });
});

describe("DrawingEngine document bounds", () => {
  it("ignores a press outside the document rectangle", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    for (const [x, y] of [
      [-1, 150],
      [200, -1],
      [401, 150],
      [200, 301],
    ]) {
      engine.beginStroke(createSample({ docX: x, docY: y }));
      engine.extendStroke(createSample({ docX: x + 10, docY: y + 10 }));
      engine.finishStroke();
    }

    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("does not leave a half-started stroke behind after a rejected press", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.beginStroke(createSample({ docX: -50, docY: 10 }));
    // The rejected press must not block the next, valid one.
    engine.beginStroke(createSample({ docX: 10, docY: 10 }));
    engine.extendStroke(createSample({ docX: 40, docY: 40 }));
    engine.finishStroke();

    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });

  it("accepts a press on the document edge", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.beginStroke(createSample({ docX: 400, docY: 300 }));
    engine.finishStroke();

    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });

  it("keeps recording a stroke that began inside and left the document", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.beginStroke(createSample({ docX: 200, docY: 150 }));
    engine.extendStroke(createSample({ docX: -500, docY: 150 }));
    engine.finishStroke();

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    // Out-of-bounds samples are kept: the layer surface clips them at composite.
    expect(strokes[0].xs).toContain(-500);
  });

  it("rejects a non-finite press", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.beginStroke(createSample({ docX: Number.NaN, docY: 10 }));
    engine.finishStroke();

    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });
});

describe("DrawingEngine layers", () => {
  it("adds, renames, reorders and removes layers", () => {
    const engine = createEngine();
    engine.addLayer();
    let layers = engine.getState().document.layers;
    expect(layers).toHaveLength(2);

    const [bottom, top] = layers;
    expect(engine.getState().document.activeLayerId).toBe(top.id);

    engine.renameLayer(top.id, "  Ink  ");
    expect(engine.getState().document.layers[1].name).toBe("Ink");

    engine.moveLayer(top.id, -1);
    expect(engine.getState().document.layers[0].id).toBe(top.id);

    engine.selectLayer(bottom.id);
    expect(engine.getState().document.activeLayerId).toBe(bottom.id);

    engine.setLayerOpacity(bottom.id, 2);
    expect(engine.getState().document.layers[1].opacity).toBe(1);

    engine.removeLayer(bottom.id);
    expect(engine.getState().document.layers).toHaveLength(1);
    expect(engine.removeLayer(engine.getState().document.layers[0].id)).toBeUndefined();
    expect(engine.getState().document.layers).toHaveLength(1);
  });

  it("drops the strokes of a removed layer", () => {
    const engine = createEngine();
    engine.addLayer();
    const removedId = engine.getState().document.activeLayerId as string;
    engine.beginStroke(createSample());
    engine.finishStroke();
    expect(engine.listStrokes(removedId)).toHaveLength(1);

    engine.removeLayer(removedId);
    expect(engine.listStrokes(removedId)).toHaveLength(0);
  });

  it("starts a new document with a cleared history and stroke store", () => {
    const engine = createEngine();
    const firstLayerId = engine.getState().document.activeLayerId as string;
    engine.beginStroke(createSample());
    engine.finishStroke();
    engine.setBrush({ size: 30 });

    engine.newDocument({ name: "Fresh", width: 800, height: 400 });

    const state = engine.getState();
    expect(state.document.name).toBe("Fresh");
    expect(state.document.width).toBe(800);
    expect(state.document.layers).toHaveLength(1);
    expect(state.history.canUndo).toBe(false);
    expect(engine.listStrokes(firstLayerId)).toHaveLength(0);
    // Brush settings are a user preference and survive a new document.
    expect(state.brush.size).toBe(30);
  });
});

describe("DrawingEngine layer history", () => {
  it("undoes and redoes a deleted layer together with its strokes", () => {
    const engine = createEngine();
    const baseLayerId = engine.getState().document.activeLayerId as string;

    engine.addLayer();
    const addedLayerId = engine.getState().document.activeLayerId as string;
    engine.beginStroke(createSample());
    engine.finishStroke();
    expect(engine.listStrokes(addedLayerId)).toHaveLength(1);

    engine.removeLayer(addedLayerId);
    expect(engine.getState().document.layers.map((layer) => layer.id)).not.toContain(addedLayerId);
    expect(engine.listStrokes(addedLayerId)).toHaveLength(0);

    // Undoing the deletion brings the layer and every stroke on it back.
    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers.map((layer) => layer.id)).toContain(addedLayerId);
    expect(engine.listStrokes(addedLayerId)).toHaveLength(1);
    expect(engine.getState().document.activeLayerId).toBe(addedLayerId);

    expect(engine.redo()).toBe(true);
    expect(engine.listStrokes(addedLayerId)).toHaveLength(0);

    // Walking back past the deletion also unwinds the stroke and the add.
    expect(engine.undo()).toBe(true);
    expect(engine.listStrokes(addedLayerId)).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.listStrokes(addedLayerId)).toHaveLength(0);
    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers).toHaveLength(1);
    expect(engine.getState().document.activeLayerId).toBe(baseLayerId);
    expect(engine.undo()).toBe(false);
  });

  it("records rename, visibility, opacity and reorder as separate steps", () => {
    const engine = createEngine();
    engine.addLayer();
    const topLayerId = engine.getState().document.activeLayerId as string;
    const afterAdd = engine.getState().history.depth;

    engine.renameLayer(topLayerId, "Ink");
    engine.setLayerVisibility(topLayerId, false);
    engine.setLayerOpacity(topLayerId, 0.5);
    engine.moveLayer(topLayerId, -1);
    expect(engine.getState().history.depth).toBe(afterAdd + 4);
    expect(engine.getState().document.layers[0].id).toBe(topLayerId);

    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers[1].id).toBe(topLayerId);
    engine.undo();
    expect(engine.getState().document.layers[1].opacity).toBe(1);
    engine.undo();
    expect(engine.getState().document.layers[1].visible).toBe(true);
    engine.undo();
    expect(engine.getState().document.layers[1].name).toBe("Layer 2");
  });

  it("collapses an opacity drag into one undo step", () => {
    const engine = createEngine();
    engine.addLayer();
    const topLayerId = engine.getState().document.activeLayerId as string;
    const afterAdd = engine.getState().history.depth;

    for (let step = 20; step >= 8; step -= 1) {
      engine.setLayerOpacity(topLayerId, step / 20);
    }
    expect(engine.getState().document.layers[1].opacity).toBeCloseTo(0.4, 5);
    expect(engine.getState().history.depth).toBe(afterAdd + 1);

    // A different kind of step ends the run; only then does a new one start.
    engine.setLayerVisibility(topLayerId, false);
    engine.setLayerOpacity(topLayerId, 0.9);
    expect(engine.getState().history.depth).toBe(afterAdd + 3);

    engine.undo();
    engine.undo();
    engine.undo();
    expect(engine.getState().document.layers[1].opacity).toBe(1);
    expect(engine.getState().document.layers[1].visible).toBe(true);
  });

  it("counts layer edits as unsaved work but not layer selection", () => {
    const engine = createEngine();
    expect(engine.getState().file.dirty).toBe(false);

    engine.addLayer();
    expect(engine.getState().file.dirty).toBe(true);

    engine.markSaved("C:\\work\\drawing.paka");
    expect(engine.getState().file.dirty).toBe(false);

    const bottomLayerId = engine.getState().document.layers[0].id;
    engine.selectLayer(bottomLayerId);
    expect(engine.getState().file.dirty).toBe(false);
    expect(engine.getState().history.depth).toBe(1);

    engine.renameLayer(bottomLayerId, "Base");
    expect(engine.getState().file.dirty).toBe(true);
  });

  it("duplicates a layer with its strokes and undoes the copy", () => {
    const engine = createEngine();
    const sourceLayerId = engine.getState().document.activeLayerId as string;
    engine.beginStroke(createSample({ docX: 20, docY: 20 }));
    engine.finishStroke();

    engine.duplicateLayer(sourceLayerId);
    const layers = engine.getState().document.layers;
    expect(layers).toHaveLength(2);

    const copy = layers[1];
    expect(copy.name).toBe("Layer 1 copy");
    expect(engine.getState().document.activeLayerId).toBe(copy.id);
    expect(engine.listStrokes(copy.id)).toHaveLength(1);
    // The copy's stroke is a distinct record, not a shared reference.
    expect(engine.listStrokes(copy.id)[0].id).not.toBe(engine.listStrokes(sourceLayerId)[0].id);

    engine.undo();
    expect(engine.getState().document.layers).toHaveLength(1);
    expect(engine.listStrokes(copy.id)).toHaveLength(0);
    expect(engine.listStrokes(sourceLayerId)).toHaveLength(1);

    engine.redo();
    expect(engine.getState().document.layers).toHaveLength(2);
    expect(engine.listStrokes(copy.id)).toHaveLength(1);
  });

  it("does not re-rasterize layers for metadata-only changes", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });

    engine.addLayer();
    const [bottomLayerId, topLayerId] = engine.getState().document.layers.map((layer) => layer.id);

    engine.renameLayer(topLayerId, "Ink");
    engine.setLayerVisibility(topLayerId, false);
    engine.setLayerOpacity(topLayerId, 0.5);
    engine.moveLayer(topLayerId, -1);
    engine.selectLayer(bottomLayerId);

    // Every surface's pixels are still valid: nothing was invalidated.
    expect(spy.invalidated).toEqual([]);
    expect(spy.getDocuments()).toBeGreaterThan(0);

    // Undoing the same operations must not invalidate either.
    engine.undo();
    engine.undo();
    expect(spy.invalidated).toEqual([]);
  });

  it("invalidates a layer only when history re-rasterizes it", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.beginStroke(createSample());
    engine.finishStroke();
    // The stroke was rasterized into the layer surface as it was drawn, so
    // committing it re-rasterizes nothing.
    expect(spy.invalidated).toEqual([]);

    engine.undo();
    expect(spy.invalidated).toContain(layerId);

    spy.invalidated.length = 0;
    engine.redo();
    expect(spy.invalidated).toContain(layerId);
  });
});
