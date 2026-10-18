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
import type { LayerId, StrokeRecord } from "../core/document/types";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import type { StrokeSource } from "../core/rendering/types";
import type { BrushSettings } from "../types/brush";
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
  readonly strokes?: Map<LayerId, StrokeRecord[]>;
  readonly rasterScale?: number;
}

function createHarness(options: HarnessOptions = {}) {
  const firstAllocation = recording.allocated.length;
  const display = new RecordingCanvas();
  const strokes = options.strokes ?? new Map<LayerId, StrokeRecord[]>();
  const strokeSource: StrokeSource = {
    listStrokes: (layerId) => strokes.get(layerId) ?? [],
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

function createStroke(layerId: LayerId, brush: BrushSettings = BRUSH): StrokeRecord {
  strokeCounter += 1;
  return {
    id: `stroke-${strokeCounter}`,
    layerId,
    brush,
    xs: [5, 25, 45],
    ys: [5, 20, 5],
    pressures: [0.5, 1, 0.5],
    times: [0, 16, 32],
    startTime: 0,
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
