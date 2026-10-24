/**
 * Reference images: the model, the geometry, the store and the decoder.
 *
 * The slice is deliberately DOM-free: the placement, the clipping and the
 * store's ordering are pure functions of the document, and the decoder's
 * rules are behind an injectable environment, so all of it is exercised here
 * without a canvas and without a browser.
 *
 * The rules the whole slice rests on are tested as well:
 *
 *  - a reference is **anchored to the document**, so it sits over the same
 *    artwork at every zoom and on every window size;
 *  - a reference is **clipped to the paper**, so it never hangs out over the
 *    edge of the document;
 *  - a reference is **display only**: it is not a layer element, so it can
 *    never reach a layer surface or a PNG export;
 *  - a file that is **not an image is refused**, rather than crashing the
 *    import.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_REFERENCE_SIZE,
  clipRectToDocument,
  fitReferenceToDocument,
  moveReference,
  referenceContains,
  referenceRect,
  referenceScale,
  referenceScreenRect,
  referenceSourcePoint,
  referenceVisibleContains,
  referenceVisibleRect,
  scaleReference,
  setReferenceOpacity,
  setReferencePosition,
  setReferenceSize,
} from "../core/reference/geometry";
import {
  MAX_REFERENCE_BYTES,
  MAX_REFERENCE_PIXELS,
  MAX_TOTAL_REFERENCE_PIXELS,
  ReferenceDecodeError,
  decodeReferenceImage,
  detectImageFormat,
  referenceImageExtensions,
  referenceMimeType,
  type DecodedReference,
  type ReferenceDecodeEnvironment,
} from "../core/reference/decode";
import {
  ReferenceImageStore,
  createReferenceImage,
  type ReferenceStoreOutcome,
} from "../core/reference/store";
import type { ReferenceImage } from "../core/reference/types";
import type { DrawingDocument, LayerElement } from "../core/document/types";

const PAPER = { width: 800, height: 600 };

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
    rotation: 0,
    opacity: 1,
    blendMode: "normal",
    behind: false,
    visible: true,
    ...overrides,
  };
}

/** A decoder that answers without touching a browser. */
function environment(
  answer: (bytes: Uint8Array, mimeType: string) => Promise<DecodedReference>,
): ReferenceDecodeEnvironment & { calls: number } {
  const wrapper = {
    calls: 0,
    decodeImage: async (bytes: Uint8Array, mimeType: string) => {
      wrapper.calls += 1;
      return answer(bytes, mimeType);
    },
  };
  return wrapper;
}

/** A picture of a given size, drawn by nothing. */
function picture(width: number, height: number): DecodedReference {
  return { width, height, source: {} as CanvasImageSource };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const BMP_BYTES = new Uint8Array([0x42, 0x4d, 0, 0]);
const TEXT_BYTES = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20]); // "hello "

describe("the reference model", () => {
  it("holds a placement, a rotation, an opacity, a blend mode and a side of the drawing", () => {
    expect(Object.keys(reference()).sort()).toEqual([
      "behind",
      "blendMode",
      "height",
      "id",
      "name",
      "naturalHeight",
      "naturalWidth",
      "opacity",
      "rotation",
      "visible",
      "width",
      "x",
      "y",
    ]);
  });

  it("starts fully opaque, over the artwork and drawn with the normal blend", () => {
    const created = createReferenceImage(
      { name: "photo.jpg", naturalWidth: 1200, naturalHeight: 800 },
      () => "reference-1",
    );
    expect(created.opacity).toBe(1);
    expect(created.blendMode).toBe("normal");
    expect(created.behind).toBe(false);
    expect(created.visible).toBe(true);
  });

  it("places a new reference on the paper at its natural size", () => {
    const created = createReferenceImage(
      { name: "photo.jpg", naturalWidth: 1200, naturalHeight: 800 },
      () => "reference-1",
    );
    expect(created.x).toBe(0);
    expect(created.y).toBe(0);
    expect(created.width).toBe(1200);
    expect(created.height).toBe(800);
  });

  it("is the same record every time, for the same inputs", () => {
    const options = { name: "photo.jpg", naturalWidth: 1200, naturalHeight: 800 };
    expect(createReferenceImage(options, () => "reference-1")).toEqual(
      createReferenceImage(options, () => "reference-1"),
    );
  });

  it("is display only: it is not a layer element, so it cannot reach a surface", () => {
    // The check is made at compile time. If the reference model were ever
    // merged with the layer model, this file would stop compiling.
    const acceptsLayerElement = (_element: LayerElement): void => undefined;
    // @ts-expect-error a reference image is not a layer element
    acceptsLayerElement(reference());
    expect(true).toBe(true);
  });

  it("is document metadata: it travels with the document but is never a layer", () => {
    // The two halves of the contract. A reference is document state - it is
    // saved and undone with the document - but it is not layer content: it is
    // never rasterized into a surface, so it cannot reach the artwork or an
    // export. If the models were ever merged, this file would stop compiling.
    const document: DrawingDocument["references"] = [reference()];
    expect(document).toHaveLength(1);
    const acceptsLayerElement = (_element: LayerElement): void => undefined;
    // @ts-expect-error a reference image is not a layer element
    acceptsLayerElement(reference());
    expect(true).toBe(true);
  });
});

describe("the geometry of a reference", () => {
  it("sits where it was put, in document coordinates", () => {
    expect(referenceRect(reference())).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });

  it("keeps its document rectangle at every zoom", () => {
    const placed = reference();
    const before = referenceRect(placed);
    // The model holds no viewport at all: the rectangle cannot drift.
    expect(referenceRect(placed)).toEqual(before);
    expect(before).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });

  it("moves with the paper and scales with it when the viewport changes", () => {
    const placed = reference();
    const atOne = referenceScreenRect(placed, { zoom: 1, offsetX: 0, offsetY: 0 });
    expect(atOne).toEqual({ x: 100, y: 50, width: 200, height: 100 });

    const zoomed = referenceScreenRect(placed, { zoom: 2, offsetX: 30, offsetY: -10 });
    expect(zoomed).toEqual({ x: 230, y: 90, width: 400, height: 200 });
  });

  it("is clipped to the paper", () => {
    const overhanging = reference({ x: 700, y: 500, width: 400, height: 400 });
    expect(referenceVisibleRect(overhanging, PAPER)).toEqual({
      x: 700,
      y: 500,
      width: 100,
      height: 100,
    });
  });

  it("is clipped on the top left as well", () => {
    const overhanging = reference({ x: -50, y: -50, width: 200, height: 200 });
    expect(referenceVisibleRect(overhanging, PAPER)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 150,
    });
  });

  it("is not drawn at all when it lies off the paper", () => {
    expect(referenceVisibleRect(reference({ x: 900, y: 20 }), PAPER)).toBeNull();
    expect(clipRectToDocument({ x: 900, y: 20, width: 100, height: 100 }, PAPER)).toBeNull();
  });

  it("keeps the whole paper when it covers it exactly", () => {
    const covering = reference({ x: 0, y: 0, width: 800, height: 600 });
    expect(referenceVisibleRect(covering, PAPER)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });

  it("is only on the paper where it is drawn", () => {
    const overhanging = reference({ x: 700, y: 0, width: 400, height: 100 });
    expect(referenceVisibleContains(overhanging, 750, 50, PAPER)).toBe(true);
    expect(referenceVisibleContains(overhanging, 900, 50, PAPER)).toBe(false);
    // The placed rectangle does contain the overhang, but the overhang is not
    // drawn, so it is not the reference.
    expect(referenceContains(overhanging, 900, 50)).toBe(true);
  });

  it("names the picture pixel under a document point", () => {
    const placed = reference({ x: 0, y: 0, width: 200, height: 100 });
    expect(referenceSourcePoint(placed, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(referenceSourcePoint(placed, 50, 25)).toEqual({ x: 100, y: 50 });
    expect(referenceSourcePoint(placed, 199, 99)).toEqual({ x: 398, y: 198 });
    expect(referenceSourcePoint(placed, 200, 0)).toBeNull();
    expect(referenceSourcePoint(placed, -1, 0)).toBeNull();
  });

  it("reports how large it is drawn relative to its own pixels", () => {
    expect(referenceScale(reference())).toBe(0.5);
    expect(referenceScale(reference({ width: 400, naturalWidth: 400 }))).toBe(1);
  });

  it("moves by a document delta and to an absolute position", () => {
    expect(moveReference(reference(), 10, -20)).toMatchObject({ x: 110, y: 30 });
    expect(setReferencePosition(reference(), 5, 5)).toMatchObject({ x: 5, y: 5 });
  });

  it("keeps its aspect ratio when it is scaled about an anchor", () => {
    const scaled = scaleReference(reference(), 2, { x: 100, y: 50 });
    expect(scaled.width).toBe(400);
    expect(scaled.height).toBe(200);
    // The anchor is the top left corner here, so it does not move.
    expect(scaled.x).toBe(100);
    expect(scaled.y).toBe(50);
  });

  it("grows around an anchor in the middle", () => {
    const scaled = scaleReference(reference(), 2, { x: 200, y: 100 });
    expect(scaled.x).toBe(0);
    expect(scaled.y).toBe(0);
    expect(scaled.width).toBe(400);
    expect(scaled.height).toBe(200);
  });

  it("is never scaled away to nothing", () => {
    const scaled = scaleReference(reference(), 0.001, { x: 100, y: 50 });
    // The longest side is clamped, so the reference can still be grabbed; the
    // sides keep their ratio, so the shorter one follows it down.
    expect(scaled.width).toBeCloseTo(MIN_REFERENCE_SIZE);
    expect(scaled.height).toBeCloseTo(MIN_REFERENCE_SIZE / 2);
  });

  it("ignores a scale that is not a number", () => {
    const placed = reference();
    expect(scaleReference(placed, Number.NaN, { x: 0, y: 0 })).toBe(placed);
    expect(scaleReference(placed, 0, { x: 0, y: 0 })).toBe(placed);
  });

  it("never shrinks below the smallest usable size", () => {
    const sized = setReferenceSize(reference(), 0, -10);
    expect(sized.width).toBe(MIN_REFERENCE_SIZE);
    expect(sized.height).toBe(MIN_REFERENCE_SIZE);
  });

  it("keeps its size when the new one is not a number", () => {
    const sized = setReferenceSize(reference(), Number.NaN, Number.POSITIVE_INFINITY);
    expect(sized.width).toBe(200);
    expect(sized.height).toBe(100);
  });

  it("clamps the opacity into 0..1", () => {
    expect(setReferenceOpacity(reference(), 2).opacity).toBe(1);
    expect(setReferenceOpacity(reference(), -1).opacity).toBe(0);
    expect(setReferenceOpacity(reference(), 0.25).opacity).toBe(0.25);
  });

  it("fits the whole picture on the paper, centred and undistorted", () => {
    const fitted = fitReferenceToDocument(
      reference({ naturalWidth: 1600, naturalHeight: 1200, width: 1600, height: 1200 }),
      PAPER,
    );
    expect(fitted.width).toBe(800);
    expect(fitted.height).toBe(600);
    expect(fitted.x).toBe(0);
    expect(fitted.y).toBe(0);
  });
});

describe("the reference store", () => {
  it("starts empty", () => {
    const store = new ReferenceImageStore();
    expect(store.list()).toEqual([]);
    expect(store.count()).toBe(0);
    expect(store.find("reference-1")).toBeNull();
  });

  it("adds a reference on top of the others", () => {
    const store = new ReferenceImageStore();
    store.add(reference({ id: "a" }));
    store.add(reference({ id: "b" }));
    expect(store.list().map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("keeps the list in the drawing order: the last one is on top", () => {
    const store = new ReferenceImageStore();
    store.add(reference({ id: "a" }));
    store.add(reference({ id: "b" }));
    store.add(reference({ id: "c" }));
    expect(store.indexOf("c")).toBe(2);
    // Moving the first one to the top brings it in front of the others.
    expect(store.reorder("a", 2)).toBe(true);
    expect(store.list().map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("clamps a reorder to the list", () => {
    const store = new ReferenceImageStore();
    store.add(reference({ id: "a" }));
    store.add(reference({ id: "b" }));
    expect(store.reorder("a", 99)).toBe(true);
    expect(store.list().map((item) => item.id)).toEqual(["b", "a"]);
    expect(store.reorder("a", 99)).toBe(false);
    expect(store.reorder("missing", 0)).toBe(false);
  });

  it("separates the references behind the artwork from the ones over it", () => {
    const store = new ReferenceImageStore();
    store.add(reference({ id: "over-1" }));
    store.add(reference({ id: "under-1", behind: true }));
    store.add(reference({ id: "over-2" }));
    expect(store.behind().map((item) => item.id)).toEqual(["under-1"]);
    expect(store.over().map((item) => item.id)).toEqual(["over-1", "over-2"]);
  });

  it("removes a reference and releases its pixels", () => {
    const store = new ReferenceImageStore();
    const outcome = store.add(reference({ id: "a" }), picture(100, 100));
    expect(outcome.ok).toBe(true);
    expect(store.decodedPixelCount()).toBe(10_000);
    expect(store.remove("a")).not.toBeNull();
    expect(store.count()).toBe(0);
    expect(store.decodedPixelCount()).toBe(0);
    expect(store.sourceFor("a")).toBeNull();
    expect(store.remove("a")).toBeNull();
  });

  it("keeps a reference's place when it is changed", () => {
    const store = new ReferenceImageStore();
    store.add(reference({ id: "a" }));
    store.add(reference({ id: "b" }));
    expect(store.update("b", { opacity: 0.5, behind: true })).toBe(true);
    expect(store.list().map((item) => item.id)).toEqual(["a", "b"]);
    expect(store.find("b")).toMatchObject({ opacity: 0.5, behind: true });
  });

  it("hands the decoded picture to the renderer and no more", () => {
    const store = new ReferenceImageStore();
    const decoded = picture(64, 32);
    store.add(reference({ id: "a" }), decoded);
    expect(store.sourceFor("a")).toBe(decoded.source);
    expect(store.decodedFor("a")).toBe(decoded);
    expect(store.sourceFor("missing")).toBeNull();
  });

  it("refuses a second reference with the same id", () => {
    const store = new ReferenceImageStore();
    store.add(reference({ id: "a" }));
    const outcome = store.add(reference({ id: "a" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("duplicate");
    }
    expect(store.count()).toBe(1);
  });

  it("refuses a picture that does not fit the session's budget", () => {
    const store = new ReferenceImageStore();
    const large = picture(6000, 4000); // 24 megapixels
    expect(store.remainingPixelBudget()).toBe(MAX_TOTAL_REFERENCE_PIXELS);
    expect(store.add(reference({ id: "a" }), large).ok).toBe(true);
    expect(store.add(reference({ id: "b" }), large).ok).toBe(true);
    const third = store.add(reference({ id: "c" }), large);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.reason).toBe("budget");
    }
    // The store is left exactly as it was.
    expect(store.count()).toBe(2);
    expect(store.decodedPixelCount()).toBe(2 * 24_000_000);
  });

  it("empties itself and gives every pixel back", () => {
    const store = new ReferenceImageStore();
    store.add(reference({ id: "a" }), picture(10, 10));
    store.clear();
    expect(store.list()).toEqual([]);
    expect(store.decodedPixelCount()).toBe(0);
    expect(store.remainingPixelBudget()).toBe(MAX_TOTAL_REFERENCE_PIXELS);
  });

  it("refuses to attach a picture to a reference that is not there", () => {
    const store = new ReferenceImageStore();
    const outcome: ReferenceStoreOutcome = store.attachDecoded("missing", picture(10, 10));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("missing");
    }
  });
});

describe("the decoder", () => {
  it("recognises the image formats a reference may be imported from", () => {
    expect(detectImageFormat(PNG_BYTES)).toBe("png");
    expect(detectImageFormat(JPEG_BYTES)).toBe("jpeg");
    expect(detectImageFormat(GIF_BYTES)).toBe("gif");
    expect(detectImageFormat(WEBP_BYTES)).toBe("webp");
    expect(detectImageFormat(BMP_BYTES)).toBe("bmp");
  });

  it("does not mistake a file that is not an image for one", () => {
    expect(detectImageFormat(TEXT_BYTES)).toBeNull();
    expect(detectImageFormat(new Uint8Array(0))).toBeNull();
    // A PNG signature cut short is not a PNG.
    expect(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
  });

  it("offers the formats the decoder accepts to the open dialog", () => {
    expect(referenceImageExtensions()).toContain("png");
    expect(referenceImageExtensions()).toContain("jpg");
    expect(referenceMimeType("png")).toBe("image/png");
    expect(referenceMimeType("jpeg")).toBe("image/jpeg");
  });

  it("decodes an image and hands the picture over", async () => {
    const decoder = environment(async () => picture(1200, 800));
    const decoded = await decodeReferenceImage(PNG_BYTES, decoder);
    expect(decoded.width).toBe(1200);
    expect(decoded.height).toBe(800);
    expect(decoder.calls).toBe(1);
  });

  it("tells the decoder which format the bytes are in", async () => {
    let seen = "";
    const decoder = environment(async (_bytes, mimeType) => {
      seen = mimeType;
      return picture(10, 10);
    });
    await decodeReferenceImage(JPEG_BYTES, decoder);
    expect(seen).toBe("image/jpeg");
  });

  it("refuses a file that is not an image, without decoding it", async () => {
    const decoder = environment(async () => picture(10, 10));
    await expect(decodeReferenceImage(TEXT_BYTES, decoder)).rejects.toBeInstanceOf(
      ReferenceDecodeError,
    );
    expect(decoder.calls).toBe(0);
  });

  it("refuses an empty file", async () => {
    const decoder = environment(async () => picture(10, 10));
    await expect(decodeReferenceImage(new Uint8Array(0), decoder)).rejects.toMatchObject({
      reason: "not-an-image",
    });
    expect(decoder.calls).toBe(0);
  });

  it("refuses a file that is larger than the byte limit, before decoding it", async () => {
    const decoder = environment(async () => picture(10, 10));
    const huge = new Uint8Array(MAX_REFERENCE_BYTES + 1);
    huge.set(PNG_BYTES, 0);
    await expect(decodeReferenceImage(huge, decoder)).rejects.toMatchObject({
      reason: "too-large",
    });
    expect(decoder.calls).toBe(0);
  });

  it("refuses a picture with more pixels than the limit", async () => {
    const decoder = environment(async () => picture(8000, 8000));
    await expect(decodeReferenceImage(PNG_BYTES, decoder)).rejects.toMatchObject({
      reason: "too-large",
    });
    expect(MAX_REFERENCE_PIXELS).toBeLessThan(8000 * 8000);
  });

  it("turns a decoder that throws into a refusal, not an exception", async () => {
    const decoder = environment(async () => {
      throw new Error("the browser gave up");
    });
    await expect(decodeReferenceImage(PNG_BYTES, decoder)).rejects.toMatchObject({
      reason: "malformed",
    });
  });

  it("refuses a picture with no pixels", async () => {
    const decoder = environment(async () => picture(0, 0));
    await expect(decodeReferenceImage(PNG_BYTES, decoder)).rejects.toMatchObject({
      reason: "malformed",
    });
  });
});
