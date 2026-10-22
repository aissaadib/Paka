/**
 * The painted bounds of a layer's content.
 *
 * The bounds answer "does this layer hold anything?" and "where is it?", and
 * they are what a layer's preview is cropped to. A wrong answer shows an
 * empty preview or crops a mark away, so the rules are pinned here.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { contentBounds, previewBounds, unionBounds } from "../core/document/layerBounds";
import type { FillPatchRecord, GradientRecord, LayerElement, StrokeRecord } from "../core/document/types";

function stroke(overrides: Partial<StrokeRecord> = {}): StrokeRecord {
  return {
    id: "stroke-1",
    layerId: "layer-1",
    brush: DEFAULT_BRUSH,
    xs: [10, 30],
    ys: [20, 40],
    pressures: [1, 1],
    times: [0, 1],
    startTime: 0,
    ...overrides,
  };
}

function fill(overrides: Partial<FillPatchRecord> = {}): FillPatchRecord {
  return {
    id: "fill-1",
    layerId: "layer-1",
    kind: "fill",
    color: "#ff0000",
    x: 5,
    y: 6,
    width: 20,
    height: 10,
    mask: new Uint8Array(200),
    ...overrides,
  };
}

function gradient(overrides: Partial<GradientRecord> = {}): GradientRecord {
  return {
    id: "gradient-1",
    layerId: "layer-1",
    kind: "gradient",
    type: "linear",
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 50,
    stops: [],
    opacity: 1,
    ...overrides,
  };
}

const radius = () => 5;

describe("contentBounds", () => {
  it("is null for a layer with no elements", () => {
    expect(contentBounds([], radius)).toBeNull();
  });

  it("covers a stroke's samples and its brush", () => {
    const bounds = contentBounds([stroke()], radius);
    expect(bounds).not.toBeNull();
    // The samples run from (10, 20) to (30, 40); the brush adds five pixels
    // on every side.
    expect(bounds?.x).toBe(5);
    expect(bounds?.y).toBe(15);
    expect(bounds?.width).toBe(30);
    expect(bounds?.height).toBe(30);
  });

  it("covers a fill patch's rectangle", () => {
    const bounds = contentBounds([fill()], radius);
    expect(bounds?.x).toBe(5);
    expect(bounds?.y).toBe(6);
    expect(bounds?.width).toBe(20);
    expect(bounds?.height).toBe(10);
  });

  it("covers a linear gradient's axis", () => {
    const bounds = contentBounds([gradient()], radius);
    expect(bounds?.x).toBe(0);
    expect(bounds?.y).toBe(0);
    expect(bounds?.width).toBe(100);
    expect(bounds?.height).toBe(50);
  });

  it("covers a radial gradient's circle", () => {
    const bounds = contentBounds(
      [gradient({ type: "radial", x1: 50, y1: 50, x2: 60, y2: 50 })],
      radius,
    );
    expect(bounds?.x).toBe(40);
    expect(bounds?.y).toBe(40);
    expect(bounds?.width).toBe(20);
    expect(bounds?.height).toBe(20);
  });

  it("unions the elements of a layer", () => {
    const elements: LayerElement[] = [stroke(), fill()];
    const bounds = contentBounds(elements, radius);
    // The stroke reaches to (35, 45) with its brush; the fill starts at
    // (5, 6). The union holds both.
    expect(bounds?.x).toBe(5);
    expect(bounds?.y).toBe(6);
    expect(bounds?.width).toBe(30);
    expect(bounds?.height).toBe(39);
  });

  it("ignores a stroke with no samples", () => {
    expect(contentBounds([stroke({ xs: [], ys: [] })], radius)).toBeNull();
  });
});

describe("unionBounds", () => {
  it("holds both rectangles", () => {
    const bounds = unionBounds(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 5, width: 10, height: 30 },
    );
    expect(bounds).toEqual({ x: 0, y: 0, width: 30, height: 35 });
  });
});

describe("previewBounds", () => {
  it("adds room around the content", () => {
    const bounds = previewBounds({ x: 0, y: 0, width: 100, height: 100 });
    expect(bounds.width).toBeGreaterThan(100);
    expect(bounds.height).toBeGreaterThan(100);
    expect(bounds.x).toBeLessThan(0);
    expect(bounds.y).toBeLessThan(0);
  });

  it("keeps the content's proportions in the middle", () => {
    const bounds = previewBounds({ x: 10, y: 20, width: 100, height: 50 });
    const centreX = bounds.x + bounds.width / 2;
    const centreY = bounds.y + bounds.height / 2;
    expect(centreX).toBeCloseTo(60, 5);
    expect(centreY).toBeCloseTo(45, 5);
  });
});
