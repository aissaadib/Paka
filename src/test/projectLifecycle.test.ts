/**
 * Document lifecycle tests: what makes a drawing "unsaved", and what a reopened
 * one looks like.
 *
 * No canvas is involved - the engine works with a null renderer - so this is
 * about the state machine: revisions, the saved revision, the file path and the
 * undo history that a loaded project rebuilds.
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { parseProject } from "../core/project/projectFormat";
import { serializeProject } from "../core/project/projectFormat";
import { isFillPatch, isGradient } from "../core/document/types";
import type {
  FillPatchRecord,
  GradientRecord,
  LayerElement,
  StrokeRecord,
  StrokeSource,
} from "../core/document/types";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import type { PointerSample } from "../types/pointer";

function sample(x: number, y: number): PointerSample {
  return {
    phase: "move",
    pointerId: 1,
    kind: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: x,
    docY: y,
    screenX: x,
    screenY: y,
    pressure: 0.5,
    hasPressure: true,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

function paintStroke(engine: DrawingEngine, offset = 0): void {
  engine.beginStroke(sample(offset, offset));
  engine.extendStroke(sample(offset + 4, offset + 2));
  engine.finishStroke();
}

function activeLayerId(engine: DrawingEngine) {
  return engine.getState().document.layers[0].id;
}

describe("unsaved-changes tracking", () => {
  it("starts clean and without a path", () => {
    const engine = new DrawingEngine();

    expect(engine.getState().file).toEqual({ path: null, dirty: false });
  });

  it("becomes dirty when a stroke is committed", () => {
    const engine = new DrawingEngine();
    const before = engine.getState().file;

    paintStroke(engine);

    const after = engine.getState().file;
    expect(after.dirty).toBe(true);
    expect(after.path).toBeNull();
    // A new object, because the snapshot only changes when something changed.
    expect(after).not.toBe(before);
  });

  it("is clean again once the revision has been saved", () => {
    const engine = new DrawingEngine();
    paintStroke(engine);

    engine.markSaved("C:\\art\\cat.paka");

    expect(engine.getState().file).toEqual({ path: "C:\\art\\cat.paka", dirty: false });
  });

  it("stays dirty when history moves away from the saved revision", () => {
    // Undoing back to the state that was saved does not make the file current
    // again: revisions are monotonic, so the user is asked to save rather than
    // being told work is safe when it may not be.
    const engine = new DrawingEngine();
    paintStroke(engine);
    engine.markSaved("C:\\art\\cat.paka");

    engine.undo();

    expect(engine.getState().file.dirty).toBe(true);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("drops the path and the dirty flag on a new document", () => {
    const engine = new DrawingEngine();
    paintStroke(engine);
    engine.markSaved("C:\\art\\cat.paka");

    engine.newDocument({ name: "Untitled", width: 100, height: 100 });

    expect(engine.getState().file).toEqual({ path: null, dirty: false });
    expect(engine.listStrokes(activeLayerId(engine))).toHaveLength(0);
  });

  it("keeps the same file state object when nothing changed", () => {
    const engine = new DrawingEngine();
    paintStroke(engine);
    engine.markSaved("C:\\art\\cat.paka");
    const file = engine.getState().file;

    // A view-only change must not produce a new file state, or every React
    // subscriber would re-render on a pan.
    engine.setViewport({ zoom: 2, offsetX: 10, offsetY: 20 });

    expect(engine.getState().file).toBe(file);
  });
});

describe("serialize and loadProject", () => {
  it("round-trips a drawing through the engine", () => {
    const engine = new DrawingEngine({ brush: { ...DEFAULT_BRUSH, size: 24 } });
    paintStroke(engine, 0);
    paintStroke(engine, 20);
    const original = engine.getState().document;
    const text = engine.serialize();

    // A second engine, as if the project had been opened in a fresh session.
    const reopened = new DrawingEngine();
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    reopened.loadProject(parsed.project, "C:\\art\\cat.paka");

    expect(reopened.getState().document).toEqual(original);
    expect(reopened.listStrokes(original.layers[0].id)).toHaveLength(2);
    expect(reopened.getState().file).toEqual({ path: "C:\\art\\cat.paka", dirty: false });
  });

  it("round-trips eraser strokes as erasers", () => {
    const engine = new DrawingEngine();
    paintStroke(engine, 0);
    engine.setTool("eraser");
    paintStroke(engine, 10);
    const text = engine.serialize();

    const reopened = new DrawingEngine();
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    reopened.loadProject(parsed.project, null);

    // The erasure survives as an erasure: reopening must not turn it into paint.
    const strokes = reopened.listStrokes(activeLayerId(reopened));
    expect(strokes).toHaveLength(2);
    expect(strokes.map((stroke) => stroke.erase === true)).toEqual([false, true]);
    expect(reopened.getState().history.undoLabel).toBe("Erase");

    expect(reopened.undo()).toBe(true);
    expect(reopened.listStrokes(activeLayerId(reopened))).toHaveLength(1);
    // Undo/redo keeps the erasure an erasure.
    expect(reopened.redo()).toBe(true);
    expect(reopened.listStrokes(activeLayerId(reopened))[1].erase).toBe(true);
  });

  it("round-trips a soft brush's hardness through save and reopen", () => {
    const engine = new DrawingEngine({
      brush: { ...DEFAULT_BRUSH, size: 40, hardness: 0.3 },
    });
    paintStroke(engine, 0);
    const text = engine.serialize();

    const reopened = new DrawingEngine();
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    reopened.loadProject(parsed.project, null);

    const strokes = reopened.listStrokes(activeLayerId(reopened));
    expect(strokes).toHaveLength(1);
    expect(strokes[0].brush.hardness).toBe(0.3);
    // The loaded soft stroke stays one undoable step and keeps its softness
    // through undo and redo, because hardness lives on the stroke record.
    expect(reopened.undo()).toBe(true);
    expect(reopened.redo()).toBe(true);
    expect(reopened.listStrokes(activeLayerId(reopened))[0].brush.hardness).toBe(0.3);
  });

  it("round-trips spacing and stabilizer through save and reopen", () => {
    const engine = new DrawingEngine({
      brush: { ...DEFAULT_BRUSH, size: 40, spacing: 0.35, stabilizer: 0.65 },
    });
    paintStroke(engine, 0);
    const text = engine.serialize();

    const reopened = new DrawingEngine();
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    reopened.loadProject(parsed.project, null);

    const strokes = reopened.listStrokes(activeLayerId(reopened));
    expect(strokes).toHaveLength(1);
    expect(strokes[0].brush.spacing).toBe(0.35);
    expect(strokes[0].brush.stabilizer).toBe(0.65);
    expect(reopened.undo()).toBe(true);
    expect(reopened.redo()).toBe(true);
    expect(reopened.listStrokes(activeLayerId(reopened))[0].brush.stabilizer).toBe(0.65);
  });

  it("rebuilds one undoable step per loaded stroke", () => {
    const engine = new DrawingEngine();
    paintStroke(engine, 0);
    paintStroke(engine, 20);
    paintStroke(engine, 40);
    const text = engine.serialize();

    const reopened = new DrawingEngine();
    const parsed = parseProject(text);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    reopened.loadProject(parsed.project, null);

    expect(reopened.getState().history.depth).toBe(3);
    // Undo removes what it says it removes: a loaded drawing stays editable.
    expect(reopened.undo()).toBe(true);
    expect(reopened.listStrokes(activeLayerId(reopened))).toHaveLength(2);
    expect(reopened.getState().file.dirty).toBe(true);
  });

  it("round-trips a duplicated layer and its copied strokes", () => {
    const engine = new DrawingEngine();
    paintStroke(engine, 0);
    const sourceLayerId = activeLayerId(engine);

    engine.duplicateLayer(sourceLayerId);
    const [bottomLayer, copiedLayer] = engine.getState().document.layers;
    expect(copiedLayer.name).toBe("Layer 1 copy");

    const text = engine.serialize();
    const parsed = parseProject(text);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }

    const reopened = new DrawingEngine();
    reopened.loadProject(parsed.project, null);

    // The copy survives a save/load cycle as a real layer with its own strokes.
    expect(reopened.getState().document.layers.map((layer) => layer.id)).toEqual([
      bottomLayer.id,
      copiedLayer.id,
    ]);
    expect(reopened.getState().document.layers[1].name).toBe("Layer 1 copy");
    expect(reopened.listStrokes(bottomLayer.id)).toHaveLength(1);
    expect(reopened.listStrokes(copiedLayer.id)).toHaveLength(1);
    expect(reopened.listStrokes(copiedLayer.id)[0].id).not.toBe(
      reopened.listStrokes(bottomLayer.id)[0].id,
    );
  });

  it("has nothing to export without a drawing surface", () => {
    const engine = new DrawingEngine();

    expect(() => engine.renderDocumentImage()).toThrow(/not attached/);
  });

  it("round-trips committed fills as pixels, with one undo step each", () => {
    const document = createDocument({ width: 40, height: 30 });
    const layerId = document.layers[0].id;
    const stroke: StrokeRecord = {
      id: "stroke-loaded",
      layerId,
      brush: { ...DEFAULT_BRUSH },
      xs: [1, 2],
      ys: [1, 2],
      pressures: [1, 1],
      times: [0, 16],
      startTime: 0,
    };
    const mask = new Uint8Array([255, 0, 0, 255]);
    const fill: FillPatchRecord = {
      id: "fill-loaded",
      layerId,
      kind: "fill",
      color: "#336699",
      x: 5,
      y: 6,
      width: 2,
      height: 2,
      mask,
    };
    const elements: LayerElement[] = [fill, stroke];
    const source: StrokeSource = {
      listStrokes: () => [stroke],
      listElements: () => elements,
    };
    const text = serializeProject(document, source);

    const parsed = parseProject(text);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const reopened = new DrawingEngine();
    reopened.loadProject(parsed.project, "C:\\art\\filled.paka");

    // Painting order survives, and the fill is content, not a stroke.
    expect(reopened.listElements(layerId).map((element) => element.id)).toEqual([
      fill.id,
      stroke.id,
    ]);
    expect(reopened.listStrokes(layerId).map((entry) => entry.id)).toEqual([stroke.id]);
    expect(reopened.getState().history.depth).toBe(2);

    const reopenedFill = reopened.listElements(layerId)[0];
    expect(isFillPatch(reopenedFill)).toBe(true);
    if (!isFillPatch(reopenedFill)) {
      return;
    }
    expect([...reopenedFill.mask]).toEqual([...mask]);

    // Both kinds replay through history after a reopen.
    expect(reopened.undo()).toBe(true);
    expect(reopened.listElements(layerId).map((element) => element.id)).toEqual([fill.id]);
    expect(reopened.undo()).toBe(true);
    expect(reopened.listElements(layerId)).toEqual([]);
    expect(reopened.redo()).toBe(true);
    expect(reopened.redo()).toBe(true);

    const replay = reopened.listElements(layerId)[0];
    expect(replay).toBe(reopenedFill);
    expect(isFillPatch(replay) && replay.mask).toBe(reopenedFill.mask);

    // Saving again writes the same patch, byte for byte.
    const savedAgain = parseProject(reopened.serialize());
    expect(savedAgain.ok).toBe(true);
    if (!savedAgain.ok) {
      return;
    }
    const savedFill = savedAgain.project.elements[0];
    expect(isFillPatch(savedFill) && [...savedFill.mask]).toEqual([...mask]);
  });

  it("round-trips a committed gradient as geometry, with one undo step", () => {
    const document = createDocument({ width: 32, height: 24 });
    const layerId = document.layers[0].id;
    const gradient: GradientRecord = {
      id: "gradient-loaded",
      layerId,
      kind: "gradient",
      type: "radial",
      x1: 8,
      y1: 9,
      x2: 20,
      y2: 21,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
      opacity: 0.6,
    };
    const stroke: StrokeRecord = {
      id: "stroke-after-gradient",
      layerId,
      brush: { ...DEFAULT_BRUSH },
      xs: [1, 2],
      ys: [3, 4],
      pressures: [1, 1],
      times: [0, 16],
      startTime: 0,
    };
    const source: StrokeSource = {
      listStrokes: (id) => (id === layerId ? [stroke] : []),
      listElements: (id) => (id === layerId ? [gradient, stroke] : []),
    };

    const parsed = parseProject(serializeProject(document, source));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const reopened = new DrawingEngine();
    reopened.loadProject(parsed.project, "C:\\art\\gradient.paka");

    expect(reopened.listElements(layerId).map((element) => element.id)).toEqual([
      gradient.id,
      stroke.id,
    ]);
    const restored = reopened.listElements(layerId)[0];
    expect(isGradient(restored)).toBe(true);
    if (!isGradient(restored)) {
      return;
    }
    expect(restored).toEqual(gradient);
    expect(reopened.getState().history.depth).toBe(2);

    expect(reopened.undo()).toBe(true);
    expect(reopened.listElements(layerId).map((element) => element.id)).toEqual([
      gradient.id,
    ]);
    expect(reopened.undo()).toBe(true);
    expect(reopened.listElements(layerId)).toEqual([]);
    expect(reopened.redo()).toBe(true);
    expect(reopened.redo()).toBe(true);
    expect(reopened.listElements(layerId)[0]).toBe(restored);
  });

  it("does not pretend a loaded project is unsaved", () => {    const engine = new DrawingEngine({ document: createDocument({ width: 40, height: 40 }) });
    const text = engine.serialize();

    const reopened = new DrawingEngine();
    const parsed = parseProject(text);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    reopened.loadProject(parsed.project, "C:\\art\\empty.paka");

    expect(reopened.getState().file.dirty).toBe(false);
    expect(reopened.getState().history.depth).toBe(0);
  });
});
