/**
 * The pointer lifecycle at the engine's boundary.
 *
 * The DOM binder hands the engine one *event* at a time, and an event can
 * carry several coalesced samples. Two things have to be true of that: every
 * sample has to reach the tool (a stroke must not lose a sample), and the
 * pointer's *position* has to be reported once (the intermediate positions
 * belong to the same physical move, so republishing them only costs a DOM
 * write per sample).
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import type { CursorReport, PointerSample } from "../types/pointer";

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

describe("a move event with coalesced samples", () => {
  it("reports the pointer's position once, for the newest sample", () => {
    const engine = createEngine();
    const reports: CursorReport[] = [];
    engine.subscribeCursor((report) => reports.push(report));

    engine.handlePointerSamples([
      createSample({ docX: 10, docY: 10 }),
      createSample({ docX: 20, docY: 20 }),
      createSample({ docX: 30, docY: 30 }),
      createSample({ docX: 40, docY: 40 }),
    ]);

    expect(reports).toHaveLength(1);
    expect(reports[0].docX).toBe(40);
    expect(reports[0].docY).toBe(40);
  });

  it("keeps every sample in the stroke", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.handlePointerSample(createSample({ phase: "down", docX: 10, docY: 10 }));
    engine.handlePointerSamples([
      createSample({ docX: 20, docY: 20, timeStamp: 10 }),
      createSample({ docX: 30, docY: 30, timeStamp: 20 }),
      createSample({ docX: 40, docY: 40, timeStamp: 30 }),
    ]);
    engine.handlePointerSample(createSample({ phase: "up", docX: 40, docY: 40, timeStamp: 40 }));

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    // The stroke builder interpolates between the samples, so the stored path
    // is longer than the four points that were fed in. What matters is that
    // every one of them is on the path: a lost sample would cut a corner.
    const xs = strokes[0].xs;
    expect(xs[0]).toBe(10);
    expect(xs[xs.length - 1]).toBe(40);
    for (const x of [20, 30]) {
      expect(xs).toContain(x);
    }
  });

  it("reports the position for a press and for a release", () => {
    const engine = createEngine();
    const reports: CursorReport[] = [];
    engine.subscribeCursor((report) => reports.push(report));

    engine.handlePointerSample(createSample({ phase: "down", docX: 5, docY: 6 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 7, docY: 8 }));

    expect(reports.map((report) => report.docX)).toEqual([5, 7]);
  });
});

describe("a gesture that is cancelled", () => {
  it("leaves a shape with no stroke and no history step", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;
    engine.setTool("rectangle");

    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 120, docY: 90 }));
    engine.handlePointerSample(createSample({ phase: "cancel", docX: 120, docY: 90 }));

    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("commits a brush stroke exactly once, however often it is cancelled", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 60, docY: 40 }));
    // The brush's pixels are real once they are rasterized, so a cancel
    // commits them - but it commits them once, not twice.
    engine.handlePointerSample(createSample({ phase: "cancel", docX: 60, docY: 40 }));
    engine.handlePointerSample(createSample({ phase: "cancel", docX: 60, docY: 40 }));

    expect(engine.listStrokes(layerId)).toHaveLength(1);
    expect(engine.getState().history.depth).toBe(1);
  });

  it("does not grow a stroke that was already cancelled", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 60, docY: 40 }));
    engine.handlePointerSample(createSample({ phase: "cancel", docX: 60, docY: 40 }));
    const committed = engine.listStrokes(layerId)[0].xs.length;

    // The pointer keeps moving after the gesture was ended. The stroke is
    // already committed, so the movement must not extend it.
    engine.handlePointerSample(createSample({ phase: "move", docX: 200, docY: 160 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 260, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 260, docY: 200 }));

    expect(engine.listStrokes(layerId)).toHaveLength(1);
    expect(engine.listStrokes(layerId)[0].xs.length).toBe(committed);
    expect(engine.getState().history.depth).toBe(1);
  });
});

describe("an engine that is detached mid-gesture", () => {
  it("gives a selection move back, so the document keeps no unrecorded edit", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    // A stroke, then a selection of it, then a move of that selection.
    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 80, docY: 60 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 80, docY: 60 }));
    const before = [...engine.listStrokes(layerId)[0].xs];

    engine.setTool("select");
    engine.handlePointerSample(createSample({ phase: "down", docX: 10, docY: 10 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 200, docY: 150 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 200, docY: 150 }));
    engine.handlePointerSample(createSample({ phase: "down", docX: 40, docY: 30 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 140, docY: 90 }));

    // The move is in flight: the samples have moved but nothing is recorded.
    expect(engine.listStrokes(layerId)[0].xs).not.toEqual(before);

    engine.detach();

    // The move is given back: the samples are where they were and no step was
    // recorded for a transform that never finished.
    expect(engine.listStrokes(layerId)[0].xs).toEqual(before);
    expect(engine.getState().history.depth).toBe(1);
  });
});
