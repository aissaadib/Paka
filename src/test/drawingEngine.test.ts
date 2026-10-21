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
import {
  DEFAULT_BRUSH,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  MIN_STAMP_SPACING,
} from "../core/brushes/defaults";
import { createDocument } from "../core/document/document";
import { DEFAULT_GRID_SPACING } from "../core/document/grid";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { parseProject } from "../core/project/projectFormat";
import type { DrawingRenderer, RendererSelection, Rgb } from "../core/rendering/types";
import type { StrokeRecord } from "../core/document/types";
import { isFillPatch, isGradient } from "../core/document/types";
import type { Guide } from "../core/document/types";
import type { CursorReport, PointerSample } from "../types/pointer";
import type { Bounds, Point } from "../types/geometry";

function createSample(overrides: Partial<PointerSample> = {}): PointerSample {  return {
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
function createSpyRenderer(
  options: {
    readonly compositePixel?: Rgb | null;
    readonly compositeImage?: ImageData | null;
  } = {},
) {
  const invalidated: string[] = [];
  const sampled: Array<{ x: number; y: number }> = [];
  const began: StrokeRecord[] = [];
  const extended: Array<{ stroke: StrokeRecord; fromIndex: number }> = [];
  const replaced: Array<{ xs: number[]; ys: number[] }> = [];
  const ended: StrokeRecord[] = [];
  const selections: Array<RendererSelection | null> = [];
  const selectedGuides: Array<string | null> = [];
  let cancelled = 0;
  let documents = 0;
  let renders = 0;
  let compositeReads = 0;
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
    extendStroke: (stroke, fromIndex) => {
      extended.push({ stroke, fromIndex });
    },
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
    setSelectedGuide: (guideId) => {
      selectedGuides.push(guideId);
    },
    setGrid: () => {},
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    readCompositePixel: (docX, docY) => {
      sampled.push({ x: docX, y: docY });
      return compositePixel;
    },
    readCompositeImage: () => {
      compositeReads += 1;
      return options.compositeImage ?? null;
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
    extended,
    replaced,
    ended,
    selections,
    selectedGuides,
    getCancelled: () => cancelled,
    getDocuments: () => documents,
    getRenders: () => renders,
    getCompositeReads: () => compositeReads,
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

  it("treats hardness as editor state: no history step, no dirty flag", () => {
    const engine = createEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setBrush({ hardness: 0.5 });
    expect(engine.getState().brush.hardness).toBe(0.5);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(engine.getState().history).toMatchObject({ depth: 0, canUndo: false });
    expect(engine.getState().file.dirty).toBe(false);

    // Out of range is clamped, and a no-op change publishes nothing.
    engine.setBrush({ hardness: 3 });
    expect(engine.getState().brush.hardness).toBe(1);
    expect(listener).toHaveBeenCalledTimes(2);
    engine.setBrush({ hardness: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("treats spacing, stabilizer and texture as editor state: no history step, no dirty flag", () => {
    const engine = createEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setBrush({ spacing: 0.4, stabilizer: 0.7, texture: 0.5 });
    expect(engine.getState().brush.spacing).toBe(0.4);
    expect(engine.getState().brush.stabilizer).toBe(0.7);
    expect(engine.getState().brush.texture).toBe(0.5);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(engine.getState().history).toMatchObject({ depth: 0, canUndo: false });
    expect(engine.getState().file.dirty).toBe(false);

    // Out-of-range values are clamped, and a no-op change publishes nothing.
    engine.setBrush({ spacing: 0.001, stabilizer: 4, texture: 3 });
    expect(engine.getState().brush.spacing).toBe(0.02);
    expect(engine.getState().brush.stabilizer).toBe(1);
    expect(engine.getState().brush.texture).toBe(1);
    expect(listener).toHaveBeenCalledTimes(2);
    engine.setBrush({ spacing: 0.02, stabilizer: 1, texture: 1 });
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

  it("captures the brush's hardness per stroke, so a later change rewrites nothing", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setBrush({ hardness: 0.4, size: 20 });
    engine.beginStroke(createSample({ docX: 10, docY: 10 }));
    engine.extendStroke(createSample({ docX: 60, docY: 40, timeStamp: 16 }));
    engine.finishStroke();

    expect(engine.listStrokes(layerId)[0].brush.hardness).toBe(0.4);

    // Changing the setting describes the next stroke; it never rewrites an
    // existing record's brush - which is what makes undo/reopen re-render the
    // stroke with the softness it was drawn with.
    engine.setBrush({ hardness: 1 });
    expect(engine.listStrokes(layerId)[0].brush.hardness).toBe(0.4);

    engine.setBrush({ hardness: 0.2 });
    expect(engine.undo()).toBe(true);
    expect(engine.redo()).toBe(true);
    expect(engine.listStrokes(layerId)[0].brush.hardness).toBe(0.4);
  });

  it("captures spacing, stabilizer and texture per stroke", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setBrush({ size: 100, spacing: 0.3, stabilizer: 0.8, texture: 0.6 });
    engine.beginStroke(createSample({ docX: 10, docY: 10 }));
    engine.extendStroke(createSample({ docX: 110, docY: 10, timeStamp: 16 }));
    engine.finishStroke();

    const stroke = engine.listStrokes(layerId)[0];
    expect(stroke.brush.spacing).toBe(0.3);
    expect(stroke.brush.stabilizer).toBe(0.8);
    expect(stroke.brush.texture).toBe(0.6);

    engine.setBrush({ spacing: 0.05, stabilizer: 0, texture: 0 });
    expect(engine.listStrokes(layerId)[0].brush.spacing).toBe(0.3);
    expect(engine.listStrokes(layerId)[0].brush.stabilizer).toBe(0.8);
    expect(engine.listStrokes(layerId)[0].brush.texture).toBe(0.6);
  });

  it("treats the stamp settings as editor state: no history step, no dirty flag", () => {
    const engine = createEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setBrush({ stamp: true, stampSpacing: 0.3, stampHardness: 0.5 });
    expect(engine.getState().brush.stamp).toBe(true);
    expect(engine.getState().brush.stampSpacing).toBe(0.3);
    expect(engine.getState().brush.stampHardness).toBe(0.5);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(engine.getState().history).toMatchObject({ depth: 0, canUndo: false });
    expect(engine.getState().file.dirty).toBe(false);

    // Out-of-range values are clamped, and a no-op change publishes nothing.
    engine.setBrush({ stampSpacing: 0.001, stampHardness: 4 });
    expect(engine.getState().brush.stampSpacing).toBe(MIN_STAMP_SPACING);
    expect(engine.getState().brush.stampHardness).toBe(1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("captures the stamp settings per stroke, so a later change rewrites nothing", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setBrush({ stamp: true, stampSpacing: 0.25, stampHardness: 0.4 });
    engine.beginStroke(createSample({ docX: 10, docY: 10 }));
    engine.extendStroke(createSample({ docX: 60, docY: 40, timeStamp: 16 }));
    engine.finishStroke();

    const stroke = engine.listStrokes(layerId)[0];
    expect(stroke.brush.stamp).toBe(true);
    expect(stroke.brush.stampSpacing).toBe(0.25);
    expect(stroke.brush.stampHardness).toBe(0.4);

    // Changing the setting describes the next stroke; it never rewrites an
    // existing record's brush.
    engine.setBrush({ stamp: false, stampSpacing: 0.9, stampHardness: 1 });
    expect(engine.listStrokes(layerId)[0].brush.stamp).toBe(true);
    expect(engine.listStrokes(layerId)[0].brush.stampSpacing).toBe(0.25);
    expect(engine.listStrokes(layerId)[0].brush.stampHardness).toBe(0.4);

    // A stamped stroke is one undo step, like any other.
    expect(engine.getState().history).toMatchObject({ depth: 1, canUndo: true });
    expect(engine.undo()).toBe(true);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.redo()).toBe(true);
    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });

  it("draws shapes with the plain segment path, even when the brush is stamped", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setBrush({ stamp: true });
    engine.setTool("rectangle");
    engine.handlePointerSample(createSample({ phase: "down", docX: 10, docY: 10 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 60, docY: 40, timeStamp: 16 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 60, docY: 40, timeStamp: 32 }));

    // A shape is an outline, not a chain of dabs, so its record says so.
    expect(engine.listStrokes(layerId)).toHaveLength(1);
    expect(engine.listStrokes(layerId)[0].brush.stamp).toBe(false);
  });

  it("settles a stabilized stroke on the release point before committing", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
      brush: { ...DEFAULT_BRUSH, size: 200, spacing: 2, stabilizer: 1 },
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.beginStroke(
      createSample({ phase: "down", docX: 10, docY: 10, pressure: 0.2, timeStamp: 0 }),
    );
    engine.extendStroke(createSample({ docX: 110, docY: 10, pressure: 1, timeStamp: 16 }));
    engine.finishStroke();

    // follow = 0.25: 10 -> 35, then finish settles on the raw release point.
    const stroke = engine.listStrokes(layerId)[0];
    expect(stroke.xs).toEqual([10, 35, 110]);
    expect(stroke.pressures).toEqual([0.2, 0.4, 1]);
    // The settle was previewed through the renderer before the stroke ended.
    expect(spy.extended.map((entry) => entry.fromIndex)).toEqual([0, 1, 2]);
    expect(spy.ended[0]).toBe(stroke);
  });

  it("does not append a settle point when the pointer stopped exactly on the path", () => {
    const builderEngine = new DrawingEngine({
      brush: { ...DEFAULT_BRUSH, size: 200, spacing: 2, stabilizer: 1 },
    });
    const layerId = builderEngine.getState().document.activeLayerId as string;

    builderEngine.beginStroke(createSample({ phase: "down", docX: 50, docY: 50 }));
    builderEngine.finishStroke();

    const stroke = builderEngine.listStrokes(layerId)[0];
    expect(stroke.xs).toEqual([50]);
    expect(stroke.ys).toEqual([50]);
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

  it("records layer blend mode changes as one undoable step", () => {
    const engine = createEngine();
    engine.addLayer();
    const topLayerId = engine.getState().document.activeLayerId as string;
    const afterAdd = engine.getState().history.depth;
    engine.markSaved("C:\\work\\blend.paka");
    expect(engine.getState().file.dirty).toBe(false);

    engine.setLayerBlendMode(topLayerId, "multiply");
    expect(engine.getState().document.layers[1].blendMode).toBe("multiply");
    expect(engine.getState().history.depth).toBe(afterAdd + 1);
    expect(engine.getState().file.dirty).toBe(true);

    engine.setLayerBlendMode(topLayerId, "multiply");
    expect(engine.getState().history.depth).toBe(afterAdd + 1);

    engine.setLayerBlendMode(topLayerId, "screen");
    expect(engine.getState().history.depth).toBe(afterAdd + 2);

    engine.setLayerBlendMode(topLayerId, "difference");
    expect(engine.getState().document.layers[1].blendMode).toBe("difference");
    expect(engine.getState().history.depth).toBe(afterAdd + 3);

    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers[1].blendMode).toBe("screen");
    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers[1].blendMode).toBe("multiply");
    expect(engine.undo()).toBe(true);
    expect(engine.getState().document.layers[1].blendMode).toBe("normal");
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

  it("marks a shape as filled only while the fill setting is on", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;
    const rectangle = (x: number): void => {
      engine.handlePointerSample(createSample({ phase: "down", docX: 0, docY: 0 }));
      engine.handlePointerSample(createSample({ phase: "move", docX: x, docY: x }));
      engine.handlePointerSample(createSample({ phase: "up", docX: x, docY: x }));
    };

    // The default is an outline, and choosing it is not an edit.
    expect(engine.getState().shapeFill).toBe(false);
    engine.setTool("rectangle");
    rectangle(50);
    expect(engine.listStrokes(layerId)[0].fill).toBe(false);

    engine.setShapeFill(true);
    expect(engine.getState().shapeFill).toBe(true);
    rectangle(100);
    expect(engine.listStrokes(layerId)[1].fill).toBe(true);

    // Each stroke keeps the setting it was drawn with: turning the fill off
    // does not rewrite the shapes already committed.
    engine.setShapeFill(false);
    rectangle(150);
    expect(engine.listStrokes(layerId)[1].fill).toBe(true);
    expect(engine.listStrokes(layerId)[2].fill).toBe(false);

    // Drawing filled shapes is a change like any other, but the setting itself
    // is not: it describes the next shape, so it neither dirties the file nor
    // enters history.
    expect(engine.getState().history.depth).toBe(3);
  });

  it("never fills a line, whose outline bounds no area", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setShapeFill(true);
    engine.setTool("line");
    engine.handlePointerSample(createSample({ phase: "down", docX: 0, docY: 0 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 100, docY: 0 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 100, docY: 0 }));

    expect(engine.listStrokes(layerId)[0].fill).toBe(false);
  });

  it("keeps the fill setting across a tool switch", () => {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });

    engine.setShapeFill(true);
    engine.setTool("ellipse");
    expect(engine.getState().shapeFill).toBe(true);
    engine.setTool("brush");
    expect(engine.getState().shapeFill).toBe(true);
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
 * The polygon and the star.
 *
 * A polygon and a star are ordinary strokes whose samples trace the outline,
 * so these tests are about the geometry the engine hands over and about the
 * options that shape it - not about a new kind of content.
 */
describe("DrawingEngine polygon and star tools", () => {
  function createShapeEngine() {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer: spy.renderer,
    });
    return { engine, spy, layerId: engine.getState().document.activeLayerId as string };
  }

  /** Drags a shape from one point to another and releases it. */
  function dragShape(
    engine: DrawingEngine,
    from: readonly [number, number],
    to: readonly [number, number],
    modifiers: Partial<PointerSample["modifiers"]> = {},
  ): void {
    const held = { shift: false, alt: false, ctrl: false, meta: false, ...modifiers };
    engine.handlePointerSample(
      createSample({ phase: "down", docX: from[0], docY: from[1], modifiers: held }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: to[0], docY: to[1], modifiers: held }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: to[0], docY: to[1], modifiers: held }),
    );
  }

  it("commits a polygon as one ordinary stroke", () => {
    const { engine, layerId } = createShapeEngine();

    engine.setTool("polygon");
    dragShape(engine, [100, 100], [200, 200]);

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    // Five sides plus the repeated first point.
    expect(strokes[0].xs).toHaveLength(6);
    expect(strokes[0].ys).toHaveLength(6);
    expect(strokes[0].xs[0]).toBeCloseTo(strokes[0].xs[5], 9);
    expect(strokes[0].ys[0]).toBeCloseTo(strokes[0].ys[5], 9);
    expect(engine.getState().history.depth).toBe(1);
    expect(engine.getState().file.dirty).toBe(true);
  });

  it("commits a star with a point per tip", () => {
    const { engine, layerId } = createShapeEngine();

    engine.setTool("star");
    dragShape(engine, [100, 100], [200, 200]);

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    // Five points: five tips and five valleys, plus the repeated first point.
    expect(strokes[0].xs).toHaveLength(11);
    expect(engine.getState().history.depth).toBe(1);
  });

  it("fills a polygon and a star through the existing fill switch", () => {
    const { engine, layerId } = createShapeEngine();

    engine.setShapeFill(true);
    engine.setTool("polygon");
    dragShape(engine, [50, 50], [150, 150]);
    engine.setTool("star");
    dragShape(engine, [200, 50], [300, 150]);

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(2);
    expect(strokes[0].fill).toBe(true);
    expect(strokes[1].fill).toBe(true);
  });

  it("treats the options as editor state: no history step, no dirty flag", () => {
    const { engine } = createShapeEngine();

    engine.setShapeSides(9);
    engine.setShapeInnerRatio(0.25);
    engine.setShapeRotation(45);

    expect(engine.getState().shapeSides).toBe(9);
    expect(engine.getState().shapeInnerRatio).toBe(0.25);
    expect(engine.getState().shapeRotation).toBe(45);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("clamps the options to their documented ranges", () => {
    const { engine } = createShapeEngine();

    engine.setShapeSides(1);
    expect(engine.getState().shapeSides).toBe(3);
    engine.setShapeSides(99);
    expect(engine.getState().shapeSides).toBe(24);
    engine.setShapeSides(7.6);
    expect(engine.getState().shapeSides).toBe(8);
    engine.setShapeInnerRatio(0);
    expect(engine.getState().shapeInnerRatio).toBe(0.05);
    engine.setShapeInnerRatio(4);
    expect(engine.getState().shapeInnerRatio).toBe(1);
    engine.setShapeRotation(-30);
    expect(engine.getState().shapeRotation).toBe(0);
    engine.setShapeRotation(400);
    expect(engine.getState().shapeRotation).toBe(360);
  });

  it("reads the options when the gesture starts, not when it ends", () => {
    const { engine, layerId } = createShapeEngine();

    engine.setShapeSides(6);
    engine.setTool("polygon");
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 100 }));
    // The option changes mid-drag: the shape keeps the sides it started with.
    engine.setShapeSides(3);
    engine.handlePointerSample(createSample({ phase: "move", docX: 200, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 200, docY: 200 }));

    const strokes = engine.listStrokes(layerId);
    expect(strokes[0].xs).toHaveLength(7);
  });

  it("keeps the inner ratio and the rotation it started with", () => {
    const { engine, layerId } = createShapeEngine();

    engine.setShapeInnerRatio(0.25);
    engine.setShapeRotation(90);
    engine.setTool("star");
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 100 }));
    // Both options change mid-drag; the star keeps the ones it started with.
    engine.setShapeInnerRatio(0.9);
    engine.setShapeRotation(0);
    engine.handlePointerSample(createSample({ phase: "move", docX: 200, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 200, docY: 200 }));

    const star = engine.listStrokes(layerId)[0];
    // The box is 100..200 by 100..200, so the centre is (150, 150) and the
    // circle's radius is 50.
    const centre = { x: 150, y: 150 };
    const radius = (index: number): number =>
      Math.hypot(star.xs[index] - centre.x, star.ys[index] - centre.y);
    // A tip is on the circle, a valley at a quarter of it: the inner ratio of
    // 0.25 the star started with.
    expect(radius(0)).toBeCloseTo(50, 6);
    expect(radius(1)).toBeCloseTo(12.5, 6);
    // The rotation of 90 degrees the star started with: the first tip, which
    // starts at the top, is now at the right.
    expect(star.xs[0]).toBeCloseTo(200, 6);
    expect(star.ys[0]).toBeCloseTo(150, 6);
  });

  it("never rewrites a committed shape when an option changes", () => {
    const { engine, layerId } = createShapeEngine();

    engine.setTool("polygon");
    dragShape(engine, [100, 100], [200, 200]);
    const committed = engine.listStrokes(layerId)[0];
    const before = { xs: [...committed.xs], ys: [...committed.ys] };

    engine.setShapeSides(3);
    engine.setShapeInnerRatio(0.9);
    engine.setShapeRotation(45);

    const after = engine.listStrokes(layerId)[0];
    expect(after.xs).toEqual(before.xs);
    expect(after.ys).toEqual(before.ys);
    // And the option changes are not edits of their own.
    expect(engine.getState().history.depth).toBe(1);
  });

  it("draws a polygon from its centre under Alt and squares it under Shift", () => {
    const { engine, layerId } = createShapeEngine();

    engine.setTool("polygon");
    dragShape(engine, [150, 150], [250, 200], { alt: true });
    const centred = engine.listStrokes(layerId)[0];
    // The mean of the vertices is the shape's centre; the closing repeat is
    // not a vertex, so it is left out.
    const vertices = centred.xs.length - 1;
    const centreX =
      centred.xs.slice(0, vertices).reduce((sum, value) => sum + value, 0) / vertices;
    const centreY =
      centred.ys.slice(0, vertices).reduce((sum, value) => sum + value, 0) / vertices;
    expect(centreX).toBeCloseTo(150, 6);
    expect(centreY).toBeCloseTo(150, 6);

    dragShape(engine, [100, 100], [200, 140], { shift: true });
    const squared = engine.listStrokes(layerId)[1];
    // Shift squares the drag's box (100 by 100), so the polygon is regular:
    // every vertex is the same distance from the box's centre.
    for (let index = 0; index < squared.xs.length; index += 1) {
      const radius = Math.hypot(squared.xs[index] - 150, squared.ys[index] - 150);
      expect(radius).toBeCloseTo(50, 6);
    }
  });

  it("discards a click that never moved", () => {
    const { engine, layerId } = createShapeEngine();

    engine.setTool("polygon");
    dragShape(engine, [100, 100], [100, 100]);

    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("draws a shape with the plain segment path, even when the brush is stamped", () => {
    const { engine, layerId } = createShapeEngine();

    engine.setBrush({ stamp: true });
    engine.setTool("star");
    dragShape(engine, [100, 100], [200, 200]);

    expect(engine.listStrokes(layerId)[0].brush.stamp).toBe(false);
  });

  it("selects a polygon and moves it in one undo step", () => {
    const { engine, layerId } = createShapeEngine();

    engine.setTool("polygon");
    dragShape(engine, [100, 100], [200, 200]);
    const before = [...engine.listStrokes(layerId)[0].xs];

    engine.setTool("select");
    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 280, docY: 280 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 280, docY: 280 }));
    expect(engine.getState().selectedStrokes).toBe(1);

    const depth = engine.getState().history.depth;
    engine.handlePointerSample(createSample({ phase: "down", docX: 150, docY: 150 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 170, docY: 150 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 170, docY: 150 }));

    const moved = engine.listStrokes(layerId)[0];
    expect(moved.xs[0]).toBeCloseTo(before[0] + 20, 6);
    expect(engine.getState().history.depth).toBe(depth + 1);
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

  it("nudges the selection and coalesces a run into one step", () => {
    const { engine, layerId } = createSelectingEngine();
    paint(engine, [
      [100, 100],
      [200, 150],
    ]);
    engine.setTool("select");
    handle(engine, [
      [50, 50],
      [250, 200],
    ], "up");
    const depth = engine.getState().history.depth;
    const stroke = engine.listStrokes(layerId)[0];
    const originalXs = [...stroke.xs];
    const originalYs = [...stroke.ys];

    expect(engine.nudgeSelection(1, 0)).toBe(true);
    expect(engine.nudgeSelection(0, 1)).toBe(true);

    const nudged = engine.listStrokes(layerId)[0];
    expect(nudged.xs).toEqual(originalXs.map((x) => x + 1));
    expect(nudged.ys).toEqual(originalYs.map((y) => y + 1));
    // A run of nudges is one history step, like a slider drag.
    expect(engine.getState().history.depth).toBe(depth + 1);

    engine.undo();
    expect(engine.listStrokes(layerId)[0].xs).toEqual(originalXs);
    expect(engine.listStrokes(layerId)[0].ys).toEqual(originalYs);
    expect(engine.getState().history.depth).toBe(depth);

    engine.redo();
    expect(engine.listStrokes(layerId)[0].xs).toEqual(originalXs.map((x) => x + 1));
    expect(engine.listStrokes(layerId)[0].ys).toEqual(originalYs.map((y) => y + 1));
  });

  it("starts a new nudge run when the selection is made again", () => {
    const { engine, layerId } = createSelectingEngine();
    paint(engine, [
      [100, 100],
      [200, 100],
    ]);
    engine.setTool("select");
    handle(engine, [
      [50, 50],
      [250, 150],
    ], "up");
    const depth = engine.getState().history.depth;

    engine.nudgeSelection(1, 0);
    engine.nudgeSelection(1, 0);
    expect(engine.getState().history.depth).toBe(depth + 1);

    // Deselecting and reselecting the same stroke is a new run, not a
    // continuation of the last one: the user's undo steps must match the
    // gestures they made.
    engine.clearSelection();
    handle(engine, [
      [50, 50],
      [250, 150],
    ], "up");
    engine.nudgeSelection(1, 0);
    expect(engine.getState().history.depth).toBe(depth + 2);

    engine.undo();
    expect(engine.listStrokes(layerId)[0].xs[0]).toBeCloseTo(102, 6);
    engine.undo();
    expect(engine.listStrokes(layerId)[0].xs[0]).toBeCloseTo(100, 6);
  });

  it("duplicates the selection above its originals and selects the copies", () => {
    const { engine, layerId } = createSelectingEngine();
    paint(engine, [
      [100, 100],
      [200, 100],
    ]);
    paint(engine, [
      [300, 250],
      [350, 250],
    ]);
    const ids = engine.listStrokes(layerId).map((stroke) => stroke.id);
    engine.setTool("select");
    handle(engine, [
      [50, 50],
      [250, 150],
    ], "up");
    const depth = engine.getState().history.depth;

    expect(engine.duplicateSelection()).toBe(true);

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(3);
    // The copy sits directly above its source, not at the top of the layer.
    expect(strokes[0].id).toBe(ids[0]);
    expect(strokes[1].id).not.toBe(ids[0]);
    expect(strokes[1].xs).toEqual(strokes[0].xs);
    expect(strokes[1].ys).toEqual(strokes[0].ys);
    expect(strokes[2].id).toBe(ids[1]);
    // The copies are selected, so the next transform acts on them.
    expect(engine.getState().selectedStrokes).toBe(1);
    expect(engine.getState().history.depth).toBe(depth + 1);

    const originalXs = [...strokes[0].xs];
    expect(engine.nudgeSelection(5, 0)).toBe(true);
    expect(engine.listStrokes(layerId)[0].xs).toEqual(originalXs);
    expect(engine.listStrokes(layerId)[1].xs).toEqual(originalXs.map((x) => x + 5));

    engine.undo();
    engine.undo();
    expect(engine.listStrokes(layerId).map((stroke) => stroke.id)).toEqual(ids);

    // Redo re-inserts the same copies rather than minting new ones.
    engine.redo();
    expect(engine.listStrokes(layerId)).toHaveLength(3);
    expect(engine.listStrokes(layerId)[1].xs).toEqual(originalXs);
  });

  it("flips the selection about its own centre", () => {
    const { engine, layerId } = createSelectingEngine();
    paint(engine, [
      [100, 100],
      [200, 150],
    ]);
    engine.setTool("select");
    handle(engine, [
      [50, 50],
      [250, 200],
    ], "up");
    const stroke = engine.listStrokes(layerId)[0];
    const originalXs = [...stroke.xs];
    const originalYs = [...stroke.ys];

    expect(engine.flipSelection("horizontal")).toBe(true);
    // The centre line is x = 150, so x becomes 300 - x and y is untouched.
    expect(engine.listStrokes(layerId)[0].xs).toEqual(originalXs.map((x) => 300 - x));
    expect(engine.listStrokes(layerId)[0].ys).toEqual(originalYs);

    engine.undo();
    expect(engine.listStrokes(layerId)[0].xs).toEqual(originalXs);
    expect(engine.listStrokes(layerId)[0].ys).toEqual(originalYs);

    // Two flips are the identity (to within floating-point rounding, since the
    // reflection is recomputed from the centre each time).
    const expectClose = (actual: readonly number[], expected: readonly number[]): void => {
      expect(actual).toHaveLength(expected.length);
      actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 9));
    };
    engine.flipSelection("horizontal");
    engine.flipSelection("horizontal");
    expectClose(engine.listStrokes(layerId)[0].xs, originalXs);

    expect(engine.flipSelection("vertical")).toBe(true);
    // The centre line is y = 125, so y becomes 250 - y and x is untouched.
    expectClose(engine.listStrokes(layerId)[0].xs, originalXs);
    expect(engine.listStrokes(layerId)[0].ys).toEqual(originalYs.map((y) => 250 - y));
  });

  /** The painted frame of a stroke: its samples' bounds plus half the brush. */
  function paintedFrame(xs: readonly number[], ys: readonly number[]): Bounds {
    const padding = DEFAULT_BRUSH.size / 2;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };
  }

  /** Presses a handle, drags it to `to` and releases it. */
  function dragHandle(
    engine: DrawingEngine,
    from: Point,
    to: Point,
    modifiers: PointerSample["modifiers"] = { shift: false, alt: false, ctrl: false, meta: false },
  ): void {
    engine.handlePointerSample(createSample({ phase: "down", docX: from.x, docY: from.y }));
    engine.handlePointerSample(
      createSample({ phase: "move", docX: to.x, docY: to.y, modifiers }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: to.x, docY: to.y, modifiers }),
    );
  }

  /** A selected horizontal stroke, ready to be transformed. */
  function selectStroke(): {
    engine: DrawingEngine;
    spy: ReturnType<typeof createSpyRenderer>;
    layerId: string;
    frame: Bounds;
    centre: Point;
    xs: number[];
    ys: number[];
    /** The brush and the pressures, copied before the gesture. */
    brush: StrokeRecord["brush"];
    pressures: number[];
    /** The stroke's identity, copied before the gesture. */
    id: string;
    startTime: number;
    depth: number;
  } {
    const { engine, spy, layerId } = createSelectingEngine();
    paint(engine, [
      [100, 100],
      [200, 100],
    ]);
    engine.setTool("select");
    handle(engine, [
      [50, 50],
      [250, 150],
    ], "up");
    const stroke = engine.listStrokes(layerId)[0];
    const xs = [...stroke.xs];
    const ys = [...stroke.ys];
    const frame = paintedFrame(xs, ys);
    return {
      engine,
      spy,
      layerId,
      frame,
      centre: { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
      xs,
      ys,
      brush: { ...stroke.brush },
      pressures: [...stroke.pressures],
      id: stroke.id,
      startTime: stroke.startTime,
      depth: engine.getState().history.depth,
    };
  }

  it("scales the selection about its frame's centre and records one undo step", () => {
    const { engine, layerId, frame, centre, xs, ys, brush, pressures, id, startTime, depth } =
      selectStroke();
    // The south-east corner handle.
    const corner = { x: frame.x + frame.width, y: frame.y + frame.height };

    dragHandle(
      engine,
      corner,
      {
        x: centre.x + (corner.x - centre.x) * 2,
        y: centre.y + (corner.y - centre.y) * 2,
      },
    );

    const scaled = engine.listStrokes(layerId)[0];
    scaled.xs.forEach((x, index) => {
      expect(x).toBeCloseTo(centre.x + (xs[index] - centre.x) * 2, 6);
    });
    scaled.ys.forEach((y, index) => {
      expect(y).toBeCloseTo(centre.y + (ys[index] - centre.y) * 2, 6);
    });
    // One step for the whole drag.
    expect(engine.getState().history.depth).toBe(depth + 1);
    // The transform moves the samples and nothing else: the brush, the
    // pressures and the sample count are the ones the stroke was drawn with.
    // The comparison is against the copies taken *before* the gesture, not
    // against the stroke itself, which would be true by construction.
    expect(scaled.brush).toEqual(brush);
    expect(scaled.pressures).toEqual(pressures);
    expect(scaled.times).toHaveLength(xs.length);
    expect(scaled.id).toBe(id);
    expect(scaled.startTime).toBe(startTime);

    engine.undo();
    expect(engine.listStrokes(layerId)[0].xs).toEqual(xs);
    expect(engine.listStrokes(layerId)[0].ys).toEqual(ys);

    engine.redo();
    expect(engine.listStrokes(layerId)[0].xs[0]).toBeCloseTo(
      centre.x + (xs[0] - centre.x) * 2,
      6,
    );
  });

  it("does not jump the content when the press misses the handle", () => {
    const { engine, layerId, frame, centre, xs, ys } = selectStroke();
    // A press four pixels short of the corner, still inside the grab radius.
    const corner = { x: frame.x + frame.width, y: frame.y + frame.height };
    const press = { x: corner.x - 4, y: corner.y - 4 };
    // One pixel further along the corner's own ray.
    const moved = { x: press.x + 1, y: press.y + 1 };

    engine.handlePointerSample(createSample({ phase: "down", docX: press.x, docY: press.y }));
    engine.handlePointerSample(createSample({ phase: "move", docX: moved.x, docY: moved.y }));
    engine.handlePointerSample(createSample({ phase: "up", docX: moved.x, docY: moved.y }));

    // The content has barely moved: the drag is measured from the press, not
    // read from the pointer.
    const after = engine.listStrokes(layerId)[0];
    after.xs.forEach((x, index) => {
      expect(Math.abs(x - xs[index])).toBeLessThan(2);
    });
    after.ys.forEach((y, index) => {
      expect(Math.abs(y - ys[index])).toBeLessThan(2);
    });
    // And the centre is still the centre: a scale about it moves both ends
    // the same way.
    expect(centre.x).toBeCloseTo((xs[0] + xs[xs.length - 1]) / 2, 6);
  });

  it("does not jump the content when the press misses the rotation handle", () => {
    const { engine, layerId, frame, centre, xs, ys } = selectStroke();
    // The rotation handle rests above the frame's top edge; the press lands
    // six pixels to its left, still inside the grab radius.
    const rotate = { x: centre.x, y: frame.y - 24 };
    const press = { x: rotate.x - 6, y: rotate.y };
    const moved = { x: press.x + 1, y: press.y };

    engine.handlePointerSample(createSample({ phase: "down", docX: press.x, docY: press.y }));
    engine.handlePointerSample(
      createSample({
        phase: "move",
        docX: moved.x,
        docY: moved.y,
        modifiers: { shift: true, alt: false, ctrl: false, meta: false },
      }),
    );
    engine.handlePointerSample(
      createSample({
        phase: "up",
        docX: moved.x,
        docY: moved.y,
        modifiers: { shift: true, alt: false, ctrl: false, meta: false },
      }),
    );

    // A pixel of movement is a fraction of a degree, not the four degrees an
    // absolute reading would have asked for.
    const after = engine.listStrokes(layerId)[0];
    after.xs.forEach((x, index) => {
      expect(Math.abs(x - xs[index])).toBeLessThan(2);
    });
    after.ys.forEach((y, index) => {
      expect(Math.abs(y - ys[index])).toBeLessThan(2);
    });
  });

  it("rotates the selection about its frame's centre", () => {
    const { engine, layerId, frame, centre, xs, ys, depth } = selectStroke();
    // The rotation handle rests above the frame's top edge.
    const rotate = { x: centre.x, y: frame.y - 24 };

    // A pointer to the right of the centre asks for a quarter turn.
    dragHandle(engine, rotate, { x: centre.x + 40, y: centre.y });

    const turned = engine.listStrokes(layerId)[0];
    turned.xs.forEach((x, index) => {
      expect(x).toBeCloseTo(centre.x - (ys[index] - centre.y), 6);
    });
    turned.ys.forEach((y, index) => {
      expect(y).toBeCloseTo(centre.y + (xs[index] - centre.x), 6);
    });
    expect(engine.getState().history.depth).toBe(depth + 1);

    engine.undo();
    expect(engine.listStrokes(layerId)[0].xs).toEqual(xs);
  });

  it("snaps the rotation to 15 degrees, and Shift turns the snap off", () => {
    const { engine, layerId, frame, centre, xs, ys } = selectStroke();
    const rotate = { x: centre.x, y: frame.y - 24 };
    // A pointer that asks for about 104 degrees.
    const to = { x: centre.x + 40, y: centre.y + 10 };

    dragHandle(engine, rotate, to);
    const snapped = engine.listStrokes(layerId)[0];
    const snappedXs = [...snapped.xs];
    const snappedAngle = Math.round(Math.atan2(40, -10) / (Math.PI / 12)) * (Math.PI / 12);
    snappedXs.forEach((x, index) => {
      const dx = xs[index] - centre.x;
      const dy = ys[index] - centre.y;
      expect(x).toBeCloseTo(
        centre.x + dx * Math.cos(snappedAngle) - dy * Math.sin(snappedAngle),
        6,
      );
    });

    // With Shift held the snap is off, so the free angle is kept.
    engine.undo();
    dragHandle(engine, rotate, to, {
      shift: true,
      alt: false,
      ctrl: false,
      meta: false,
    });
    const free = engine.listStrokes(layerId)[0];
    const freeAngle = Math.atan2(40, -10);
    free.xs.forEach((x, index) => {
      const dx = xs[index] - centre.x;
      const dy = ys[index] - centre.y;
      expect(x).toBeCloseTo(
        centre.x + dx * Math.cos(freeAngle) - dy * Math.sin(freeAngle),
        6,
      );
    });
    // The free angle is not a multiple of 15 degrees, so the two differ.
    expect(free.xs[0]).not.toBeCloseTo(snappedXs[0], 3);
  });

  it("shows the new frame and the handles after a transform", () => {
    const { engine, spy, frame, centre } = selectStroke();
    const corner = { x: frame.x + frame.width, y: frame.y + frame.height };
    dragHandle(
      engine,
      corner,
      {
        x: centre.x + (corner.x - centre.x) * 2,
        y: centre.y + (corner.y - centre.y) * 2,
      },
    );

    const overlay = spy.selections[spy.selections.length - 1];
    // The frame follows the strokes: the samples doubled, the padding did not.
    expect(overlay?.bounds?.width).toBeCloseTo(frame.width * 2 - DEFAULT_BRUSH.size, 6);
    expect(overlay?.bounds?.height).toBeCloseTo(frame.height, 6);
    // The handles are on the frame's new corners.
    expect(overlay?.handles?.corners).toHaveLength(4);
    expect(overlay?.handles?.corners[2].x).toBeCloseTo(
      overlay?.bounds?.x as number + (overlay?.bounds?.width as number),
      6,
    );
  });

  it("puts the handles on the selected frame and never on the rubber band", () => {
    const { engine, spy } = createSelectingEngine();
    paint(engine, [
      [100, 100],
      [200, 100],
    ]);
    engine.setTool("select");

    // A marquee drag with nothing selected shows the band and nothing else:
    // the handles belong to a selection, and there is none.
    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 60, docY: 50 }));
    const band = spy.selections[spy.selections.length - 1];
    expect(band?.bounds).toEqual({ x: 20, y: 20, width: 40, height: 30 });
    expect(band?.handles).toBeNull();
    engine.handlePointerSample(createSample({ phase: "up", docX: 60, docY: 50 }));

    // A marquee that meets the stroke selects it: the handles sit on its
    // frame, and the frame is the one derived from the strokes.
    engine.handlePointerSample(createSample({ phase: "down", docX: 50, docY: 50 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 250, docY: 150 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 250, docY: 150 }));
    const selected = spy.selections[spy.selections.length - 1];
    const bounds = selected?.bounds;
    expect(selected?.handles?.corners).toHaveLength(4);
    expect(selected?.handles?.corners[0]).toEqual({ x: bounds?.x, y: bounds?.y });
    expect(selected?.handles?.corners[2]).toEqual({
      x: (bounds?.x ?? 0) + (bounds?.width ?? 0),
      y: (bounds?.y ?? 0) + (bounds?.height ?? 0),
    });

    // A new marquee replaces the frame with the band, and the handles go with
    // it: they are never drawn on the rubber band.
    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 30, docY: 30 }));
    const second = spy.selections[spy.selections.length - 1];
    expect(second?.bounds).toEqual({ x: 20, y: 20, width: 10, height: 10 });
    expect(second?.handles).toBeNull();
  });

  it("recomputes the cursor when the viewport changes", () => {
    const { engine, frame } = selectStroke();
    const reports: CursorReport[] = [];
    engine.subscribeCursor((report) => reports.push(report));

    // Put the pointer on the south-east corner handle. The screen position is
    // the same point, so the pointer is where the report says it is.
    const corner = { x: frame.x + frame.width, y: frame.y + frame.height };
    engine.handlePointerSample(
      createSample({
        phase: "move",
        docX: corner.x,
        docY: corner.y,
        screenX: corner.x,
        screenY: corner.y,
      }),
    );
    expect(reports[reports.length - 1].cursor).toBe("nwse-resize");

    // Zoom without moving the pointer: the document point under it is a
    // different one, so the answer must be recomputed rather than kept.
    engine.setViewport({ zoom: 4, offsetX: 0, offsetY: 0 });
    expect(reports[reports.length - 1].cursor).toBe("default");
  });

  it("records no step for a transform that changes nothing", () => {
    const { engine, layerId } = createSelectingEngine();
    // A single dab: the frame's centre is the dab itself, so a scale and a
    // rotation both map it onto itself.
    handle(engine, [[100, 100]], "up");
    engine.setTool("select");
    handle(engine, [
      [90, 90],
      [110, 110],
    ], "up");
    const depth = engine.getState().history.depth;
    const frame = paintedFrame([100], [100]);
    const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };

    dragHandle(engine, { x: frame.x + frame.width, y: frame.y + frame.height }, {
      x: centre.x + 40,
      y: centre.y + 40,
    });
    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.listStrokes(layerId)[0].xs.every((x) => x === 100)).toBe(true);
    expect(engine.listStrokes(layerId)[0].ys.every((y) => y === 100)).toBe(true);
  });

  it("cancels a transform in flight and records nothing", () => {
    const { engine, layerId, frame, centre, xs, ys, depth } = selectStroke();
    const corner = { x: frame.x + frame.width, y: frame.y + frame.height };
    engine.handlePointerSample(createSample({ phase: "down", docX: corner.x, docY: corner.y }));
    engine.handlePointerSample(
      createSample({
        phase: "move",
        docX: centre.x + (corner.x - centre.x) * 3,
        docY: centre.y + (corner.y - centre.y) * 3,
      }),
    );
    // The preview moved.
    expect(engine.listStrokes(layerId)[0].xs[0]).not.toBeCloseTo(xs[0], 3);

    engine.handlePointerSample(createSample({ phase: "cancel", docX: 0, docY: 0 }));
    // The originals are back and nothing was recorded.
    expect(engine.listStrokes(layerId)[0].xs).toEqual(xs);
    expect(engine.listStrokes(layerId)[0].ys).toEqual(ys);
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("survives a save and reopen", () => {
    const { engine, layerId, frame, centre } = selectStroke();
    const corner = { x: frame.x + frame.width, y: frame.y + frame.height };
    dragHandle(
      engine,
      corner,
      {
        x: centre.x + (corner.x - centre.x) * 2,
        y: centre.y + (corner.y - centre.y) * 2,
      },
    );
    const transformedXs = [...engine.listStrokes(layerId)[0].xs];
    const transformedYs = [...engine.listStrokes(layerId)[0].ys];

    // The transform is a change of the samples, so the project file carries it
    // like any other stroke: reopening it gives the same stroke back.
    const parsed = parseProject(engine.serialize());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const reopened = parsed.project.strokes[0];
    expect(reopened.xs).toEqual(transformedXs);
    expect(reopened.ys).toEqual(transformedYs);
    expect(reopened.brush).toEqual(engine.listStrokes(layerId)[0].brush);
  });

  it("refuses undo and redo while a selection drag is in flight", () => {
    const { engine, layerId } = createSelectingEngine();
    paint(engine, [
      [100, 100],
      [200, 100],
    ]);
    engine.setTool("select");
    handle(engine, [
      [50, 50],
      [250, 150],
    ], "up");
    const depth = engine.getState().history.depth;

    // Start a move but do not release it.
    engine.handlePointerSample(createSample({ phase: "down", docX: 150, docY: 100 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 170, docY: 100 }));
    const moved = [...engine.listStrokes(layerId)[0].xs];

    expect(engine.undo()).toBe(false);
    expect(engine.redo()).toBe(false);
    // Still mid-drag, still one stroke, and nothing was recorded.
    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.listStrokes(layerId)).toHaveLength(1);
    expect(engine.listStrokes(layerId)[0].xs).toEqual(moved);

    // Releasing still records exactly one step for the drag.
    engine.handlePointerSample(createSample({ phase: "up", docX: 170, docY: 100 }));
    expect(engine.getState().history.depth).toBe(depth + 1);
  });

  it("records no step for a flip that changes nothing", () => {
    const { engine, layerId } = createSelectingEngine();
    // A single dab: its bounds centre is the dab itself, so a reflection maps
    // every sample to where it already is.
    handle(engine, [[100, 100]], "up");
    engine.setTool("select");
    handle(engine, [
      [90, 90],
      [110, 110],
    ], "up");
    expect(engine.getState().selectedStrokes).toBe(1);
    const depth = engine.getState().history.depth;

    expect(engine.flipSelection("horizontal")).toBe(false);
    expect(engine.flipSelection("vertical")).toBe(false);
    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.listStrokes(layerId)[0].xs.every((x) => x === 100)).toBe(true);
    expect(engine.listStrokes(layerId)[0].ys.every((y) => y === 100)).toBe(true);
  });

  it("does not record a step when the selection is already gone", () => {
    const { engine } = createSelectingEngine();
    paint(engine, [
      [100, 100],
      [200, 100],
    ]);
    engine.setTool("select");
    handle(engine, [
      [50, 50],
      [250, 150],
    ], "up");
    engine.duplicateSelection();
    // Undo the duplicate: the selection still names the copies, which are gone.
    engine.undo();
    const depth = engine.getState().history.depth;

    expect(engine.getState().selectedStrokes).toBe(0);
    expect(engine.deleteSelection()).toBe(false);
    expect(engine.nudgeSelection(1, 0)).toBe(false);
    expect(engine.flipSelection("horizontal")).toBe(false);
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("drops a selection whose strokes an undo removed", () => {
    const { engine } = createSelectingEngine();
    paint(engine, [
      [100, 100],
      [200, 100],
    ]);
    engine.setTool("select");
    handle(engine, [
      [50, 50],
      [250, 150],
    ], "up");
    expect(engine.duplicateSelection()).toBe(true);
    // The copies are selected; undo takes them away.
    expect(engine.undo()).toBe(true);
    expect(engine.getState().selectedStrokes).toBe(0);

    // The next transform must not report success on a selection that resolves
    // to nothing, and must not record an empty step.
    const depth = engine.getState().history.depth;
    expect(engine.duplicateSelection()).toBe(false);
    expect(engine.deleteSelection()).toBe(false);
    expect(engine.getState().history.depth).toBe(depth);
    // A redo of the duplicate still restores exactly one copy.
    expect(engine.redo()).toBe(true);
    expect(engine.getState().selectedStrokes).toBe(1);
  });

  it("refuses transforms with nothing selected", () => {
    const { engine } = createSelectingEngine();
    paint(engine, [
      [100, 100],
      [200, 150],
    ]);
    const depth = engine.getState().history.depth;

    expect(engine.nudgeSelection(1, 0)).toBe(false);
    expect(engine.duplicateSelection()).toBe(false);
    expect(engine.flipSelection("horizontal")).toBe(false);
    expect(engine.getState().history.depth).toBe(depth);
  });
});

/** White RGBA image with a one-pixel black frame around the edge. */
function framedComposite(width = 20, height = 20): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function createBucketEngine(options: { readonly compositeImage?: ImageData | null } = {}) {
  const spy = createSpyRenderer({ compositeImage: options.compositeImage ?? null });
  const engine = new DrawingEngine({
    document: createDocument({ name: "Test", width: 20, height: 20 }),
    renderer: spy.renderer,
    brush: { ...DEFAULT_BRUSH, color: "#ff0000" },
  });
  engine.setTool("bucket");
  return { engine, spy };
}

function pressBucket(engine: DrawingEngine, docX: number, docY: number): void {
  engine.handlePointerSample(
    createSample({ phase: "down", docX, docY, button: 0, buttons: 1 }),
  );
}

function releaseBucket(engine: DrawingEngine, docX: number, docY: number): void {
  engine.handlePointerSample(
    createSample({ phase: "up", docX, docY, button: 0, buttons: 0 }),
  );
}

describe("DrawingEngine gradients", () => {
  function createGradientEngine() {
    const spy = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 20, height: 20 }),
      renderer: spy.renderer,
      brush: { ...DEFAULT_BRUSH, color: "#ff0000", opacity: 0.75 },
    });
    engine.setTool("gradient");
    return { engine, spy };
  }

  function pressGradient(engine: DrawingEngine, x: number, y: number): void {
    engine.handlePointerSample(
      createSample({ phase: "down", docX: x, docY: y, button: 0, buttons: 1 }),
    );
  }

  function moveGradient(engine: DrawingEngine, x: number, y: number): void {
    engine.handlePointerSample(
      createSample({ phase: "move", docX: x, docY: y, button: 0, buttons: 1 }),
    );
  }

  function releaseGradient(engine: DrawingEngine, x: number, y: number): void {
    engine.handlePointerSample(
      createSample({ phase: "up", docX: x, docY: y, button: 0, buttons: 0 }),
    );
  }

  it("previews on press, follows the pointer, and commits one undo step on release", () => {
    const { engine, spy } = createGradientEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    engine.setGradientEndColor("#0000ff");

    pressGradient(engine, 4, 6);
    let gradient = engine.listElements(layerId)[0];
    expect(isGradient(gradient)).toBe(true);
    expect(gradient).toMatchObject({
      layerId,
      kind: "gradient",
      type: "linear",
      x1: 4,
      y1: 6,
      x2: 4,
      y2: 6,
      opacity: 0.75,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    });
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);

    moveGradient(engine, 16, 18);
    gradient = engine.listElements(layerId)[0];
    const previewId = gradient.id;
    expect(gradient).toMatchObject({ x2: 16, y2: 18 });
    expect(engine.listElements(layerId)).toHaveLength(1);
    expect(engine.getState().history.depth).toBe(0);
    expect(spy.invalidated).toContain(layerId);

    releaseGradient(engine, 18, 20);
    gradient = engine.listElements(layerId)[0];
    expect(gradient.id).toBe(previewId);
    expect(gradient).toMatchObject({ x2: 18, y2: 20 });
    expect(engine.getState().history.depth).toBe(1);
    expect(engine.getState().file.dirty).toBe(true);
    expect(engine.listStrokes(layerId)).toEqual([]);
  });

  it("uses the radial option captured when the drag starts", () => {
    const { engine } = createGradientEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    engine.setGradientType("radial");

    pressGradient(engine, 10, 10);
    engine.setGradientType("linear");
    releaseGradient(engine, 14, 13);

    expect(engine.listElements(layerId)[0]).toMatchObject({
      type: "radial",
      x1: 10,
      y1: 10,
      x2: 14,
      y2: 13,
    });
  });

  it("undoes and redoes the committed record, not new geometry", () => {
    const { engine } = createGradientEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    pressGradient(engine, 2, 3);
    releaseGradient(engine, 17, 19);
    const committed = engine.listElements(layerId)[0];

    expect(engine.undo()).toBe(true);
    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.canRedo).toBe(true);

    expect(engine.redo()).toBe(true);
    expect(engine.listElements(layerId)[0]).toBe(committed);
  });

  it("cancels a preview without dirtying the document", () => {
    const { engine } = createGradientEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    pressGradient(engine, 4, 4);
    moveGradient(engine, 12, 12);
    expect(engine.listElements(layerId)).toHaveLength(1);

    engine.handlePointerSample(
      createSample({ phase: "cancel", docX: 12, docY: 12, button: 0, buttons: 0 }),
    );

    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("cancels a preview when the tool changes", () => {
    const { engine } = createGradientEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    pressGradient(engine, 4, 4);
    moveGradient(engine, 12, 12);

    engine.setTool("brush");

    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("does not record an invisible zero-length drag", () => {
    const { engine } = createGradientEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    pressGradient(engine, 8, 8);
    releaseGradient(engine, 8, 8);

    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("ignores presses outside the paper and blocks history during a drag", () => {
    const { engine } = createGradientEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    pressGradient(engine, -1, 5);
    releaseGradient(engine, 10, 10);
    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);

    pressGradient(engine, 4, 4);
    expect(engine.undo()).toBe(false);
    expect(engine.redo()).toBe(false);
    expect(engine.listElements(layerId)).toHaveLength(1);
  });

  it("clamps coordinates to the document while dragging", () => {
    const { engine } = createGradientEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    pressGradient(engine, 4, 4);
    releaseGradient(engine, 99, -5);

    expect(engine.listElements(layerId)[0]).toMatchObject({ x2: 20, y2: 0 });
  });

  it("keeps gradient editor options in the snapshot and validates the colour", () => {
    const { engine } = createGradientEngine();
    expect(engine.getState().gradientType).toBe("linear");
    expect(engine.getState().gradientEndColor).toBe("#ffffff");

    engine.setGradientType("radial");
    engine.setGradientEndColor("#0f0");
    expect(engine.getState().gradientType).toBe("radial");
    expect(engine.getState().gradientEndColor).toBe("#00ff00");

    engine.setGradientEndColor("not a colour");
    expect(engine.getState().gradientEndColor).toBe("#00ff00");
  });

  it("captures middle stops at press time and keeps them through undo/redo", () => {
    const { engine } = createGradientEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    engine.setGradientEndColor("#0000ff");
    engine.setGradientMidStops([
      { offset: 0.7, color: "#00ff00" },
      { offset: 0.35, color: "#ff8800" },
      { offset: 0, color: "#ffffff" },
    ]);
    expect(engine.getState().gradientMidStops).toEqual([
      { offset: 0.35, color: "#ff8800" },
      { offset: 0.7, color: "#00ff00" },
    ]);

    pressGradient(engine, 2, 2);
    // Options describe the next drag; changing them mid-drag must not rewrite
    // the gradient already being previewed.
    engine.setGradientMidStops([]);
    releaseGradient(engine, 18, 18);

    const expectedStops = [
      { offset: 0, color: "#ff0000" },
      { offset: 0.35, color: "#ff8800" },
      { offset: 0.7, color: "#00ff00" },
      { offset: 1, color: "#0000ff" },
    ];
    let gradient = engine.listElements(layerId)[0];
    expect(isGradient(gradient)).toBe(true);
    expect(isGradient(gradient) ? gradient.stops : []).toEqual(expectedStops);
    expect(engine.getState().history.depth).toBe(1);

    engine.undo();
    expect(engine.listElements(layerId)).toEqual([]);
    engine.redo();
    gradient = engine.listElements(layerId)[0];
    expect(isGradient(gradient) ? gradient.stops : []).toEqual(expectedStops);
  });

  it("copies gradients with fresh ids through layer duplication", () => {
    const { engine } = createGradientEngine();
    const sourceId = engine.getState().document.activeLayerId as string;
    pressGradient(engine, 2, 2);
    releaseGradient(engine, 18, 18);
    const original = engine.listElements(sourceId)[0];

    engine.duplicateLayer(sourceId);
    const copyId = engine.getState().document.activeLayerId as string;
    const copied = engine.listElements(copyId)[0];

    expect(isGradient(copied)).toBe(true);
    expect(copied.id).not.toBe(original.id);
    expect(isGradient(copied) && copied.stops).toEqual(
      isGradient(original) ? original.stops : [],
    );
    expect(isGradient(copied) && copied.stops[0]).not.toBe(
      isGradient(original) ? original.stops[0] : undefined,
    );
  });
});

describe("DrawingEngine fill and gradient ordering", () => {
  it("keeps strokes, fills and gradients in one ordered element list", () => {
    const spy = createSpyRenderer({ compositeImage: framedComposite() });
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 20, height: 20 }),
      renderer: spy.renderer,
      brush: { ...DEFAULT_BRUSH, color: "#ff0000" },
    });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setTool("brush");
    engine.handlePointerSample(
      createSample({ phase: "down", docX: 2, docY: 2, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 8, docY: 8, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 8, docY: 8, button: 0, buttons: 0 }),
    );
    engine.setTool("gradient");
    pressGradientHelper(engine, 0, 0);
    releaseGradientHelper(engine, 19, 19);
    engine.setTool("bucket");
    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);

    const elements = engine.listElements(layerId);
    expect(elements).toHaveLength(3);
    expect(isGradient(elements[1])).toBe(true);
    expect(isFillPatch(elements[2])).toBe(true);

    engine.undo();
    expect(isGradient(engine.listElements(layerId)[1])).toBe(true);
    engine.undo();
    expect(engine.listElements(layerId)).toHaveLength(1);
  });
});

function pressGradientHelper(engine: DrawingEngine, x: number, y: number): void {
  engine.handlePointerSample(
    createSample({ phase: "down", docX: x, docY: y, button: 0, buttons: 1 }),
  );
}

function releaseGradientHelper(engine: DrawingEngine, x: number, y: number): void {
  engine.handlePointerSample(
    createSample({ phase: "up", docX: x, docY: y, button: 0, buttons: 0 }),
  );
}

describe("DrawingEngine bucket fill", () => {
  it("applies a pixel patch on press and records one undo step on release", () => {
    const { engine, spy } = createBucketEngine({ compositeImage: framedComposite() });
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);

    // The patch is already on the layer, so the user sees the real result.
    const applied = engine.listElements(layerId);
    expect(applied).toHaveLength(1);
    const patch = applied[0];
    expect(isFillPatch(patch)).toBe(true);
    if (!isFillPatch(patch)) {
      return;
    }
    expect(patch).toMatchObject({
      layerId,
      kind: "fill",
      color: "#ff0000",
      x: 1,
      y: 1,
      width: 18,
      height: 18,
    });
    expect(patch.mask).toHaveLength(18 * 18);
    expect(patch.mask.every((value) => value === 255)).toBe(true);
    expect(spy.getCompositeReads()).toBe(1);
    expect(spy.invalidated).toContain(layerId);
    // Not committed yet: no history entry, and the drawing is not dirty.
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);

    releaseBucket(engine, 10, 10);

    expect(engine.getState().history.depth).toBe(1);
    expect(engine.getState().file.dirty).toBe(true);
    expect(engine.listStrokes(layerId)).toEqual([]);
  });

  it("undoes and redoes the committed pixels without scanning again", () => {
    const { engine, spy } = createBucketEngine({ compositeImage: framedComposite() });
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);
    const patch = engine.listElements(layerId)[0];

    expect(engine.undo()).toBe(true);
    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.canRedo).toBe(true);

    const readsBeforeRedo = spy.getCompositeReads();
    expect(engine.redo()).toBe(true);
    expect(engine.listElements(layerId)[0]).toBe(patch);
    // Redo replays the stored patch; it must not sample the composite again.
    expect(spy.getCompositeReads()).toBe(readsBeforeRedo);
  });

  it("samples the visible composite, not just the active layer", () => {
    // The fake composite has a black frame the engine's layer does not contain;
    // the resulting box proves the boundary came from the merged image.
    const { engine } = createBucketEngine({ compositeImage: framedComposite(30, 20) });
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 15, 10);
    releaseBucket(engine, 15, 10);

    const patch = engine.listElements(layerId)[0];
    expect(isFillPatch(patch) && patch.width).toBe(28);
    expect(isFillPatch(patch) && patch.height).toBe(18);
  });

  it("honours the tolerance setting for the next fill", () => {
    const width = 6;
    const shades = [100, 104, 108, 120, 124, 200];
    const data = new Uint8ClampedArray(width * 4);
    shades.forEach((shade, x) => {
      const offset = x * 4;
      data[offset] = shade;
      data[offset + 1] = shade;
      data[offset + 2] = shade;
      data[offset + 3] = 255;
    });
    const composite = { data, width, height: 1, colorSpace: "srgb" } as ImageData;

    const tight = createBucketEngine({ compositeImage: composite });
    tight.engine.setFillTolerance(4);
    expect(tight.engine.getState().fillTolerance).toBe(4);
    pressBucket(tight.engine, 0, 0);
    releaseBucket(tight.engine, 0, 0);
    const tightPatch = tight.engine.listElements(
      tight.engine.getState().document.activeLayerId as string,
    )[0];
    expect(isFillPatch(tightPatch) && tightPatch.width).toBe(2);

    const wide = createBucketEngine({ compositeImage: composite });
    wide.engine.setFillTolerance(40);
    pressBucket(wide.engine, 0, 0);
    releaseBucket(wide.engine, 0, 0);
    const widePatch = wide.engine.listElements(
      wide.engine.getState().document.activeLayerId as string,
    )[0];
    expect(isFillPatch(widePatch) && widePatch.width).toBe(5);
  });

  it("clamps and rounds the tolerance editor value", () => {
    const { engine } = createBucketEngine();
    expect(engine.getState().fillTolerance).toBe(24);
    engine.setFillTolerance(300);
    expect(engine.getState().fillTolerance).toBe(255);
    engine.setFillTolerance(-4);
    expect(engine.getState().fillTolerance).toBe(0);
    engine.setFillTolerance(12.6);
    expect(engine.getState().fillTolerance).toBe(13);
    engine.setFillTolerance(Number.NaN);
    expect(engine.getState().fillTolerance).toBe(13);
  });

  it("leaves the document untouched for an out-of-bounds press", () => {
    const { engine, spy } = createBucketEngine({ compositeImage: framedComposite() });
    const layerId = engine.getState().document.activeLayerId as string;

    for (const [x, y] of [
      [-1, 5],
      [5, -1],
      [21, 5],
      [5, 21],
      [Number.NaN, 5],
    ] as const) {
      pressBucket(engine, x, y);
      releaseBucket(engine, x, y);
    }

    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
    // The composite is not even read for a press outside the paper.
    expect(spy.getCompositeReads()).toBe(0);
  });

  it("does nothing when the renderer cannot supply a composite", () => {
    const { engine } = createBucketEngine({ compositeImage: null });
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);

    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("avoids an invisible undo step when the fill colour is already there", () => {
    // White composite, white brush, zero tolerance: nothing would change.
    const { engine } = createBucketEngine({ compositeImage: framedComposite() });
    const layerId = engine.getState().document.activeLayerId as string;
    engine.setBrush({ color: "#ffffff" });
    engine.setFillTolerance(0);

    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);

    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("cancels an uncommitted fill without dirtying the document", () => {
    const { engine, spy } = createBucketEngine({ compositeImage: framedComposite() });
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);
    expect(engine.listElements(layerId)).toHaveLength(1);

    engine.handlePointerSample(
      createSample({ phase: "cancel", docX: 10, docY: 10, button: 0, buttons: 0 }),
    );

    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
    // Cancelling repaints the layer without leaving the patch in history.
    expect(spy.invalidated.filter((id) => id === layerId).length).toBeGreaterThanOrEqual(2);
  });

  it("cancels an uncommitted fill when the tool changes", () => {
    const { engine } = createBucketEngine({ compositeImage: framedComposite() });
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);
    expect(engine.listElements(layerId)).toHaveLength(1);

    engine.setTool("brush");

    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("keeps two separate fills as two undo steps", () => {
    const { engine } = createBucketEngine({ compositeImage: framedComposite() });
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);
    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);

    expect(engine.listElements(layerId)).toHaveLength(2);
    expect(engine.getState().history.depth).toBe(2);
    engine.undo();
    expect(engine.listElements(layerId)).toHaveLength(1);
    engine.undo();
    expect(engine.listElements(layerId)).toHaveLength(0);
  });

  it("keeps fills intact through layer duplication and deletion", () => {
    const { engine } = createBucketEngine({ compositeImage: framedComposite() });
    const sourceId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);
    const original = engine.listElements(sourceId)[0];

    engine.duplicateLayer(sourceId);
    const copyId = engine.getState().document.activeLayerId as string;
    const copied = engine.listElements(copyId)[0];
    expect(isFillPatch(copied)).toBe(true);
    expect(copied.id).not.toBe(original.id);
    expect(isFillPatch(copied) && [...copied.mask]).toEqual(
      isFillPatch(original) ? [...original.mask] : [],
    );

    // Undoing the duplicate removes the copied fill, not the original.
    expect(engine.undo()).toBe(true);
    expect(engine.listElements(copyId)).toEqual([]);
    expect(engine.listElements(sourceId)).toEqual([original]);

    // Deleting the source layer and undoing restores its fill content. A
    // document always keeps one layer, so duplicate again to allow removal.
    engine.duplicateLayer(sourceId);
    engine.removeLayer(sourceId);
    expect(engine.listElements(sourceId)).toEqual([]);
    expect(engine.undo()).toBe(true);
    expect(engine.listElements(sourceId)).toEqual([original]);
  });

  it("refuses a document too large to scan and explains why", () => {
    const spy = createSpyRenderer({ compositeImage: framedComposite() });
    // The document-pixel budget now caps `createDocument` exactly at the fill
    // scan limit. Build a raw document one row/column over it so the bucket's
    // own guard (for documents that bypass normal validation) stays covered;
    // the spy renderer means no surface of that size is ever allocated.
    const base = createDocument({ name: "Huge", width: 4096, height: 4096 });
    const engine = new DrawingEngine({
      document: { ...base, width: 4097, height: 4097 },
      renderer: spy.renderer,
    });
    engine.setTool("bucket");

    pressBucket(engine, 4000, 4000);

    expect(engine.getState().notice).toContain("Bucket fill is limited to");
    expect(engine.listElements(engine.getState().document.activeLayerId as string)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
    expect(spy.getCompositeReads()).toBe(0);

    engine.dismissNotice();
    expect(engine.getState().notice).toBeNull();
  });
});


/**
 * The composition guides.
 *
 * A guide is document state with no pixels: it is placed with a drag, moved
 * with a drag, selected with a click, and every change is one undoable step.
 * These tests drive the engine the way the app does - through normalized
 * pointer samples - so the whole gesture path is covered.
 */
describe("DrawingEngine composition guides", () => {
  function createGuideEngine(guides: readonly Guide[] = []) {
    const spy = createSpyRenderer();
    const base = createDocument({ name: "Test", width: 400, height: 300 });
    const engine = new DrawingEngine({
      document: { ...base, guides },
      renderer: spy.renderer,
    });
    engine.setTool("guides");
    return { engine, spy };
  }

  /** Drags with the pointer and releases it. */
  function drag(
    engine: DrawingEngine,
    from: readonly [number, number],
    to: readonly [number, number],
    overrides: Partial<PointerSample> = {},
  ): void {
    engine.handlePointerSample(
      createSample({ phase: "down", docX: from[0], docY: from[1], ...overrides }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: to[0], docY: to[1], ...overrides }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: to[0], docY: to[1], ...overrides }),
    );
  }

  function guidesOf(engine: DrawingEngine): readonly Guide[] {
    return engine.getState().document.guides;
  }

  it("creates one guide at the press point, on the axis the drag chose", () => {
    const { engine } = createGuideEngine();

    // A drag that is wider than it is tall makes a vertical guide, and the
    // guide sits where the pointer went down, not where it came up.
    drag(engine, [100, 50], [220, 60]);

    const guides = guidesOf(engine);
    expect(guides).toHaveLength(1);
    expect(guides[0].axis).toBe("vertical");
    expect(guides[0].position).toBe(100);
    expect(engine.getState().history.depth).toBe(1);
    expect(engine.getState().file.dirty).toBe(true);
  });

  it("makes a horizontal guide from a drag that is taller than it is wide", () => {
    const { engine } = createGuideEngine();

    drag(engine, [100, 50], [110, 200]);

    const guides = guidesOf(engine);
    expect(guides).toHaveLength(1);
    expect(guides[0].axis).toBe("horizontal");
    expect(guides[0].position).toBe(50);
  });

  it("snaps the position to a whole document pixel", () => {
    const { engine } = createGuideEngine();

    drag(engine, [120.4, 50], [220, 60]);

    expect(guidesOf(engine)[0].position).toBe(120);
  });

  it("moves an existing guide along its own axis", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    const id = guidesOf(engine)[0].id;

    // Press on the guide - the y is irrelevant for a vertical guide - and drag.
    drag(engine, [100, 200], [250, 210]);

    const guides = guidesOf(engine);
    expect(guides).toHaveLength(1);
    expect(guides[0].id).toBe(id);
    expect(guides[0].axis).toBe("vertical");
    expect(guides[0].position).toBe(250);
    // The drag is one undo step, not one per pointer move.
    expect(engine.getState().history.depth).toBe(2);
  });

  it("never changes the axis of a guide that is being moved", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);

    // A drag that is much taller than it is wide still only moves the guide in
    // x, because the guide is vertical.
    drag(engine, [100, 200], [110, 300]);

    const guides = guidesOf(engine);
    expect(guides[0].axis).toBe("vertical");
    expect(guides[0].position).toBe(110);
  });

  it("records nothing for a drag that ends where it started", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    const depth = engine.getState().history.depth;

    // One drag that goes out and comes back: the guide ends where it began,
    // so the gesture changed nothing and history must not grow.
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 250, docY: 210 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 100, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 100, docY: 200 }));

    expect(guidesOf(engine)[0].position).toBe(100);
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("selects a guide that is pressed without moving", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    const id = guidesOf(engine)[0].id;

    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 100, docY: 200 }));

    expect(engine.getState().selectedGuideId).toBe(id);
  });

  it("clears the selection when empty canvas is pressed", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 100, docY: 200 }));
    expect(engine.getState().selectedGuideId).not.toBeNull();

    engine.handlePointerSample(createSample({ phase: "down", docX: 300, docY: 250 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 300, docY: 250 }));

    expect(engine.getState().selectedGuideId).toBeNull();
  });

  it("removes the selected guide as one undoable step", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 100, docY: 200 }));
    const depth = engine.getState().history.depth;

    expect(engine.deleteSelectedGuide()).toBe(true);

    expect(guidesOf(engine)).toHaveLength(0);
    expect(engine.getState().selectedGuideId).toBeNull();
    expect(engine.getState().history.depth).toBe(depth + 1);

    engine.undo();
    expect(guidesOf(engine)).toHaveLength(1);
    expect(guidesOf(engine)[0].position).toBe(100);
  });

  it("undoes and redoes a guide change exactly", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    const before = guidesOf(engine).map((guide) => ({ ...guide }));

    drag(engine, [100, 200], [250, 210]);
    expect(guidesOf(engine)[0].position).toBe(250);

    engine.undo();
    expect(guidesOf(engine).map((guide) => ({ ...guide }))).toEqual(before);

    engine.redo();
    expect(guidesOf(engine)[0].position).toBe(250);
    expect(guidesOf(engine)[0].id).toBe(before[0].id);
  });

  it("cancels a drag: the guide goes back where it was and history is untouched", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    const depth = engine.getState().history.depth;
    const dirty = engine.getState().file.dirty;

    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 300, docY: 210 }));
    // The live preview is on screen...
    expect(guidesOf(engine)[0].position).toBe(300);

    engine.cancelGuideGesture();

    // ...and the cancel puts it back.
    expect(guidesOf(engine)[0].position).toBe(100);
    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.getState().file.dirty).toBe(dirty);
  });

  it("cancels a drag that was creating a guide: the guide disappears", () => {
    const { engine } = createGuideEngine();

    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 50 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 220, docY: 60 }));
    expect(guidesOf(engine)).toHaveLength(1);

    engine.cancelGuideGesture();

    expect(guidesOf(engine)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("refuses undo while a guide drag is in flight", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    const depth = engine.getState().history.depth;

    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 300, docY: 210 }));

    expect(engine.undo()).toBe(false);
    expect(engine.getState().history.depth).toBe(depth);

    engine.handlePointerSample(createSample({ phase: "up", docX: 300, docY: 210 }));
    expect(engine.undo()).toBe(true);
  });

  it("pans with the middle button while the guides tool is active", () => {
    const { engine } = createGuideEngine();
    const before = engine.getState().viewport;

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 100, docY: 50, screenX: 100, screenY: 50, button: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 130, docY: 50, screenX: 130, screenY: 50, button: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 130, docY: 50, screenX: 130, screenY: 50, button: 1 }),
    );

    expect(engine.getState().viewport.offsetX).toBe(before.offsetX + 30);
    // Panning is not an edit.
    expect(guidesOf(engine)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("places the same guide for a pen, a mouse and a touch", () => {
    for (const kind of ["pen", "mouse", "touch"] as const) {
      const { engine } = createGuideEngine();
      drag(engine, [100, 50], [220, 60], { kind });
      const guides = guidesOf(engine);
      expect(guides).toHaveLength(1);
      expect(guides[0].axis).toBe("vertical");
      expect(guides[0].position).toBe(100);
    }
  });

  it("grabs a guide within eight screen pixels at any zoom", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);

    // 20 document pixels away is 20 screen pixels at 1x: out of reach.
    expect(engine.findGuideAt(120, 50)).toBeNull();

    // At a quarter zoom the same 20 screen pixels are 80 document pixels, and
    // the radius is 32 document pixels: still out of reach.
    engine.setViewport({ zoom: 0.25, offsetX: 0, offsetY: 0 });
    expect(engine.findGuideAt(180, 50)).toBeNull();
    // 28 document pixels is 7 screen pixels at that zoom: in reach.
    expect(engine.findGuideAt(128, 50)?.position).toBe(100);
  });

  it("refuses a guide that would land on another one", () => {
    // Two guides at the same spot, as a hand-edited file could carry.
    const { engine } = createGuideEngine([
      { id: "guide-a", axis: "vertical", position: 100 },
      { id: "guide-b", axis: "vertical", position: 300 },
    ]);

    // Dragging the second one onto the first is refused: the guide stays put.
    drag(engine, [300, 200], [100, 210]);
    expect(guidesOf(engine).map((guide) => guide.position).sort()).toEqual([100, 300]);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("refuses a create that would land on an existing guide", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    const depth = engine.getState().history.depth;

    // At 64x the grab radius is an eighth of a document pixel, so a press a
    // fifth of a document pixel away misses the guide - and the new guide
    // would round onto the very same position.
    engine.setViewport({ zoom: 64, offsetX: 0, offsetY: 0 });
    drag(engine, [100.2, 50], [220, 60]);

    expect(guidesOf(engine)).toHaveLength(1);
    expect(guidesOf(engine)[0].position).toBe(100);
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("creates nothing when the drag is shorter than the axis threshold", () => {
    const { engine } = createGuideEngine();

    // Two document pixels at 1x: under the three CSS pixels the tool needs
    // before it decides which axis the guide takes, so nothing is created.
    drag(engine, [100, 50], [102, 50]);

    expect(guidesOf(engine)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("keeps the redo stack intact when a drag is cancelled", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);

    // Undo leaves a redo entry, and a cancelled drag must not destroy it.
    engine.undo();
    expect(engine.getState().history.canRedo).toBe(true);

    engine.handlePointerSample(createSample({ phase: "down", docX: 300, docY: 50 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 420, docY: 60 }));
    engine.cancelGuideGesture();

    expect(engine.getState().history.canRedo).toBe(true);
    expect(engine.redo()).toBe(true);
    expect(guidesOf(engine)).toHaveLength(1);
  });

  it("lets the tool start a new gesture after the engine cancelled the last one", () => {
    const { engine } = createGuideEngine();

    // The Escape key cancels the gesture without a pointer release, so the
    // tool has to be told: it must not go on believing a drag is in flight.
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 50 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 220, docY: 60 }));
    engine.cancelGuideGesture();

    // The next press has to work.
    drag(engine, [300, 50], [420, 60]);
    expect(guidesOf(engine)).toHaveLength(1);
    expect(guidesOf(engine)[0].position).toBe(300);
  });

  it("does not call the file clean when it is saved during a guide drag", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    engine.markSaved("C:\\art\\guided.paka");
    expect(engine.getState().file.dirty).toBe(false);

    // A save while a drag is in flight writes the *preview*, not the document
    // the user is going to keep, so the file cannot be called clean.
    engine.handlePointerSample(createSample({ phase: "down", docX: 300, docY: 50 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 420, docY: 60 }));
    engine.markSaved("C:\\art\\guided.paka");
    expect(engine.getState().file.dirty).toBe(true);

    // Cancelling the drag leaves the file and the document different, so the
    // file has to stay dirty until it is written again.
    engine.cancelGuideGesture();
    expect(engine.getState().file.dirty).toBe(true);

    // The next save writes the document and clears the marker.
    engine.markSaved("C:\\art\\guided.paka");
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("drops the guide selection when the guides tool is left", () => {
    const { engine } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 100, docY: 200 }));
    expect(engine.getState().selectedGuideId).not.toBeNull();

    engine.setTool("brush");

    expect(engine.getState().selectedGuideId).toBeNull();
  });

  it("drops the guide gesture when the document is replaced", () => {
    const { engine } = createGuideEngine();
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 50 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 220, docY: 60 }));
    expect(guidesOf(engine)).toHaveLength(1);

    engine.newDocument({ name: "Fresh", width: 400, height: 300 });

    // The preview went with the document, and the gesture with it: a release
    // that arrives afterwards must not bring the old guide back.
    engine.handlePointerSample(createSample({ phase: "up", docX: 220, docY: 60 }));
    expect(guidesOf(engine)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("changes no pixels: a guide never invalidates a layer", () => {
    const { engine, spy } = createGuideEngine();

    drag(engine, [100, 50], [220, 60]);
    drag(engine, [100, 200], [250, 210]);

    // A guide is metadata: no layer surface is invalidated and no stroke is
    // re-rasterized, so the document's pixels are exactly what they were.
    expect(spy.invalidated).toEqual([]);
    expect(engine.listStrokes(engine.getState().document.activeLayerId as string)).toEqual([]);
  });

  it("tells the renderer which guide is selected", () => {
    const { engine, spy } = createGuideEngine();
    drag(engine, [100, 50], [220, 60]);
    const id = guidesOf(engine)[0].id;

    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 100, docY: 200 }));

    expect(spy.selectedGuides).toContain(id);
  });
});

/**
 * The grid and snapping.
 *
 * Both are session/display state: the grid changes no pixels, enters no
 * history and never reaches the project file. Snapping moves the samples a
 * drawing tool commits, so a stroke drawn near a guide lands exactly on it -
 * still as one undo step.
 */
describe("DrawingEngine grid and snapping", () => {
  function createSnappingEngine(guides: readonly Guide[] = []) {
    const spy = createSpyRenderer();
    const base = createDocument({ name: "Test", width: 400, height: 300 });
    const engine = new DrawingEngine({
      document: { ...base, guides },
      renderer: spy.renderer,
    });
    return { engine, spy, layerId: engine.getState().document.activeLayerId as string };
  }

  /** One brush stroke through the engine's pointer router, down-move-up. */
  function paintStroke(
    engine: DrawingEngine,
    from: readonly [number, number],
    to: readonly [number, number],
  ): void {
    engine.handlePointerSample(createSample({ phase: "down", docX: from[0], docY: from[1] }));
    engine.handlePointerSample(
      createSample({ phase: "move", docX: to[0], docY: to[1], timeStamp: 16 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: to[0], docY: to[1], timeStamp: 32 }),
    );
  }

  it("starts with the grid hidden, the default spacing and snapping off", () => {
    const { engine } = createSnappingEngine();

    expect(engine.getState()).toMatchObject({
      gridVisible: false,
      gridSpacing: DEFAULT_GRID_SPACING,
      gridSnapping: false,
    });
  });

  it("snaps a committed stroke sample onto a guide, as one undo step", () => {
    const { engine, layerId } = createSnappingEngine([
      { id: "guide-x", axis: "vertical", position: 100 },
    ]);
    engine.setGridSnapping(true);

    // The press is 5 document pixels from the guide, inside the 6 CSS pixel
    // tolerance at 1x.
    paintStroke(engine, [95, 50], [130, 50]);

    const stroke = engine.listStrokes(layerId)[0];
    expect(stroke.xs[0]).toBe(100);
    expect(stroke.ys[0]).toBe(50);
    expect(engine.getState().history).toMatchObject({
      depth: 1,
      canUndo: true,
      undoLabel: "Stroke",
    });

    engine.undo();
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history).toMatchObject({ depth: 0, canRedo: true });
  });

  it("leaves the samples untouched while snapping is off", () => {
    const { engine, layerId } = createSnappingEngine([
      { id: "guide-x", axis: "vertical", position: 100 },
    ]);
    engine.setGridSnapping(false);

    paintStroke(engine, [95, 50], [130, 50]);

    const stroke = engine.listStrokes(layerId)[0];
    expect(stroke.xs[0]).toBe(95);
    expect(engine.getState().history.depth).toBe(1);
  });

  it("snaps to grid lines at the configured spacing", () => {
    const { engine, layerId } = createSnappingEngine();
    engine.setGridSpacing(20);
    engine.setGridSnapping(true);

    paintStroke(engine, [58.5, 39], [130, 70]);

    const stroke = engine.listStrokes(layerId)[0];
    expect(stroke.xs[0]).toBe(60);
    expect(stroke.ys[0]).toBe(40);
  });

  it("derives the tolerance from the zoom, so the same gesture snaps alike", () => {
    const guides: readonly Guide[] = [{ id: "guide-x", axis: "vertical", position: 100 }];

    const atOne = createSnappingEngine(guides);
    atOne.engine.setGridSnapping(true);
    paintStroke(atOne.engine, [105, 50], [130, 50]);
    expect(atOne.engine.listStrokes(atOne.layerId)[0].xs[0]).toBe(100);

    // The same 5 document pixels are 20 CSS pixels at 4x, outside the 6 CSS
    // tolerance, so the sample stays where the pointer is.
    const atFour = createSnappingEngine(guides);
    atFour.engine.setViewport({ zoom: 4, offsetX: 0, offsetY: 0 });
    atFour.engine.setGridSnapping(true);
    paintStroke(atFour.engine, [105, 50], [130, 50]);
    expect(atFour.engine.listStrokes(atFour.layerId)[0].xs[0]).toBe(105);
  });

  it("is session state: no history step, no dirty file, no invalidated layer", () => {
    const { engine, spy } = createSnappingEngine();

    engine.setGridVisible(true);
    engine.setGridSpacing(25);
    engine.setGridSnapping(true);

    expect(engine.getState()).toMatchObject({
      gridVisible: true,
      gridSpacing: 25,
      gridSnapping: true,
    });
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
    expect(spy.invalidated).toEqual([]);

    // The spacing is clamped and rounded like every other editor setting.
    engine.setGridSpacing(0);
    expect(engine.getState().gridSpacing).toBe(2);
  });
});
