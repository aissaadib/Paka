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
import { DEFAULT_BRUSH, MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from "../core/brushes/defaults";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import type { DrawingRenderer, RendererSelection, Rgb } from "../core/rendering/types";
import type { StrokeRecord } from "../core/document/types";
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
function createSpyRenderer(options: { readonly compositePixel?: Rgb | null } = {}) {
  const invalidated: string[] = [];
  const sampled: Array<{ x: number; y: number }> = [];
  const began: StrokeRecord[] = [];
  const replaced: Array<{ xs: number[]; ys: number[] }> = [];
  const ended: StrokeRecord[] = [];
  const selections: Array<RendererSelection | null> = [];
  let cancelled = 0;
  let documents = 0;
  let renders = 0;
  // `undefined` means "no colour here" (the same answer as an empty document).
  const compositePixel = options.compositePixel ?? null;

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
    beginStroke: (stroke) => {
      began.push(stroke);
    },
    extendStroke: () => {},
    replaceStroke: (stroke) => {
      replaced.push({ xs: [...stroke.xs], ys: [...stroke.ys] });
    },
    endStroke: (stroke) => {
      ended.push(stroke);
    },
    cancelStroke: () => {
      cancelled += 1;
    },
    setSelection: (selection) => {
      selections.push(selection);
    },
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    readCompositePixel: (docX, docY) => {
      sampled.push({ x: docX, y: docY });
      return compositePixel;
    },
    render: () => {},
    requestRender: () => {
      renders += 1;
    },
    destroy: () => {},
  };

  return {
    renderer,
    invalidated,
    sampled,
    began,
    replaced,
    ended,
    selections,
    getCancelled: () => cancelled,
    getDocuments: () => documents,
    getRenders: () => renders,
  };
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

describe("DrawingEngine colour picker", () => {
  it("sets the brush colour from the composite without editing the document", () => {
    const spy = createSpyRenderer({ compositePixel: { r: 204, g: 51, b: 102 } });
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("picker");
    expect(engine.getCursor()).toBe("crosshair");

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 100, docY: 40, button: 0, buttons: 1 }),
    );

    // The renderer is asked at the document position the input pipeline
    // produced, and its colour becomes the brush colour.
    expect(spy.sampled).toEqual([{ x: 100, y: 40 }]);
    expect(engine.getState().brush.color).toBe("#cc3366");

    // Picking is not an edit: no stroke, no history entry, no dirty marker.
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().history.canUndo).toBe(false);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("ignores a pick outside the document rectangle", () => {
    const spy = createSpyRenderer({ compositePixel: { r: 255, g: 255, b: 255 } });
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const before = engine.getState().brush.color;

    engine.setTool("picker");
    for (const [x, y] of [
      [-1, 150],
      [200, -1],
      [401, 150],
      [200, 301],
    ]) {
      engine.handlePointerSample(createSample({ phase: "down", docX: x, docY: y }));
    }

    expect(spy.sampled).toEqual([]);
    expect(engine.getState().brush.color).toBe(before);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("leaves the brush colour alone when the renderer reports no pixel", () => {
    const spy = createSpyRenderer({ compositePixel: null });
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
      brush: { ...DEFAULT_BRUSH, color: "#123456" },
    });

    engine.setTool("picker");
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 40 }));

    expect(spy.sampled).toEqual([{ x: 100, y: 40 }]);
    expect(engine.getState().brush.color).toBe("#123456");
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });
});

describe("DrawingEngine shape tools", () => {
  it("previews in the stroke buffer and commits one stroke on release", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("rectangle");
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 100 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 200, docY: 150 }));

    // Mid-drag the shape is only a preview: one full-buffer redraw, no stroke,
    // no history entry.
    expect(spy.began).toHaveLength(1);
    expect(spy.replaced).toHaveLength(1);
    expect(spy.ended).toHaveLength(0);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);

    engine.handlePointerSample(createSample({ phase: "up", docX: 200, docY: 150 }));

    expect(spy.ended).toHaveLength(1);
    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    // A closed rectangle: four corners plus the repeated first point.
    expect(strokes[0].xs).toEqual([100, 200, 200, 100, 100]);
    expect(strokes[0].ys).toEqual([100, 100, 150, 150, 100]);
    expect(strokes[0].pressures).toEqual([1, 1, 1, 1, 1]);
    expect(engine.getState().history.depth).toBe(1);
    expect(engine.getState().file.dirty).toBe(true);
  });

  it("snaps a line to 45 degrees under Shift", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("line");
    engine.handlePointerSample(createSample({ phase: "down", docX: 0, docY: 0 }));
    const shiftHeld = { shift: true, alt: false, ctrl: false, meta: false };
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 100, docY: 10, modifiers: shiftHeld }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 100, docY: 10, modifiers: shiftHeld }),
    );

    const stroke = engine.listStrokes(layerId)[0];
    expect(stroke.xs).toHaveLength(2);
    // Snapped to horizontal: the y offset collapses to zero.
    expect(stroke.ys[1]).toBeCloseTo(0, 10);
    expect(stroke.xs[1]).toBeCloseTo(Math.hypot(100, 10), 6);
  });

  it("draws a rectangle from its centre under Alt", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("rectangle");
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 100 }));
    const altHeld = { shift: false, alt: true, ctrl: false, meta: false };
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 150, docY: 130, modifiers: altHeld }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 150, docY: 130, modifiers: altHeld }),
    );

    const stroke = engine.listStrokes(layerId)[0];
    expect(Math.min(...stroke.xs)).toBe(50);
    expect(Math.max(...stroke.xs)).toBe(150);
    expect(Math.min(...stroke.ys)).toBe(70);
    expect(Math.max(...stroke.ys)).toBe(130);
  });

  it("commits the geometry of the release point, not the last move", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("line");
    engine.handlePointerSample(createSample({ phase: "down", docX: 0, docY: 0 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 100, docY: 0 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 60, docY: 80 }));

    const stroke = engine.listStrokes(layerId)[0];
    expect(stroke.xs).toEqual([0, 60]);
    expect(stroke.ys).toEqual([0, 80]);
  });

  it("discards a click that never moved", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("ellipse");
    engine.handlePointerSample(createSample({ phase: "down", docX: 50, docY: 50 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 50, docY: 50 }));

    expect(spy.replaced).toHaveLength(0);
    expect(spy.ended).toHaveLength(0);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("ignores a shape that starts outside the document", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("rectangle");
    engine.handlePointerSample(createSample({ phase: "down", docX: -5, docY: 40 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 100, docY: 100 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 100, docY: 100 }));

    expect(spy.began).toHaveLength(0);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("discards an in-progress shape on cancellation", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("ellipse");
    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 120, docY: 90 }));
    engine.handlePointerSample(createSample({ phase: "cancel", docX: 120, docY: 90 }));

    expect(spy.ended).toHaveLength(0);
    expect(spy.getCancelled()).toBe(1);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("discards an in-progress shape when the tool changes mid-drag", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("rectangle");
    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 120, docY: 90 }));
    engine.setTool("brush");

    expect(spy.ended).toHaveLength(0);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().toolId).toBe("brush");
  });
});

/**
 * Selection and transform.
 *
 * Driven through the same pointer entry point the DOM binder uses, so each test
 * covers the whole path - press, gesture, release, history - with only the
 * renderer faked out (which is also how the overlay is asserted).
 */
describe("DrawingEngine selection", () => {
  function createSelectingEngine() {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    return { engine, spy, layerId: engine.getState().document.activeLayerId as string };
  }

  /** Paints one stroke with the brush tool, following the given polyline. */
  function paint(engine: DrawingEngine, points: ReadonlyArray<readonly [number, number]>): void {
    engine.setTool("brush");
    handle(engine, points, "up");
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

  it("selects the strokes a marquee meets, with a frame around their paint", () => {
    const { engine, spy, layerId } = createSelectingEngine();
    paint(engine, [
      [50, 50],
      [100, 50],
    ]);
    paint(engine, [
      [300, 250],
      [350, 250],
    ]);
    const depth = engine.getState().history.depth;
    engine.setTool("select");

    handle(engine, [
      [10, 10],
      [150, 120],
    ], "up");

    expect(engine.getState().selectedStrokes).toBe(1);
    const overlay = spy.selections[spy.selections.length - 1];
    expect(overlay?.strokes).toHaveLength(1);
    expect(overlay?.strokes[0].id).toBe(engine.listStrokes(layerId)[0].id);
    // The frame is derived from the stroke's paint, not from the marquee: the
    // centreline sits at y = 50 and the default brush is 6 wide, so it spans 47.
    expect(overlay?.bounds?.y).toBeCloseTo(50 - DEFAULT_BRUSH.size / 2, 6);
    expect(overlay?.bounds?.height).toBeCloseTo(DEFAULT_BRUSH.size, 6);
    // Selecting is not an edit: no history step, and nothing became dirty.
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("shows the rubber band, and the previous selection, while dragging", () => {
    const { engine, spy } = createSelectingEngine();
    paint(engine, [
      [50, 50],
      [100, 50],
    ]);
    engine.setTool("select");

    engine.handlePointerSample(createSample({ phase: "down", docX: 10, docY: 10 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 120, docY: 80 }));

    const overlay = spy.selections[spy.selections.length - 1];
    expect(overlay?.bounds).toEqual({ x: 10, y: 10, width: 110, height: 70 });
    expect(overlay?.strokes).toEqual([]);

    engine.handlePointerSample(createSample({ phase: "up", docX: 120, docY: 80 }));
    expect(engine.getState().selectedStrokes).toBe(1);
  });

  it("selects on a click and clears on a click over empty paper", () => {
    const { engine, spy } = createSelectingEngine();
    paint(engine, [
      [50, 50],
      [100, 50],
    ]);
    engine.setTool("select");

    // A press that never moved is a zero-size marquee: it hit-tests the point.
    handle(engine, [
      [50, 50],
      [50, 50],
    ], "up");
    expect(engine.getState().selectedStrokes).toBe(1);

    handle(engine, [
      [390, 290],
      [390, 290],
    ], "up");
    expect(engine.getState().selectedStrokes).toBe(0);
    expect(spy.selections[spy.selections.length - 1]).toBeNull();
  });

  it("translates the selected strokes and records one undoable step", () => {
    const { engine, layerId } = createSelectingEngine();
    paint(engine, [
      [50, 50],
      [100, 50],
    ]);
    engine.setTool("select");
    handle(engine, [
      [10, 10],
      [150, 120],
    ], "up");
    const depth = engine.getState().history.depth;

    const before = engine.listStrokes(layerId)[0];
    const originalXs = [...before.xs];
    const originalYs = [...before.ys];

    // Press inside the frame, drag, release: +30 horizontally, +60 vertically.
    handle(engine, [
      [60, 50],
      [80, 70],
      [90, 110],
    ], "up");

    const moved = engine.listStrokes(layerId)[0];
    expect(moved.xs).toHaveLength(originalXs.length);
    for (let index = 0; index < originalXs.length; index += 1) {
      expect(moved.xs[index]).toBe(originalXs[index] + 30);
      expect(moved.ys[index]).toBe(originalYs[index] + 60);
    }
    expect(engine.getState().history.depth).toBe(depth + 1);
    expect(engine.getState().selectedStrokes).toBe(1);

    engine.undo();
    expect(engine.listStrokes(layerId)[0].xs).toEqual(originalXs);
    expect(engine.listStrokes(layerId)[0].ys).toEqual(originalYs);

    engine.redo();
    expect(engine.listStrokes(layerId)[0].xs).toEqual(originalXs.map((value) => value + 30));
    expect(engine.listStrokes(layerId)[0].ys).toEqual(originalYs.map((value) => value + 60));
  });

  it("records nothing for a press inside the selection that never moved", () => {
    const { engine } = createSelectingEngine();
    paint(engine, [
      [50, 50],
      [100, 50],
    ]);
    engine.setTool("select");
    handle(engine, [
      [10, 10],
      [150, 120],
    ], "up");
    const depth = engine.getState().history.depth;

    handle(engine, [
      [60, 50],
      [60, 50],
    ], "up");

    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.getState().selectedStrokes).toBe(1);
  });

  it("restores the strokes when a move is cancelled", () => {
    const { engine, layerId } = createSelectingEngine();
    paint(engine, [
      [50, 50],
      [100, 50],
    ]);
    engine.setTool("select");
    handle(engine, [
      [10, 10],
      [150, 120],
    ], "up");
    const depth = engine.getState().history.depth;
    const before = engine.listStrokes(layerId)[0];
    const originalXs = [...before.xs];
    const originalYs = [...before.ys];

    handle(engine, [
      [60, 50],
      [140, 130],
    ], "cancel");

    expect(engine.listStrokes(layerId)[0].xs).toEqual(originalXs);
    expect(engine.listStrokes(layerId)[0].ys).toEqual(originalYs);
    expect(engine.getState().history.depth).toBe(depth);
    // The selection survives a cancelled move: only the translation is undone.
    expect(engine.getState().selectedStrokes).toBe(1);
  });

  it("deletes the selected strokes in one step and restores their order on undo", () => {
    const { engine, layerId } = createSelectingEngine();
    paint(engine, [
      [50, 50],
      [80, 50],
    ]);
    paint(engine, [
      [150, 50],
      [180, 50],
    ]);
    paint(engine, [
      [300, 250],
      [330, 250],
    ]);
    const ids = engine.listStrokes(layerId).map((stroke) => stroke.id);
    engine.setTool("select");
    handle(engine, [
      [20, 20],
      [220, 100],
    ], "up");
    expect(engine.getState().selectedStrokes).toBe(2);
    const depth = engine.getState().history.depth;

    expect(engine.deleteSelection()).toBe(true);

    expect(engine.listStrokes(layerId).map((stroke) => stroke.id)).toEqual([ids[2]]);
    expect(engine.getState().selectedStrokes).toBe(0);
    expect(engine.getState().history.depth).toBe(depth + 1);

    engine.undo();
    expect(engine.listStrokes(layerId).map((stroke) => stroke.id)).toEqual(ids);
    expect(engine.getState().history.depth).toBe(depth);
    // Nothing is selected after deleting, so deleting again is a no-op.
    expect(engine.deleteSelection()).toBe(false);
  });

  it("keeps the selection to one layer, and drops it on a layer or tool change", () => {
    const { engine, spy, layerId } = createSelectingEngine();
    paint(engine, [
      [50, 50],
      [100, 50],
    ]);
    engine.addLayer();
    const secondLayerId = engine.getState().document.activeLayerId as string;
    paint(engine, [
      [50, 60],
      [100, 60],
    ]);
    engine.setTool("select");

    handle(engine, [
      [20, 20],
      [120, 120],
    ], "up");

    // Both strokes are inside the marquee; only the active layer's is selected.
    expect(engine.getState().selectedStrokes).toBe(1);
    expect(spy.selections[spy.selections.length - 1]?.strokes[0].layerId).toBe(secondLayerId);
    expect(layerId).not.toBe(secondLayerId);

    engine.setTool("brush");
    expect(engine.getState().selectedStrokes).toBe(0);
    expect(spy.selections[spy.selections.length - 1]).toBeNull();
  });

  it("drops the selection when another layer becomes active", () => {
    const { engine } = createSelectingEngine();
    engine.addLayer();
    paint(engine, [
      [50, 50],
      [100, 50],
    ]);
    const drawingLayerId = engine.getState().document.activeLayerId as string;
    engine.setTool("select");
    handle(engine, [
      [20, 20],
      [120, 120],
    ], "up");
    expect(engine.getState().selectedStrokes).toBe(1);

    const otherLayerId = engine
      .getState()
      .document.layers.map((layer) => layer.id)
      .find((id) => id !== drawingLayerId) as string;
    engine.selectLayer(otherLayerId);

    expect(engine.getState().selectedStrokes).toBe(0);
  });
});
