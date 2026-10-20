import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_BACKGROUND,
  MAX_DOCUMENT_SIZE,
  addLayer,
  createDocument,
  duplicateLayer,
  getActiveLayer,
  moveLayer,
  nextLayerName,
  removeLayer,
  setActiveLayer,
  uniqueLayerName,
  isValidDocumentSize,
  updateLayer,
} from "../core/document/document";

const base = createDocument({ name: "Test", width: 800, height: 600 });

describe("createDocument", () => {
  it("creates a document with one active layer", () => {
    expect(base.width).toBe(800);
    expect(base.height).toBe(600);
    expect(base.background).toBe(DEFAULT_DOCUMENT_BACKGROUND);
    expect(base.layers).toHaveLength(1);
    expect(base.activeLayerId).toBe(base.layers[0].id);
    expect(base.layers[0].opacity).toBe(1);
    expect(base.layers[0].visible).toBe(true);
  });

  it("rounds fractional dimensions", () => {
    const document = createDocument({ width: 800.4, height: 600.6 });
    expect(document.width).toBe(800);
    expect(document.height).toBe(601);
  });

  it("rejects sizes outside the supported range", () => {
    expect(() => createDocument({ width: 4, height: 600 })).toThrow(RangeError);
    expect(() => createDocument({ width: 800, height: MAX_DOCUMENT_SIZE + 1 })).toThrow(RangeError);
    expect(isValidDocumentSize(64, 64)).toBe(true);
    expect(isValidDocumentSize(0, 64)).toBe(false);
  });
});

describe("layers", () => {
  it("names new layers uniquely", () => {
    const withLayer = addLayer(base);
    expect(withLayer.layers).toHaveLength(2);
    expect(withLayer.layers[1].name).toBe("Layer 2");
    expect(nextLayerName(withLayer)).toBe("Layer 3");
  });

  it("activates the layer it adds", () => {
    const withLayer = addLayer(base, "Ink");
    expect(getActiveLayer(withLayer)?.name).toBe("Ink");
  });

  it("never removes the last layer", () => {
    expect(removeLayer(base, base.layers[0].id)).toBe(base);
  });

  it("selects a neighbour when the active layer is removed", () => {
    const two = addLayer(base);
    const removed = removeLayer(two, two.activeLayerId as string);
    expect(removed.layers).toHaveLength(1);
    expect(removed.activeLayerId).toBe(two.layers[0].id);
  });

  it("orders layers bottom-first and moves them by delta", () => {
    const two = addLayer(base);
    const bottomId = two.layers[0].id;
    const moved = moveLayer(two, bottomId, 1);
    expect(moved.layers[1].id).toBe(bottomId);
    // Moving past the end is a no-op.
    expect(moveLayer(moved, bottomId, 5)).toBe(moved);
  });

  it("updates metadata immutably and clamps opacity", () => {
    const layerId = base.layers[0].id;
    const opaque = updateLayer(base, layerId, { opacity: 5 });
    expect(opaque.layers[0].opacity).toBe(1);
    expect(base.layers[0].opacity).toBe(1);

    const hidden = updateLayer(base, layerId, { visible: false, name: "Sketch" });
    expect(hidden.layers[0].visible).toBe(false);
    expect(hidden.layers[0].name).toBe("Sketch");
    expect(base.layers[0].name).toBe("Layer 1");
  });

  it("returns the same document when nothing changes", () => {
    const layerId = base.layers[0].id;
    expect(updateLayer(base, layerId, {})).toBe(base);
    expect(updateLayer(base, "missing", { visible: false })).toBe(base);
    expect(updateLayer(base, layerId, { visible: true })).toBe(base);
    expect(setActiveLayer(base, layerId)).toBe(base);
    expect(setActiveLayer(base, "missing")).toBe(base);
  });

  it("changes the active layer once", () => {
    const two = addLayer(base);
    const switched = setActiveLayer(two, two.layers[0].id);
    expect(switched.activeLayerId).toBe(two.layers[0].id);
    expect(switched.layers).toBe(two.layers);
  });
});

describe("duplicateLayer", () => {
  it("inserts a uniquely named copy directly above the original", () => {
    const two = addLayer(base);
    const sourceId = two.layers[0].id;
    const copied = duplicateLayer(two, sourceId);

    expect(copied.layers).toHaveLength(3);
    expect(copied.layers[1].id).not.toBe(sourceId);
    expect(copied.layers[1].name).toBe("Layer 1 copy");
    // The copy carries the source's compositing state, not the defaults.
    expect(copied.layers[1].opacity).toBe(two.layers[0].opacity);
    expect(copied.layers[1].visible).toBe(two.layers[0].visible);
    expect(copied.layers[1].blendMode).toBe(two.layers[0].blendMode);
    expect(copied.activeLayerId).toBe(copied.layers[1].id);

    // Order is preserved around the insertion point.
    expect(copied.layers[0].id).toBe(sourceId);
    expect(copied.layers[2].id).toBe(two.layers[1].id);
    // The original document is untouched.
    expect(two.layers).toHaveLength(2);
  });

  it("copies a non-normal blend mode", () => {
    const two = addLayer(base);
    const sourceId = two.layers[0].id;
    const screened = updateLayer(two, sourceId, { blendMode: "screen" });
    const copied = duplicateLayer(screened, sourceId);

    expect(copied.layers[1].blendMode).toBe("screen");
    // The source keeps its own mode: duplication reads, never mutates.
    expect(copied.layers[0].blendMode).toBe("screen");
  });

  it("numbers the copy name when it is already taken", () => {
    const taken = addLayer(base, "Layer 1 copy");
    const copied = duplicateLayer(taken, taken.layers[0].id);
    expect(copied.layers[1].name).toBe("Layer 1 copy 2");
  });

  it("returns the same document for an unknown layer", () => {
    expect(duplicateLayer(base, "missing")).toBe(base);
  });
});

describe("uniqueLayerName", () => {
  it("keeps the base name when free and numbers it otherwise", () => {
    expect(uniqueLayerName(base, "Sketch")).toBe("Sketch");
    const taken = addLayer(base, "Sketch");
    expect(uniqueLayerName(taken, "Sketch")).toBe("Sketch 2");
  });
});
