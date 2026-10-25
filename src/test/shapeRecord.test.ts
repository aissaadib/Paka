/**
 * Native shape records: the pure geometry, hit-testing and edits.
 *
 * These tests are deliberately DOM-free. They pin down the three promises the
 * editable-shape work rests on:
 *
 *  - the outline a committed shape draws is the one the shape tool previewed;
 *  - an edit changes the model, not a re-guess from pixels;
 *  - a shape keeps its primitive and its parameters through every transform.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  MIN_SHAPE_SIZE,
  cloneShape,
  findShapeHandle,
  mirrorShape,
  normalizeShapeDegrees,
  resizeShape,
  rotateShape,
  setShapeBrush,
  setShapeFill,
  setShapeInnerRatio,
  setShapeRotation,
  setShapeSides,
  setShapeSize,
  shapeGeometryEqual,
  shapeHitTest,
  shapeRecordBounds,
  shapeRecordFrame,
  shapeRecordHandles,
  shapeRecordOutline,
  shapeRecordsEqual,
  strokeFromShape,
  translateShape,
} from "../core/document/shapeRecord";
import type {
  BoxShapeGeometry,
  LineShapeGeometry,
  ShapeGeometry,
  ShapeRecord,
} from "../core/document/types";
import {
  MAX_SHAPE_INNER_RATIO,
  MAX_SHAPE_SIDES,
  MIN_SHAPE_INNER_RATIO,
  MIN_SHAPE_SIDES,
} from "../core/tools/shapeOptions";
import { shapeOutline } from "../core/tools/shapeGeometry";

const BRUSH = { ...DEFAULT_BRUSH, size: 4 };

function box(overrides: Partial<BoxShapeGeometry> = {}): BoxShapeGeometry {
  return {
    shape: "rectangle",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    rotation: 0,
    sides: 5,
    innerRatio: 0.5,
    ...overrides,
  };
}

function line(overrides: Partial<LineShapeGeometry> = {}): LineShapeGeometry {
  return { shape: "line", x1: 10, y1: 20, x2: 110, y2: 70, ...overrides };
}

function record(
  geometry: ShapeGeometry,
  overrides: Partial<ShapeRecord> = {},
): ShapeRecord {
  return {
    id: "shape-1",
    layerId: "layer-1",
    kind: "shape",
    geometry,
    brush: BRUSH,
    fill: false,
    ...overrides,
  };
}

describe("shape outlines", () => {
  it("draws the very outline the shape tool previewed", () => {
    const cases: readonly [ShapeGeometry, Parameters<typeof shapeOutline>[0]][] = [
      [line(), "line"],
      [box(), "rectangle"],
      [box({ shape: "ellipse" }), "ellipse"],
      [box({ shape: "polygon", sides: 7 }), "polygon"],
      [box({ shape: "star", sides: 6, innerRatio: 0.3 }), "star"],
    ];
    for (const [geometry, kind] of cases) {
      const previewed = shapeOutline(
        kind,
        {
          anchor: { x: 10, y: 20 },
          current: { x: 110, y: 70 },
          shift: false,
          alt: false,
        },
        geometry.shape === "line"
          ? undefined
          : {
              sides: geometry.sides,
              innerRatio: geometry.innerRatio,
              rotation: geometry.rotation,
            },
      );
      // The geometry was built from that drag, so the record and the preview
      // are the same list of points - not merely close.
      expect(shapeRecordOutline(record(geometry))).toEqual(previewed);
    }
  });

  it("keeps a line's direction, which a box cannot represent", () => {
    const forward = shapeRecordOutline(record(line()));
    const backward = shapeRecordOutline(
      record(line({ x1: 110, y1: 70, x2: 10, y2: 20 })),
    );
    expect(forward).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 70 },
    ]);
    expect(backward[0]).toEqual({ x: 110, y: 70 });
    expect(backward[1]).toEqual({ x: 10, y: 20 });
  });

  it("closes a box shape and leaves a line open", () => {
    const rectangle = shapeRecordOutline(record(box()));
    expect(rectangle).toHaveLength(5);
    expect(rectangle[4]).toEqual(rectangle[0]);
    expect(shapeRecordOutline(record(line()))).toHaveLength(2);
  });

  it("turns a box rigidly, so its side lengths never change", () => {
    const upright = shapeRecordOutline(record(box()));
    const turned = shapeRecordOutline(record(box({ rotation: 37 })));
    const length = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    expect(turned).toHaveLength(upright.length);
    for (let index = 1; index < upright.length; index += 1) {
      expect(length(turned[index - 1], turned[index])).toBeCloseTo(
        length(upright[index - 1], upright[index]),
        9,
      );
    }
  });

  it("reports the frame as the box's four corners, or the line's bounds", () => {
    expect(shapeRecordFrame(record(box()))).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ]);
    expect(shapeRecordFrame(record(line()))).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ]);
  });
});

describe("shape hit-testing", () => {
  it("hits the outline within the tolerance and misses outside it", () => {
    const shape = record(box());
    // The top edge, from (10, 20) to (110, 20).
    expect(shapeHitTest(shape, 60, 20, 2)).toBe(true);
    expect(shapeHitTest(shape, 60, 22, 2)).toBe(true);
    expect(shapeHitTest(shape, 60, 30, 2)).toBe(false);
  });

  it("hits the interior only when the shape is filled", () => {
    const outline = record(box());
    const filled = record(box(), { fill: true });
    expect(shapeHitTest(outline, 60, 45, 1)).toBe(false);
    expect(shapeHitTest(filled, 60, 45, 1)).toBe(true);
  });

  it("uses the caller's tolerance, which carries the brush half-width", () => {
    const shape = record(box());
    expect(shapeHitTest(shape, 60, 25, 6)).toBe(true);
    expect(shapeHitTest(shape, 60, 25, 3)).toBe(false);
  });

  it("hits a line's segment but not the space beside it", () => {
    const shape = record(line());
    expect(shapeHitTest(shape, 60, 45, 2)).toBe(true);
    expect(shapeHitTest(shape, 60, 60, 2)).toBe(false);
  });
});

describe("shape bounds and handles", () => {
  it("pads the painted bounds by the brush's half-width", () => {
    const bounds = shapeRecordBounds(record(box()));
    expect(bounds).toEqual({ x: 8, y: 18, width: 104, height: 54 });
  });

  it("offers four corner handles and one rotation handle", () => {
    const handles = shapeRecordHandles(record(box()), 20);
    expect(handles).not.toBeNull();
    expect(handles?.corners).toEqual(shapeRecordFrame(record(box())));
    // The rotation handle sits above the top edge's midpoint.
    expect(handles?.rotate).toEqual({ x: 60, y: 0 });
  });

  it("grabs the nearest handle inside the radius", () => {
    const shape = record(box());
    expect(findShapeHandle(shape, 10, 20, 20, 6)).toBe("scale-nw");
    expect(findShapeHandle(shape, 110, 70, 20, 6)).toBe("scale-se");
    expect(findShapeHandle(shape, 60, 0, 20, 6)).toBe("rotate");
    expect(findShapeHandle(shape, 60, 45, 20, 6)).toBeNull();
  });
});

describe("moving a shape", () => {
  it("moves a box by a document delta, keeping its size", () => {
    const moved = translateShape(record(box()), 15, -5);
    expect(moved.geometry).toMatchObject({ x: 25, y: 15, width: 100, height: 50 });
  });

  it("moves a line's endpoints", () => {
    const moved = translateShape(record(line()), 15, -5);
    expect(moved.geometry).toEqual({
      shape: "line",
      x1: 25,
      y1: 15,
      x2: 125,
      y2: 65,
    });
  });
});

describe("resizing a shape", () => {
  it("keeps the corner opposite the grabbed one fixed", () => {
    const resized = resizeShape(
      record(box()),
      "scale-se",
      { x: 210, y: 120 },
      false,
    );
    expect(resized.geometry).toMatchObject({ x: 10, y: 20, width: 200, height: 100 });
  });

  it("squares the box under Shift", () => {
    const resized = resizeShape(
      record(box()),
      "scale-se",
      { x: 210, y: 70 },
      true,
    );
    // The larger extent is 200, so the box is 200 by 200 from the fixed nw.
    expect(resized.geometry).toMatchObject({ width: 200, height: 200 });
  });

  it("never collapses below one document pixel", () => {
    const resized = resizeShape(record(box()), "scale-se", { x: 10, y: 20 }, false);
    expect(resized.geometry).toMatchObject({
      width: MIN_SHAPE_SIZE,
      height: MIN_SHAPE_SIZE,
    });
  });

  it("resizes a rotated box along its own sides", () => {
    const shape = record(box({ rotation: 90 }));
    // Turned 90 degrees about (60, 45), the top edge now runs vertically.
    const resized = resizeShape(shape, "scale-se", { x: 60, y: 100 }, false);
    // The fixed corner is the opposite one in the turned frame, and the
    // rotation is unchanged: the edit is a size change, not a re-placement.
    expect(resized.geometry.shape).not.toBe("line");
    if (resized.geometry.shape === "line") {
      return;
    }
    expect(resized.geometry.rotation).toBe(90);
    expect(resized.geometry.width).toBeGreaterThan(0);
    expect(resized.geometry.height).toBeGreaterThan(0);
  });

  it("scales a line's endpoints inside its bounding box", () => {
    const resized = resizeShape(record(line()), "scale-se", { x: 210, y: 120 }, false);
    expect(resized.geometry).toEqual({
      shape: "line",
      x1: 10,
      y1: 20,
      x2: 210,
      y2: 120,
    });
  });

  it("ignores the rotation handle", () => {
    const shape = record(box());
    expect(resizeShape(shape, "rotate", { x: 0, y: 0 }, false)).toBe(shape);
  });
});

describe("rotating a shape", () => {
  it("accumulates a box's rotation and normalizes it", () => {
    const turned = rotateShape(record(box({ rotation: 350 })), 20, false);
    expect(turned.geometry).toMatchObject({ rotation: 10 });
  });

  it("snaps the delta to 15 degrees when asked", () => {
    const turned = rotateShape(record(box()), 22, true);
    expect(turned.geometry).toMatchObject({ rotation: 15 });
  });

  it("turns a line's endpoints about their centre", () => {
    const turned = rotateShape(record(line()), 90, false);
    expect(turned.geometry.shape).toBe("line");
    if (turned.geometry.shape !== "line") {
      return;
    }
    // The centre is (60, 45); (10, 20) is (-50, -25) from it, and a quarter
    // turn sends it to (25, -50).
    expect(turned.geometry.x1).toBeCloseTo(85, 9);
    expect(turned.geometry.y1).toBeCloseTo(-5, 9);
    expect(turned.geometry.x2).toBeCloseTo(35, 9);
    expect(turned.geometry.y2).toBeCloseTo(95, 9);
  });

  it("normalizes degrees into 0..360", () => {
    expect(normalizeShapeDegrees(370)).toBe(10);
    expect(normalizeShapeDegrees(-10)).toBe(350);
    expect(normalizeShapeDegrees(360)).toBe(0);
  });
});

describe("editing a shape's parameters", () => {
  it("clamps a polygon's sides to the supported range", () => {
    const shape = record(box({ shape: "polygon", sides: 5 }));
    expect(setShapeSides(shape, 1).geometry).toMatchObject({ sides: MIN_SHAPE_SIDES });
    expect(setShapeSides(shape, 99).geometry).toMatchObject({ sides: MAX_SHAPE_SIDES });
    expect(setShapeSides(shape, 8.4).geometry).toMatchObject({ sides: 8 });
  });

  it("leaves a rectangle's sides alone", () => {
    const shape = record(box());
    expect(setShapeSides(shape, 8)).toBe(shape);
  });

  it("clamps a star's inner radius and ignores it on other kinds", () => {
    const star = record(box({ shape: "star", innerRatio: 0.5 }));
    expect(setShapeInnerRatio(star, 0).geometry).toMatchObject({
      innerRatio: MIN_SHAPE_INNER_RATIO,
    });
    expect(setShapeInnerRatio(star, 4).geometry).toMatchObject({
      innerRatio: MAX_SHAPE_INNER_RATIO,
    });
    const polygon = record(box({ shape: "polygon" }));
    expect(setShapeInnerRatio(polygon, 0.2)).toBe(polygon);
  });

  it("sets a box's rotation but never a line's", () => {
    expect(setShapeRotation(record(box()), 45).geometry).toMatchObject({ rotation: 45 });
    const lineShape = record(line());
    expect(setShapeRotation(lineShape, 45)).toBe(lineShape);
  });

  it("fills a box shape but never a line", () => {
    expect(setShapeFill(record(box()), true).fill).toBe(true);
    const lineShape = record(line());
    expect(setShapeFill(lineShape, true)).toBe(lineShape);
  });

  it("resizes a box but never a line", () => {
    expect(setShapeSize(record(box()), 30, 40).geometry).toMatchObject({
      width: 30,
      height: 40,
    });
    const lineShape = record(line());
    expect(setShapeSize(lineShape, 30, 40)).toBe(lineShape);
  });

  it("keeps every appearance field and forces the stamp off", () => {
    const shape = record(box(), {
      brush: { ...BRUSH, stamp: true, hardness: 0.3, texture: 0.6, tip: "chisel" },
    });
    const edited = setShapeBrush(shape, { color: "#ff0000", size: 12 });
    expect(edited.brush).toMatchObject({
      color: "#ff0000",
      size: 12,
      hardness: 0.3,
      texture: 0.6,
      tip: "chisel",
      stamp: false,
    });
  });

  it("normalizes an appearance edit like any brush", () => {
    const edited = setShapeBrush(record(box()), { opacity: 4, size: -2 });
    expect(edited.brush.opacity).toBe(1);
    expect(edited.brush.size).toBeGreaterThanOrEqual(1);
  });
});

describe("copying a shape", () => {
  it("mirrors a box across the vertical axis, flipping its rotation", () => {
    const mirrored = mirrorShape(record(box({ rotation: 30 })), [
      { kind: "vertical", position: 0 },
    ]);
    expect(mirrored.geometry).toMatchObject({
      x: -110,
      y: 20,
      width: 100,
      height: 50,
      rotation: 150,
    });
  });

  it("mirrors a line's endpoints", () => {
    const mirrored = mirrorShape(record(line()), [{ kind: "horizontal", position: 0 }]);
    expect(mirrored.geometry).toEqual({
      shape: "line",
      x1: 10,
      y1: -20,
      x2: 110,
      y2: -70,
    });
  });

  it("clones onto another layer with a fresh id, sharing the geometry", () => {
    const original = record(box());
    const copy = cloneShape(original, "layer-2", "shape-2");
    expect(copy.id).toBe("shape-2");
    expect(copy.layerId).toBe("layer-2");
    expect(copy.geometry).toEqual(original.geometry);
    expect(copy.brush).toEqual(original.brush);
  });
});

describe("comparing shapes", () => {
  it("compares geometries by value", () => {
    expect(shapeGeometryEqual(box(), box())).toBe(true);
    expect(shapeGeometryEqual(box(), box({ width: 101 }))).toBe(false);
    expect(shapeGeometryEqual(box(), line())).toBe(false);
    expect(shapeGeometryEqual(line(), line())).toBe(true);
  });

  it("compares records by identity, geometry and appearance", () => {
    expect(shapeRecordsEqual(record(box()), record(box()))).toBe(true);
    expect(shapeRecordsEqual(record(box()), record(box(), { fill: true }))).toBe(false);
    expect(
      shapeRecordsEqual(record(box()), record(box(), { brush: { ...BRUSH, size: 9 } })),
    ).toBe(false);
    expect(
      shapeRecordsEqual(record(box()), record(box(), { id: "shape-2" })),
    ).toBe(false);
  });
});

describe("the stroke a shape is drawn as", () => {
  it("carries the outline, pressure 1 and the shape's own brush", () => {
    const shape = record(box(), { fill: true });
    const stroke = strokeFromShape(shape);
    expect(stroke.id).toBe(shape.id);
    expect(stroke.layerId).toBe(shape.layerId);
    expect(stroke.brush).toEqual(shape.brush);
    expect(stroke.fill).toBe(true);
    expect(stroke.xs).toEqual(shapeRecordOutline(shape).map((point) => point.x));
    expect(stroke.ys).toEqual(shapeRecordOutline(shape).map((point) => point.y));
    expect(stroke.pressures.every((value) => value === 1)).toBe(true);
  });

  it("leaves the fill flag off an unfilled shape", () => {
    expect(strokeFromShape(record(box())).fill).toBeUndefined();
  });
});
