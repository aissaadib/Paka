/**
 * Rendering native shapes.
 *
 * The shape model is only useful if what it draws is exactly what the shape
 * tool previewed and what an export writes. These tests pin that down from the
 * renderer's side:
 *
 *  - a native shape is rasterized through the one stroke rasterizer, by
 *    expanding it to the derived stroke, so the two cannot diverge;
 *  - its fill, opacity, colour and width come from the shape's own brush;
 *  - it obeys layers exactly like every other element - order, visibility and
 *    opacity;
 *  - the selection overlay (outline, frame, handles) is display-only and never
 *    reaches the exported composite.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createDocument, updateLayer } from "../core/document/document";
import { strokeFromShape } from "../core/document/shapeRecord";
import type {
  BoxShapeGeometry,
  LayerElement,
  LayerId,
  ShapeRecord,
  StrokeRecord,
} from "../core/document/types";
import { isStroke } from "../core/document/types";
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
  ...DEFAULT_BRUSH,
  size: 8,
  opacity: 1,
  color: "#204080",
  hardness: 1,
  stamp: false,
};

const SELECTION_COLOR = "#2f7bff";

function box(overrides: Partial<BoxShapeGeometry> = {}): BoxShapeGeometry {
  return {
    shape: "rectangle",
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    rotation: 0,
    sides: 5,
    innerRatio: 0.5,
    ...overrides,
  };
}

function shape(overrides: Partial<ShapeRecord> = {}): ShapeRecord {
  return {
    id: "shape-1",
    layerId: "layer-1",
    kind: "shape",
    geometry: box(),
    brush: BRUSH,
    fill: false,
    ...overrides,
  };
}

let recording: RecordingDocument;

beforeEach(() => {
  recording = installRecordingDocument();
});

afterEach(() => {
  recording.restore();
});

function createHarness(elements: readonly LayerElement[] = []) {
  const display = new RecordingCanvas();
  const byLayer = new Map<LayerId, LayerElement[]>();
  const doc = createDocument({ name: "Shapes", width: 100, height: 80 });
  const layerId = doc.activeLayerId as LayerId;
  byLayer.set(layerId, [...elements]);

  const strokeSource: StrokeSource = {
    listStrokes: (id) => (byLayer.get(id) ?? []).filter(isStroke),
    listElements: (id) => byLayer.get(id) ?? [],
  };
  const renderer = new Canvas2DRenderer({
    canvas: display.asElement(),
    strokeSource,
    rasterScale: 1,
    // Never fires: each test calls `render()` explicitly so ordering is exact.
    scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
  });

  return {
    renderer,
    display,
    doc,
    layerId,
    /**
     * The layer surface: the canvas the display drew. The stroke buffer is a
     * scratch canvas the surface drew in turn, and it is where the outline's
     * path calls actually land.
     */
    layerSurface: () => display.drawnSources[0] as RecordingCanvas | undefined,
    strokeBuffer: () =>
      (display.drawnSources[0] as RecordingCanvas | undefined)?.drawnSources[0] as
        | RecordingCanvas
        | undefined,
    composeDocument: () => renderer.composeDocumentImage() as unknown as RecordingCanvas,
  };
}

/** The surface calls, with the stroke buffer's identity reduced to a token. */
function surfaceStream(surface: RecordingCanvas) {
  return surface.calls.map((call) => ({
    name: call.name,
    // Every stroke is rasterized into the same scratch buffer and then
    // composited, so the canvas object differs between two harnesses while
    // everything that describes the painting does not.
    args: call.name === "drawImage" ? ["stroke-buffer"] : call.args,
    alpha: call.alpha,
    composite: call.composite,
    fillStyle: call.fillStyle,
    strokeStyle: call.strokeStyle,
    lineWidth: call.lineWidth,
    lineDash: call.lineDash,
    filter: call.filter,
  }));
}

/** Renders one layer holding `elements` at 1:1 and returns the harness. */
function rendered(elements: readonly LayerElement[]) {
  const harness = createHarness(elements);
  harness.renderer.setDocument(harness.doc);
  harness.renderer.setDisplaySize(100, 80, 1);
  harness.renderer.render();
  return harness;
}

/** The scratch canvas the layer's elements are actually rasterized into. */
function strokeBufferOf(elements: readonly LayerElement[]): RecordingCanvas {
  const buffer = rendered(elements).strokeBuffer();
  if (!buffer) {
    throw new Error("the layer did not rasterize into a stroke buffer");
  }
  return buffer;
}

describe("rasterizing a native shape", () => {
  it("paints exactly the calls its derived stroke paints", () => {
    const native = shape();
    const derived = strokeFromShape(native);

    const shapeBuffer = strokeBufferOf([native]);
    const strokeBuffer = strokeBufferOf([derived]);
    expect(shapeBuffer.calls.length).toBeGreaterThan(0);
    expect(surfaceStream(shapeBuffer)).toEqual(surfaceStream(strokeBuffer));
  });

  it("paints every primitive, each as its own outline", () => {
    const shapes: ShapeRecord[] = [
      shape({ id: "line", geometry: { shape: "line", x1: 10, y1: 20, x2: 50, y2: 50 } }),
      shape({ id: "rectangle" }),
      shape({ id: "ellipse", geometry: box({ shape: "ellipse" }) }),
      shape({ id: "polygon", geometry: box({ shape: "polygon", sides: 7 }) }),
      shape({ id: "star", geometry: box({ shape: "star", sides: 6, innerRatio: 0.3 }) }),
    ];

    const streams = shapes.map((native) =>
      JSON.stringify(surfaceStream(strokeBufferOf([native]))),
    );
    // Every primitive goes through the one rasterizer, and no two outlines are
    // the same list of points.
    expect(new Set(streams).size).toBe(shapes.length);
    for (const [index, native] of shapes.entries()) {
      expect(streams[index]).toBe(
        JSON.stringify(surfaceStream(strokeBufferOf([strokeFromShape(native)]))),
      );
    }
  });

  it("fills the interior only when the shape is filled", () => {
    const outline = strokeBufferOf([shape({ id: "outline", fill: false })]);
    const filled = strokeBufferOf([shape({ id: "filled", fill: true })]);

    expect(outline.named("fill")).toHaveLength(0);
    expect(filled.named("fill").length).toBeGreaterThan(0);
  });

  it("uses the shape's own brush for colour, width and opacity", () => {
    const native = shape({
      brush: { ...BRUSH, color: "#aa3311", size: 16, opacity: 0.5 },
    });
    const harness = rendered([native]);

    // The outline is stroked at the brush's width, in its colour; the
    // composite carries the brush's opacity.
    const buffer = strokeBufferOf([native]);
    const path = buffer.named("stroke").find((call) => call.strokeStyle === "#aa3311");
    expect(path).toBeDefined();
    expect(path?.lineWidth).toBeCloseTo(16, 6);
    const composite = harness.layerSurface()?.named("drawImage")[0];
    expect(composite?.alpha).toBeCloseTo(0.5, 6);
  });

  it("keeps painting order with strokes and fills around it", () => {
    const stroke: StrokeRecord = {
      id: "stroke-1",
      layerId: "layer-1",
      brush: BRUSH,
      xs: [2, 4],
      ys: [2, 4],
      pressures: [1, 1],
      times: [0, 1],
      startTime: 0,
    };
    const before = strokeBufferOf([stroke, shape({ id: "second" })]);
    const after = strokeBufferOf([shape({ id: "first" }), { ...stroke, id: "stroke-2" }]);

    // The first outline drawn differs when the shape moves from the top of the
    // list to the bottom, so order is the document's, not the type's.
    const firstMove = (surface: RecordingCanvas) => surface.named("moveTo")[0]?.args;
    expect(firstMove(before)).not.toEqual(firstMove(after));
  });

  it("obeys the layer's visibility and opacity like any other element", () => {
    const native = shape();
    const hidden = createHarness([native]);
    hidden.renderer.setDocument(updateLayer(hidden.doc, hidden.layerId, { visible: false }));
    hidden.renderer.setDisplaySize(100, 80, 1);
    hidden.renderer.render();
    expect(hidden.display.drawnSources).toHaveLength(0);

    const translucent = createHarness([native]);
    translucent.renderer.setDocument(updateLayer(translucent.doc, translucent.layerId, { opacity: 0.4 }));
    translucent.renderer.setDisplaySize(100, 80, 1);
    translucent.renderer.render();
    const composite = translucent.display.named("drawImage")[0];
    expect(composite?.alpha).toBeCloseTo(0.4, 6);
  });
});

describe("the shape selection overlay", () => {
  function selectedHarness() {
    const native = shape();
    const harness = createHarness([native]);
    harness.renderer.setDocument(harness.doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.setSelection({
      bounds: null,
      strokes: [],
      outline: [
        { x: 10, y: 20 },
        { x: 50, y: 20 },
        { x: 50, y: 50 },
        { x: 10, y: 50 },
        { x: 10, y: 20 },
      ],
      frame: [
        { x: 10, y: 20 },
        { x: 50, y: 20 },
        { x: 50, y: 50 },
        { x: 10, y: 50 },
      ],
      handles: {
        corners: [
          { x: 10, y: 20 },
          { x: 50, y: 20 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        rotate: { x: 30, y: -4 },
      },
    });
    harness.display.calls.length = 0;
    harness.renderer.render();
    return harness;
  }

  it("traces the exact outline and a dashed frame in the accent colour", () => {
    const harness = selectedHarness();

    const accent = harness.display
      .named("stroke")
      .filter((call) => call.strokeStyle === SELECTION_COLOR);
    // The frame, the outline, and the rotation handle's stem.
    expect(accent).toHaveLength(3);
    expect(accent[0].lineDash).not.toEqual([]);
    expect(accent[1].lineDash).toEqual([]);
    expect(accent[1].lineWidth).toBeCloseTo(1.5, 6);
    expect(accent[2].lineDash).toEqual([]);

    // The outline's points are the record's, not a re-guess from pixels.
    const traced = harness.display.calls.filter(
      (call) => call.name === "lineTo" && call.strokeStyle === SELECTION_COLOR,
    );
    const points = traced.map((call) => call.args);
    expect(points).toContainEqual([50, 20]);
    expect(points).toContainEqual([10, 50]);
  });

  it("draws the handles above the artwork and never into the export", () => {
    const harness = selectedHarness();

    const fills = harness.display
      .named("fillRect")
      .filter((call) => call.args[2] === 8);
    expect(fills).toHaveLength(4);
    const arcs = harness.display.named("arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0].args[0]).toBe(30);
    expect(arcs[0].args[1]).toBe(-4);

    const composed = harness.composeDocument();
    expect(composed.named("stroke").filter((call) => call.strokeStyle === SELECTION_COLOR)).toHaveLength(0);
    expect(composed.named("fillRect").filter((call) => call.args[2] === 8)).toHaveLength(0);
    expect(composed.named("arc")).toHaveLength(0);
  });

  it("exports the shape itself, so the overlay is the only difference", () => {
    const withOverlay = selectedHarness();
    const without = createHarness([shape()]);
    without.renderer.setDocument(without.doc);
    without.renderer.setDisplaySize(100, 80, 1);

    // Both exports come from the same document content, so the composite is
    // identical; the overlay only ever lived on the display canvas.
    expect(surfaceStream(withOverlay.composeDocument())).toEqual(
      surfaceStream(without.composeDocument()),
    );
  });
});
