import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  centerOn,
  clampZoom,
  docToScreen,
  fitToViewport,
  panBy,
  screenToDoc,
  zoomAt,
  zoomToAt,
} from "../core/rendering/viewport";

const viewport = { zoom: 2, offsetX: 40, offsetY: -20 };

describe("viewport transforms", () => {
  it("maps document coordinates to canvas-local screen coordinates", () => {
    expect(docToScreen(viewport, 10, 5)).toEqual({ x: 60, y: -10 });
  });

  it("maps screen coordinates back to document coordinates", () => {
    expect(screenToDoc(viewport, 60, -10)).toEqual({ x: 10, y: 5 });
  });

  it("round-trips exactly at fractional zoom and offsets", () => {
    const fractional = { zoom: 0.37, offsetX: 12.5, offsetY: 88.25 };
    const screen = docToScreen(fractional, 123.25, 456.75);
    const doc = screenToDoc(fractional, screen.x, screen.y);
    expect(doc.x).toBeCloseTo(123.25, 9);
    expect(doc.y).toBeCloseTo(456.75, 9);
  });

  it("keeps document dimensions independent of zoom", () => {
    // The same document point maps to different screen positions, and the
    // transform is what changes - never a document dimension.
    const atOneHundred = docToScreen({ zoom: 1, offsetX: 0, offsetY: 0 }, 800, 600);
    const atFourHundred = docToScreen({ zoom: 4, offsetX: 0, offsetY: 0 }, 800, 600);
    expect(atOneHundred).toEqual({ x: 800, y: 600 });
    expect(atFourHundred).toEqual({ x: 3200, y: 2400 });
  });
});

describe("zoom", () => {
  it("keeps the document point under the cursor pinned", () => {
    const before = { zoom: 1, offsetX: 0, offsetY: 0 };
    const anchor = screenToDoc(before, 300, 200);
    const after = zoomAt(before, 300, 200, 3);
    const screen = docToScreen(after, anchor.x, anchor.y);
    expect(after.zoom).toBe(3);
    expect(screen.x).toBeCloseTo(300, 9);
    expect(screen.y).toBeCloseTo(200, 9);
  });

  it("clamps zoom to the supported range", () => {
    const base = { zoom: 1, offsetX: 0, offsetY: 0 };
    expect(zoomToAt(base, 0, 0, 10_000).zoom).toBe(MAX_ZOOM);
    expect(zoomToAt(base, 0, 0, 0.000001).zoom).toBe(MIN_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });
});

describe("pan and fit", () => {
  it("translates without changing zoom", () => {
    expect(panBy(viewport, 15, -5)).toEqual({ zoom: 2, offsetX: 55, offsetY: -25 });
  });

  it("centers a document in the viewport", () => {
    expect(centerOn({ width: 800, height: 600 }, { width: 400, height: 300 }, 1)).toEqual({
      zoom: 1,
      offsetX: 200,
      offsetY: 150,
    });
  });

  it("fits a large document inside the viewport with padding", () => {
    const viewportSize = { width: 800, height: 600 };
    const documentSize = { width: 4000, height: 2000 };
    const fitted = fitToViewport(viewportSize, documentSize, 32);
    expect(fitted.zoom).toBeCloseTo(Math.min(736 / 4000, 536 / 2000), 9);

    const topLeft = docToScreen(fitted, 0, 0);
    const bottomRight = docToScreen(fitted, documentSize.width, documentSize.height);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(viewportSize.width);
    expect(bottomRight.y).toBeLessThanOrEqual(viewportSize.height);
  });

  it("survives a zero-sized document without producing NaN", () => {
    const fitted = fitToViewport({ width: 800, height: 600 }, { width: 0, height: 0 });
    expect(fitted).toEqual({ zoom: 1, offsetX: 400, offsetY: 300 });
  });
});
