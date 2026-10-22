/**
 * The polyline tool and the escape key.
 *
 * Two behaviours are pinned down here, and they are the same behaviour seen
 * from two sides:
 *
 *  - **a polyline** is a path the user places one vertex at a time. It stays
 *    open across clicks, so it needs a way to end - `Enter`, a double click,
 *    or a click on the first vertex - and a way to be thrown away.
 *  - **`Escape`** throws away whatever is being drawn. Before this, `Escape`
 *    only cleared the selection, so a shape or a brush stroke in flight kept
 *    previewing and was committed on the release: the user asked for the work
 *    to be dropped and got it kept.
 *
 * The tests drive the engine without a canvas, so they are about the geometry
 * the engine hands over, the history it records and the state it leaves
 * behind - not about pixels. The pixels are covered in `canvas2dRenderer.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { parseProject } from "../core/project/projectFormat";
import type { DrawingRenderer, Rgb } from "../core/rendering/types";
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

/**
 * A renderer that records what the engine asks of it.
 *
 * The polyline replaces its outline on every move, so the replaced outlines
 * are the interesting part: they are what the user watched.
 */
function createSpyRenderer() {
  const began: StrokeRecord[] = [];
  const replaced: Array<{ xs: number[]; ys: number[] }> = [];
  const ended: StrokeRecord[] = [];
  let cancelled = 0;

  const renderer: DrawingRenderer = {
    kind: "canvas2d",
    setDocument: () => {},
    setViewport: () => {},
    setDisplaySize: () => {},
    setRasterScale: () => {},
    invalidateLayer: () => {},
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
    setSelection: () => {},
    setSelectedGuide: () => {},
    setGrid: () => {},
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    readCompositePixel: (): Rgb | null => null,
    readCompositeImage: () => null,
    render: () => {},
    requestRender: () => {},
    destroy: () => {},
  };

  return {
    renderer,
    began,
    replaced,
    ended,
    getCancelled: () => cancelled,
  };
}

function createEngine() {
  const spy = createSpyRenderer();
  const engine = new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
    renderer: spy.renderer,
  });
  return { engine, spy, layerId: engine.getState().document.activeLayerId as string };
}

/** A click at a point: a press and a release in the same place. */
function click(
  engine: DrawingEngine,
  x: number,
  y: number,
  options: { timeStamp?: number; shift?: boolean } = {},
): void {
  const modifiers = {
    shift: options.shift === true,
    alt: false,
    ctrl: false,
    meta: false,
  };
  const timeStamp = options.timeStamp ?? 0;
  engine.handlePointerSample(
    createSample({ phase: "down", docX: x, docY: y, timeStamp, modifiers }),
  );
  engine.handlePointerSample(
    createSample({ phase: "up", docX: x, docY: y, timeStamp, modifiers }),
  );
}

/** A press, a move and a release: a drag from one point to another. */
function drag(
  engine: DrawingEngine,
  from: readonly [number, number],
  to: readonly [number, number],
  options: { timeStamp?: number; shift?: boolean } = {},
): void {
  const modifiers = {
    shift: options.shift === true,
    alt: false,
    ctrl: false,
    meta: false,
  };
  const timeStamp = options.timeStamp ?? 0;
  engine.handlePointerSample(
    createSample({ phase: "down", docX: from[0], docY: from[1], timeStamp, modifiers }),
  );
  engine.handlePointerSample(
    createSample({ phase: "move", docX: to[0], docY: to[1], timeStamp, modifiers }),
  );
  engine.handlePointerSample(
    createSample({ phase: "up", docX: to[0], docY: to[1], timeStamp, modifiers }),
  );
}

describe("the polyline tool", () => {
  it("places a vertex per click and commits the path as one stroke", () => {
    const { engine, spy, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });
    click(engine, 70, 90, { timeStamp: 2000 });

    // The path is still open: it has not reached the layer.
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
    expect(spy.ended).toHaveLength(0);

    engine.finishShapeGesture();

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].xs).toEqual([20, 120, 70]);
    expect(strokes[0].ys).toEqual([20, 20, 90]);
    expect(engine.getState().history.depth).toBe(1);
    expect(engine.getState().file.dirty).toBe(true);
  });

  it("shows the rubber band from the last vertex to the pointer", () => {
    const { engine, spy } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });

    // Two vertices are placed; the band follows the pointer to the next point.
    engine.handlePointerSample(createSample({ phase: "move", docX: 120, docY: 90 }));

    const last = spy.replaced[spy.replaced.length - 1];
    expect(last.xs).toEqual([20, 120, 120]);
    expect(last.ys).toEqual([20, 20, 90]);
  });

  it("shows nothing for a path that has no segment yet", () => {
    const { engine, spy } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });

    // One point is a click, not a shape: there is no outline to draw.
    for (const outline of spy.replaced) {
      expect(outline.xs).toHaveLength(0);
    }
  });

  it("constrains a segment to 45 degrees under Shift", () => {
    const { engine, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 0, 0, { timeStamp: 0 });
    // A drag at about 31 degrees: Shift straightens the segment to 45.
    drag(engine, [100, 60], [100, 60], { timeStamp: 1000, shift: true });
    engine.finishShapeGesture();

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    // The segment is 45 degrees, and it keeps its length.
    expect(strokes[0].xs[1]).toBeCloseTo(strokes[0].ys[1], 6);
    expect(Math.hypot(strokes[0].xs[1], strokes[0].ys[1])).toBeCloseTo(
      Math.hypot(100, 60),
      6,
    );
  });

  it("closes the path when the first vertex is clicked", () => {
    const { engine, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });
    click(engine, 70, 90, { timeStamp: 2000 });
    // Clicking the first vertex again closes the path and ends it.
    click(engine, 20, 20, { timeStamp: 3000 });

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    // The closing edge is drawn, so the first point is repeated at the end.
    expect(strokes[0].xs).toEqual([20, 120, 70, 20]);
    expect(strokes[0].ys).toEqual([20, 20, 90, 20]);
    expect(engine.getState().history.depth).toBe(1);
  });

  it("ends the path on a double click", () => {
    const { engine, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });
    // The second click of the double click ends the path.
    click(engine, 120, 20, { timeStamp: 1200 });

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].xs).toEqual([20, 120]);
    expect(engine.getState().history.depth).toBe(1);
  });

  it("does not end the path on two slow clicks", () => {
    const { engine, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });
    // Far too late to be a double click: this is another vertex.
    click(engine, 70, 90, { timeStamp: 5000 });

    expect(engine.listStrokes(layerId)).toHaveLength(0);
    engine.finishShapeGesture();
    expect(engine.listStrokes(layerId)[0].xs).toEqual([20, 120, 70]);
  });

  it("discards a path that never moved", () => {
    const { engine, spy, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    engine.finishShapeGesture();

    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
    expect(spy.ended).toHaveLength(0);
  });

  it("throws the path away with Escape, with no history and no dirty flag", () => {
    const { engine, spy, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });

    expect(engine.cancelActiveGesture()).toBe(true);

    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
    expect(spy.ended).toHaveLength(0);
    expect(spy.getCancelled()).toBe(1);
  });

  it("starts a fresh path after the last one was thrown away", () => {
    const { engine, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });
    engine.cancelActiveGesture();

    // The next press starts a new path: the old vertices are gone.
    click(engine, 200, 200, { timeStamp: 2000 });
    click(engine, 260, 200, { timeStamp: 3000 });
    engine.finishShapeGesture();

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].xs).toEqual([200, 260]);
  });

  it("keeps the path when the user moves on to another tool", () => {
    const { engine, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });

    // The path is finished work, not a half-finished preview.
    engine.setTool("brush");

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].xs).toEqual([20, 120]);
    expect(engine.getState().history.depth).toBe(1);
  });

  it("records the path as one undo step", () => {
    const { engine, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });
    click(engine, 70, 90, { timeStamp: 2000 });
    engine.finishShapeGesture();

    expect(engine.getState().history.depth).toBe(1);
    expect(engine.undo()).toBe(true);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.redo()).toBe(true);
    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });

  it("survives a save and a reopen", () => {
    const { engine, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });
    click(engine, 70, 90, { timeStamp: 2000 });
    engine.finishShapeGesture();

    // The path is an ordinary stroke, so the project file carries it like any
    // other stroke: reopening it gives the same path back.
    const parsed = parseProject(engine.serialize());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const reopened = parsed.project.strokes[0];
    expect(reopened.xs).toEqual(engine.listStrokes(layerId)[0].xs);
    expect(reopened.ys).toEqual(engine.listStrokes(layerId)[0].ys);
  });

  it("fills the path when the fill switch is on", () => {
    const { engine, layerId } = createEngine();

    engine.setShapeFill(true);
    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });
    click(engine, 70, 90, { timeStamp: 2000 });
    engine.finishShapeGesture();

    expect(engine.listStrokes(layerId)[0].fill).toBe(true);
  });

  it("does not open a path outside the document", () => {
    const { engine, spy, layerId } = createEngine();

    engine.setTool("polyline");
    click(engine, -20, 20, { timeStamp: 0 });

    // The press was outside the paper, so there is no path to work on.
    expect(spy.began).toHaveLength(0);
    expect(engine.canFinishShapeGesture()).toBe(false);

    // The next press inside the paper starts a fresh path.
    click(engine, 120, 20, { timeStamp: 1000 });
    click(engine, 70, 90, { timeStamp: 2000 });
    engine.finishShapeGesture();

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].xs).toEqual([120, 70]);
  });

  it("closes the path when the close option is on", () => {
    const { engine, layerId } = createEngine();

    engine.setShapeClosed(true);
    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    click(engine, 120, 20, { timeStamp: 1000 });
    click(engine, 70, 90, { timeStamp: 2000 });
    engine.finishShapeGesture();

    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(1);
    // The closing edge is drawn, so the first corner is repeated at the end.
    expect(strokes[0].xs).toEqual([20, 120, 70, 20]);
    expect(strokes[0].ys).toEqual([20, 20, 90, 20]);
  });

  it("keeps the closing setting the path was started with", () => {
    const { engine, layerId } = createEngine();

    engine.setShapeClosed(true);
    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    // The setting changes mid-path: the path keeps the one it started with.
    engine.setShapeClosed(false);
    click(engine, 120, 20, { timeStamp: 1000 });
    click(engine, 70, 90, { timeStamp: 2000 });
    engine.finishShapeGesture();

    const strokes = engine.listStrokes(layerId);
    expect(strokes[0].xs).toEqual([20, 120, 70, 20]);
  });

  it("treats the closing setting as editor state", () => {
    const { engine } = createEngine();

    expect(engine.getState().shapeClosed).toBe(false);
    engine.setShapeClosed(true);

    // It describes the next path, so it is not an edit.
    expect(engine.getState().shapeClosed).toBe(true);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("only offers the finish command while a path is open", () => {
    const { engine } = createEngine();

    expect(engine.canFinishShapeGesture()).toBe(false);

    engine.setTool("polyline");
    click(engine, 20, 20, { timeStamp: 0 });
    expect(engine.canFinishShapeGesture()).toBe(true);

    engine.finishShapeGesture();
    expect(engine.canFinishShapeGesture()).toBe(false);
  });
});

describe("Escape throws the drawing in flight away", () => {
  it("removes a shape preview, with no history and no dirty flag", () => {
    const { engine, spy, layerId } = createEngine();

    engine.setTool("rectangle");
    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 120, docY: 90 }));

    expect(engine.cancelActiveGesture()).toBe(true);

    expect(spy.ended).toHaveLength(0);
    expect(spy.getCancelled()).toBe(1);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("lets the next press through instead of swallowing it", () => {
    const { engine, layerId } = createEngine();

    engine.setTool("rectangle");
    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 120, docY: 90 }));
    engine.cancelActiveGesture();

    // The tool was told, so the next drag draws a shape instead of doing
    // nothing.
    engine.handlePointerSample(createSample({ phase: "down", docX: 200, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 260, docY: 240 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 260, docY: 240 }));

    expect(engine.listStrokes(layerId)).toHaveLength(1);
    expect(engine.getState().history.depth).toBe(1);
  });

  it("cancels a brush stroke in flight", () => {
    const { engine, spy, layerId } = createEngine();

    engine.handlePointerSample(createSample({ phase: "down", docX: 20, docY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 120, docY: 90 }));

    expect(engine.cancelActiveGesture()).toBe(true);

    expect(spy.ended).toHaveLength(0);
    expect(spy.getCancelled()).toBe(1);
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("does nothing when there is no gesture in flight", () => {
    const { engine } = createEngine();

    expect(engine.cancelActiveGesture()).toBe(false);
    expect(engine.getState().history.depth).toBe(0);
  });
});
