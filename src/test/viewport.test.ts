import { describe, expect, it } from "vitest";
import { guideGrabRadius } from "../core/document/guides";
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

/**
 * A guide in the viewport.
 *
 * A guide's position is document space and its grab radius is screen space.
 * These are the two halves of that rule, checked at the zoom extremes the
 * viewport allows.
 */
describe("a guide in the viewport", () => {
  it("keeps its document position while the view is panned and zoomed", () => {
    const guide = { id: "guide-1", axis: "vertical" as const, position: 400 };

    // Panning moves the guide on screen and leaves it where it is in the
    // document.
    const panned = panBy({ zoom: 1, offsetX: 0, offsetY: 0 }, 30, -12);
    const screen = docToScreen(panned, guide.position, 0);
    expect(screen.x).toBe(430);
    expect(screen.y).toBe(-12);
    // The document position did not move: it is still the same guide.
    expect(screenToDoc(panned, screen.x, screen.y).x).toBeCloseTo(guide.position, 9);

    // Zooming at a cursor point keeps the guide's document position and moves
    // its screen position with the transform.
    const zoomed = zoomAt({ zoom: 1, offsetX: 0, offsetY: 0 }, 300, 200, 4);
    const zoomedScreen = docToScreen(zoomed, guide.position, 0);
    expect(zoomedScreen.x).toBe(zoomed.offsetX + guide.position * zoomed.zoom);
    expect(screenToDoc(zoomed, zoomedScreen.x, 0).x).toBeCloseTo(guide.position, 9);
  });

  it("maps to a device position of document x times zoom times dpr", () => {
    for (const zoom of [MIN_ZOOM, 0.25, 1, 4, MAX_ZOOM]) {
      for (const dpr of [1, 2]) {
        const screen = docToScreen({ zoom, offsetX: 0, offsetY: 0 }, 400, 0);
        // The canvas transform is scale = zoom * dpr, so the device x is the
        // screen x times the device pixel ratio.
        expect(screen.x * dpr).toBeCloseTo(400 * zoom * dpr, 6);
      }
    }
  });

  it("has a grab radius that shrinks with the zoom", () => {
    // Eight screen pixels, in document units, at both ends of the zoom range.
    expect(guideGrabRadius(MIN_ZOOM)).toBeCloseTo(400, 6);
    expect(guideGrabRadius(1)).toBe(8);
    expect(guideGrabRadius(MAX_ZOOM)).toBeCloseTo(0.125, 6);
  });
});
