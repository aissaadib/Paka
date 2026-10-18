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

  it("has nothing to export without a drawing surface", () => {
    const engine = new DrawingEngine();

    expect(() => engine.renderDocumentImage()).toThrow(/not attached/);
  });

  it("does not pretend a loaded project is unsaved", () => {
    const engine = new DrawingEngine({ document: createDocument({ width: 40, height: 40 }) });
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
