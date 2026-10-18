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
