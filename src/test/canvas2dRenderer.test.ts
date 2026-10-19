/**
 * Canvas 2D renderer tests.
 *
 * The suite runs in plain Node, so Canvas 2D is faked: `document.createElement`
 * returns a *recording* canvas whose context logs every draw call together with
 * the alpha/transform/composite state that was live at the time. That is enough
 * to pin down the compositor's rules - paper, layer order, visibility, opacity,
 * the in-progress stroke, the document border and dirty-driven re-rasterization
 * - without needing a real rasterizer.
 *
 * What these tests cannot cover is actual pixel coverage: whether a pressure-
 * tapered stroke looks right is verified by brush geometry tests and, in the
 * running app, by reading the display canvas pixels.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addLayer, createDocument, moveLayer, updateLayer } from "../core/document/document";
import type {
  FillPatchRecord,
  GradientRecord,
  LayerElement,
  LayerId,
  StrokeRecord,
} from "../core/document/types";
import { isStroke } from "../core/document/types";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import type { StrokeSource } from "../core/rendering/types";
import type { BrushSettings } from "../types/brush";
import type { Bounds } from "../types/geometry";
import {
  installRecordingDocument,
  RecordingCanvas,
  type RecordingDocument,
} from "./support/recordingCanvas";

const BRUSH: BrushSettings = {
  size: 10,
  opacity: 1,
  color: "#000000",
  pressureSize: 0,
  pressureOpacity: 0,
  minSizeRatio: 0,
  spacing: 0.1,
};

let recording: RecordingDocument;

beforeEach(() => {
  recording = installRecordingDocument();
});

afterEach(() => {
  recording.restore();
});

interface HarnessOptions {
  readonly strokes?: Map<LayerId, LayerElement[]>;
  readonly rasterScale?: number;
}

function createHarness(options: HarnessOptions = {}) {
  const firstAllocation = recording.allocated.length;
  const display = new RecordingCanvas();
  const strokes = options.strokes ?? new Map<LayerId, LayerElement[]>();
  const strokeSource: StrokeSource = {
    listStrokes: (layerId) => (strokes.get(layerId) ?? []).filter(isStroke),
    listElements: (layerId) => strokes.get(layerId) ?? [],
  };

  const renderer = new Canvas2DRenderer({
    canvas: display.asElement(),
    strokeSource,
    rasterScale: options.rasterScale ?? 1,
    // Never fires: each test calls `render()` explicitly so ordering is exact.
    scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
  });

  return {
    renderer,
    display,
    strokes,
    /** The renderer's in-progress stroke buffer (the first canvas it allocates). */
    strokeBuffer: recording.allocated[firstAllocation],
    /** Layer surfaces, in the order they were first created. */
    layerSurfaces: () => recording.allocated.slice(firstAllocation + 1),
    /** The document-size composite PNG export works from. */
    composeDocument: () => renderer.composeDocumentImage() as unknown as RecordingCanvas,
  };
}

let strokeCounter = 0;

function createStroke(layerId: LayerId, brush: BrushSettings = BRUSH, erase = false): StrokeRecord {
  strokeCounter += 1;
  return {
    id: `stroke-${strokeCounter}`,
    layerId,
    brush,
    erase,
    xs: [5, 25, 45],
    ys: [5, 20, 5],
    pressures: [0.5, 1, 0.5],
    times: [0, 16, 32],
    startTime: 0,
  };
}

let fillCounter = 0;

function createFill(
  layerId: LayerId,
  mask: Uint8Array = new Uint8Array([255, 128, 0, 0, 255, 0]),
  overrides: Partial<FillPatchRecord> = {},
): FillPatchRecord {
  fillCounter += 1;
  return {
    id: `fill-${fillCounter}`,
    layerId,
    kind: "fill",
    color: "#336699",
    x: 4,
    y: 6,
    width: 3,
    height: 2,
    mask,
    ...overrides,
  };
}

let gradientCounter = 0;

function createGradient(
  layerId: LayerId,
  overrides: Partial<GradientRecord> = {},
): GradientRecord {
  gradientCounter += 1;
  return {
    id: `gradient-${gradientCounter}`,
    layerId,
    kind: "gradient",
    type: "linear",
    x1: 10,
    y1: 20,
    x2: 90,
    y2: 60,
    stops: [
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#0000ff" },
    ],
    opacity: 0.4,
    ...overrides,
  };
}

describe("Canvas2DRenderer compositing", () => {
  it("paints the paper, then visible layers bottom-to-top, then a one-device-pixel border", () => {
    const harness = createHarness();
    let doc = createDocument({ width: 100, height: 80, background: "#101010" });
    doc = addLayer(doc);

    harness.renderer.setDocument(doc);
    harness.renderer.setViewport({ zoom: 0.5, offsetX: 10, offsetY: 20 });
    harness.renderer.setDisplaySize(200, 160, 1);
    harness.renderer.render();

    const fills = harness.display.named("fillRect");
    expect(fills).toHaveLength(1);
    expect(fills[0].fillStyle).toBe("#101010");
    expect(fills[0].args).toEqual([0, 0, 100, 80]);

    // Layers are allocated (and therefore composited) bottom-first.
    const surfaces = harness.layerSurfaces();
    expect(surfaces).toHaveLength(2);
    expect(harness.display.drawnSources).toEqual(surfaces);

    const border = harness.display.named("strokeRect");
    expect(border).toHaveLength(1);
    expect(border[0].args).toEqual([0, 0, 100, 80]);
    // 1 device pixel at zoom 0.5 and dpr 1.
    expect(border[0].lineWidth).toBeCloseTo(2, 10);
  });

  it("maps document coordinates through zoom, pan and device pixel ratio", () => {
    const harness = createHarness();
    harness.renderer.setDocument(createDocument({ width: 100, height: 80 }));
    harness.renderer.setViewport({ zoom: 2, offsetX: 10, offsetY: -5 });
    harness.renderer.setDisplaySize(300, 200, 2);

    harness.display.calls.length = 0;
    harness.renderer.render();

    const transforms = harness.display.named("setTransform");
    expect(transforms[0].args).toEqual([1, 0, 0, 1, 0, 0]);
    // scale = zoom * dpr, translation = offset * dpr.
    expect(transforms[1].args).toEqual([4, 0, 0, 4, 20, -10]);
    // Backing store follows CSS size * dpr; the document size is untouched.
    expect(harness.display.width).toBe(600);
    expect(harness.display.height).toBe(400);
  });

  it("skips hidden layers and layers whose opacity is zero", () => {
    const harness = createHarness();
    let doc = createDocument({ width: 20, height: 20 });
    doc = addLayer(doc);
    const topLayerId = doc.layers[1].id;

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(40, 40, 1);
    harness.renderer.render();
    expect(harness.display.drawImages).toHaveLength(2);

    harness.renderer.setDocument(updateLayer(doc, topLayerId, { visible: false }));
    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawImages).toHaveLength(1);

    harness.renderer.setDocument(updateLayer(doc, topLayerId, { opacity: 0 }));
    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawImages).toHaveLength(1);
  });

  it("applies layer opacity to the composite without leaking into the border", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 20, height: 20 });
    harness.renderer.setDocument(updateLayer(doc, doc.layers[0].id, { opacity: 0.25 }));
    harness.renderer.setDisplaySize(40, 40, 1);
    harness.renderer.render();

    const [image] = harness.display.drawImages;
    expect(image.alpha).toBe(0.25);
    expect(image.composite).toBe("source-over");

    // The document border is drawn at full alpha after the layer pass.
    expect(harness.display.named("strokeRect")[0].alpha).toBe(1);
  });

  it("follows the document layer order and reuses surfaces when layers move", () => {
    const harness = createHarness();
    let doc = createDocument({ width: 20, height: 20 });
    doc = addLayer(doc);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(40, 40, 1);
    harness.renderer.render();

    const before = harness.display.drawnSources;
    expect(before).toHaveLength(2);
    expect(harness.layerSurfaces()).toHaveLength(2);

    // Bring the top layer to the bottom of the stack.
    harness.renderer.setDocument(moveLayer(doc, doc.layers[1].id, -1));
    harness.display.calls.length = 0;
    harness.renderer.render();

    // Same two surfaces, painted in the opposite order: no re-rasterization.
    expect(harness.display.drawnSources).toEqual([before[1], before[0]]);
    expect(harness.layerSurfaces()).toHaveLength(2);
  });

  it("rasterizes layer surfaces at the raster scale while keeping document geometry", () => {
    const harness = createHarness({ rasterScale: 2 });
    harness.renderer.setDocument(createDocument({ width: 100, height: 80 }));
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.render();

    const [surface] = harness.layerSurfaces();
    expect(surface.width).toBe(200);
    expect(surface.height).toBe(160);

    // clear() resets to identity, then prepare() maps document px to surface px.
    const transforms = surface.named("setTransform");
    expect(transforms[1].args).toEqual([2, 0, 0, 2, 0, 0]);

    // The document is still composited at its logical size.
    expect(harness.display.drawImages[0].args.slice(1)).toEqual([0, 0, 100, 80]);
    expect(harness.display.width).toBe(100);
  });

  it("draws the in-progress stroke above the layers and folds it in when it ends", () => {
    const strokes = new Map<LayerId, StrokeRecord[]>();
    const harness = createHarness({ strokes });
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.render();

    const stroke = createStroke(layerId);
    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);
    harness.display.calls.length = 0;
    harness.renderer.render();

    const withStroke = harness.display.drawnSources;
    expect(withStroke).toHaveLength(2);
    expect(withStroke[1]).toBe(harness.strokeBuffer);
    expect(withStroke[0]).not.toBe(harness.strokeBuffer);

    // Once committed the buffer is composited into the layer, not painted again.
    strokes.set(layerId, [stroke]);
    harness.renderer.endStroke(stroke);
    harness.display.calls.length = 0;
    harness.renderer.render();

    const afterEnd = harness.display.drawnSources;
    expect(afterEnd).toHaveLength(1);
    expect(afterEnd[0]).not.toBe(harness.strokeBuffer);
  });

  it("drops the stroke buffer when a stroke is cancelled", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 40, height: 40 });
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(80, 80, 1);

    const stroke = createStroke(doc.layers[0].id);
    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);
    harness.renderer.cancelStroke();
    harness.display.calls.length = 0;
    harness.renderer.render();

    expect(harness.display.drawnSources).not.toContain(harness.strokeBuffer);
    expect(harness.display.drawImages).toHaveLength(1);
  });

  it("redraws the whole stroke once it grows past the initial dab", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);

    const stroke = createStroke(doc.layers[0].id);
    stroke.xs.length = 0;
    stroke.ys.length = 0;
    stroke.pressures.length = 0;
    stroke.times.length = 0;
    stroke.xs.push(5);
    stroke.ys.push(5);
    stroke.pressures.push(1);
    stroke.times.push(0);

    // A press with no movement yet: one sample, rasterized as a dab.
    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);
    expect(harness.strokeBuffer.named("arc")).toHaveLength(1);

    // The pointer moves. The dab is discarded and the stroke redrawn from
    // scratch, so the live buffer matches a full re-rasterization - undo,
    // reopen, export - of the same stroke rather than carrying one extra
    // antialiased pass at the start.
    stroke.xs.push(40);
    stroke.ys.push(20);
    stroke.pressures.push(1);
    stroke.times.push(16);
    harness.renderer.extendStroke(stroke, 1);

    const names = harness.strokeBuffer.calls.map((call) => call.name);
    const afterLastClear = names.slice(names.lastIndexOf("clearRect") + 1);
    expect(afterLastClear).toContain("stroke");
    expect(afterLastClear).not.toContain("arc");
  });

  it("composites a semi-transparent stroke once, at the stroke's own opacity", () => {
    const strokes = new Map<LayerId, StrokeRecord[]>();
    const harness = createHarness({ strokes });
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;
    const brush: BrushSettings = { ...BRUSH, opacity: 0.5 };

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    // First frame allocates and rasterizes the still-empty layer surface.
    harness.renderer.render();

    const stroke = createStroke(layerId, brush);
    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);

    // Full coverage in the buffer: there is no per-segment alpha to accumulate,
    // which is what used to darken every joint of a semi-transparent stroke.
    const segments = harness.strokeBuffer.named("stroke");
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((call) => call.alpha === 1)).toBe(true);

    // The in-progress stroke is displayed at the stroke's opacity, applied once.
    harness.display.calls.length = 0;
    harness.renderer.render();
    const inProgress = harness.display.drawImages.find(
      (call) => call.args[0] === harness.strokeBuffer,
    );
    expect(inProgress?.alpha).toBe(0.5);

    // Committing composites the buffer into the layer at the same alpha.
    strokes.set(layerId, [stroke]);
    harness.renderer.endStroke(stroke);
    const [surface] = harness.layerSurfaces();
    const composites = surface.drawImages.filter((call) => call.args[0] === harness.strokeBuffer);
    expect(composites).toHaveLength(1);
    expect(composites[0].alpha).toBe(0.5);

    // Once committed the display paints the layer, not the live buffer.
    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawnSources).not.toContain(harness.strokeBuffer);
  });

  it("only re-rasterizes a layer surface when it is dirty", () => {
    const strokes = new Map<LayerId, StrokeRecord[]>();
    const harness = createHarness({ strokes });
    const doc = createDocument({ width: 50, height: 50 });
    const layerId = doc.layers[0].id;
    strokes.set(layerId, [createStroke(layerId)]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(50, 50, 1);
    harness.renderer.render();

    const [surface] = harness.layerSurfaces();
    const clears = surface.named("clearRect").length;
    expect(clears).toBeGreaterThan(0);

    // A second frame with unchanged pixels must not touch the surface again.
    harness.renderer.render();
    expect(surface.named("clearRect")).toHaveLength(clears);

    harness.renderer.invalidateLayer(layerId);
    harness.renderer.render();
    expect(surface.named("clearRect").length).toBeGreaterThan(clears);
  });

  it("drops layer surfaces that are no longer in the document", () => {
    const harness = createHarness();
    let doc = createDocument({ width: 20, height: 20 });
    doc = addLayer(doc);
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(40, 40, 1);
    harness.renderer.render();
    expect(harness.layerSurfaces()).toHaveLength(2);

    // Replacing the document drops the surface of the layer that disappeared.
    harness.renderer.setDocument(createDocument({ width: 20, height: 20 }));
    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawImages).toHaveLength(1);
  });

  it("does nothing after destroy()", () => {
    const harness = createHarness();
    harness.renderer.setDocument(createDocument({ width: 20, height: 20 }));
    harness.renderer.setDisplaySize(40, 40, 1);
    harness.renderer.render();

    harness.renderer.destroy();
    harness.display.calls.length = 0;
    harness.renderer.render();
    harness.renderer.setDisplaySize(80, 80, 1);

    expect(harness.display.calls).toHaveLength(0);
    expect(harness.display.width).toBe(40);
  });
});

describe("Canvas2DRenderer shape preview", () => {
  it("rebuilds the whole stroke buffer from replaced samples", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);

    const stroke = createStroke(doc.layers[0].id);
    const setOutline = (points: ReadonlyArray<readonly [number, number]>): void => {
      stroke.xs.length = 0;
      stroke.ys.length = 0;
      stroke.pressures.length = 0;
      stroke.times.length = 0;
      for (const [x, y] of points) {
        stroke.xs.push(x);
        stroke.ys.push(y);
        stroke.pressures.push(1);
        stroke.times.push(0);
      }
    };

    // A line outline: two points, one segment.
    setOutline([
      [10, 10],
      [90, 70],
    ]);
    harness.renderer.beginStroke(stroke);
    harness.renderer.replaceStroke(stroke);
    expect(harness.strokeBuffer.named("stroke")).toHaveLength(1);

    // The drag moves: the outline is replaced, not appended, so the buffer is
    // cleared and redrawn from the four segments of a rectangle.
    setOutline([
      [10, 10],
      [90, 10],
      [90, 70],
      [10, 70],
      [10, 10],
    ]);
    harness.renderer.replaceStroke(stroke);

    const names = harness.strokeBuffer.calls.map((call) => call.name);
    const afterClear = names.slice(names.lastIndexOf("clearRect") + 1);
    expect(afterClear.filter((name) => name === "stroke")).toHaveLength(4);
  });

  it("shows the replaced outline above the layers at the stroke's opacity", () => {
    const strokes = new Map<LayerId, StrokeRecord[]>();
    const harness = createHarness({ strokes });
    const doc = createDocument({ width: 100, height: 80 });
    const brush: BrushSettings = { ...BRUSH, opacity: 0.5 };

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);

    const stroke = createStroke(doc.layers[0].id, brush);
    harness.renderer.beginStroke(stroke);
    harness.renderer.replaceStroke(stroke);
    harness.renderer.render();

    const inProgress = harness.display.drawImages.find(
      (call) => call.args[0] === harness.strokeBuffer,
    );
    expect(inProgress?.alpha).toBe(0.5);
  });
});

describe("Canvas2DRenderer eraser", () => {
  it("subtracts eraser strokes from the layer when re-rasterizing", () => {
    const strokes = new Map<LayerId, StrokeRecord[]>();
    const harness = createHarness({ strokes });
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;
    strokes.set(layerId, [
      createStroke(layerId, { ...BRUSH, opacity: 0.5 }),
      createStroke(layerId, BRUSH, true),
    ]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.render();

    const [surface] = harness.layerSurfaces();
    const composites = surface.drawImages;

    // Painting order within the layer is preserved: the stroke is added, then
    // the eraser subtracts from what is already there.
    expect(composites).toHaveLength(2);
    expect(composites[0].composite).toBe("source-over");
    expect(composites[0].alpha).toBe(0.5);
    expect(composites[1].composite).toBe("destination-out");
    expect(composites[1].alpha).toBe(1);
    expect(composites[1].args.slice(1)).toEqual([0, 0, 100, 80]);

    // The composite operation does not leak into whatever paints next.
    surface.ctx.fillRect(0, 0, 1, 1);
    expect(surface.named("fillRect")[0].composite).toBe("source-over");
  });

  it("subtracts a live eraser stroke from its layer and keeps it out of the display pass", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.render();

    const [surface] = harness.layerSurfaces();
    const erase = createStroke(layerId, BRUSH, true);
    harness.renderer.beginStroke(erase);
    // The snapshot is the last canvas the renderer allocates, and it is not the
    // stroke buffer that holds the eraser's own coverage.
    const snapshot = recording.allocated[recording.allocated.length - 1];
    expect(snapshot).not.toBe(harness.strokeBuffer);

    surface.calls.length = 0;
    harness.renderer.extendStroke(erase, 0);

    // The layer is rebuilt from the pre-stroke pixels, then the stroke is
    // subtracted from them.
    const images = surface.drawImages;
    expect(images[0].args[0]).toBe(snapshot);
    expect(images[0].composite).toBe("source-over");
    expect(images[1].args[0]).toBe(harness.strokeBuffer);
    expect(images[1].composite).toBe("destination-out");
    expect(surface.named("clearRect").length).toBeGreaterThan(0);

    // The erasure is already in the layer, so the display paints the layer
    // alone - drawing the buffer on top would paint the erased coverage back.
    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawnSources).toEqual([surface]);
  });

  it("rebuilds the layer from the snapshot on every update, so a crossing stroke erases once", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.render();

    const [surface] = harness.layerSurfaces();
    const erase = createStroke(layerId, BRUSH, true);
    harness.renderer.beginStroke(erase);
    const snapshot = recording.allocated[recording.allocated.length - 1];

    surface.calls.length = 0;
    harness.renderer.extendStroke(erase, 0);
    erase.xs.push(60);
    erase.ys.push(40);
    erase.pressures.push(1);
    erase.times.push(48);
    harness.renderer.extendStroke(erase, 1);

    // Restore and subtraction alternate: each update starts from the pixels as
    // they were before the stroke, never from the previous subtraction. Applying
    // `destination-out` twice to the same pixels would erase them twice as hard.
    const images = surface.drawImages;
    const order = images.map((call) => (call.args[0] === snapshot ? "restore" : "subtract"));
    expect(order).toEqual(["restore", "subtract", "restore", "subtract"]);
    expect(images.filter((call) => call.args[0] === snapshot).every((call) => call.composite === "source-over")).toBe(true);
    expect(images.filter((call) => call.args[0] !== snapshot).every((call) => call.composite === "destination-out")).toBe(true);
  });

  it("restores the layer pixels when an eraser stroke is cancelled", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.render();

    const [surface] = harness.layerSurfaces();
    const erase = createStroke(layerId, BRUSH, true);
    harness.renderer.beginStroke(erase);
    const snapshot = recording.allocated[recording.allocated.length - 1];
    harness.renderer.extendStroke(erase, 0);

    surface.calls.length = 0;
    harness.renderer.cancelStroke();

    const images = surface.drawImages;
    expect(images).toHaveLength(1);
    expect(images[0].args[0]).toBe(snapshot);
    expect(images[0].composite).toBe("source-over");
    expect(surface.named("clearRect").length).toBeGreaterThan(0);

    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawnSources).not.toContain(harness.strokeBuffer);
  });

  it("does not composite the eraser buffer again when the stroke ends", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.render();

    const [surface] = harness.layerSurfaces();
    const erase = createStroke(layerId, BRUSH, true);
    harness.renderer.beginStroke(erase);
    harness.renderer.extendStroke(erase, 0);
    const before = surface.drawImages.length;

    harness.renderer.endStroke(erase);

    // The layer already holds the subtraction; committing must not paint the
    // buffer on top of it.
    expect(surface.drawImages).toHaveLength(before);
    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawnSources).not.toContain(harness.strokeBuffer);
  });

  it("re-anchors a live eraser stroke when the raster scale changes under it", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.render();

    const erase = createStroke(doc.layers[0].id, BRUSH, true);
    harness.renderer.beginStroke(erase);
    harness.renderer.extendStroke(erase, 0);

    // A HiDPI change drops and rebuilds every surface, so the snapshot the
    // stroke was erasing against no longer describes the layer.
    harness.renderer.setRasterScale(2);
    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawnSources).not.toContain(harness.strokeBuffer);

    const rebuilt = recording.allocated[recording.allocated.length - 1];
    expect(rebuilt.width).toBe(200);
    rebuilt.calls.length = 0;

    // The next sample redraws the whole stroke and takes a fresh snapshot of the
    // rebuilt layer at the new scale, instead of subtracting from stale pixels.
    erase.xs.push(60);
    erase.ys.push(40);
    erase.pressures.push(1);
    erase.times.push(48);
    harness.renderer.extendStroke(erase, 1);

    const images = rebuilt.drawImages;
    expect((images[0].args[0] as RecordingCanvas).width).toBe(200);
    expect(images[0].composite).toBe("source-over");
    expect(images[images.length - 1].args[0]).toBe(harness.strokeBuffer);
    expect(images[images.length - 1].composite).toBe("destination-out");
  });

  it("applies the eraser's own opacity to the subtraction", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.render();

    const [surface] = harness.layerSurfaces();
    const erase = createStroke(layerId, { ...BRUSH, opacity: 0.25 }, true);
    harness.renderer.beginStroke(erase);
    harness.renderer.extendStroke(erase, 0);

    const subtraction = surface.drawImages.find(
      (call) => call.args[0] === harness.strokeBuffer,
    );
    expect(subtraction?.composite).toBe("destination-out");
    expect(subtraction?.alpha).toBe(0.25);

    // The buffer itself still carries full coverage: the eraser's opacity is
    // applied once, when the stroke is subtracted, not per segment.
    expect(harness.strokeBuffer.named("stroke").every((call) => call.alpha === 1)).toBe(true);
  });
});

describe("Canvas2DRenderer fill patches", () => {
  it("uploads the base64-decoded mask as RGBA and draws it at its document box", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;
    const mask = new Uint8Array([255, 128, 0, 0, 255, 0]);
    harness.strokes.set(layerId, [createFill(layerId, mask)]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(200, 160, 1);
    harness.renderer.render();

    const patchCanvas = recording.allocated.find(
      (canvas) => canvas.named("putImageData").length > 0,
    );
    expect(patchCanvas).toBeDefined();
    const upload = patchCanvas?.named("putImageData")[0];
    const image = upload?.args[0] as ImageData;
    expect(upload?.args.slice(1)).toEqual([0, 0]);
    expect(image.width).toBe(3);
    expect(image.height).toBe(2);

    // "#336699" = 51, 102, 153, with the mask byte as alpha.
    expect([...image.data]).toEqual([
      51, 102, 153, 255,
      51, 102, 153, 128,
      51, 102, 153, 0,
      51, 102, 153, 0,
      51, 102, 153, 255,
      51, 102, 153, 0,
    ]);

    const surface = harness.layerSurfaces()[0];
    const paint = surface.drawImages.find((call) => call.args[0] === patchCanvas);
    expect(paint?.args).toEqual([patchCanvas, 4, 6, 3, 2]);
    expect(paint?.composite).toBe("source-over");
    expect(paint?.alpha).toBe(1);
  });

  it("keeps the painting order when strokes and fills interleave", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;
    harness.strokes.set(layerId, [
      createStroke(layerId),
      createFill(layerId),
      createStroke(layerId),
    ]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(200, 160, 1);
    harness.renderer.render();

    const patchCanvas = recording.allocated.find(
      (canvas) => canvas.named("putImageData").length > 0,
    );
    const surface = harness.layerSurfaces()[0];
    expect(surface.drawImages.map((call) => call.args[0])).toEqual([
      harness.strokeBuffer,
      patchCanvas,
      harness.strokeBuffer,
    ]);
  });

  it("reads the composite at document resolution for the bucket fill", () => {
    const harness = createHarness();
    expect(harness.renderer.readCompositeImage()).toBeNull();

    harness.renderer.setDocument(createDocument({ width: 100, height: 80 }));
    const image = harness.renderer.readCompositeImage();

    expect(image?.width).toBe(100);
    expect(image?.height).toBe(80);
    const composed = recording.allocated.find(
      (canvas) => canvas.getImageDataCalls.length > 0,
    );
    expect(composed?.getImageDataCalls).toEqual([[0, 0, 100, 80]]);
  });
});

describe("Canvas2DRenderer gradients", () => {
  it("paints a linear gradient over the layer at its element opacity", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;
    const gradient = createGradient(layerId);
    harness.strokes.set(layerId, [gradient]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(200, 160, 1);
    harness.renderer.render();

    const surface = harness.layerSurfaces()[0];
    const paint = surface.named("fillRect")[0];
    expect(paint.args).toEqual([0, 0, 100, 80]);
    expect(paint.alpha).toBe(0.4);
    expect(paint.composite).toBe("source-over");

    const fill = paint.fillStyle as {
      kind: string;
      args: number[];
      stops: { offset: number; color: string }[];
    };
    expect(fill.kind).toBe("linear");
    expect(fill.args).toEqual([10, 20, 90, 60]);
    expect(fill.stops).toEqual([
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#0000ff" },
    ]);
  });

  it("uses the drag length as the outer radius for a radial gradient", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;
    harness.strokes.set(layerId, [
      createGradient(layerId, { type: "radial", x1: 30, y1: 40, x2: 33, y2: 44 }),
    ]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(200, 160, 1);
    harness.renderer.render();

    const fill = harness.layerSurfaces()[0].named("fillRect")[0]
      .fillStyle as { kind: string; args: number[] };
    expect(fill.kind).toBe("radial");
    expect(fill.args).toEqual([30, 40, 0, 30, 40, 5]);
  });

  it("keeps gradients in painting order with strokes and fills", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;
    harness.strokes.set(layerId, [
      createStroke(layerId),
      createGradient(layerId),
      createFill(layerId),
      createStroke(layerId),
    ]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(200, 160, 1);
    harness.renderer.render();

    const surface = harness.layerSurfaces()[0];
    // Gradients paint in place; strokes and fills are drawImage entries. Their
    // relative order is visible as: stroke, then gradient fillRect, then patch,
    // then stroke. The patch upload gives us the second drawImage identity.
    const patchCanvas = recording.allocated.find(
      (canvas) => canvas.named("putImageData").length > 0,
    );
    expect(surface.drawImages.map((call) => call.args[0])).toEqual([
      harness.strokeBuffer,
      patchCanvas,
      harness.strokeBuffer,
    ]);
    expect(
      surface.calls
        .filter((call) => call.name === "drawImage" || call.name === "fillRect")
        .map((call) => call.name),
    ).toEqual(["drawImage", "fillRect", "drawImage", "drawImage"]);
  });

  it("draws nothing for a zero-length or fully transparent gradient", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    const layerId = doc.layers[0].id;
    harness.strokes.set(layerId, [
      createGradient(layerId, { x2: 10, y2: 20 }),
      createGradient(layerId, { opacity: 0 }),
    ]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(200, 160, 1);
    harness.renderer.render();

    expect(harness.layerSurfaces()[0].named("fillRect")).toEqual([]);
  });
});

describe("Canvas2DRenderer document export", () => {
  it("composites paper and visible layers into a document-sized canvas", () => {
    const harness = createHarness({ rasterScale: 2 });
    let doc = createDocument({ width: 100, height: 80, background: "#101010" });
    doc = addLayer(doc);
    doc = updateLayer(doc, doc.layers[1].id, { visible: false });
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(300, 200, 1);

    const exported = harness.composeDocument();

    // Document pixel size: neither the display size nor the raster scale.
    expect(exported.width).toBe(100);
    expect(exported.height).toBe(80);

    const paper = exported.named("fillRect");
    expect(paper).toHaveLength(1);
    expect(paper[0].fillStyle).toBe("#101010");
    expect(paper[0].args).toEqual([0, 0, 100, 80]);

    // The hidden layer is skipped, so one surface is composited - stretched to
    // document size even though the surface itself is 200x160 at rasterScale 2.
    const images = exported.named("drawImage");
    expect(images).toHaveLength(1);
    expect(images[0].args.slice(1)).toEqual([0, 0, 100, 80]);

    // No viewport transform and no document border: this is an image, not a view.
    expect(exported.named("setTransform").map((call) => call.args)).toEqual([[1, 0, 0, 1, 0, 0]]);
    expect(exported.named("strokeRect")).toHaveLength(0);
  });

  it("keeps layer order and layer opacity in the exported composite", () => {
    const harness = createHarness();
    let doc = createDocument({ width: 20, height: 20 });
    doc = addLayer(doc);
    doc = updateLayer(doc, doc.layers[0].id, { opacity: 0.5 });
    harness.renderer.setDocument(doc);

    const images = harness.composeDocument().named("drawImage");

    expect(images).toHaveLength(2);
    // Bottom layer first (half transparent), then the untouched top layer.
    expect(images.map((call) => call.alpha)).toEqual([0.5, 1]);
    expect(images.map((call) => call.composite)).toEqual(["source-over", "source-over"]);
  });

  it("omits the in-progress stroke and leaves the display and surfaces untouched", () => {
    const strokes = new Map<LayerId, StrokeRecord[]>();
    const harness = createHarness({ strokes, rasterScale: 2 });
    const doc = createDocument({ width: 60, height: 40 });
    const layerId = doc.layers[0].id;
    strokes.set(layerId, [createStroke(layerId)]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(60, 40, 1);
    harness.renderer.render();

    const stroke = createStroke(layerId);
    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);
    harness.renderer.render();

    harness.display.calls.length = 0;
    const clearsBefore = harness.layerSurfaces()[0].named("clearRect").length;

    const exported = harness.composeDocument();

    // The committed stroke is exported; the uncommitted one is not.
    expect(exported.named("drawImage")).toHaveLength(1);
    expect(exported.drawnSources).not.toContain(harness.strokeBuffer);
    // Exporting re-rasterized nothing and painted nothing on the display.
    expect(harness.layerSurfaces()[0].named("clearRect")).toHaveLength(clearsBefore);
    expect(harness.display.calls).toHaveLength(0);
  });

  it("returns an empty canvas when no document has been set", () => {
    const exported = createHarness().composeDocument();

    expect(exported.width).toBe(1);
    expect(exported.height).toBe(1);
    expect(exported.calls).toHaveLength(0);
  });
});

describe("Canvas2DRenderer colour probe", () => {
  it("samples paper then visible layers at a pixel-aligned document point", () => {
    const harness = createHarness({ rasterScale: 2 });
    let doc = createDocument({ width: 100, height: 80, background: "#101010" });
    doc = addLayer(doc);
    const [bottomId, topId] = doc.layers.map((layer) => layer.id);
    doc = updateLayer(doc, bottomId, { opacity: 0.5 });
    doc = updateLayer(doc, topId, { opacity: 0.25 });
    harness.renderer.setDocument(doc);

    // Default recording pixel is transparent black, so the probe returns black;
    // the draw stream below is what proves the composite was built.
    expect(harness.renderer.readCompositePixel(30.9, 12.4)).toEqual({ r: 0, g: 0, b: 0 });

    const probe = recording.allocated.find((canvas) => canvas.getImageDataCalls.length > 0);
    expect(probe).toBeDefined();
    // The 1x1 probe is not the stroke buffer, so the "first canvas allocated is
    // the stroke buffer" assumption used by the harness still holds.
    expect(probe).not.toBe(harness.strokeBuffer);
    expect(probe?.width).toBe(1);
    expect(probe?.height).toBe(1);

    const paper = probe?.named("fillRect") ?? [];
    expect(paper).toHaveLength(1);
    expect(paper[0].fillStyle).toBe("#101010");
    expect(paper[0].args).toEqual([0, 0, 1, 1]);

    // Bottom-first, each at its own alpha, offset so that the sampled document
    // pixel lands on (0, 0). Flooring keeps the probe pixel-aligned:
    // floor(30.9 * 2) = 61, floor(12.4 * 2) = 24.
    const images = probe?.named("drawImage") ?? [];
    expect(images.map((call) => call.alpha)).toEqual([0.5, 0.25]);
    expect(images.map((call) => call.args.slice(1))).toEqual([
      [-61, -24],
      [-61, -24],
    ]);
    expect(probe?.getImageDataCalls).toEqual([[0, 0, 1, 1]]);

    // The returned colour is exactly what the 1x1 read produced.
    const probeCanvas = probe as RecordingCanvas;
    probeCanvas.imageData = new Uint8ClampedArray([204, 51, 102, 255]);
    const allocations = recording.allocated.length;
    expect(harness.renderer.readCompositePixel(30.9, 12.4)).toEqual({
      r: 204,
      g: 51,
      b: 102,
    });
    // The probe is reused rather than allocated per pick.
    expect(recording.allocated.length).toBe(allocations);
  });

  it("skips hidden layers and layers whose opacity is zero", () => {
    const harness = createHarness();
    let doc = createDocument({ width: 20, height: 20 });
    doc = addLayer(doc);
    doc = addLayer(doc);
    const [, hiddenId, transparentId] = doc.layers.map((layer) => layer.id);
    doc = updateLayer(doc, hiddenId, { visible: false });
    doc = updateLayer(doc, transparentId, { opacity: 0 });
    harness.renderer.setDocument(doc);

    harness.renderer.readCompositePixel(5, 5);

    // Only the visible, non-transparent bottom layer reaches the probe.
    const probe = recording.allocated.find((canvas) => canvas.getImageDataCalls.length > 0);
    const images = probe?.named("drawImage") ?? [];
    expect(images).toHaveLength(1);
    expect(images[0].alpha).toBe(1);
  });

  it("returns null and allocates nothing when there is no document", () => {
    const harness = createHarness();
    const allocations = recording.allocated.length;

    expect(harness.renderer.readCompositePixel(0, 0)).toBeNull();
    expect(recording.allocated.length).toBe(allocations);
  });

  it("returns null after destroy()", () => {
    const harness = createHarness();
    harness.renderer.setDocument(createDocument({ width: 20, height: 20 }));
    harness.renderer.destroy();

    expect(harness.renderer.readCompositePixel(5, 5)).toBeNull();
  });
});

describe("Canvas2DRenderer selection overlay", () => {
  function renderWithSelection(bounds: Bounds | null, strokes: readonly StrokeRecord[]) {
    const harness = createHarness();
    const doc = createDocument({ width: 100, height: 80 });
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.setSelection(strokes.length > 0 || bounds !== null ? { bounds, strokes } : null);
    harness.renderer.render();
    return { harness, doc };
  }

  it("traces the selected strokes and draws the marquee above them", () => {
    const doc = createDocument({ width: 100, height: 80 });
    const stroke = createStroke(doc.layers[0].id);
    const { harness } = renderWithSelection({ x: 2, y: 3, width: 40, height: 20 }, [stroke]);

    // The trace: one stroked path at a constant device width, in the accent
    // colour, translucent so the ink underneath stays readable.
    const traces = harness.display.named("stroke");
    expect(traces).toHaveLength(1);
    expect(traces[0].strokeStyle).toBe("#2f7bff");
    expect(traces[0].alpha).toBeCloseTo(0.85, 6);
    expect(traces[0].lineWidth).toBeCloseTo(1.5, 6);

    // The marquee is dashed and exactly the requested rectangle; the border is
    // the solid rectangle after it.
    const rectangles = harness.display.named("strokeRect");
    expect(rectangles).toHaveLength(2);
    expect(rectangles[0].args).toEqual([2, 3, 40, 20]);
    expect(rectangles[0].strokeStyle).toBe("#2f7bff");
    expect(rectangles[0].lineDash).not.toEqual([]);
    expect(rectangles[1].strokeStyle).toBe("rgba(0, 0, 0, 0.35)");
    expect(rectangles[1].lineDash).toEqual([]);
    expect(rectangles[1].args).toEqual([0, 0, 100, 80]);

    // Ordering on the display canvas: trace, then marquee, then border.
    const names = harness.display.calls.map((call) => call.name);
    expect(names.indexOf("stroke")).toBeLessThan(names.lastIndexOf("strokeRect"));
    expect(names.indexOf("stroke")).toBeGreaterThan(names.lastIndexOf("clearRect"));
  });

  it("treats a null selection as no overlay at all", () => {
    const { harness } = renderWithSelection(null, []);
    expect(harness.display.named("stroke")).toHaveLength(0);
    // Only the document border remains.
    expect(harness.display.named("strokeRect")).toHaveLength(1);
  });

  it("keeps the overlay out of the exported composite", () => {
    const doc = createDocument({ width: 100, height: 80 });
    const stroke = createStroke(doc.layers[0].id);
    const harness = createHarness();
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.setSelection({ bounds: { x: 2, y: 3, width: 40, height: 20 }, strokes: [stroke] });

    const composed = harness.composeDocument();
    expect(composed.named("stroke")).toHaveLength(0);
    expect(composed.named("strokeRect")).toHaveLength(0);
  });
});
