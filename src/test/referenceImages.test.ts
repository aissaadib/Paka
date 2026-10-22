/**
 * Reference images: the workspace overlay, its transform, and the colour the
 * picker reads from it.
 *
 * The suite runs in plain Node, so the browser's image decoder is replaced by
 * a stand-in that hands back a canvas with known pixels. That is enough to pin
 * down the rules that matter:
 *
 *  - the transform is in **workspace space** and is independent of the
 *    document: a reference is placed on the screen, not in the drawing;
 *  - the colour the picker reads is the pixel of the *decoded image* under the
 *    pointer, mapped through the reference's placement;
 *  - a reference never becomes document content: it does not dirty the
 *    document, it does not enter the history, and it never reaches an export.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import {
  decodeReferenceImage,
  MAX_REFERENCE_BYTES,
  MAX_REFERENCE_PIXELS,
  ReferenceDecodeError,
  type DecodedReference,
  type ReferenceDecodeEnvironment,
} from "../core/reference/decode";
import {
  fitReference,
  referenceContains,
  referenceScale,
  referenceSourcePoint,
  scaleReference,
  setReferenceScale,
} from "../core/reference/geometry";
import { ReferenceImageStore } from "../core/reference/store";
import type { ReferenceImage } from "../core/reference/types";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import type { DrawingRenderer, StrokeSource } from "../core/rendering/types";
import type { PointerSample } from "../types/pointer";
import {
  installRecordingDocument,
  RecordingCanvas,
  type RecordingDocument,
} from "./support/recordingCanvas";

/** A reference placed in the workspace, for the geometry tests. */
function reference(overrides: Partial<ReferenceImage> = {}): ReferenceImage {
  return {
    id: "reference-1",
    name: "sketch.png",
    x: 100,
    y: 50,
    width: 200,
    height: 100,
    naturalWidth: 400,
    naturalHeight: 200,
    visible: true,
    opacity: 1,
    ...overrides,
  };
}

/**
 * A decoded image with known pixels.
 *
 * The colour of the pixel at `(x, y)` is `(x, y, 0)`, so a test can say which
 * pixel it expects to be read by naming its coordinates.
 */
function fakeImage(width: number, height: number) {
  const reads: Array<[number, number]> = [];
  const context = {
    getImageData: (x: number, y: number, w: number, h: number) => {
      reads.push([x, y]);
      return {
        data: new Uint8ClampedArray([x & 255, y & 255, 0, 255]),
        width: w,
        height: h,
        colorSpace: "srgb",
      } as unknown as ImageData;
    },
    drawImage: () => {},
  } as unknown as CanvasRenderingContext2D;
  const canvas = { width, height } as unknown as HTMLCanvasElement;
  const decoded: DecodedReference = { width, height, canvas, context };
  return { decoded, reads };
}

/** A store whose decoder hands back a fixed image. */
function createStore(options: { width?: number; height?: number; fail?: boolean } = {}) {
  const image = fakeImage(options.width ?? 4, options.height ?? 4);
  const store = new ReferenceImageStore({
    decode: async () => {
      if (options.fail) {
        throw new ReferenceDecodeError("malformed", "The file could not be decoded as an image.");
      }
      return image.decoded;
    },
    createId: (() => {
      let counter = 0;
      return () => {
        counter += 1;
        return `reference-${counter}`;
      };
    })(),
  });
  return { store, image };
}

function createSample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    phase: "down",
    pointerId: 1,
    kind: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: 0,
    docY: 0,
    screenX: 0,
    screenY: 0,
    pressure: 1,
    hasPressure: false,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    ...overrides,
  };
}

/** A renderer that records what the engine asks of it. */
function createSpyRenderer(compositePixel: { r: number; g: number; b: number } | null = null) {
  const referenceOverlays: unknown[] = [];
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
    setRulers: () => {},
    setSymmetry: () => {},
    setReferenceOverlay: (overlay) => {
      referenceOverlays.push(overlay);
    },
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    renderOverview: () => null,
    readCompositePixel: () => compositePixel,
    readCompositeImage: () => null,
    render: () => {},
    requestRender: () => {},
    destroy: () => {},
  };
  return { renderer, referenceOverlays };
}

describe("the geometry of a reference", () => {
  it("maps a point on the screen to the pixel of the image under it", () => {
    // The image is drawn at half its own size, so every screen pixel covers
    // two image pixels.
    const image = reference();
    expect(referenceSourcePoint(image, 150, 75)).toEqual({ x: 100, y: 50 });
    expect(referenceSourcePoint(image, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(referenceSourcePoint(image, 299, 149)).toEqual({ x: 398, y: 198 });
  });

  it("has no pixel for a point outside the reference", () => {
    const image = reference();
    expect(referenceSourcePoint(image, 99, 75)).toBeNull();
    expect(referenceSourcePoint(image, 300, 75)).toBeNull();
    expect(referenceSourcePoint(image, 150, 150)).toBeNull();
  });

  it("knows which points it covers", () => {
    const image = reference();
    expect(referenceContains(image, 100, 50)).toBe(true);
    expect(referenceContains(image, 299.9, 149.9)).toBe(true);
    expect(referenceContains(image, 300, 150)).toBe(false);
  });

  it("scales about the anchor it is given", () => {
    const image = reference();
    const scaled = scaleReference(image, 2, { x: 100, y: 50 });
    expect(scaled.width).toBe(400);
    expect(scaled.height).toBe(200);
    // The anchor is the top-left corner here, so it stays where it was.
    expect(scaled.x).toBe(100);
    expect(scaled.y).toBe(50);
  });

  it("keeps the anchor in place when the scale is clamped", () => {
    const image = reference();
    const scaled = scaleReference(image, 0.0001, { x: 200, y: 100 });
    expect(scaled.width).toBeGreaterThan(0);
    // The centre of the reference is the anchor, and it does not move.
    expect(scaled.x + scaled.width / 2).toBeCloseTo(200);
    expect(scaled.y + scaled.height / 2).toBeCloseTo(100);
  });

  it("grows about its centre when the scale is set", () => {
    const image = reference();
    const scaled = setReferenceScale(image, 0.5);
    expect(scaled.width).toBe(200);
    expect(scaled.height).toBe(100);
    expect(scaled.x + scaled.width / 2).toBeCloseTo(image.x + image.width / 2);
    expect(scaled.y + scaled.height / 2).toBeCloseTo(image.y + image.height / 2);
  });

  it("fits into a view without distorting the image", () => {
    const image = reference({ naturalWidth: 400, naturalHeight: 200 });
    const fitted = fitReference(image, { width: 500, height: 500 }, 0);
    expect(fitted.width / fitted.height).toBeCloseTo(2);
    expect(fitted.width).toBe(500);
    expect(fitted.height).toBe(250);
    expect(fitted.x).toBe(0);
    expect(fitted.y).toBe(125);
  });

  it("reports how large it is drawn relative to its own pixels", () => {
    expect(referenceScale(reference())).toBe(0.5);
  });
});

describe("decoding an imported file", () => {
  /** A browser that decodes into a bitmap of a known size. */
  function fakeEnvironment(options: { width: number; height: number; fail?: boolean }) {
    const canvases: Array<{ width: number; height: number }> = [];
    const resizes: Array<[number, number]> = [];
    const closed: string[] = [];
    const environment: ReferenceDecodeEnvironment = {
      createBitmap: async () => {
        if (options.fail) {
          throw new Error("The blob is not an image.");
        }
        return {
          width: options.width,
          height: options.height,
          close: () => {
            closed.push("bitmap");
          },
        } as unknown as ImageBitmap;
      },
      resizeBitmap: async (_bitmap, width, height) => {
        resizes.push([width, height]);
        return {
          width,
          height,
          close: () => {
            closed.push("resized");
          },
        } as unknown as ImageBitmap;
      },
      createCanvas: (width, height) => {
        canvases.push({ width, height });
        const context = { drawImage: () => {} } as unknown as CanvasRenderingContext2D;
        return {
          width,
          height,
          getContext: () => context,
        } as unknown as HTMLCanvasElement;
      },
    };
    return { environment, canvases, resizes, closed };
  }

  it("refuses a file the browser cannot decode", async () => {
    const { environment } = fakeEnvironment({ width: 4, height: 4, fail: true });

    await expect(decodeReferenceImage(new Blob(["x"]), environment)).rejects.toBeInstanceOf(
      ReferenceDecodeError,
    );
    await expect(decodeReferenceImage(new Blob(["x"]), environment)).rejects.toMatchObject({
      reason: "malformed",
    });
  });

  it("refuses a file that is too large to be worth decoding", async () => {
    const { environment, canvases } = fakeEnvironment({ width: 4, height: 4 });
    const huge = { size: MAX_REFERENCE_BYTES + 1 } as unknown as Blob;

    await expect(decodeReferenceImage(huge, environment)).rejects.toMatchObject({
      reason: "too-large",
    });
    // Nothing was decoded: the file was refused before the decoder ran.
    expect(canvases).toHaveLength(0);
  });

  it("downscales an enormous image while it is decoded", async () => {
    const { environment, canvases, resizes, closed } = fakeEnvironment({
      width: 20_000,
      height: 20_000,
    });

    const decoded = await decodeReferenceImage(new Blob(["x"]), environment);

    expect(resizes).toHaveLength(1);
    const [width, height] = resizes[0];
    expect(width * height).toBeLessThanOrEqual(MAX_REFERENCE_PIXELS);
    // The aspect ratio survives the downscale.
    expect(width / height).toBeCloseTo(1);
    // The copy that is kept is the small one, and the transient bitmaps are
    // released: an enormous import does not leave the memory behind.
    expect(decoded.width).toBe(width);
    expect(canvases).toEqual([{ width, height }]);
    expect(closed.sort()).toEqual(["bitmap", "resized"]);
  });

  it("keeps a normal image at its own size", async () => {
    const { environment, canvases, resizes } = fakeEnvironment({ width: 320, height: 200 });

    const decoded = await decodeReferenceImage(new Blob(["x"]), environment);

    expect(decoded.width).toBe(320);
    expect(decoded.height).toBe(200);
    expect(resizes).toHaveLength(0);
    expect(canvases).toEqual([{ width: 320, height: 200 }]);
  });
});

describe("the reference store", () => {  it("imports an image and keeps exactly one decoded copy", async () => {
    const { store, image } = createStore({ width: 8, height: 8 });
    const added = await store.add({ blob: new Blob(["x"]), name: "sketch.png" });

    expect(added).toBe(true);
    const state = store.getState();
    expect(state.references).toHaveLength(1);
    expect(state.references[0].name).toBe("sketch.png");
    expect(state.selectedId).toBe(state.references[0].id);
    // The pixels come from the one decoded copy, and it is the same object
    // every time: nothing decodes the file twice.
    expect(store.sourceFor(state.references[0].id)).toBe(image.decoded.canvas);
    expect(store.sourceFor(state.references[0].id)).toBe(store.sourceFor(state.references[0].id));
  });

  it("refuses a file that cannot be decoded, and says why", async () => {
    const { store } = createStore({ fail: true });
    const added = await store.add({ blob: new Blob(["x"]), name: "broken.png" });

    expect(added).toBe(false);
    expect(store.getState().references).toHaveLength(0);
    expect(store.getState().notice).toContain("broken.png");
    expect(store.getState().notice).toContain("could not be decoded");
  });

  it("releases the pixels of a reference that is removed", async () => {
    const { store } = createStore();
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });
    const id = store.getState().references[0].id;

    store.remove(id);

    expect(store.getState().references).toHaveLength(0);
    expect(store.getState().selectedId).toBeNull();
    expect(store.sourceFor(id)).toBeNull();
  });

  it("hides a reference without removing it, and stops sampling it", async () => {
    const { store } = createStore();
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });
    const id = store.getState().references[0].id;
    const placed = store.getState().references[0];

    store.setVisible(id, false);

    expect(store.getState().references[0].visible).toBe(false);
    expect(store.hitTest(placed.x + 1, placed.y + 1)).toBeNull();
    expect(store.sampleAt(placed.x + 1, placed.y + 1)).toBeNull();
  });

  it("moves and scales a reference without touching anything else", async () => {
    const { store } = createStore();
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });
    const id = store.getState().references[0].id;
    const before = store.getState().references[0];

    store.move(id, 10, 20);
    expect(store.getState().references[0].x).toBe(before.x + 10);
    expect(store.getState().references[0].y).toBe(before.y + 20);

    store.setScale(id, 2);
    expect(store.getState().references[0].width).toBe(before.naturalWidth * 2);
  });

  it("samples the pixel under the pointer through the reference's placement", async () => {
    const { store, image } = createStore({ width: 40, height: 40 });
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });
    const id = store.getState().references[0].id;

    // Put the reference somewhere known and at a known size.
    store.setPosition(id, 100, 100);
    store.setSize(id, 80, 80);

    // The pointer is over the middle of the reference, which is the pixel
    // (20, 20) of a 40x40 image.
    const colour = store.sampleAt(140, 140);

    expect(colour).toEqual({ r: 20, g: 20, b: 0 });
    expect(image.reads).toContainEqual([20, 20]);
  });

  it("fits a reference into the workspace", async () => {
    const { store } = createStore({ width: 400, height: 200 });
    store.setViewportSize(1000, 800);
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });
    const id = store.getState().references[0].id;

    store.fitToView(id);

    const fitted = store.getState().references[0];
    // The image is as large as it can be without touching the edge, and it is
    // centred in the workspace.
    expect(fitted.width).toBe(1000 - 32);
    expect(fitted.height).toBe((200 / 400) * (1000 - 32));
    expect(fitted.x).toBe(16);
  });

  it("brings a reference in at its own size when the workspace is not known yet", async () => {
    const { store } = createStore({ width: 400, height: 200 });
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });

    const reference = store.getState().references[0];
    expect(reference.width).toBe(400);
    expect(reference.height).toBe(200);
  });

  it("refuses a reference that does not fit the session's budget", async () => {
    const store = new ReferenceImageStore({
      decode: async () => fakeImage(2000, 2000).decoded,
      createId: (() => {
        let counter = 0;
        return () => `reference-${++counter}`;
      })(),
    });
    // 2000 x 2000 is four megapixels; the budget is sixty-four.
    for (let index = 0; index < 20; index += 1) {
      await store.add({ blob: new Blob(["x"]), name: `image-${index}.png` });
    }

    expect(store.getState().references.length).toBeLessThan(20);
    expect(store.getState().notice).toContain("memory");
  });
});

describe("the colour picker and the references", () => {
  it("samples the reference under the pointer", async () => {
    const { store } = createStore({ width: 40, height: 40 });
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });
    const id = store.getState().references[0].id;
    store.setPosition(id, 100, 100);
    store.setSize(id, 80, 80);

    const { renderer } = createSpyRenderer({ r: 1, g: 2, b: 3 });
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer,
      referenceSource: store,
    });
    engine.setTool("picker");

    engine.handlePointerSample(createSample({ screenX: 140, screenY: 140 }));

    expect(engine.getState().brush.color).toBe("#141400");
    // The artwork was not even read: the reference was on top of it.
    expect(engine.getState().secondaryColor).not.toBe("#141400");
  });

  it("samples the background colour when Alt is held", async () => {
    const { store } = createStore({ width: 40, height: 40 });
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });
    const id = store.getState().references[0].id;
    store.setPosition(id, 0, 0);
    store.setSize(id, 80, 80);

    const { renderer } = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer,
      referenceSource: store,
    });
    engine.setTool("picker");
    const brushBefore = engine.getState().brush.color;

    engine.handlePointerSample(
      createSample({
        screenX: 20,
        screenY: 20,
        modifiers: { shift: false, alt: true, ctrl: false, meta: false },
      }),
    );

    expect(engine.getState().brush.color).toBe(brushBefore);
    // The pointer is over the middle of an 80x80 rendering of a 40x40 image,
    // so the pixel it reads is the one at (10, 10).
    expect(engine.getState().secondaryColor).toBe("#0a0a00");
  });

  it("falls back to the artwork when the pointer is not over a reference", async () => {
    const { store } = createStore({ width: 40, height: 40 });
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });
    const id = store.getState().references[0].id;
    store.setPosition(id, 0, 0);
    store.setSize(id, 80, 80);

    const { renderer } = createSpyRenderer({ r: 10, g: 20, b: 30 });
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer,
      referenceSource: store,
    });
    engine.setTool("picker");

    engine.handlePointerSample(createSample({ screenX: 300, screenY: 300, docX: 300, docY: 300 }));

    expect(engine.getState().brush.color).toBe("#0a141e");
  });

  it("never dirties the document", async () => {
    const { store } = createStore({ width: 40, height: 40 });
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });
    const id = store.getState().references[0].id;
    store.setPosition(id, 0, 0);
    store.setSize(id, 80, 80);

    const { renderer } = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer,
      referenceSource: store,
    });
    engine.setTool("picker");

    engine.handlePointerSample(createSample({ screenX: 20, screenY: 20 }));
    store.move(id, 5, 5);
    store.setOpacity(id, 0.5);
    store.setVisible(id, false);
    store.remove(id);

    expect(engine.getState().file.dirty).toBe(false);
    expect(engine.getState().history.canUndo).toBe(false);
  });

  it("asks for the magnifier cursor over a reference, and the crosshair elsewhere", async () => {
    const { store } = createStore({ width: 40, height: 40 });
    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });
    const id = store.getState().references[0].id;
    store.setPosition(id, 0, 0);
    store.setSize(id, 80, 80);

    const { renderer } = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer,
      referenceSource: store,
    });
    engine.setTool("picker");
    const cursors: string[] = [];
    engine.subscribeCursor((report) => {
      cursors.push(report.cursor);
    });

    engine.handlePointerSample(createSample({ phase: "move", screenX: 20, screenY: 20 }));
    engine.handlePointerSample(createSample({ phase: "move", screenX: 300, screenY: 300 }));

    // The magnifier says the press will read the reference; the crosshair is
    // the picker's own cursor over the artwork.
    expect(cursors).toEqual(["zoom-in", "crosshair"]);
  });

  it("asks the renderer for the overlay when the references change", async () => {    const { store } = createStore();
    const { renderer, referenceOverlays } = createSpyRenderer();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
      renderer,
      referenceSource: store,
    });

    await store.add({ blob: new Blob(["x"]), name: "sketch.png" });

    const last = referenceOverlays[referenceOverlays.length - 1] as {
      items: unknown[];
      selectedId: string | null;
    };
    expect(last.items).toHaveLength(1);
    expect(last.selectedId).toBe(store.getState().references[0].id);
    // The overlay is a display concern: the drawing is untouched by it.
    expect(engine.getState().file.dirty).toBe(false);
  });
});

describe("the reference overlay on the canvas", () => {
  let recording: RecordingDocument;

  beforeEach(() => {
    recording = installRecordingDocument();
  });

  afterEach(() => {
    recording.restore();
  });

  function createHarness() {
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
    renderer.setDocument(createDocument({ name: "Test", width: 200, height: 150 }));
    renderer.setDisplaySize(200, 150, 1);
    return { renderer, display };
  }

  it("is drawn on the display canvas", () => {
    const { renderer, display } = createHarness();
    const { decoded } = fakeImage(4, 4);

    renderer.setReferenceOverlay({
      items: [
        {
          reference: reference({ x: 10, y: 20, width: 40, height: 30 }),
          source: decoded.canvas,
        },
      ],
      selectedId: null,
      hoveredId: null,
    });
    renderer.render();

    const drawn = display.drawImages.filter((call) => call.args[0] === decoded.canvas);
    expect(drawn).toHaveLength(1);
    // The reference is placed in workspace pixels: its own rectangle, not a
    // document one.
    expect(drawn[0].args.slice(1)).toEqual([10, 20, 40, 30]);
  });

  it("never reaches the exported image", () => {
    const { renderer, display } = createHarness();
    const { decoded } = fakeImage(4, 4);

    renderer.setReferenceOverlay({
      items: [
        {
          reference: reference({ x: 10, y: 20, width: 40, height: 30 }),
          source: decoded.canvas,
        },
      ],
      selectedId: "reference-1",
      hoveredId: "reference-1",
    });
    renderer.render();

    const exported = renderer.composeDocumentImage() as unknown as RecordingCanvas;
    expect(exported.drawImages.filter((call) => call.args[0] === decoded.canvas)).toHaveLength(0);
    // The display canvas did draw it, so the overlay was not simply ignored.
    expect(display.drawImages.filter((call) => call.args[0] === decoded.canvas)).toHaveLength(1);
  });
});
