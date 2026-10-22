/**
 * The drawing aids: the rulers, the guides they hand out and the symmetry.
 *
 * The pure geometry lives in `core/document/symmetry.ts` and
 * `core/rendering/rulers.ts`; this file covers the three things that are not
 * pure:
 *
 *  - the **engine seam**: the copies a symmetric stroke commits, the single
 *    history step they share, the symmetry centre the user drags, and the
 *    guide a ruler hands out;
 *  - the **renderer**: the rulers and the symmetry overlay are drawn over the
 *    artwork, and neither of them ever reaches an export;
 *  - the **viewport**: the same document point has to be measured the same way
 *    through a zoom and a pan.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createDocument } from "../core/document/document";
import type { StrokeRecord } from "../core/document/types";
import { createId } from "../utils/id";
import {
  DEFAULT_SYMMETRY_SETTINGS,
  createSymmetryCopies,
  normalizeSymmetryCount,
  symmetryAxes,
  symmetryTransforms,
  type SymmetrySettings,
} from "../core/document/symmetry";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import {
  RULER_LEFT_SIZE_PX,
  RULER_SIZE_PX,
  formatRulerLabel,
  rulerAxisAt,
  rulerMinorStep,
  rulerStep,
  rulerTicks,
} from "../core/rendering/rulers";
import type { DrawingRenderer, Rgb, StrokeSource } from "../core/rendering/types";
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
  const symmetries: SymmetrySettings[] = [];
  const rulers: boolean[] = [];
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
    setSelection: () => {},
    setGradientOverlay: () => {},
    setSelectedGuide: () => {},
    setGrid: () => {},
    setRulers: (settings) => {
      rulers.push(settings.visible);
    },
    setSymmetry: (symmetry) => {
      symmetries.push(symmetry);
    },
    setReferenceOverlay: () => {},
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    renderOverview: () => null,
    readCompositePixel: (): Rgb | null => null,
    readCompositeImage: () => null,
    render: () => {},
    requestRender: () => {},
    destroy: () => {},
  };
  return { renderer, symmetries, rulers };
}

function createEngine(options: { viewport?: Viewport } = {}) {
  const spy = createSpyRenderer();
  const engine = new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
    renderer: spy.renderer,
  });
  if (options.viewport) {
    engine.setViewport(options.viewport);
  }
  return { engine, ...spy };
}

function layerIdOf(engine: DrawingEngine): string {
  return engine.getState().document.activeLayerId as string;
}

/** Drags with the pointer and releases it. */
function drag(
  engine: DrawingEngine,
  from: readonly [number, number],
  to: readonly [number, number],
  screen?: Partial<PointerSample>,
): void {
  engine.handlePointerSample(
    createSample({ phase: "down", docX: from[0], docY: from[1], ...screen }),
  );
  engine.handlePointerSample(
    createSample({ phase: "move", docX: to[0], docY: to[1], ...screen }),
  );
  engine.handlePointerSample(
    createSample({ phase: "up", docX: to[0], docY: to[1], ...screen }),
  );
}

describe("the symmetry geometry", () => {
  it("mirrors a stroke across a vertical axis through the centre", () => {
    const settings: SymmetrySettings = {
      enabled: true,
      mode: "vertical",
      count: 6,
      center: { x: 100, y: 50 },
    };
    const transforms = symmetryTransforms(settings);
    expect(transforms).toHaveLength(2);

    // The mirror of 40 about x = 100 is 160.
    const mirrored = transforms[1];
    expect(mirrored.a * 40 + mirrored.c * 10 + mirrored.e).toBeCloseTo(160, 9);
    expect(mirrored.b * 40 + mirrored.d * 10 + mirrored.f).toBeCloseTo(10, 9);
  });

  it("mirrors a stroke across a horizontal axis through the centre", () => {
    const settings: SymmetrySettings = {
      enabled: true,
      mode: "horizontal",
      count: 6,
      center: { x: 100, y: 50 },
    };
    const transforms = symmetryTransforms(settings);
    expect(transforms).toHaveLength(2);

    // The mirror of 10 about y = 50 is 90, and the x is untouched.
    const mirrored = transforms[1];
    expect(mirrored.a * 40 + mirrored.c * 10 + mirrored.e).toBeCloseTo(40, 9);
    expect(mirrored.b * 40 + mirrored.d * 10 + mirrored.f).toBeCloseTo(90, 9);
  });

  it("turns a radial symmetry into evenly spaced copies", () => {
    const settings: SymmetrySettings = {
      enabled: true,
      mode: "radial",
      count: 4,
      center: { x: 100, y: 100 },
    };
    const transforms = symmetryTransforms(settings);
    expect(transforms).toHaveLength(4);

    // The first copy is a quarter turn: the point (200, 100) lands on
    // (100, 200).
    const quarter = transforms[1];
    const x = quarter.a * 200 + quarter.c * 100 + quarter.e;
    const y = quarter.b * 200 + quarter.d * 100 + quarter.f;
    expect(x).toBeCloseTo(100, 9);
    expect(y).toBeCloseTo(200, 9);
  });

  it("produces no copies while the symmetry is off", () => {
    const transforms = symmetryTransforms({
      ...DEFAULT_SYMMETRY_SETTINGS,
      enabled: false,
    });
    expect(transforms).toHaveLength(1);
    expect(createSymmetryCopies(strokeWith([[10, 20]]), DEFAULT_SYMMETRY_SETTINGS)).toHaveLength(0);
  });

  it("clamps the copy count into the range the editor offers", () => {
    expect(normalizeSymmetryCount(1)).toBe(2);
    expect(normalizeSymmetryCount(100)).toBe(12);
    expect(normalizeSymmetryCount(4.6)).toBe(5);
    expect(normalizeSymmetryCount(Number.NaN)).toBe(DEFAULT_SYMMETRY_SETTINGS.count);
  });

  it("names the axes the overlay draws", () => {
    expect(
      symmetryAxes({ enabled: true, mode: "vertical", count: 6, center: { x: 0, y: 0 } }),
    ).toEqual([Math.PI / 2]);
    expect(
      symmetryAxes({ enabled: true, mode: "horizontal", count: 6, center: { x: 0, y: 0 } }),
    ).toEqual([0]);
    expect(
      symmetryAxes({ enabled: true, mode: "radial", count: 4, center: { x: 0, y: 0 } }),
    ).toHaveLength(4);
    expect(symmetryAxes({ ...DEFAULT_SYMMETRY_SETTINGS })).toEqual([]);
  });

  it("copies a stroke with the same brush and mirrored samples", () => {
    const stroke = strokeWith([
      [10, 20],
      [30, 40],
    ]);
    const copies = createSymmetryCopies(stroke, {
      enabled: true,
      mode: "vertical",
      count: 6,
      center: { x: 100, y: 0 },
    });
    expect(copies).toHaveLength(1);
    const copy = copies[0];
    expect(copy.xs).toEqual([190, 170]);
    expect(copy.ys).toEqual([20, 40]);
    expect(copy.id).not.toBe(stroke.id);
    expect(copy.brush).toEqual(stroke.brush);
    expect(copy.pressures).toEqual(stroke.pressures);
  });
});

describe("the symmetry in the engine", () => {
  it("starts with the symmetry off", () => {
    const { engine } = createEngine();
    const state = engine.getState();
    expect(state.symmetryEnabled).toBe(false);
    expect(state.symmetryMode).toBe(DEFAULT_SYMMETRY_SETTINGS.mode);
    expect(state.symmetryCount).toBe(DEFAULT_SYMMETRY_SETTINGS.count);
  });

  it("commits the copy of a symmetric stroke beside the stroke itself", () => {
    const { engine } = createEngine();
    engine.setSymmetryEnabled(true);
    engine.setSymmetryMode("vertical");
    engine.setSymmetryCenter({ x: 100, y: 150 });

    drag(engine, [40, 100], [60, 120]);

    const strokes = engine.listStrokes(layerIdOf(engine));
    expect(strokes).toHaveLength(2);
    expect(strokes[0].xs[0]).toBe(40);
    // The copy is the mirror about x = 100.
    expect(strokes[1].xs[0]).toBe(160);
    expect(strokes[1].ys[0]).toBe(100);
  });

  it("commits the whole set as one undo step", () => {
    const { engine } = createEngine();
    engine.setSymmetryEnabled(true);
    engine.setSymmetryMode("radial");
    engine.setSymmetryCount(4);
    engine.setSymmetryCenter({ x: 200, y: 150 });

    drag(engine, [240, 150], [260, 150]);

    const strokes = engine.listStrokes(layerIdOf(engine));
    expect(strokes).toHaveLength(4);
    expect(engine.getState().history.depth).toBe(1);

    // One undo removes the stroke and all of its copies.
    engine.undo();
    expect(engine.listStrokes(layerIdOf(engine))).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);

    // And one redo puts them all back.
    engine.redo();
    expect(engine.listStrokes(layerIdOf(engine))).toHaveLength(4);
  });

  it("draws no copies while the symmetry is off", () => {
    const { engine } = createEngine();
    drag(engine, [40, 100], [60, 120]);
    expect(engine.listStrokes(layerIdOf(engine))).toHaveLength(1);
  });

  it("leaves the eraser alone", () => {
    const { engine } = createEngine();
    engine.setSymmetryEnabled(true);
    engine.setTool("eraser");

    drag(engine, [40, 100], [60, 120]);

    // The eraser subtracts coverage; its copies would need their own snapshot,
    // so the symmetry does not apply to it.
    expect(engine.listStrokes(layerIdOf(engine))).toHaveLength(1);
  });

  it("keeps the symmetry out of the document, the history and the file", () => {
    const { engine } = createEngine();
    const before = engine.serialize();

    engine.setSymmetryEnabled(true);
    engine.setSymmetryMode("radial");
    engine.setSymmetryCount(8);
    engine.setSymmetryCenter({ x: 10, y: 20 });

    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
    expect(engine.serialize()).toBe(before);
  });

  it("puts the symmetry centre back in the middle of the paper", () => {
    const { engine } = createEngine();
    engine.setSymmetryCenter({ x: 10, y: 20 });
    engine.resetSymmetryCenter();
    expect(engine.getState().symmetryCenter).toEqual({ x: 200, y: 150 });
  });

  it("rounds the symmetry centre to whole document pixels", () => {
    const { engine } = createEngine();
    engine.setSymmetryCenter({ x: 10.4, y: 20.6 });
    expect(engine.getState().symmetryCenter).toEqual({ x: 10, y: 21 });
  });

  it("drags the symmetry centre with the pointer", () => {
    const { engine } = createEngine();
    engine.setSymmetryEnabled(true);
    engine.setSymmetryCenter({ x: 100, y: 100 });

    // A press on the marker grabs it; the drag moves it and the release keeps
    // it where the pointer left it.
    drag(engine, [100, 100], [160, 130]);

    expect(engine.getState().symmetryCenter).toEqual({ x: 160, y: 130 });
    // The centre is editor state: no history, no dirty flag.
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("draws a stroke instead of moving the centre when the press misses the marker", () => {
    const { engine } = createEngine();
    engine.setSymmetryEnabled(true);
    engine.setSymmetryCenter({ x: 100, y: 100 });

    drag(engine, [40, 100], [60, 120]);

    expect(engine.listStrokes(layerIdOf(engine))).toHaveLength(2);
    expect(engine.getState().symmetryCenter).toEqual({ x: 100, y: 100 });
  });

  it("puts the centre back when the drag is cancelled", () => {
    const { engine } = createEngine();
    engine.setSymmetryEnabled(true);
    engine.setSymmetryCenter({ x: 100, y: 100 });

    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 100 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 160, docY: 130 }));
    engine.handlePointerSample(createSample({ phase: "cancel", docX: 160, docY: 130 }));

    expect(engine.getState().symmetryCenter).toEqual({ x: 100, y: 100 });
  });

  it("tells the renderer about the symmetry", () => {
    const { engine, symmetries } = createEngine();
    engine.setSymmetryEnabled(true);
    engine.setSymmetryMode("radial");
    engine.setSymmetryCount(5);

    const last = symmetries[symmetries.length - 1];
    expect(last.enabled).toBe(true);
    expect(last.mode).toBe("radial");
    expect(last.count).toBe(5);
  });
});

describe("the ruler geometry", () => {
  it("labels a tick at least the minimum gap apart on screen", () => {
    for (const zoom of [0.25, 0.5, 1, 2, 8, 64]) {
      const step = rulerStep(zoom);
      expect(step * zoom).toBeGreaterThanOrEqual(60);
      // The step is a round number: 1, 2 or 5 times a power of ten.
      const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
      expect([1, 2, 5]).toContain(mantissa);
    }
  });

  it("divides a labelled step into minor ticks", () => {
    expect(rulerMinorStep(100)).toBe(10);
    expect(rulerMinorStep(50)).toBe(5);
    expect(rulerMinorStep(2)).toBe(1);
    expect(rulerMinorStep(1)).toBe(0);
  });

  it("lists the ticks between two coordinates", () => {
    expect(rulerTicks(0, 250, 100)).toEqual([0, 100, 200]);
    expect(rulerTicks(250, 0, 100)).toEqual([0, 100, 200]);
    expect(rulerTicks(0, 250, 0)).toEqual([]);
  });

  it("knows which ruler a press is over", () => {
    expect(rulerAxisAt(50, 5)).toBe("horizontal");
    expect(rulerAxisAt(5, 50)).toBe("vertical");
    expect(rulerAxisAt(50, 50)).toBeNull();
    // The corner belongs to the top strip.
    expect(rulerAxisAt(1, 1)).toBe("horizontal");
  });

  it("labels a tick with a whole document pixel", () => {
    expect(formatRulerLabel(120)).toBe("120");
    expect(formatRulerLabel(0)).toBe("0");
    expect(formatRulerLabel(-40)).toBe("-40");
  });
});

describe("the guides in the engine", () => {
  it("hands out a vertical guide from the top ruler", () => {
    const { engine } = createEngine();
    engine.setRulersVisible(true);
    engine.setTool("guides");

    // A press in the top strip, 10 CSS pixels down, at the document x 120.
    drag(
      engine,
      [120, 0],
      [120, 0],
      { screenX: 120, screenY: 5 },
    );

    const guides = engine.getState().document.guides;
    expect(guides).toHaveLength(1);
    expect(guides[0].axis).toBe("vertical");
    expect(guides[0].position).toBe(120);
    expect(engine.getState().history.depth).toBe(1);
  });

  it("hands out a horizontal guide from the left ruler", () => {
    const { engine } = createEngine();
    engine.setRulersVisible(true);
    engine.setTool("guides");

    drag(engine, [0, 80], [0, 80], { screenX: 5, screenY: 80 });

    const guides = engine.getState().document.guides;
    expect(guides).toHaveLength(1);
    expect(guides[0].axis).toBe("horizontal");
    expect(guides[0].position).toBe(80);
  });

  it("moves the guide along its axis while the drag runs", () => {
    const { engine } = createEngine();
    engine.setRulersVisible(true);
    engine.setTool("guides");

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 120, docY: 0, screenX: 120, screenY: 5 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 200, docY: 0, screenX: 200, screenY: 5 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 200, docY: 0, screenX: 200, screenY: 5 }),
    );

    const guides = engine.getState().document.guides;
    expect(guides).toHaveLength(1);
    expect(guides[0].position).toBe(200);
    expect(engine.getState().history.depth).toBe(1);
  });

  it("makes no guide when the rulers are hidden", () => {
    const { engine } = createEngine();
    engine.setTool("guides");

    drag(engine, [120, 0], [120, 0], { screenX: 120, screenY: 5 });

    expect(engine.getState().document.guides).toHaveLength(0);
  });

  it("clears every guide as one undoable step", () => {
    const { engine } = createEngine();
    engine.setRulersVisible(true);
    engine.setTool("guides");
    drag(engine, [120, 0], [120, 0], { screenX: 120, screenY: 5 });
    expect(engine.getState().document.guides).toHaveLength(1);

    engine.clearGuides();

    expect(engine.getState().document.guides).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(2);

    engine.undo();
    expect(engine.getState().document.guides).toHaveLength(1);
  });
});

describe("the drawing aids in the renderer", () => {
  let recording: RecordingDocument;

  beforeEach(() => {
    recording = installRecordingDocument();
  });

  afterEach(() => {
    recording.restore();
  });

  function renderAids(options: {
    rulers?: boolean;
    symmetry?: SymmetrySettings;
    zoom?: number;
    width?: number;
    height?: number;
  }) {
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
    renderer.setDocument(createDocument({ width: 400, height: 300 }));
    renderer.setViewport({ zoom: options.zoom ?? 1, offsetX: 0, offsetY: 0 });
    renderer.setDisplaySize(options.width ?? 400, options.height ?? 300, 1);
    if (options.rulers) {
      renderer.setRulers({ visible: true });
    }
    if (options.symmetry) {
      renderer.setSymmetry(options.symmetry);
    }
    display.calls.length = 0;
    renderer.render();
    return { display, renderer };
  }

  it("draws the ruler strips along the top and the left", () => {
    const { display } = renderAids({ rulers: true });
    const fills = display.named("fillRect");
    // The two strips, plus the paper.
    const strip = fills.find(
      (call) => call.args[0] === 0 && call.args[1] === 0 && call.args[3] === RULER_SIZE_PX,
    );
    expect(strip).toBeDefined();
    const side = fills.find(
      (call) => call.args[0] === 0 && call.args[1] === 0 && call.args[2] === RULER_LEFT_SIZE_PX,
    );
    expect(side).toBeDefined();
  });

  it("labels the ruler with document coordinates", () => {
    const { display } = renderAids({ rulers: true, zoom: 1 });
    const labels = display.named("fillText").map((call) => call.args[0]);
    expect(labels).toContain("0");
    expect(labels).toContain("100");
  });

  it("keeps the ruler ticks on the same document coordinates at every zoom", () => {
    for (const zoom of [0.5, 1, 4]) {
      const { display } = renderAids({ rulers: true, zoom });
      const labels = display.named("fillText").map((call) => call.args[0]);
      // The step grows with the zoom, so the labels are different numbers -
      // but every one of them is a whole document pixel.
      for (const label of labels) {
        expect(Number.isInteger(Number(label))).toBe(true);
      }
    }
  });

  it("draws nothing while the rulers are hidden", () => {
    const { display } = renderAids({ rulers: false });
    expect(display.named("fillText")).toHaveLength(0);
  });

  it("draws the symmetry axes and the centre marker", () => {
    const { display } = renderAids({
      symmetry: { enabled: true, mode: "vertical", count: 6, center: { x: 200, y: 150 } },
    });
    // The axes are a stroke, and the centre marker is an arc.
    expect(display.named("stroke").length).toBeGreaterThan(0);
    expect(display.named("arc").length).toBeGreaterThan(0);
  });

  it("paints the in-progress stroke once per symmetry copy", () => {
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
    const doc = createDocument({ width: 400, height: 300 });
    renderer.setDocument(doc);
    renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
    renderer.setDisplaySize(400, 300, 1);
    renderer.setSymmetry({
      enabled: true,
      mode: "vertical",
      count: 6,
      center: { x: 200, y: 150 },
    });

    const stroke = { ...strokeWith([
      [100, 100],
      [140, 120],
    ]), layerId: doc.activeLayerId as string };
    renderer.beginStroke(stroke);
    renderer.extendStroke(stroke, 0);
    display.calls.length = 0;
    renderer.render();

    // The stroke is painted once as it was drawn and once through the
    // symmetry's mirror, so the user sees the symmetric result while they
    // draw.
    const transforms = display.named("transform");
    expect(transforms).toHaveLength(1);
    // The mirror about x = 200: x' = -x + 400.
    expect(transforms[0].args[0]).toBeCloseTo(-1, 9);
    expect(transforms[0].args[4]).toBeCloseTo(400, 9);
  });

  it("keeps the rulers and the symmetry out of the exported composite", () => {    const { renderer } = renderAids({
      rulers: true,
      symmetry: { enabled: true, mode: "radial", count: 6, center: { x: 200, y: 150 } },
    });
    const composed = renderer.composeDocumentImage() as unknown as RecordingCanvas;
    expect(composed.named("fillText")).toHaveLength(0);
    expect(composed.named("arc")).toHaveLength(0);
    // The export is the document's pixels: the paper is filled once, and
    // nothing else is - no ruler strip, no axis, no centre marker.
    const fills = composed.named("fillRect");
    expect(fills).toHaveLength(1);
    expect(fills[0].args).toEqual([0, 0, 400, 300]);
  });
});

/** A stroke with the given samples, for the copy builder. */
function strokeWith(points: readonly (readonly [number, number])[]): StrokeRecord {
  return {
    id: createId("stroke"),
    layerId: "layer-1",
    brush: { ...DEFAULT_BRUSH },
    xs: points.map((point) => point[0]),
    ys: points.map((point) => point[1]),
    pressures: points.map(() => 1),
    times: points.map(() => 0),
    startTime: 0,
  };
}
