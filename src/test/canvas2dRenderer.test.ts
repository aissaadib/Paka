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
  DrawingDocument,
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
  hardness: 1,
  pressureSize: 0,
  pressureOpacity: 0,
  minSizeRatio: 0,
  spacing: 0.1,
  stabilizer: 0,
  texture: 0,
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

  it("maps multiply and screen layer modes to the canvas composite operation", () => {
    const harness = createHarness();
    let doc = createDocument({ width: 20, height: 20 });
    doc = addLayer(doc);
    const topId = doc.layers[1].id;
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(40, 40, 1);

    harness.renderer.render();
    expect(harness.display.drawImages.map((image) => image.composite)).toEqual([
      "source-over",
      "source-over",
    ]);

    harness.renderer.setDocument(updateLayer(doc, topId, { blendMode: "multiply" }));
    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawImages.map((image) => image.composite)).toEqual([
      "source-over",
      "multiply",
    ]);

    harness.renderer.setDocument(updateLayer(doc, topId, { blendMode: "screen" }));
    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawImages.map((image) => image.composite)).toEqual([
      "source-over",
      "screen",
    ]);

    // The mode is reset between layers and after the pass: the paper fill and
    // the document border are never blended.
    expect(harness.display.named("fillRect")[0].composite).toBe("source-over");
    expect(harness.display.named("strokeRect")[0].composite).toBe("source-over");

    // Export, bucket sampling and the colour probe share the same composite,
    // so the document-size export must carry the mode too.
    expect(harness.composeDocument().drawImages.map((image) => image.composite)).toEqual([
      "source-over",
      "screen",
    ]);
    expect(harness.renderer.readCompositePixel(1, 1)).not.toBeNull();
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

  it("shows the replaced outline in its own layer, at the stroke's opacity", () => {
    const strokes = new Map<LayerId, StrokeRecord[]>();
    const harness = createHarness({ strokes });
    let doc = createDocument({ width: 100, height: 80 });
    doc = addLayer(doc);
    const bottomId = doc.layers[0].id;
    const brush: BrushSettings = { ...BRUSH, opacity: 0.5 };

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);

    const stroke = createStroke(bottomId, brush);
    harness.renderer.beginStroke(stroke);
    harness.renderer.replaceStroke(stroke);
    harness.renderer.render();

    const inProgress = harness.display.drawImages.find(
      (call) => call.args[0] === harness.strokeBuffer,
    );
    expect(inProgress?.alpha).toBe(0.5);

    // The preview belongs to the bottom layer, so it is painted after that
    // layer's surface and before the layer above it - not after every layer.
    const sources = harness.display.drawnSources;
    const surfaces = harness.layerSurfaces();
    expect(sources.indexOf(harness.strokeBuffer)).toBeGreaterThan(sources.indexOf(surfaces[0]));
    expect(sources.indexOf(harness.strokeBuffer)).toBeLessThan(sources.indexOf(surfaces[1]));
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

    // Only the rectangle the stroke inks is subtracted: the samples run from
    // (5, 5) to (45, 5) with a 10 px brush, so the padded bounds are
    // 0..51 x 0..26 in document pixels. The blit is one to one, so the
    // source and the destination rectangles are the same.
    expect(composites[1].args.slice(1)).toEqual([0, 0, 51, 26, 0, 0, 51, 26]);

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

describe("Canvas2DRenderer brush hardness", () => {
  const SOFT: BrushSettings = { ...BRUSH, size: 40, hardness: 0.5 };

  /** The feather scratch: the only canvas that is ever drawn through a filter. */
  function featherCanvas(): RecordingCanvas | undefined {
    return recording.allocated.find((canvas) =>
      canvas.named("drawImage").some((call) => call.filter !== "none"),
    );
  }

  function openHarness() {
    const strokes = new Map<LayerId, StrokeRecord[]>();
    const harness = createHarness({ strokes });
    const doc = createDocument({ width: 100, height: 80 });
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.render();
    return { harness, strokes, doc, layerId: doc.layers[0].id };
  }

  it("keeps a hard stroke on the raw buffer with no filter anywhere", () => {
    const { harness, doc, layerId } = openHarness();
    const allocations = recording.allocated.length;

    const stroke = createStroke(layerId);
    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);
    harness.display.calls.length = 0;
    harness.renderer.render();

    const images = harness.display.named("drawImage");
    expect(images.some((call) => call.args[0] === harness.strokeBuffer)).toBe(true);
    expect(images.every((call) => call.filter === "none")).toBe(true);
    // Hardness 1 allocates no feather scratch and blurs nothing.
    expect(recording.allocated.length).toBe(allocations);
    expect(featherCanvas()).toBeUndefined();
    expect(doc.layers[0].id).toBe(layerId);
  });

  it("feathers a soft stroke once, into a bounded scratch, and shows the copy", () => {
    const { harness, layerId } = openHarness();
    const stroke = createStroke(layerId, SOFT);
    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);

    harness.display.calls.length = 0;
    harness.renderer.render();

    const feather = featherCanvas();
    expect(feather).toBeDefined();

    // The buffer holds one segment per gap between samples at full coverage; the
    // blur is a single pass over the finished silhouette, never one per segment.
    expect(harness.strokeBuffer.named("stroke").length).toBeGreaterThan(1);
    const blurred = feather?.named("drawImage").filter((call) => call.filter !== "none") ?? [];
    expect(blurred).toHaveLength(1);
    expect(blurred[0].args[0]).toBe(harness.strokeBuffer);
    expect(blurred[0].filter).toMatch(/^blur\(/);

    // The scratch is the stroke's bounding box, not the whole document: a soft
    // edge costs a pass over the stroke, not a document-wide blur per frame.
    const surface = harness.layerSurfaces()[0];
    expect(feather?.width).toBeLessThan(surface.width);
    expect(feather?.height).toBeLessThan(surface.height);

    // The display shows the feathered copy, at the stroke's own alpha, exactly
    // once - the raw buffer never reaches the screen.
    const shown = harness.display.named("drawImage").filter((call) => call.args[0] === feather);
    expect(shown).toHaveLength(1);
    expect(shown[0].alpha).toBe(1);
    expect(
      harness.display.named("drawImage").some((call) => call.args[0] === harness.strokeBuffer),
    ).toBe(false);
  });

  it("composites the feathered copy into the layer when the stroke commits", () => {
    const { harness, strokes, layerId } = openHarness();
    const stroke = createStroke(layerId, SOFT);

    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);

    const surface = harness.layerSurfaces()[0];
    surface.calls.length = 0;
    strokes.set(layerId, [stroke]);
    harness.renderer.endStroke(stroke);

    const composites = surface.drawImages;
    expect(composites).toHaveLength(1);
    const feather = composites[0].args[0] as RecordingCanvas;
    expect(feather).not.toBe(harness.strokeBuffer);
    expect(composites[0].alpha).toBe(1);
    expect(composites[0].composite).toBe("source-over");
    // Still no blur on the surface itself: the falloff lives in the scratch,
    // which was built with one filtered pass over the stroke's silhouette.
    expect(composites[0].filter).toBe("none");
    expect(feather.named("drawImage").filter((call) => call.filter !== "none")).toHaveLength(1);
  });

  it("rebuilds a committed soft stroke through the same feathered path", () => {
    const { harness, strokes, layerId } = openHarness();
    strokes.set(layerId, [createStroke(layerId, SOFT)]);

    harness.renderer.invalidateLayer(layerId);
    harness.renderer.render();

    const feather = featherCanvas();
    expect(feather).toBeDefined();
    const blurred = feather?.named("drawImage").filter((call) => call.filter !== "none") ?? [];
    expect(blurred).toHaveLength(1);

    const surface = harness.layerSurfaces()[0];
    const paint = surface.named("drawImage").find((call) => call.args[0] === feather);
    expect(paint?.composite).toBe("source-over");
    expect(paint?.alpha).toBe(1);
  });

  it("subtracts a soft eraser's feathered copy from the snapshot base", () => {
    const { harness, layerId } = openHarness();
    const surface = harness.layerSurfaces()[0];

    const erase = createStroke(layerId, SOFT, true);
    harness.renderer.beginStroke(erase);
    const snapshot = recording.allocated[recording.allocated.length - 1];
    expect(snapshot).not.toBe(harness.strokeBuffer);

    surface.calls.length = 0;
    harness.renderer.extendStroke(erase, 0);

    const feather = featherCanvas();
    expect(feather).toBeDefined();
    const images = surface.drawImages;
    expect(images[0].args[0]).toBe(snapshot);
    expect(images[0].composite).toBe("source-over");
    expect(images[1].args[0]).toBe(feather);
    expect(images[1].composite).toBe("destination-out");
    expect(
      images.some((call) => call.args[0] === harness.strokeBuffer),
    ).toBe(false);

    // The erasure is already in the layer, so the display paints the layer alone.
    harness.display.calls.length = 0;
    harness.renderer.render();
    expect(harness.display.drawnSources).toEqual([surface]);
  });

  it("reuses one feather scratch across frames instead of allocating per frame", () => {
    const { harness, layerId } = openHarness();
    const stroke = createStroke(layerId, SOFT);
    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);
    harness.renderer.render();

    const allocations = recording.allocated.length;
    const feather = featherCanvas();
    harness.renderer.render();
    harness.renderer.render();

    expect(recording.allocated.length).toBe(allocations);
    expect(featherCanvas()).toBe(feather);
  });

  it("applies one document-anchored grain pass to a hard stroke without touching the buffer", () => {
    const { harness, layerId } = openHarness();
    const textured: BrushSettings = { ...BRUSH, size: 40, texture: 0.8 };
    const stroke = createStroke(layerId, textured);
    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);
    harness.display.calls.length = 0;

    harness.renderer.render();

    const grain = recording.allocated.find((canvas) =>
      canvas
        .named("fillRect")
        .some(
          (call) =>
            call.composite === "destination-in" &&
            (call.fillStyle as { kind?: string }).kind === "pattern",
        ),
    );
    expect(grain).toBeDefined();
    expect(grain).not.toBe(harness.strokeBuffer);

    const pass = grain?.named("fillRect").find((call) => call.composite === "destination-in");
    const pattern = pass?.fillStyle as
      | { kind: string; repetition: string; transform: Record<string, number> }
      | undefined;
    expect(pattern?.kind).toBe("pattern");
    expect(pattern?.repetition).toBe("repeat");
    expect(pattern?.transform).toMatchObject({ a: 1, b: 0, c: 0, d: 1 });
    expect(pattern?.transform.e).toBeLessThanOrEqual(0);
    expect(pattern?.transform.f).toBeLessThanOrEqual(0);

    // The display shows the grain copy; the raw stroke buffer is still the
    // input for the next extend, never modified by the texture pass.
    expect(
      harness.display
        .named("drawImage")
        .some((call) => call.args[0] === grain),
    ).toBe(true);
    expect(harness.strokeBuffer.named("fillRect")).toHaveLength(0);
  });

  it("reads hardness from the stroke's own brush, not from editor state", () => {
    const { harness, layerId } = openHarness();
    // A hard stroke stays hard even while the toolbar's brush is soft.
    const stroke = createStroke(layerId, BRUSH);
    harness.renderer.beginStroke(stroke);
    harness.renderer.extendStroke(stroke, 0);
    harness.display.calls.length = 0;
    harness.renderer.render();

    expect(featherCanvas()).toBeUndefined();
    const shown = harness.display.named("drawImage").find(
      (call) => call.args[0] === harness.strokeBuffer,
    );
    expect(shown).toBeDefined();
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

/**
 * A tiny software Canvas 2D for the preview-compositing regression tests.
 *
 * The recording canvas proves *which* canvas was painted, in what order and
 * with what state, but it cannot answer "what colour is on screen". These
 * tests need the latter, so this stand-in keeps real straight-alpha pixels and
 * implements the slice of the spec the renderer uses to composite: `fillRect`,
 * `clearRect`, 1:1 `drawImage`, transforms, `save`/`restore`, and the
 * `source-over`, `destination-out`, `multiply` and `screen` operations.
 *
 * Stroke rasterization (paths, arcs) is deliberately a no-op: coverage is
 * seeded straight into the stroke buffer, because these tests are about where
 * that coverage is composited, not how it was rasterized.
 */

type PixelColour = readonly [number, number, number, number];

const PIXEL_BLACK: PixelColour = [0, 0, 0, 255];
const PIXEL_RED: PixelColour = [255, 0, 0, 255];
const PIXEL_GREEN: PixelColour = [0, 255, 0, 255];
const PIXEL_YELLOW: PixelColour = [255, 255, 0, 255];

function parsePixelColour(value: unknown): PixelColour | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : hex[1];
    return [
      parseInt(digits.slice(0, 2), 16) / 255,
      parseInt(digits.slice(2, 4), 16) / 255,
      parseInt(digits.slice(4, 6), 16) / 255,
      1,
    ];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => Number.parseFloat(part));
    return [(parts[0] ?? 0) / 255, (parts[1] ?? 0) / 255, (parts[2] ?? 0) / 255, parts[3] ?? 1];
  }
  return null;
}

class PixelCanvas {
  private _width = 0;
  private _height = 0;
  /** Straight-alpha RGBA, one float per channel in `[0, 1]`. */
  pixels = new Float32Array(0);
  readonly ctx: CanvasRenderingContext2D;

  constructor() {
    const self = this;
    const state = {
      transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
      alpha: 1,
      composite: "source-over",
      fillStyle: "#000000" as unknown,
      strokeStyle: "#000000" as unknown,
      lineWidth: 1,
      lineCap: "butt" as string,
      lineJoin: "miter" as string,
      filter: "none",
      lineDash: [] as number[],
      /** Subpaths of the current path, in user space. */
      path: [] as number[][][],
    };
    const saved: (typeof state)[] = [];

    const compositePixel = (
      index: number,
      source: ArrayLike<number>,
      sourceIndex: number,
      alpha: number,
    ): void => {
      const target = this.pixels;
      const sourceAlpha = source[sourceIndex + 3] * alpha;
      const backdropAlpha = target[index + 3];

      if (state.composite === "destination-out") {
        target[index + 3] = backdropAlpha * (1 - sourceAlpha);
        return;
      }
      if (state.composite === "destination-in") {
        // Keeps the destination's colour and scales its alpha by the source.
        target[index + 3] = backdropAlpha * sourceAlpha;
        return;
      }
      if (sourceAlpha <= 0) {
        return;
      }

      const sourceR = source[sourceIndex];
      const sourceG = source[sourceIndex + 1];
      const sourceB = source[sourceIndex + 2];
      const backdropR = target[index];
      const backdropG = target[index + 1];
      const backdropB = target[index + 2];
      const outAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
      if (outAlpha <= 0) {
        target[index] = 0;
        target[index + 1] = 0;
        target[index + 2] = 0;
        target[index + 3] = 0;
        return;
      }

      let outR: number;
      let outG: number;
      let outB: number;
      if (state.composite === "multiply" || state.composite === "screen") {
        const blend = (backdrop: number, sourceColour: number): number =>
          state.composite === "multiply"
            ? backdrop * sourceColour
            : backdrop + sourceColour - backdrop * sourceColour;
        const mix = (backdrop: number, sourceColour: number): number =>
          (sourceAlpha * (1 - backdropAlpha) * sourceColour +
            sourceAlpha * backdropAlpha * blend(backdrop, sourceColour) +
            (1 - sourceAlpha) * backdropAlpha * backdrop) /
          outAlpha;
        outR = mix(backdropR, sourceR);
        outG = mix(backdropG, sourceG);
        outB = mix(backdropB, sourceB);
      } else {
        outR = (sourceR * sourceAlpha + backdropR * backdropAlpha * (1 - sourceAlpha)) / outAlpha;
        outG = (sourceG * sourceAlpha + backdropG * backdropAlpha * (1 - sourceAlpha)) / outAlpha;
        outB = (sourceB * sourceAlpha + backdropB * backdropAlpha * (1 - sourceAlpha)) / outAlpha;
      }

      target[index] = outR;
      target[index + 1] = outG;
      target[index + 2] = outB;
      target[index + 3] = outAlpha;
    };

    /** Device-pixel bounds of a drawn rectangle, clipped to the canvas. */
    const bounds = (
      x: number,
      y: number,
      width: number,
      height: number,
    ): { left: number; top: number; right: number; bottom: number } => {
      const [a, , , d, e, f] = state.transform;
      return {
        left: Math.max(0, Math.floor(a * x + e)),
        top: Math.max(0, Math.floor(d * y + f)),
        right: Math.min(this._width, Math.ceil(a * (x + width) + e)),
        bottom: Math.min(this._height, Math.ceil(d * (y + height) + f)),
      };
    };

    /** Tiles a pattern image over a rectangle, like `fillRect` with a pattern. */
    const fillPattern = (
      pattern: {
        image?: PixelCanvas;
        transform?: { a: number; b: number; c: number; d: number; e: number; f: number } | null;
      },
      area: { left: number; top: number; right: number; bottom: number },
    ): void => {
      const image = pattern.image;
      if (!image) {
        return;
      }
      const transform = pattern.transform ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      const { a, d, e, f } = transform;
      if (a === 0 || d === 0) {
        return;
      }
      for (let row = area.top; row < area.bottom; row += 1) {
        for (let column = area.left; column < area.right; column += 1) {
          const ux = (column + 0.5 - e) / a;
          const uy = (row + 0.5 - f) / d;
          const sourceX = ((Math.floor(ux) % image.width) + image.width) % image.width;
          const sourceY = ((Math.floor(uy) % image.height) + image.height) % image.height;
          compositePixel(
            (row * self._width + column) * 4,
            image.pixels,
            (sourceY * image.width + sourceX) * 4,
            state.alpha,
          );
        }
      }
    };

    /** Even-odd test of a device point against the current path. */
    const insidePath = (path: number[][][], x: number, y: number): boolean => {
      let crossings = 0;
      for (const subpath of path) {
        if (subpath.length < 2) {
          continue;
        }
        for (let index = 0; index < subpath.length; index += 1) {
          const from = subpath[index];
          const to = subpath[(index + 1) % subpath.length];
          if (from[1] > y !== to[1] > y) {
            const t = (y - from[1]) / (to[1] - from[1]);
            const crossX = from[0] + t * (to[0] - from[0]);
            if (crossX > x) {
              crossings += 1;
            }
          }
        }
      }
      return crossings % 2 === 1;
    };

    /** Distance from a device point to a device-space segment. */
    const distanceToSegment = (
      x: number,
      y: number,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ): number => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared === 0) {
        return Math.hypot(x - x0, y - y0);
      }
      let t = ((x - x0) * dx + (y - y0) * dy) / lengthSquared;
      t = Math.min(1, Math.max(0, t));
      return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
    };

    const ctx = {
      canvas: this,
      get globalAlpha(): number {
        return state.alpha;
      },
      set globalAlpha(value: number) {
        state.alpha = value;
      },
      get globalCompositeOperation(): string {
        return state.composite;
      },
      set globalCompositeOperation(value: string) {
        state.composite = value;
      },
      get fillStyle(): unknown {
        return state.fillStyle;
      },
      set fillStyle(value: unknown) {
        state.fillStyle = value;
      },
      get filter(): string {
        return state.filter;
      },
      set filter(value: string) {
        state.filter = value;
      },
      setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0): void {
        state.transform = [a, b, c, d, e, f];
      },
      save(): void {
        saved.push({
          transform: [...state.transform] as [number, number, number, number, number, number],
          alpha: state.alpha,
          composite: state.composite,
          fillStyle: state.fillStyle,
          strokeStyle: state.strokeStyle,
          lineWidth: state.lineWidth,
          lineCap: state.lineCap,
          lineJoin: state.lineJoin,
          filter: state.filter,
          lineDash: [...state.lineDash],
          path: state.path,
        });
      },
      restore(): void {
        const previous = saved.pop();
        if (previous) {
          state.transform = previous.transform;
          state.alpha = previous.alpha;
          state.composite = previous.composite;
          state.fillStyle = previous.fillStyle;
          state.strokeStyle = previous.strokeStyle;
          state.lineWidth = previous.lineWidth;
          state.lineCap = previous.lineCap;
          state.lineJoin = previous.lineJoin;
          state.filter = previous.filter;
          state.lineDash = previous.lineDash;
          state.path = previous.path;
        }
      },
      clearRect(x: number, y: number, width: number, height: number): void {
        const area = bounds(x, y, width, height);
        for (let row = area.top; row < area.bottom; row += 1) {
          for (let column = area.left; column < area.right; column += 1) {
            const index = (row * self._width + column) * 4;
            self.pixels[index] = 0;
            self.pixels[index + 1] = 0;
            self.pixels[index + 2] = 0;
            self.pixels[index + 3] = 0;
          }
        }
      },
      fillRect(x: number, y: number, width: number, height: number): void {
        const area = bounds(x, y, width, height);
        const pattern = state.fillStyle as {
          image?: PixelCanvas;
          transform?: { a: number; b: number; c: number; d: number; e: number; f: number } | null;
        } | null;
        if (pattern && typeof pattern === "object" && pattern.image instanceof PixelCanvas) {
          fillPattern(pattern, area);
          return;
        }
        const colour = parsePixelColour(state.fillStyle);
        if (!colour) {
          return;
        }
        const source = [colour[0], colour[1], colour[2], colour[3]];
        for (let row = area.top; row < area.bottom; row += 1) {
          for (let column = area.left; column < area.right; column += 1) {
            compositePixel(
              (row * self._width + column) * 4,
              source,
              0,
              state.alpha * colour[3],
            );
          }
        }
      },
      drawImage(source: unknown, ...args: number[]): void {
        if (!(source instanceof PixelCanvas)) {
          return;
        }
        const image = source;
        let sourceX = 0;
        let sourceY = 0;
        let sourceWidth = image.width;
        let sourceHeight = image.height;
        let destX: number;
        let destY: number;
        let destWidth: number;
        let destHeight: number;
        if (args.length === 2) {
          [destX, destY] = args;
          destWidth = sourceWidth;
          destHeight = sourceHeight;
        } else if (args.length === 4) {
          [destX, destY, destWidth, destHeight] = args;
        } else if (args.length === 8) {
          [sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight] = args;
        } else {
          return;
        }
        if (sourceWidth <= 0 || sourceHeight <= 0 || destWidth <= 0 || destHeight <= 0) {
          return;
        }

        const [a, , , d, e, f] = state.transform;
        const area = bounds(destX, destY, destWidth, destHeight);
        for (let row = area.top; row < area.bottom; row += 1) {
          const v = (row + 0.5 - (d * destY + f)) / (d * destHeight);
          if (v < 0 || v >= 1) {
            continue;
          }
          const imageY = Math.min(
            image.height - 1,
            Math.max(0, Math.floor(sourceY + v * sourceHeight)),
          );
          for (let column = area.left; column < area.right; column += 1) {
            const u = (column + 0.5 - (a * destX + e)) / (a * destWidth);
            if (u < 0 || u >= 1) {
              continue;
            }
            const imageX = Math.min(
              image.width - 1,
              Math.max(0, Math.floor(sourceX + u * sourceWidth)),
            );
            compositePixel(
              (row * self._width + column) * 4,
              image.pixels,
              (imageY * image.width + imageX) * 4,
              state.alpha,
            );
          }
        }
      },
      // Path drawing: the stroke rasterizer is a thick polyline, so a capsule
      // per segment reproduces it. Edges are hard (no antialiasing), which is
      // enough to compare paths against each other.
      beginPath(): void {
        state.path = [];
      },
      moveTo(x: number, y: number): void {
        state.path.push([[x, y]]);
      },
      lineTo(x: number, y: number): void {
        if (state.path.length === 0) {
          state.path.push([[x, y]]);
          return;
        }
        state.path[state.path.length - 1].push([x, y]);
      },
      arc(x: number, y: number, radius: number): void {
        const points: number[][] = [];
        const steps = 24;
        for (let step = 0; step < steps; step += 1) {
          const angle = (step / steps) * Math.PI * 2;
          points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
        }
        state.path.push(points);
      },
      closePath(): void {
        // The fill rule closes every subpath implicitly.
      },
      fill(): void {
        const colour = parsePixelColour(state.fillStyle);
        if (!colour || state.path.length === 0) {
          return;
        }
        const source = [colour[0], colour[1], colour[2], colour[3]];
        const [a, , , d, e, f] = state.transform;
        const points = state.path.flat();
        const minX = Math.min(...points.map((point) => a * point[0] + e));
        const maxX = Math.max(...points.map((point) => a * point[0] + e));
        const minY = Math.min(...points.map((point) => d * point[1] + f));
        const maxY = Math.max(...points.map((point) => d * point[1] + f));
        const left = Math.max(0, Math.floor(minX));
        const top = Math.max(0, Math.floor(minY));
        const right = Math.min(self._width, Math.ceil(maxX));
        const bottom = Math.min(self._height, Math.ceil(maxY));
        for (let row = top; row < bottom; row += 1) {
          for (let column = left; column < right; column += 1) {
            if (!insidePath(state.path, column + 0.5, row + 0.5)) {
              continue;
            }
            compositePixel(
              (row * self._width + column) * 4,
              source,
              0,
              state.alpha * colour[3],
            );
          }
        }
      },
      stroke(): void {
        const colour = parsePixelColour(state.strokeStyle);
        if (!colour) {
          return;
        }
        const source = [colour[0], colour[1], colour[2], colour[3]];
        const [a, , , d, e, f] = state.transform;
        const radius = (state.lineWidth / 2) * Math.abs(a);
        for (const subpath of state.path) {
          for (let index = 1; index < subpath.length; index += 1) {
            const from = subpath[index - 1];
            const to = subpath[index];
            const x0 = a * from[0] + e;
            const y0 = d * from[1] + f;
            const x1 = a * to[0] + e;
            const y1 = d * to[1] + f;
            const left = Math.max(0, Math.floor(Math.min(x0, x1) - radius));
            const top = Math.max(0, Math.floor(Math.min(y0, y1) - radius));
            const right = Math.min(self._width, Math.ceil(Math.max(x0, x1) + radius));
            const bottom = Math.min(self._height, Math.ceil(Math.max(y0, y1) + radius));
            for (let row = top; row < bottom; row += 1) {
              for (let column = left; column < right; column += 1) {
                if (
                  distanceToSegment(column + 0.5, row + 0.5, x0, y0, x1, y1) > radius
                ) {
                  continue;
                }
                compositePixel(
                  (row * self._width + column) * 4,
                  source,
                  0,
                  state.alpha * colour[3],
                );
              }
            }
          }
        }
      },
      strokeRect(): void {},
      setLineDash(segments: number[] = []): void {
        state.lineDash = [...segments];
      },
      createImageData(width: number, height: number): ImageData {
        return {
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
          colorSpace: "srgb",
        } as unknown as ImageData;
      },
      putImageData(image: ImageData, x: number, y: number): void {
        for (let row = 0; row < image.height; row += 1) {
          for (let column = 0; column < image.width; column += 1) {
            const targetX = x + column;
            const targetY = y + row;
            if (
              targetX < 0 ||
              targetY < 0 ||
              targetX >= self._width ||
              targetY >= self._height
            ) {
              continue;
            }
            const sourceIndex = (row * image.width + column) * 4;
            const targetIndex = (targetY * self._width + targetX) * 4;
            self.pixels[targetIndex] = image.data[sourceIndex] / 255;
            self.pixels[targetIndex + 1] = image.data[sourceIndex + 1] / 255;
            self.pixels[targetIndex + 2] = image.data[sourceIndex + 2] / 255;
            self.pixels[targetIndex + 3] = image.data[sourceIndex + 3] / 255;
          }
        }
      },
      getImageData(x: number, y: number, width: number, height: number): ImageData {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let row = 0; row < height; row += 1) {
          for (let column = 0; column < width; column += 1) {
            const sourceX = x + column;
            const sourceY = y + row;
            if (
              sourceX < 0 ||
              sourceY < 0 ||
              sourceX >= self._width ||
              sourceY >= self._height
            ) {
              continue;
            }
            const sourceIndex = (sourceY * self._width + sourceX) * 4;
            const targetIndex = (row * width + column) * 4;
            for (let channel = 0; channel < 4; channel += 1) {
              data[targetIndex + channel] = Math.round(
                Math.min(1, Math.max(0, self.pixels[sourceIndex + channel])) * 255,
              );
            }
          }
        }
        return { data, width, height, colorSpace: "srgb" } as unknown as ImageData;
      },
      // State the renderer sets but this fake does not consume.
      get strokeStyle(): unknown {
        return state.strokeStyle;
      },
      set strokeStyle(value: unknown) {
        state.strokeStyle = value;
      },
      get lineWidth(): number {
        return state.lineWidth;
      },
      set lineWidth(value: number) {
        state.lineWidth = value;
      },
      get lineCap(): string {
        return state.lineCap;
      },
      set lineCap(value: string) {
        state.lineCap = value;
      },
      get lineJoin(): string {
        return state.lineJoin;
      },
      set lineJoin(value: string) {
        state.lineJoin = value;
      },
      createLinearGradient: () => ({ addColorStop(): void {} }),
      createRadialGradient: () => ({ addColorStop(): void {} }),
      createPattern: (image: unknown, repetition: string) => {
        const object = {
          kind: "pattern",
          image,
          repetition,
          transform: null as unknown,
          setTransform(transform: unknown): void {
            this.transform = transform;
          },
        };
        return object as unknown as CanvasPattern;
      },
    };

    this.ctx = ctx as unknown as CanvasRenderingContext2D;
  }

  get width(): number {
    return this._width;
  }

  set width(value: number) {
    this._width = Math.max(0, Math.round(value));
    this.pixels = new Float32Array(this._width * this._height * 4);
  }

  get height(): number {
    return this._height;
  }

  set height(value: number) {
    this._height = Math.max(0, Math.round(value));
    this.pixels = new Float32Array(this._width * this._height * 4);
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  asElement(): HTMLCanvasElement {
    return this as unknown as HTMLCanvasElement;
  }
}

function paintPixels(
  canvas: PixelCanvas,
  colour: PixelColour,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      if (column < 0 || row < 0 || column >= canvas.width || row >= canvas.height) {
        continue;
      }
      const index = (row * canvas.width + column) * 4;
      canvas.pixels[index] = colour[0] / 255;
      canvas.pixels[index + 1] = colour[1] / 255;
      canvas.pixels[index + 2] = colour[2] / 255;
      canvas.pixels[index + 3] = colour[3] / 255;
    }
  }
}

function readPixel(canvas: PixelCanvas, x: number, y: number): [number, number, number, number] {
  const index = (y * canvas.width + x) * 4;
  const pixel: [number, number, number, number] = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    pixel[channel] = Math.round(canvas.pixels[index + channel] * 255);
  }
  return pixel;
}

function expectPixel(
  canvas: PixelCanvas,
  x: number,
  y: number,
  expected: readonly [number, number, number],
  tolerance = 2,
): void {
  const [r, g, b] = readPixel(canvas, x, y);
  const message = `pixel (${x}, ${y}) is rgb(${r}, ${g}, ${b}), expected rgb(${expected.join(", ")})`;
  expect(Math.abs(r - expected[0]), message).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(g - expected[1]), message).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(b - expected[2]), message).toBeLessThanOrEqual(tolerance);
}

interface PixelHarness {
  readonly renderer: Canvas2DRenderer;
  readonly display: PixelCanvas;
  readonly doc: DrawingDocument;
  /** The renderer's in-progress stroke buffer (first canvas it allocates). */
  readonly strokeBuffer: PixelCanvas;
  /** Layer surfaces in painting order, bottom-first. */
  readonly surfaces: PixelCanvas[];
  /** The layer content the renderer rebuilds from. */
  readonly elements: Map<LayerId, LayerElement[]>;
}

/**
 * Runs `body` with a pixel-accurate document/window, then restores the global
 * `document` so the recording-canvas tests are unaffected.
 *
 * The first render allocates and rasterizes the (empty) layer surfaces; tests
 * then seed committed pixels directly into those surfaces and into the stroke
 * buffer, which is what keeps these tests about compositing rather than about
 * the stroke rasterizer.
 */
function withPixels(
  build: (doc: DrawingDocument) => DrawingDocument,
  body: (harness: PixelHarness) => void,
): void {
  const saved = (globalThis as { document?: unknown }).document;
  const allocated: PixelCanvas[] = [];
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const canvas = new PixelCanvas();
      allocated.push(canvas);
      return canvas;
    },
  };

  try {
    const display = new PixelCanvas();
    const elements = new Map<LayerId, LayerElement[]>();
    const strokeSource: StrokeSource = {
      listStrokes: (layerId) => (elements.get(layerId) ?? []).filter(isStroke),
      listElements: (layerId) => elements.get(layerId) ?? [],
    };
    const renderer = new Canvas2DRenderer({
      canvas: display.asElement(),
      strokeSource,
      rasterScale: 1,
      scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
    });
    const doc = build(createDocument({ width: 32, height: 32, background: "#ffffff" }));
    renderer.setDocument(doc);
    renderer.setDisplaySize(32, 32, 1);
    renderer.render();

    body({
      renderer,
      display,
      doc,
      strokeBuffer: allocated[0],
      surfaces: allocated.slice(1),
      elements,
    });
  } finally {
    (globalThis as { document?: unknown }).document = saved;
  }
}

describe("Canvas2DRenderer live preview compositing (real pixels)", () => {
  it("keeps a brush preview beneath an opaque layer above it", () => {
    withPixels(
      (doc) => addLayer(doc),
      (harness) => {
        const [bottom, top] = harness.surfaces;
        paintPixels(top, PIXEL_RED, 0, 0, 32, 32);

        const stroke = createStroke(harness.doc.layers[0].id);
        harness.renderer.beginStroke(stroke);
        paintPixels(harness.strokeBuffer, PIXEL_BLACK, 8, 8, 16, 16);
        harness.renderer.render();

        // The layer above is opaque: the preview must be behind it, not on top
        // of the whole document (the old behaviour painted black here).
        expectPixel(harness.display, 16, 16, [255, 0, 0]);
        // Nothing was committed while the stroke is in flight.
        expect(readPixel(bottom, 16, 16)).toEqual([0, 0, 0, 0]);
        expect(readPixel(top, 16, 16)).toEqual([255, 0, 0, 255]);
      },
    );
  });

  it("keeps a shape preview beneath a translucent layer above it", () => {
    withPixels(
      (doc) => {
        const withTop = addLayer(doc);
        return updateLayer(withTop, withTop.layers[1].id, { opacity: 0.5 });
      },
      (harness) => {
        const [bottom, top] = harness.surfaces;
        paintPixels(top, PIXEL_RED, 0, 0, 32, 32);

        const stroke = createStroke(harness.doc.layers[0].id);
        harness.renderer.beginStroke(stroke);
        harness.renderer.replaceStroke(stroke);
        paintPixels(harness.strokeBuffer, PIXEL_GREEN, 8, 8, 16, 16);
        harness.renderer.render();

        // Red at 50 % over the green preview: the preview is below the upper
        // layer. Painting the preview last would show pure green here.
        expectPixel(harness.display, 16, 16, [128, 128, 0]);
        expect(readPixel(bottom, 16, 16)).toEqual([0, 0, 0, 0]);
      },
    );
  });

  it("applies active-layer opacity to the preview once, not per element", () => {
    withPixels(
      (doc) => updateLayer(doc, doc.layers[0].id, { opacity: 0.5 }),
      (harness) => {
        const [surface] = harness.surfaces;
        paintPixels(surface, PIXEL_RED, 0, 0, 32, 32);

        const stroke = createStroke(harness.doc.layers[0].id, { ...BRUSH, opacity: 0.5 });
        harness.renderer.beginStroke(stroke);
        paintPixels(harness.strokeBuffer, PIXEL_YELLOW, 8, 8, 16, 16);
        harness.renderer.render();

        // Group first: yellow at 50 % over red = (255, 128, 0); then the whole
        // layer at 50 % over white paper = (255, 191, 128). Applying the layer
        // alpha to each element separately would leave the blue channel at 64.
        expectPixel(harness.display, 16, 16, [255, 191, 128]);
      },
    );
  });

  it("multiplies the preview with the backdrop instead of painting over it", () => {
    withPixels(
      (doc) => {
        const bottom = updateLayer(doc, doc.layers[0].id, { blendMode: "multiply" });
        return { ...bottom, background: "#3366cc" };
      },
      (harness) => {
        const stroke = createStroke(harness.doc.layers[0].id, { ...BRUSH, opacity: 0.5 });
        harness.renderer.beginStroke(stroke);
        paintPixels(harness.strokeBuffer, PIXEL_YELLOW, 8, 8, 16, 16);
        harness.renderer.render();

        // Yellow at 50 % under `multiply` over #3366cc. Painted with
        // `source-over` on top of the paper it would be (153, 178, 102).
        expectPixel(harness.display, 16, 16, [51, 102, 102]);
      },
    );
  });

  it("screens the preview with the backdrop", () => {
    withPixels(
      (doc) => {
        const bottom = updateLayer(doc, doc.layers[0].id, { blendMode: "screen" });
        return { ...bottom, background: "#3366cc" };
      },
      (harness) => {
        const stroke = createStroke(harness.doc.layers[0].id, { ...BRUSH, opacity: 0.5 });
        harness.renderer.beginStroke(stroke);
        paintPixels(harness.strokeBuffer, PIXEL_YELLOW, 8, 8, 16, 16);
        harness.renderer.render();

        // Painting over the paper would leave the blue channel at 102.
        expectPixel(harness.display, 16, 16, [153, 179, 204]);
      },
    );
  });

  it("hides the preview with a hidden active layer", () => {
    withPixels(
      (doc) => updateLayer(doc, doc.layers[0].id, { visible: false }),
      (harness) => {
        const stroke = createStroke(harness.doc.layers[0].id);
        harness.renderer.beginStroke(stroke);
        paintPixels(harness.strokeBuffer, PIXEL_BLACK, 0, 0, 32, 32);
        harness.renderer.render();

        expectPixel(harness.display, 16, 16, [255, 255, 255]);
      },
    );
  });

  it("hides the preview with a zero-opacity active layer", () => {
    withPixels(
      (doc) => updateLayer(doc, doc.layers[0].id, { opacity: 0 }),
      (harness) => {
        const stroke = createStroke(harness.doc.layers[0].id);
        harness.renderer.beginStroke(stroke);
        paintPixels(harness.strokeBuffer, PIXEL_BLACK, 0, 0, 32, 32);
        harness.renderer.render();

        expectPixel(harness.display, 16, 16, [255, 255, 255]);
      },
    );
  });

  it("shows the same pixels before release as after, and commits nothing early", () => {
    withPixels(
      (doc) => {
        let next = updateLayer(doc, doc.layers[0].id, { opacity: 0.5 });
        next = updateLayer(next, next.layers[0].id, { blendMode: "multiply" });
        return next;
      },
      (harness) => {
        const [surface] = harness.surfaces;
        paintPixels(surface, PIXEL_RED, 0, 0, 32, 32);

        const stroke = createStroke(harness.doc.layers[0].id, { ...BRUSH, opacity: 0.4 });
        harness.renderer.beginStroke(stroke);
        paintPixels(harness.strokeBuffer, PIXEL_YELLOW, 8, 8, 16, 16);
        harness.renderer.render();

        const preview = readPixel(harness.display, 16, 16);
        // The preview was assembled in the renderer's scratch: the layer still
        // holds exactly the pixels it had before the gesture started.
        expect(readPixel(surface, 16, 16)).toEqual([255, 0, 0, 255]);

        harness.renderer.endStroke(stroke);
        harness.renderer.render();
        expect(readPixel(harness.display, 16, 16)).toEqual(preview);
      },
    );
  });
});

describe("Canvas2DRenderer preview compositing calls", () => {
  it("groups the preview before applying a non-default layer opacity and blend", () => {
    const harness = createHarness();
    let doc = createDocument({ width: 20, height: 20 });
    const layerId = doc.layers[0].id;
    doc = updateLayer(doc, layerId, { opacity: 0.5, blendMode: "multiply" });

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(20, 20, 1);
    harness.renderer.render();
    const [surface] = harness.layerSurfaces();

    const stroke = createStroke(layerId);
    harness.renderer.beginStroke(stroke);
    harness.display.calls.length = 0;
    harness.renderer.render();

    const group = harness.display.drawnSources.find((source) => source !== surface);
    expect(group).toBeDefined();
    expect(group).not.toBe(harness.strokeBuffer);

    const draw = harness.display.drawImages.find((call) => call.args[0] === group);
    expect(draw?.alpha).toBe(0.5);
    expect(draw?.composite).toBe("multiply");

    // The group receives the committed layer first, then the live coverage.
    const scratch = group as RecordingCanvas;
    expect(scratch.drawImages).toHaveLength(2);
    expect(scratch.drawImages[0].args[0]).toBe(surface);
    expect(scratch.drawImages[1].args[0]).toBe(harness.strokeBuffer);

    // Only read: the layer surface never received the live buffer.
    expect(surface.drawImages).toEqual([]);
  });

  it("skips the preview for a hidden layer instead of drawing it on top", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 20, height: 20 });
    const layerId = doc.layers[0].id;
    harness.renderer.setDocument(updateLayer(doc, layerId, { visible: false }));
    harness.renderer.setDisplaySize(20, 20, 1);
    harness.renderer.render();
    const [surface] = harness.layerSurfaces();

    const stroke = createStroke(layerId);
    harness.renderer.beginStroke(stroke);
    harness.display.calls.length = 0;
    harness.renderer.render();

    expect(harness.display.drawnSources).not.toContain(harness.strokeBuffer);
    expect(harness.display.drawnSources).not.toContain(surface);
    expect(harness.display.drawImages).toHaveLength(0);
  });
});

/**
 * The device pixels a canvas's drawing touched.
 *
 * A call's area is its destination rectangle scaled by the determinant of the
 * transform that was live when it was made. That is how a rebuild's cost is
 * measured: the number of calls stays the same, the area they touch does not.
 */
function touchedArea(canvas: RecordingCanvas, only?: "clearRect" | "drawImage"): number {
  let scale = 1;
  let area = 0;
  for (const call of canvas.calls) {
    if (call.name === "setTransform") {
      const [a, b, c, d] = call.args as number[];
      scale = Math.abs(a * d - b * c);
      continue;
    }
    if (only && call.name !== only) {
      continue;
    }
    if (call.name === "clearRect") {
      const [, , width, height] = call.args as number[];
      area += width * height * scale;
      continue;
    }
    if (call.name === "drawImage") {
      const args = call.args as number[];
      const width = args.length === 5 ? args[3] : args[7];
      const height = args.length === 5 ? args[4] : args[8];
      area += width * height * scale;
    }
  }
  return area;
}

/** True when every covered pixel of a canvas lies inside a rectangle. */
function coverageInside(
  canvas: PixelCanvas,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  for (let row = 0; row < canvas.height; row += 1) {
    for (let column = 0; column < canvas.width; column += 1) {
      if (canvas.pixels[(row * canvas.width + column) * 4 + 3] > 0) {
        if (column < left || column > right || row < top || row > bottom) {
          return false;
        }
      }
    }
  }
  return true;
}

describe("Canvas2DRenderer bounded layer rasterization", () => {
  it("clears and blends only the rectangle a stroke inks", () => {
    const strokes = new Map<LayerId, StrokeRecord[]>();
    const harness = createHarness({ strokes });
    const doc = createDocument({ width: 200, height: 200 });
    const layerId = doc.layers[0].id;
    // An off-centre stroke: the cost of a rebuild has to follow the ink, not
    // the document.
    const stroke: StrokeRecord = {
      ...createStroke(layerId),
      xs: [150, 170],
      ys: [150, 170],
      pressures: [1, 1],
      times: [0, 16],
    };
    strokes.set(layerId, [stroke]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(200, 200, 1);
    // Forget the set-up clears (the document swap drops the stroke buffer) so
    // the measurement covers the rebuild only.
    harness.strokeBuffer.calls.length = 0;
    harness.renderer.render();

    const [surface] = harness.layerSurfaces();
    // A 10 px brush pads the samples by 6 px, so the stroke inks 32 x 32 px.
    expect(touchedArea(harness.strokeBuffer, "clearRect")).toBe(32 * 32);
    expect(touchedArea(surface, "drawImage")).toBe(32 * 32);
    // A full-document clear and blend would have been 200 x 200 each.
    expect(touchedArea(surface, "drawImage")).toBeLessThan((200 * 200) / 10);

    // The blend is a one-to-one blit of that rectangle: the surface and the
    // stroke buffer share a pixel grid, so nothing is resampled.
    const blend = surface.drawImages[0];
    expect(blend.args.length).toBe(9);
    expect(blend.args.slice(1)).toEqual([144, 144, 32, 32, 144, 144, 32, 32]);
  });

  it("keeps the layer's own clear whole but bounds every element", () => {
    const strokes = new Map<LayerId, StrokeRecord[]>();
    const harness = createHarness({ strokes });
    const doc = createDocument({ width: 200, height: 200 });
    const layerId = doc.layers[0].id;
    strokes.set(layerId, [
      { ...createStroke(layerId), xs: [20, 30], ys: [20, 30], pressures: [1, 1], times: [0, 16] },
      { ...createStroke(layerId), xs: [150, 160], ys: [150, 160], pressures: [1, 1], times: [0, 16] },
    ]);

    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(200, 200, 1);
    harness.renderer.render();

    const [surface] = harness.layerSurfaces();
    // Two elements, two small rectangles - not two document-sized blends.
    // The samples are 10 px apart, so each stroke inks 22 x 22 px.
    expect(surface.drawImages).toHaveLength(2);
    expect(touchedArea(surface, "drawImage")).toBe(2 * 22 * 22);
    // The layer itself is still cleared once, in full: a rebuild starts from
    // an empty surface.
    expect(surface.named("clearRect")).toHaveLength(1);
    expect(touchedArea(surface, "clearRect")).toBe(200 * 200);
  });
});

describe("Canvas2DRenderer bounded rebuild is pixel-identical", () => {
  const SAMPLE_X = 16;
  const SAMPLE_Y = 14;

  function createTestStroke(
    layerId: LayerId,
    brush: BrushSettings,
    id: string,
    erase = false,
  ): StrokeRecord {
    return {
      id,
      layerId,
      brush,
      erase,
      xs: [6, SAMPLE_X, 26],
      ys: [6, SAMPLE_Y, 6],
      pressures: [1, 1, 1],
      times: [0, 16, 32],
      startTime: 0,
    };
  }

  /**
   * Live, commit, rebuild and export must show the same pixels.
   *
   * The rebuild is the path the dirty bounds changed: it rasterizes the
   * stroke into the buffer and blends only the rectangle it inks. The other
   * three are the reference the user sees.
   *
   * The software canvas has no blur, so the soft case checks the feather
   * path's geometry and placement rather than the kernel; the grain case is
   * real, because the pattern pass is implemented.
   */
  function checkEveryPathAgrees(brush: BrushSettings): void {
    withPixels(
      (doc) => doc,
      (harness) => {
        const layerId = harness.doc.layers[0].id;
        const stored = createTestStroke(layerId, brush, "stored");

        // 1. The rebuild: the layer is rasterized from the stroke list.
        harness.elements.set(layerId, [stored]);
        harness.renderer.invalidateLayer(layerId);
        harness.renderer.render();
        const rebuilt = readPixel(harness.display, SAMPLE_X, SAMPLE_Y);
        expect(rebuilt[3]).toBe(255);

        // The bounded blit can only replace the old full-surface blit if no
        // coverage falls outside the rectangle it draws. The coverage stays
        // within the brush radius of the samples (4 px for an 8 px brush), and
        // the drawn rectangle is that bound plus the padding the area test
        // pins.
        expect(coverageInside(harness.strokeBuffer, 2, 2, 30, 30)).toBe(true);

        // A second rebuild must land on the same pixels.
        harness.renderer.invalidateLayer(layerId);
        harness.renderer.render();
        expect(readPixel(harness.display, SAMPLE_X, SAMPLE_Y)).toEqual(rebuilt);

        // 2. Live: the same stroke drawn through the live path.
        harness.elements.set(layerId, []);
        harness.renderer.invalidateLayer(layerId);
        harness.renderer.render();
        const live = createTestStroke(layerId, brush, "live");
        harness.renderer.beginStroke(live);
        harness.renderer.extendStroke(live, 0);
        harness.renderer.render();
        expect(readPixel(harness.display, SAMPLE_X, SAMPLE_Y)).toEqual(rebuilt);

        // 3. The release: the buffer composites into the layer.
        harness.renderer.endStroke(live);
        harness.renderer.render();
        expect(readPixel(harness.display, SAMPLE_X, SAMPLE_Y)).toEqual(rebuilt);

        // 4. The export: the same picture at document size.
        const exported = harness.renderer.composeDocumentImage() as unknown as PixelCanvas;
        expect(readPixel(exported, SAMPLE_X, SAMPLE_Y)).toEqual(rebuilt);
      },
    );
  }

  it("agrees for a hard brush", () => {
    checkEveryPathAgrees({ ...BRUSH, size: 8, hardness: 1, texture: 0 });
  });

  it("agrees for a soft brush", () => {
    checkEveryPathAgrees({ ...BRUSH, size: 8, hardness: 0.4, texture: 0 });
  });

  it("agrees for a grain brush", () => {
    checkEveryPathAgrees({ ...BRUSH, size: 8, hardness: 1, texture: 1 });
  });

  it("does not darken a self-crossing stroke", () => {
    withPixels(
      (doc) => doc,
      (harness) => {
        const layerId = harness.doc.layers[0].id;
        // The stroke runs over the same pixels twice. The alpha is applied
        // once, when the finished coverage composites, so the crossing keeps
        // the brush's own opacity instead of stacking.
        const crossing: StrokeRecord = {
          ...createTestStroke(layerId, { ...BRUSH, size: 8, opacity: 0.5, hardness: 1 }, "cross"),
          xs: [6, 26, 6],
          ys: [14, 14, 14],
        };
        harness.elements.set(layerId, [crossing]);
        harness.renderer.invalidateLayer(layerId);
        harness.renderer.render();

        // Black at 50 % over white paper is 128; stacking it twice would be 64.
        expectPixel(harness.display, 16, 14, [128, 128, 128], 1);
      },
    );
  });

  it("keeps the eraser green: a rebuild still subtracts the stroke", () => {
    withPixels(
      (doc) => doc,
      (harness) => {
        const layerId = harness.doc.layers[0].id;
        const painted = createTestStroke(layerId, { ...BRUSH, size: 16, hardness: 1 }, "painted");
        const eraser = createTestStroke(
          layerId,
          { ...BRUSH, size: 16, hardness: 1 },
          "erased",
          true,
        );

        harness.elements.set(layerId, [painted]);
        harness.renderer.invalidateLayer(layerId);
        harness.renderer.render();
        const paintedPixel = readPixel(harness.display, SAMPLE_X, SAMPLE_Y);
        expect(paintedPixel[3]).toBe(255);
        // The layer itself holds the coverage (the paper behind it is opaque).
        expect(readPixel(harness.surfaces[0], SAMPLE_X, SAMPLE_Y)[3]).toBe(255);

        // The eraser subtracts the coverage it inks, and nothing else.
        harness.elements.set(layerId, [painted, eraser]);
        harness.renderer.invalidateLayer(layerId);
        harness.renderer.render();
        expect(readPixel(harness.surfaces[0], SAMPLE_X, SAMPLE_Y)[3]).toBe(0);
      },
    );
  });
});

describe("Canvas2DRenderer preview scratch lifetime", () => {
  /**
   * The grouped-preview scratch is a full-resolution surface, and the erase
   * snapshot is another one. The raster budget allows only one of them at a
   * time, so the scratch may only exist while a preview is being composited.
   */
  function createGroupedHarness() {
    const harness = createHarness();
    const doc = createDocument({ width: 20, height: 20 });
    const layerId = doc.layers[0].id;
    harness.renderer.setDocument(updateLayer(doc, layerId, { opacity: 0.5 }));
    harness.renderer.setDisplaySize(20, 20, 1);
    harness.renderer.render();
    return { harness, layerId };
  }

  it("holds the scratch only while a grouped preview is on screen", () => {
    const { harness, layerId } = createGroupedHarness();
    expect(harness.renderer.holdsPreviewScratch).toBe(false);

    const stroke = createStroke(layerId);
    harness.renderer.beginStroke(stroke);
    harness.renderer.render();
    expect(harness.renderer.holdsPreviewScratch).toBe(true);

    // The release is the end of the preview: the scratch is a full-resolution
    // surface and must not sit next to a later erase snapshot.
    harness.renderer.endStroke(stroke);
    expect(harness.renderer.holdsPreviewScratch).toBe(false);
  });

  it("releases the scratch when the stroke is cancelled", () => {
    const { harness, layerId } = createGroupedHarness();
    const stroke = createStroke(layerId);
    harness.renderer.beginStroke(stroke);
    harness.renderer.render();
    expect(harness.renderer.holdsPreviewScratch).toBe(true);

    harness.renderer.cancelStroke();
    expect(harness.renderer.holdsPreviewScratch).toBe(false);
  });

  it("never holds the scratch beside an eraser snapshot", () => {
    const { harness, layerId } = createGroupedHarness();
    const stroke = createStroke(layerId);
    harness.renderer.beginStroke(stroke);
    harness.renderer.render();
    expect(harness.renderer.holdsPreviewScratch).toBe(true);
    harness.renderer.endStroke(stroke);

    // The eraser takes its own snapshot; the scratch must already be gone, so
    // the two full-resolution surfaces are alternatives, not neighbours.
    const eraser = createStroke(layerId, BRUSH, true);
    harness.renderer.beginStroke(eraser);
    expect(harness.renderer.holdsPreviewScratch).toBe(false);

    harness.display.calls.length = 0;
    harness.renderer.render();
    const [surface] = harness.layerSurfaces();
    expect(harness.display.drawnSources).toEqual([surface]);
    harness.renderer.cancelStroke();
  });

  it("does not allocate a scratch for an opaque normal layer", () => {
    const harness = createHarness();
    const doc = createDocument({ width: 20, height: 20 });
    const layerId = doc.layers[0].id;
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(20, 20, 1);
    harness.renderer.render();

    const stroke = createStroke(layerId);
    harness.renderer.beginStroke(stroke);
    harness.renderer.render();

    // The common case groups nothing: the preview composites straight onto
    // the layer, so no full-resolution scratch is ever allocated.
    expect(harness.renderer.holdsPreviewScratch).toBe(false);
  });
});
