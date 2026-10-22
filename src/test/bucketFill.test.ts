/**
 * Bucket-fill engine tests.
 *
 * These run without a canvas: the engine takes a renderer that records what it
 * is asked for, so the *seam* is testable in plain Node - which layers the
 * bucket samples, what a cancelled press leaves behind, and what a no-op fill
 * does to the history and the dirty flag.
 *
 * The pixels themselves are covered by `fillScan.test.ts`; the renderer's own
 * compositing is covered by `canvas2dRenderer.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createDocument } from "../core/document/document";
import { isFillPatch } from "../core/document/types";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { parseProject } from "../core/project/projectFormat";
import type {
  CompositeReadOptions,
  DrawingRenderer,
  RendererSelection,
  Rgb,
} from "../core/rendering/types";
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

/** A white field with a black frame, so a fill has a bounded region. */
function framedComposite(width = 20, height = 20): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      data[offset] = border ? 0 : 255;
      data[offset + 1] = border ? 0 : 255;
      data[offset + 2] = border ? 0 : 255;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

/** A renderer that records what the engine asks of it. */
function createSpyRenderer(composite: ImageData | null) {
  const invalidated: string[] = [];
  const reads: CompositeReadOptions[] = [];
  let renders = 0;

  const renderer: DrawingRenderer = {
    kind: "canvas2d",
    setDocument: () => {},
    setViewport: () => {},
    setDisplaySize: () => {},
    setRasterScale: () => {},
    invalidateLayer: (layerId: string) => {
      invalidated.push(layerId);
    },
    beginStroke: (_stroke: StrokeRecord) => {},
    extendStroke: () => {},
    replaceStroke: () => {},
    endStroke: () => {},
    cancelStroke: () => {},
    setSelection: (_selection: RendererSelection | null) => {},
    setGradientOverlay: () => {},
    setSelectedGuide: () => {},
    setGrid: () => {},
    setRulers: () => {},
    setSymmetry: () => {},
    setReferenceOverlay: () => {},
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    renderOverview: () => null,
    readCompositePixel: (_x: number, _y: number): Rgb | null => null,
    readCompositeImage: (options?: CompositeReadOptions) => {
      reads.push(options ?? {});
      return composite;
    },
    render: () => {},
    requestRender: () => {
      renders += 1;
    },
    destroy: () => {},
  } as unknown as DrawingRenderer;

  return {
    renderer,
    invalidated,
    reads,
    getRenders: () => renders,
  };
}

function createBucketEngine(composite: ImageData | null = framedComposite()) {
  const spy = createSpyRenderer(composite);
  const engine = new DrawingEngine({
    document: createDocument({ name: "Test", width: 20, height: 20 }),
    renderer: spy.renderer,
    brush: { ...DEFAULT_BRUSH, color: "#ff0000" },
  });
  engine.setTool("bucket");
  return { engine, spy };
}

function pressBucket(engine: DrawingEngine, docX: number, docY: number): void {
  engine.handlePointerSample(
    createSample({ phase: "down", docX, docY, button: 0, buttons: 1 }),
  );
}

function releaseBucket(engine: DrawingEngine, docX: number, docY: number): void {
  engine.handlePointerSample(
    createSample({ phase: "up", docX, docY, button: 0, buttons: 0 }),
  );
}

describe("the bucket's reference mode", () => {
  it("samples every visible layer by default", () => {
    const { engine, spy } = createBucketEngine();

    pressBucket(engine, 10, 10);

    expect(spy.reads).toHaveLength(1);
    expect(spy.reads[0].layerIds ?? null).toBeNull();
  });

  it("samples the active layer alone in the active mode", () => {
    const { engine, spy } = createBucketEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setFillReference("active");
    pressBucket(engine, 10, 10);

    expect(spy.reads[0].layerIds).toEqual([layerId]);
  });

  it("samples one chosen layer in the layer mode", () => {
    const { engine, spy } = createBucketEngine();
    engine.addLayer();
    const layers = engine.getState().document.layers;
    const chosen = layers[layers.length - 1].id;

    engine.setFillReference("layer");
    engine.setFillReferenceLayer(chosen);
    pressBucket(engine, 10, 10);

    expect(spy.reads[0].layerIds).toEqual([chosen]);
  });

  it("falls back to the active layer when no layer is chosen", () => {
    const { engine, spy } = createBucketEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setFillReference("layer");
    pressBucket(engine, 10, 10);

    expect(spy.reads[0].layerIds).toEqual([layerId]);
  });

  it("refuses to sample a hidden layer and says so", () => {
    const { engine, spy } = createBucketEngine();
    engine.addLayer();
    const layers = engine.getState().document.layers;
    const hidden = layers[layers.length - 1].id;

    engine.setFillReference("layer");
    engine.setFillReferenceLayer(hidden);
    engine.toggleLayerVisibility(hidden);
    const depthBefore = engine.getState().history.depth;

    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);

    expect(spy.reads).toHaveLength(0);
    expect(engine.getState().notice).toContain("hidden");
    // The refused press adds no history step and does not dirty the drawing.
    expect(engine.getState().history.depth).toBe(depthBefore);
  });

  it("remembers the reference as editor state, not document state", () => {
    const { engine } = createBucketEngine();

    engine.setFillReference("active");
    engine.setFillExpand(4);

    expect(engine.getState().fillReference).toBe("active");
    expect(engine.getState().fillExpand).toBe(4);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });
});

describe("the bucket's options", () => {
  it("grows the region it fills", () => {
    const { engine } = createBucketEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setFillExpand(3);
    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);

    const patch = engine.listElements(layerId)[0];
    // The frame is one pixel in, so the region is 18x18 and three pixels of
    // growth make it 24x24 - clipped by the 20x20 canvas.
    expect(isFillPatch(patch) && patch.width).toBe(20);
    expect(isFillPatch(patch) && patch.height).toBe(20);
  });

  it("shrinks the region it fills", () => {
    const { engine } = createBucketEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setFillExpand(-3);
    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);

    const patch = engine.listElements(layerId)[0];
    expect(isFillPatch(patch) && patch.width).toBe(12);
    expect(isFillPatch(patch) && patch.height).toBe(12);
  });

  it("softens the edge of the region it fills", () => {
    const { engine } = createBucketEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setFillAntialias(2);
    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);

    const patch = engine.listElements(layerId)[0];
    if (!isFillPatch(patch)) {
      throw new Error("the fill did not commit a patch.");
    }
    // The soft edge reaches outside the region, and the coverage is a ramp
    // rather than a step.
    expect(patch.width).toBeGreaterThan(18);
    const values = new Set(patch.mask);
    expect(values.size).toBeGreaterThan(2);
    expect([...values].every((value) => value > 0 && value <= 255)).toBe(true);
  });

  it("clamps the growth to the supported range", () => {
    const { engine } = createBucketEngine();

    engine.setFillExpand(999);
    expect(engine.getState().fillExpand).toBe(32);
    engine.setFillExpand(-999);
    expect(engine.getState().fillExpand).toBe(-32);
    engine.setFillAntialias(999);
    expect(engine.getState().fillAntialias).toBe(8);
    engine.setFillCloseGaps(999);
    expect(engine.getState().fillCloseGaps).toBe(16);
  });
});

describe("a bucket press", () => {
  it("records one undo step and dirties the document", () => {
    const { engine, spy } = createBucketEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);
    expect(engine.listElements(layerId)).toHaveLength(1);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);

    releaseBucket(engine, 10, 10);
    expect(engine.getState().history.depth).toBe(1);
    expect(engine.getState().file.dirty).toBe(true);
    expect(spy.invalidated).toContain(layerId);
  });

  it("undoes and redoes the committed pixels without scanning again", () => {
    const { engine, spy } = createBucketEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);
    const patch = engine.listElements(layerId)[0];

    expect(engine.undo()).toBe(true);
    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.canRedo).toBe(true);

    const readsBeforeRedo = spy.reads.length;
    expect(engine.redo()).toBe(true);
    expect(engine.listElements(layerId)[0]).toBe(patch);
    expect(spy.reads).toHaveLength(readsBeforeRedo);
  });

  it("leaves no history and no dirty flag when the press is cancelled", () => {
    const { engine } = createBucketEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);
    engine.handlePointerSample(
      createSample({ phase: "cancel", docX: 10, docY: 10, button: 0, buttons: 0 }),
    );

    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("leaves no history and no dirty flag when the fill changes nothing", () => {
    // The composite is already the fill colour, so the fill would be invisible.
    const red = framedComposite();
    for (let index = 0; index < red.data.length; index += 4) {
      red.data[index] = 255;
      red.data[index + 1] = 0;
      red.data[index + 2] = 0;
    }
    const { engine } = createBucketEngine(red);
    const layerId = engine.getState().document.activeLayerId as string;

    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);

    expect(engine.listElements(layerId)).toEqual([]);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("does nothing when the press is outside the paper", () => {
    const { engine, spy } = createBucketEngine();

    pressBucket(engine, -5, -5);
    releaseBucket(engine, -5, -5);

    expect(spy.reads).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });
});

describe("a soft-edged fill in a project file", () => {
  it("survives a save and a reopen without a format change", () => {
    const { engine } = createBucketEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setFillAntialias(2);
    pressBucket(engine, 10, 10);
    releaseBucket(engine, 10, 10);

    const patch = engine.listElements(layerId)[0];
    if (!isFillPatch(patch)) {
      throw new Error("the fill did not commit a patch.");
    }
    // The patch carries a ramp, not a step.
    expect(new Set(patch.mask).size).toBeGreaterThan(2);

    const parsed = parseProject(engine.serialize());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const elements = parsed.project.elements;
    expect(elements).toHaveLength(1);
    const reopened = elements[0];
    if (!isFillPatch(reopened)) {
      throw new Error("the reopened element is not a fill patch.");
    }
    // The coverage bytes are the same ones the user saw.
    expect([...reopened.mask]).toEqual([...patch.mask]);
  });
});
