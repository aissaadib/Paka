/**
 * Grid and snapping: the pure geometry.
 *
 * The rules that decide which target a sample lands on are DOM-free, so they
 * are tested here directly: the nearest-target rule, the screen-space
 * tolerance converted with the zoom, and the grid's multiples.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID_SETTINGS,
  DEFAULT_GRID_SPACING,
  MAX_GRID_SPACING,
  MIN_GRID_SPACING,
  SNAP_TOLERANCE_PX,
  gridLinesBetween,
  nearestGridLine,
  normalizeGridSpacing,
  snapDocumentPoint,
  snapTolerance,
  type SnapTargets,
} from "../core/document/grid";
import type { Guide } from "../core/document/types";

function vertical(position: number, id = "guide-v"): Guide {
  return { id, axis: "vertical", position };
}

function horizontal(position: number, id = "guide-h"): Guide {
  return { id, axis: "horizontal", position };
}

/** Snapping on, 1x zoom, no guide and no grid unless a case overrides it. */
function targets(overrides: Partial<SnapTargets> = {}): SnapTargets {
  return { enabled: true, guides: [], spacing: 0, zoom: 1, ...overrides };
}

describe("the grid settings", () => {
  it("start off, at the default spacing", () => {
    expect(DEFAULT_GRID_SETTINGS).toEqual({
      visible: false,
      spacing: DEFAULT_GRID_SPACING,
      snap: false,
    });
    expect(DEFAULT_GRID_SETTINGS.spacing).toBe(50);
  });

  it("clamps the spacing to whole document pixels in range", () => {
    expect(normalizeGridSpacing(25)).toBe(25);
    expect(normalizeGridSpacing(25.4)).toBe(25);
    expect(normalizeGridSpacing(0)).toBe(MIN_GRID_SPACING);
    expect(normalizeGridSpacing(-10)).toBe(MIN_GRID_SPACING);
    expect(normalizeGridSpacing(10_000)).toBe(MAX_GRID_SPACING);
    // A non-finite value restores the default instead of poisoning the grid.
    expect(normalizeGridSpacing(Number.NaN)).toBe(DEFAULT_GRID_SPACING);
    expect(normalizeGridSpacing(Number.POSITIVE_INFINITY)).toBe(DEFAULT_GRID_SPACING);
  });
});

describe("the grid geometry", () => {
  it("puts lines on whole multiples of the spacing", () => {
    expect(nearestGridLine(59, 20)).toBe(60);
    expect(nearestGridLine(41, 20)).toBe(40);
    expect(nearestGridLine(0, 20)).toBe(0);
    expect(nearestGridLine(-11, 20)).toBe(-20);
    expect(nearestGridLine(-9, 20)).toBe(0);
  });

  it("has no line when the spacing is not a positive number", () => {
    expect(nearestGridLine(10, 0)).toBeNull();
    expect(nearestGridLine(10, -5)).toBeNull();
    expect(nearestGridLine(10, Number.NaN)).toBeNull();
    expect(nearestGridLine(Number.NaN, 20)).toBeNull();
  });

  it("lists the whole lines between two positions, inclusive", () => {
    expect(gridLinesBetween(0, 100, 25)).toEqual([0, 25, 50, 75, 100]);
    expect(gridLinesBetween(10, 49, 20)).toEqual([20, 40]);
    // The order is ascending whatever the arguments' order.
    expect(gridLinesBetween(100, 0, 25)).toEqual([0, 25, 50, 75, 100]);
    expect(gridLinesBetween(0, 100, 0)).toEqual([]);
    expect(gridLinesBetween(Number.NaN, 100, 25)).toEqual([]);
  });
});

describe("the snap tolerance", () => {
  it("is 6 CSS pixels converted to document units with the zoom", () => {
    expect(SNAP_TOLERANCE_PX).toBe(6);
    expect(snapTolerance(1)).toBe(6);
    expect(snapTolerance(0.5)).toBe(12);
    expect(snapTolerance(2)).toBe(3);
    expect(snapTolerance(4)).toBe(1.5);
  });

  it("falls back to 1x for a zoom that is not positive", () => {
    expect(snapTolerance(0)).toBe(SNAP_TOLERANCE_PX);
    expect(snapTolerance(-2)).toBe(SNAP_TOLERANCE_PX);
    expect(snapTolerance(Number.NaN)).toBe(SNAP_TOLERANCE_PX);
  });
});

describe("snapping a document point", () => {
  it("leaves the point alone when snapping is off", () => {
    const result = snapDocumentPoint(103, 57, targets({ enabled: false, guides: [vertical(100)] }));
    expect(result).toEqual({ x: 103, y: 57, snappedX: false, snappedY: false });
  });

  it("snaps an exact hit onto the guide unchanged", () => {
    const result = snapDocumentPoint(100, 57, targets({ guides: [vertical(100)] }));
    expect(result.x).toBe(100);
    expect(result.snappedX).toBe(true);
    // A vertical guide says nothing about y.
    expect(result.y).toBe(57);
    expect(result.snappedY).toBe(false);
  });

  it("snaps a point within tolerance exactly onto the target", () => {
    const result = snapDocumentPoint(103, 100, targets({ guides: [vertical(100), horizontal(100)] }));
    expect(result).toEqual({ x: 100, y: 100, snappedX: true, snappedY: true });
  });

  it("never moves a point outside the tolerance", () => {
    const result = snapDocumentPoint(107, 57, targets({ guides: [vertical(100)] }));
    expect(result).toEqual({ x: 107, y: 57, snappedX: false, snappedY: false });
  });

  it("treats the tolerance itself as inside", () => {
    expect(snapDocumentPoint(106, 0, targets({ guides: [vertical(100)] })).x).toBe(100);
    expect(snapDocumentPoint(106.0001, 0, targets({ guides: [vertical(100)] })).x).toBe(106.0001);
  });

  it("takes the nearest target, never the first one listed", () => {
    // At 0.5x the tolerance is 12 document pixels.
    const guides = [vertical(100, "far"), vertical(120, "near")];
    const result = snapDocumentPoint(112, 0, targets({ guides, zoom: 0.5 }));
    expect(result.x).toBe(120);
    // The same list in the other order gives the same answer.
    const reversed = snapDocumentPoint(112, 0, targets({ guides: [...guides].reverse(), zoom: 0.5 }));
    expect(reversed.x).toBe(120);
  });

  it("prefers a nearer grid line over a further guide", () => {
    const result = snapDocumentPoint(52, 0, targets({ guides: [vertical(55)], spacing: 50 }));
    expect(result.x).toBe(50);
  });

  it("prefers a nearer guide over a further grid line", () => {
    const result = snapDocumentPoint(51, 0, targets({ guides: [vertical(51)], spacing: 50 }));
    expect(result.x).toBe(51);
  });

  it("breaks an exact tie in favour of the guide, then the lower position", () => {
    // 53 is 3 from the grid line at 50 and 3 from the guide at 56.
    expect(snapDocumentPoint(53, 0, targets({ guides: [vertical(56)], spacing: 50 })).x).toBe(56);
    // Two guides equally far away: the lower one wins, whatever the list order.
    const left = vertical(10, "left");
    const right = vertical(30, "right");
    expect(snapDocumentPoint(20, 0, targets({ guides: [left, right], zoom: 0.5 })).x).toBe(10);
    expect(snapDocumentPoint(20, 0, targets({ guides: [right, left], zoom: 0.5 })).x).toBe(10);
  });

  it("snaps to grid lines on both axes, using the spacing", () => {
    const result = snapDocumentPoint(59, 21, targets({ spacing: 20 }));
    expect(result).toEqual({ x: 60, y: 20, snappedX: true, snappedY: true });
  });

  it("moves only the axis that has a target in reach", () => {
    // x is 1 from the line at 60; y is 7 from the line at 20, outside 6.
    const result = snapDocumentPoint(59, 27, targets({ spacing: 20 }));
    expect(result).toEqual({ x: 60, y: 27, snappedX: true, snappedY: false });
  });

  it("keeps the axes of the guides apart", () => {
    const result = snapDocumentPoint(103, 400, targets({ guides: [vertical(100)] }));
    expect(result).toEqual({ x: 100, y: 400, snappedX: true, snappedY: false });
    const other = snapDocumentPoint(400, 103, targets({ guides: [horizontal(100)] }));
    expect(other).toEqual({ x: 400, y: 100, snappedX: false, snappedY: true });
  });

  it("leaves a non-finite point untouched", () => {
    const result = snapDocumentPoint(Number.NaN, 57, targets({ guides: [vertical(100)] }));
    expect(Number.isNaN(result.x)).toBe(true);
    expect(result.snappedX).toBe(false);
    expect(result.snappedY).toBe(false);
  });
});

describe("the zoom invariance", () => {
  it("snaps the same physical gesture identically at 100% and 400%", () => {
    // A 4 CSS pixel nudge is 4 document pixels at 1x and 1 document pixel at 4x.
    const atOne = snapDocumentPoint(104, 0, targets({ guides: [vertical(100)], zoom: 1 }));
    const atFour = snapDocumentPoint(101, 0, targets({ guides: [vertical(100)], zoom: 4 }));
    expect(atOne.x).toBe(100);
    expect(atFour.x).toBe(100);
  });

  it("measures the tolerance in document pixels derived from the zoom", () => {
    const guides = [vertical(100)];
    // 5 document pixels: 5 CSS at 1x (inside 6), 20 CSS at 4x (outside).
    expect(snapDocumentPoint(105, 0, targets({ guides, zoom: 1 })).x).toBe(100);
    expect(snapDocumentPoint(105, 0, targets({ guides, zoom: 4 })).x).toBe(105);
    // 1.4 document pixels is 5.6 CSS at 4x, so it is inside.
    expect(snapDocumentPoint(101.4, 0, targets({ guides, zoom: 4 })).x).toBe(100);
  });

  it("does not reach further in document space when zoomed in", () => {
    // The 6 CSS boundary is 1.5 document pixels at 4x.
    expect(snapDocumentPoint(101.5, 0, targets({ guides: [vertical(100)], zoom: 4 })).x).toBe(100);
    expect(snapDocumentPoint(101.5001, 0, targets({ guides: [vertical(100)], zoom: 4 })).x).toBe(
      101.5001,
    );
  });

  it("snaps grid lines with the same zoom-derived tolerance", () => {
    // Spacing 20; at 4x a 2 document pixel nudge from the line at 40 is 8 CSS.
    expect(snapDocumentPoint(42, 0, targets({ spacing: 20, zoom: 4 })).x).toBe(42);
    // 1 document pixel (4 CSS) is inside.
    expect(snapDocumentPoint(41, 0, targets({ spacing: 20, zoom: 4 })).x).toBe(40);
  });
});
