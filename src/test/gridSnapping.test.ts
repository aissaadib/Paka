/**
 * The grid overlay and the pointer snap, end to end.
 *
 * The pure geometry lives in `core/document/grid.ts` and is tested in
 * `grid.test.ts`. This file covers the three things that are not pure:
 *
 *  - the **engine seam**: which samples snap, what they snap to, and what
 *    stays exactly as it was when the snapping is off;
 *  - the **viewport**: the same document point has to snap the same way
 *    through a zoom and a pan, and it has to come back to the screen
 *    position the user aimed at;
 *  - the **renderer**: the grid is drawn over the paper in document space,
 *    and it never reaches an export.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DEFAULT_GRID_SETTINGS, gridLinesBetween } from "../core/document/grid";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import type { DrawingRenderer, RendererSelection, Rgb, StrokeSource } from "../core/rendering/types";
import { docToScreen, screenToDoc } from "../core/rendering/viewport";
import type { Guide } from "../core/document/types";
import { isGradient } from "../core/document/types";
import type { PointerSample } from "../types/pointer";
import type { Viewport } from "../types/viewport";
import {
  installRecordingDocument,
  RecordingCanvas,
  type RecordingDocument,
} from "./support/recordingCanvas";

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

/** A renderer that records what the engine asks of it. */
function createSpyRenderer() {
  const grids: Array<{ visible: boolean; spacing: number; snap: boolean }> = [];
  const renderer: DrawingRenderer = {
    kind: "canvas2d",
    setDocument: () => {},
    setViewport: () => {},
    setDisplaySize: () => {},
    setRasterScale: () => {},
    invalidateLayer: () => {},
    beginStroke: () => {},
    extendStroke: () => {},
    replaceStroke: () => {},
    endStroke: () => {},
    cancelStroke: () => {},
    setSelection: (_selection: RendererSelection | null) => {},
    setSelectedGuide: () => {},
    setReferenceSources: () => {},
    setSelectedReference: () => {},
    setGrid: (grid) => {
      grids.push(grid);
    },
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    readCompositePixel: (): Rgb | null => null,
    readCompositeImage: (): ImageData | null => null,
    render: () => {},
    requestRender: () => {},
    destroy: () => {},
  };
  return { renderer, grids };
}

interface GridEngine {
  readonly engine: DrawingEngine;
  readonly grids: Array<{ visible: boolean; spacing: number; snap: boolean }>;
}

function createGridEngine(
  guides: readonly Guide[] = [],
  viewport?: Viewport,
  size: { width?: number; height?: number } = {},
): GridEngine {
  const spy = createSpyRenderer();
  const base = createDocument({
    name: "Test",
    width: size.width ?? 400,
    height: size.height ?? 300,
  });
  const engine = new DrawingEngine({
    document: { ...base, guides },
    renderer: spy.renderer,
  });
  if (viewport) {
    engine.setViewport(viewport);
  }
  return { engine, grids: spy.grids };
}

/** The layer the engine draws on. */
function layerIdOf(engine: DrawingEngine): string {
  return engine.getState().document.activeLayerId as string;
}

/** Drags with the pointer and releases it. */
function drag(
  engine: DrawingEngine,
  from: readonly [number, number],
  to: readonly [number, number],
): void {
  engine.handlePointerSample(createSample({ phase: "down", docX: from[0], docY: from[1] }));
  engine.handlePointerSample(createSample({ phase: "move", docX: to[0], docY: to[1] }));
  engine.handlePointerSample(createSample({ phase: "up", docX: to[0], docY: to[1] }));
}

describe("the grid and snapping in the engine", () => {
  it("starts with no grid and no snapping", () => {
    const { engine } = createGridEngine();
    const state = engine.getState();
    expect(state.gridVisible).toBe(DEFAULT_GRID_SETTINGS.visible);
    expect(state.gridSpacing).toBe(DEFAULT_GRID_SETTINGS.spacing);
    expect(state.gridSnapping).toBe(DEFAULT_GRID_SETTINGS.snap);
  });

  it("leaves a shape exactly where it was drawn while the snapping is off", () => {
    const { engine } = createGridEngine();
    engine.setTool("rectangle");

    // 37 is 3 away from the line at 40 and 33 away from the line at 0: with
    // the snapping off it stays where the pointer was.
    drag(engine, [37, 70], [120, 90]);

    const strokes = engine.listStrokes(layerIdOf(engine));
    expect(strokes).toHaveLength(1);
    expect(strokes[0].xs).toEqual([37, 120, 120, 37, 37]);
    expect(strokes[0].ys).toEqual([70, 70, 90, 90, 70]);
  });

  it("lands a shape's corners on the grid lines while the snapping is on", () => {
    const { engine } = createGridEngine();
    engine.setGridSpacing(40);
    engine.setGridSnapping(true);
    engine.setTool("rectangle");

    // 37 is 3 away from the line at 40: inside the 6 pixel tolerance. 70 is
    // 10 away from the lines at 60 and 80, so the y stays where it was.
    drag(engine, [37, 70], [120, 90]);

    const strokes = engine.listStrokes(layerIdOf(engine));
    expect(strokes).toHaveLength(1);
    expect(strokes[0].xs).toEqual([40, 120, 120, 40, 40]);
    expect(strokes[0].ys).toEqual([70, 70, 90, 90, 70]);
  });

  it("leaves a corner alone when no target is within reach", () => {
    const { engine } = createGridEngine();
    engine.setGridSpacing(40);
    engine.setGridSnapping(true);
    engine.setTool("rectangle");

    // 70 is 10 away from the lines at 60 and 80.
    drag(engine, [70, 70], [120, 90]);

    const strokes = engine.listStrokes(layerIdOf(engine));
    expect(strokes[0].xs).toEqual([70, 120, 120, 70, 70]);
    expect(strokes[0].ys).toEqual([70, 70, 90, 90, 70]);
  });

  it("lands a shape's corner on a composition guide", () => {
    // The guide at 137 is the only target in reach: the nearest grid line of
    // the default spacing is 150, which is 13 away.
    const { engine } = createGridEngine([{ id: "g1", axis: "vertical", position: 137 }]);
    engine.setGridSnapping(true);
    engine.setTool("rectangle");

    // 134 is 3 away from the guide at 137.
    drag(engine, [134, 60], [160, 90]);

    const strokes = engine.listStrokes(layerIdOf(engine));
    expect(strokes[0].xs).toEqual([137, 160, 160, 137, 137]);
  });

  it("snaps a gradient's ends while the snapping is on", () => {
    const { engine } = createGridEngine();
    engine.setGridSpacing(40);
    engine.setGridSnapping(true);
    engine.setTool("gradient");

    drag(engine, [37, 78], [120, 90]);

    const gradients = engine
      .listElements(layerIdOf(engine))
      .filter(isGradient);
    expect(gradients).toHaveLength(1);
    const gradient = gradients[0] as {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };
    // 37 is 3 away from the line at 40 and 78 is 2 away from the line at 80.
    expect(gradient.x1).toBe(40);
    expect(gradient.y1).toBe(80);
    expect(gradient.x2).toBe(120);
    // 90 is 10 away from the line at 80, so the end of the drag stays put.
    expect(gradient.y2).toBe(90);
  });

  it("nudges a freehand brush sample onto a line it passes", () => {
    const { engine } = createGridEngine();
    engine.setGridSpacing(40);
    engine.setGridSnapping(true);
    engine.setTool("brush");

    // 37 is 3 away from the line at 40: the magnet reaches it.
    drag(engine, [37, 42], [40, 45]);

    const strokes = engine.listStrokes(layerIdOf(engine));
    expect(strokes).toHaveLength(1);
    // The sample is committed where the magnet put it, so what the user drew
    // and what the document holds agree.
    expect(strokes[0].xs[0]).toBe(40);
  });

  it("leaves a freehand brush sample alone when no target is in reach", () => {
    const { engine } = createGridEngine();
    engine.setGridSpacing(40);
    engine.setGridSnapping(true);
    engine.setTool("brush");

    // 70 is 10 away from the lines at 60 and 80: outside the magnet.
    drag(engine, [70, 70], [73, 75]);

    const strokes = engine.listStrokes(layerIdOf(engine));
    expect(strokes).toHaveLength(1);
    expect(strokes[0].xs[0]).toBe(70);
  });

  it("still ignores a press outside the paper while the snapping is on", () => {
    const { engine } = createGridEngine();
    engine.setGridSpacing(40);
    engine.setGridSnapping(true);
    engine.setTool("rectangle");

    // -4 would snap onto the line at 0, but a press outside the paper is
    // ignored, exactly as it is without the snapping.
    drag(engine, [-4, 20], [100, 90]);

    expect(engine.listStrokes(layerIdOf(engine))).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("never lets the snap push a gesture off the paper", () => {
    // The paper is 395 wide, so the line at 400 is off it.
    const { engine } = createGridEngine([], undefined, { width: 395 });
    engine.setGridSpacing(400);
    engine.setGridSnapping(true);
    engine.setTool("rectangle");

    // 394 is 6 away from the line at 400: inside the tolerance, but the line
    // is off the paper, so the corner stays where the pointer was.
    drag(engine, [394, 20], [100, 90]);

    const strokes = engine.listStrokes(layerIdOf(engine));
    expect(strokes).toHaveLength(1);
    for (const x of strokes[0].xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(395);
    }
  });

  it("tells the renderer about the grid", () => {
    const { engine, grids } = createGridEngine();
    engine.setGridVisible(true);
    engine.setGridSpacing(25);
    engine.setGridSnapping(true);

    expect(grids).toHaveLength(3);
    expect(grids[2]).toEqual({ visible: true, spacing: 25, snap: true });
  });

  it("clamps the spacing to whole document pixels", () => {
    const { engine } = createGridEngine();
    engine.setGridSpacing(25.4);
    expect(engine.getState().gridSpacing).toBe(25);
    engine.setGridSpacing(-10);
    expect(engine.getState().gridSpacing).toBeGreaterThanOrEqual(2);
    engine.setGridSpacing(Number.NaN);
    expect(engine.getState().gridSpacing).toBe(DEFAULT_GRID_SETTINGS.spacing);
  });

  it("keeps the grid out of the document, the history and the file", () => {
    const { engine } = createGridEngine();
    const before = engine.serialize();

    engine.setGridVisible(true);
    engine.setGridSpacing(25);
    engine.setGridSnapping(true);

    // A display preference is not an edit: no history, no dirty flag, and the
    // project file is byte-identical.
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
    expect(engine.serialize()).toBe(before);
  });

  it("keeps the grid out of the document when a shape is drawn with it on", () => {
    const { engine } = createGridEngine();
    engine.setGridVisible(true);
    engine.setGridSpacing(50);
    engine.setGridSnapping(true);
    const before = engine.serialize();

    engine.setTool("rectangle");
    drag(engine, [37, 42], [120, 90]);

    // The stroke is a normal entry in the file; the grid is not in it.
    const after = engine.serialize();
    expect(after).not.toBe(before);
    expect(after).not.toContain("grid");
    expect(engine.getState().history.depth).toBe(1);
  });
});

describe("the snap through the viewport", () => {
  it("snaps a point that is within the tolerance on screen at every zoom", () => {
    // The tolerance is 6 *screen* pixels, so the same gesture - the pointer
    // 3 CSS pixels away from the line - snaps at every zoom, whatever the
    // distance is in document pixels.
    for (const zoom of [0.5, 1, 2.5, 4]) {
      const viewport: Viewport = { zoom, offsetX: 30, offsetY: -12 };
      const { engine } = createGridEngine([], viewport);
      engine.setGridSpacing(40);
      engine.setGridSnapping(true);
      engine.setTool("rectangle");

      const x = 40 + 3 / zoom;
      drag(engine, [x, 20], [120, 90]);

      const strokes = engine.listStrokes(layerIdOf(engine));
      expect(strokes[0].xs[0]).toBeCloseTo(40, 9);
    }
  });

  it("maps a snapped point back to the screen position it was aimed at", () => {
    const viewport: Viewport = { zoom: 2.5, offsetX: 40, offsetY: 15 };
    const { engine } = createGridEngine([], viewport);
    engine.setGridSpacing(40);
    engine.setGridSnapping(true);
    engine.setTool("rectangle");

    // 3 CSS pixels from the line at 40, which is 1.2 document pixels here.
    drag(engine, [40 + 3 / 2.5, 20], [120, 90]);

    const strokes = engine.listStrokes(layerIdOf(engine));
    const snapped = { x: strokes[0].xs[0], y: strokes[0].ys[0] };
    // The snapped point is exactly on a grid line, and it is a whole document
    // pixel, so it comes back through the transform without a remainder.
    expect(snapped.x).toBe(40);

    const screen = docToScreen(viewport, snapped.x, snapped.y);
    const back = screenToDoc(viewport, screen.x, screen.y);
    expect(back.x).toBeCloseTo(snapped.x, 9);
    expect(back.y).toBeCloseTo(snapped.y, 9);

    // And the line it sits on is one the grid actually draws.
    expect(gridLinesBetween(0, 400, 40)).toContain(snapped.x);
  });

  it("keeps the drawn grid and the snapped grid the same lines", () => {
    const spacing = 40;
    const lines = gridLinesBetween(0, 400, spacing);
    for (const line of lines) {
      expect(line % spacing).toBe(0);
    }
    expect(lines[0]).toBe(0);
    expect(lines[lines.length - 1]).toBe(400);
  });
});

describe("the grid overlay in the renderer", () => {
  let recording: RecordingDocument;

  beforeEach(() => {
    recording = installRecordingDocument();
  });

  afterEach(() => {
    recording.restore();
  });

  function renderGrid(
    grid: { visible: boolean; spacing: number; snap: boolean },
    options: { zoom?: number; width?: number; height?: number } = {},
  ) {
    const display = new RecordingCanvas();
    const strokeSource: StrokeSource = {
      listStrokes: () => [],
      listElements: () => [],
    };
    const renderer = new Canvas2DRenderer({
      canvas: display.asElement(),
      strokeSource,
      scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
    });
    renderer.setDocument(createDocument({ width: 100, height: 80 }));
    renderer.setViewport({ zoom: options.zoom ?? 1, offsetX: 0, offsetY: 0 });
    renderer.setDisplaySize(options.width ?? 200, options.height ?? 160, 1);
    renderer.setGrid(grid);
    display.calls.length = 0;
    renderer.render();
    return { display, renderer };
  }

  it("draws the grid at the document positions, whatever the zoom", () => {
    for (const zoom of [0.5, 1, 4]) {
      const { display } = renderGrid(
        { visible: true, spacing: 50, snap: false },
        { zoom },
      );

      const moves = display.named("moveTo");
      const lines = display.named("lineTo");
      // The path is in document space: the vertical line at 50 is at x 50
      // whatever the zoom, and the canvas transform maps it to the device.
      const at50 = moves.find((call) => call.args[0] === 50);
      expect(at50).toBeDefined();
      expect(lines.find((call) => call.args[0] === 50)).toBeDefined();

      const transform = display.named("setTransform")[1];
      const scale = transform.args[0] as number;
      const deviceX = 50 * scale + (transform.args[4] as number);
      expect(deviceX).toBeCloseTo(50 * zoom, 10);
    }
  });

  it("covers the paper with a line per spacing, and no more", () => {
    // At 1x the whole 100x80 paper is visible: three vertical lines (0, 50
    // and 100) and two horizontal ones (0 and 50). The grid is clipped to the
    // paper, so it never draws outside it.
    const { display } = renderGrid({ visible: true, spacing: 50, snap: false });

    const moves = display.named("moveTo");
    expect(moves).toHaveLength(3 + 2);
    expect(moves.map((call) => call.args)).toEqual([
      [0, 0],
      [50, 0],
      [100, 0],
      [0, 0],
      [0, 50],
    ]);
  });

  it("keeps the grid one device pixel wide at every zoom", () => {
    for (const zoom of [0.5, 1, 4]) {
      const { display } = renderGrid(
        { visible: true, spacing: 50, snap: false },
        { zoom },
      );
      const strokes = display.named("stroke");
      expect(strokes).toHaveLength(1);
      expect(strokes[0].lineWidth * zoom).toBeCloseTo(1, 10);
    }
  });

  it("draws nothing while the grid is hidden", () => {
    const { display } = renderGrid({ visible: false, spacing: 50, snap: false });
    expect(display.named("stroke")).toHaveLength(0);
    expect(display.named("moveTo")).toHaveLength(0);
  });

  it("keeps the grid out of the exported composite", () => {
    const { renderer } = renderGrid({ visible: true, spacing: 50, snap: false });
    const composed = renderer.composeDocumentImage() as unknown as RecordingCanvas;
    expect(composed.named("moveTo")).toHaveLength(0);
    expect(composed.named("stroke")).toHaveLength(0);
  });

  it("draws the grid after the layers and before the guides", () => {
    const display = new RecordingCanvas();
    const strokeSource: StrokeSource = {
      listStrokes: () => [],
      listElements: () => [],
    };
    const renderer = new Canvas2DRenderer({
      canvas: display.asElement(),
      strokeSource,
      scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
    });
    const doc = createDocument({ width: 100, height: 80 });
    renderer.setDocument({
      ...doc,
      guides: [{ id: "g1", axis: "vertical", position: 40 }],
    });
    renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
    renderer.setDisplaySize(200, 160, 1);
    renderer.setGrid({ visible: true, spacing: 50, snap: false });
    display.calls.length = 0;
    renderer.render();

    const names = display.calls.map((call) => call.name);
    // The layers are composited first, then the grid, then the guide, and the
    // document border last.
    const strokes = display.named("stroke");
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    const gridStroke = strokes[0];
    const guideStroke = strokes[1];
    expect(gridStroke.strokeStyle).not.toBe(guideStroke.strokeStyle);
    expect(names.indexOf("drawImage")).toBeLessThan(names.indexOf("moveTo"));
  });
});

