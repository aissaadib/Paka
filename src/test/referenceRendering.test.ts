/**
 * Reference images at the rendering seam.
 *
 * The suite runs in plain Node with a recording canvas, so these tests pin down
 * *what is painted where* rather than the final pixels: the draw calls, their
 * order, their alpha and their composite operation.
 *
 * Two invariants matter here and nowhere else:
 *
 *  1. **Paint order.** A "behind" reference is painted after the paper and
 *     before the layers; an "over" one after every layer.
 *  2. **Export isolation.** `composeDocumentImage()` - the PNG export path -
 *     never paints a reference and never paints the selection chrome. That is
 *     proved structurally: the export trace is identical with and without
 *     references, however they are placed, turned or hidden.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import type { DrawingDocument } from "../core/document/types";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import type { StrokeSource } from "../core/rendering/types";
import type { ReferenceImage } from "../core/reference/types";
import {
  RecordingCanvas,
  installRecordingDocument,
  type RecordingDocument,
} from "./support/recordingCanvas";

let recording: RecordingDocument;

beforeEach(() => {
  recording = installRecordingDocument();
});

afterEach(() => {
  recording.restore();
});

function reference(overrides: Partial<ReferenceImage> = {}): ReferenceImage {
  return {
    id: "reference-1",
    name: "sketch.png",
    x: 20,
    y: 10,
    width: 40,
    height: 20,
    naturalWidth: 400,
    naturalHeight: 200,
    rotation: 0,
    opacity: 1,
    blendMode: "normal",
    behind: false,
    visible: true,
    ...overrides,
  };
}

/** The source object a reference's picture is drawn from. */
function sourceFor(id: string): CanvasImageSource {
  return { kind: "reference-source", id } as unknown as CanvasImageSource;
}

function createHarness(references: readonly ReferenceImage[] = []) {
  const firstAllocation = recording.allocated.length;
  const display = new RecordingCanvas();
  const strokeSource: StrokeSource = {
    listStrokes: () => [],
    listElements: () => [],
  };
  const renderer = new Canvas2DRenderer({
    canvas: display.asElement(),
    strokeSource,
    rasterScale: 1,
    scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
  });

  const doc: DrawingDocument = { ...createDocument({ width: 100, height: 80 }), references };
  renderer.setDocument(doc);
  renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
  renderer.setDisplaySize(100, 80, 1);

  const sources = new Map<string, CanvasImageSource>();
  for (const item of references) {
    sources.set(item.id, sourceFor(item.id));
  }
  renderer.setReferenceSources(sources);

  return {
    renderer,
    display,
    doc,
    sources,
    /** The layer surfaces, in allocation order (the stroke buffer is first). */
    layerSurfaces: () => recording.allocated.slice(firstAllocation + 1),
  };
}

/** A draw call with canvas arguments replaced by stable tokens. */
function trace(canvas: RecordingCanvas, allocated: readonly RecordingCanvas[]) {
  return canvas.calls.map((call) => ({
    name: call.name,
    args: call.args.map((argument) => {
      if (argument instanceof RecordingCanvas) {
        return `canvas:${allocated.indexOf(argument)}`;
      }
      return argument;
    }),
    alpha: call.alpha,
    composite: call.composite,
  }));
}

function allocatedCanvases(): RecordingCanvas[] {
  return [...recording.allocated];
}

describe("painting references", () => {
  it("paints a behind reference after the paper and before the layers", () => {
    const behind = reference({ behind: true });
    const harness = createHarness([behind]);

    harness.renderer.render();

    const calls = harness.display.calls;
    const paper = calls.findIndex((call) => call.name === "fillRect");
    const surfaces = harness.layerSurfaces();
    const referenceIndex = calls.findIndex(
      (call) => call.name === "drawImage" && call.args[0] === harness.sources.get(behind.id),
    );
    const firstLayer = calls.findIndex(
      (call) => call.name === "drawImage" && surfaces.includes(call.args[0] as RecordingCanvas),
    );

    expect(paper).toBeGreaterThanOrEqual(0);
    expect(referenceIndex).toBeGreaterThan(paper);
    expect(firstLayer).toBeGreaterThan(referenceIndex);
  });

  it("paints an over reference after every layer", () => {
    const over = reference();
    const harness = createHarness([over]);

    harness.renderer.render();

    const drawn = harness.display.drawnSources;
    const referenceIndex = drawn.indexOf(harness.sources.get(over.id));
    expect(referenceIndex).toBe(drawn.length - 1);
    expect(referenceIndex).toBeGreaterThan(drawn.indexOf(harness.layerSurfaces()[0]));
  });

  it("paints both sides when references are on both", () => {
    const behind = reference({ id: "behind", behind: true });
    const over = reference({ id: "over" });
    const harness = createHarness([behind, over]);

    harness.renderer.render();

    const drawn = harness.display.drawnSources;
    expect(drawn.indexOf(harness.sources.get("behind"))).toBeLessThan(
      drawn.indexOf(harness.layerSurfaces()[0]),
    );
    expect(drawn.indexOf(harness.sources.get("over"))).toBeGreaterThan(
      drawn.indexOf(harness.layerSurfaces()[0]),
    );
  });

  it("clips the reference pass to the paper", () => {
    const harness = createHarness([reference()]);

    harness.renderer.render();

    const clip = harness.display.named("clip");
    expect(clip).toHaveLength(1);
    const clipRect = harness.display.named("rect").find((call) => call.args[2] === 100);
    expect(clipRect?.args).toEqual([0, 0, 100, 80]);
  });

  it("turns the picture about its centre, in document space", () => {
    const harness = createHarness([reference({ rotation: 90 })]);

    harness.renderer.render();

    const translates = harness.display.named("translate");
    // The reference pass centres the transform on the picture.
    expect(translates[translates.length - 1]?.args).toEqual([40, 20]);
    const rotates = harness.display.named("rotate");
    const rotate = rotates[rotates.length - 1];
    expect(rotate?.args[0]).toBeCloseTo(Math.PI / 2, 10);
  });

  it("applies the reference's opacity and blend mode", () => {
    const harness = createHarness([
      reference({ opacity: 0.25, blendMode: "multiply" }),
    ]);

    harness.renderer.render();

    const drawn = harness.display
      .named("drawImage")
      .find((call) => call.args[0] === harness.sources.get("reference-1"));
    expect(drawn?.alpha).toBe(0.25);
    expect(drawn?.composite).toBe("multiply");
  });

  it("draws nothing for a hidden reference", () => {
    const harness = createHarness([reference({ visible: false })]);

    harness.renderer.render();

    expect(harness.display.drawnSources).not.toContain(harness.sources.get("reference-1"));
  });

  it("draws nothing for a reference whose picture has not decoded yet", () => {
    const harness = createHarness([reference()]);
    harness.renderer.setReferenceSources(new Map());

    harness.renderer.render();

    expect(harness.display.drawnSources).not.toContain(harness.sources.get("reference-1"));
    // The paper and the layers are still there: an undecoded picture is not an
    // error, it is simply not painted.
    expect(harness.display.named("fillRect")).toHaveLength(1);
  });

  it("frames the selected reference on the display canvas only", () => {
    const harness = createHarness([reference()]);
    harness.renderer.setSelectedReference("reference-1");

    harness.renderer.render();

    // Four corner handles, each a filled and stroked square, plus the rotation
    // handle drawn as an arc.
    const squares = harness.display
      .named("rect")
      .filter((call) => call.args[2] === 8 && call.args[3] === 8);
    expect(squares).toHaveLength(4);
    expect(harness.display.named("arc")).toHaveLength(1);
  });
});

describe("export isolation", () => {
  it("never paints a reference into the exported composite", () => {
    const harness = createHarness([reference()]);

    const exported = harness.renderer.composeDocumentImage() as unknown as RecordingCanvas;

    expect(exported.drawnSources).not.toContain(harness.sources.get("reference-1"));
    // The layers are still exported: this is a reference exclusion, not an
    // empty export.
    expect(exported.drawnSources.length).toBeGreaterThan(0);
  });

  it("never paints the selection chrome into the exported composite", () => {
    const harness = createHarness([reference()]);
    harness.renderer.setSelectedReference("reference-1");

    const exported = harness.renderer.composeDocumentImage() as unknown as RecordingCanvas;

    expect(exported.named("arc")).toHaveLength(0);
    expect(exported.named("clip")).toHaveLength(0);
    expect(exported.named("translate")).toHaveLength(0);
    expect(exported.named("rotate")).toHaveLength(0);
  });

  it("exports the very same image whatever the references do", () => {
    const harness = createHarness([reference()]);

    harness.renderer.render();
    const before = trace(
      harness.renderer.composeDocumentImage() as unknown as RecordingCanvas,
      allocatedCanvases(),
    );

    // Move it, turn it, make it translucent, put it behind the artwork and
    // then hide it: none of that is artwork, so none of it may change the PNG.
    const moved: ReferenceImage = {
      ...reference(),
      x: 61,
      y: 33,
      rotation: 37,
      opacity: 0.4,
      behind: true,
    };
    harness.renderer.setDocument({ ...harness.doc, references: [moved] });
    harness.renderer.setReferenceSources(
      new Map([["reference-1", harness.sources.get("reference-1") as CanvasImageSource]]),
    );
    harness.renderer.render();
    const afterMove = trace(
      harness.renderer.composeDocumentImage() as unknown as RecordingCanvas,
      allocatedCanvases(),
    );

    harness.renderer.setDocument({
      ...harness.doc,
      references: [{ ...moved, visible: false }],
    });
    harness.renderer.render();
    const afterHide = trace(
      harness.renderer.composeDocumentImage() as unknown as RecordingCanvas,
      allocatedCanvases(),
    );

    harness.renderer.setDocument({ ...harness.doc, references: [] });
    harness.renderer.render();
    const afterRemove = trace(
      harness.renderer.composeDocumentImage() as unknown as RecordingCanvas,
      allocatedCanvases(),
    );

    expect(afterMove).toEqual(before);
    expect(afterHide).toEqual(before);
    expect(afterRemove).toEqual(before);
  });
});
