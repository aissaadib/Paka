/**
 * The layers panel's reordering arithmetic.
 *
 * The panel shows the stack top-first and the document stores it bottom-first,
 * and a drag has to say where a layer lands in both. These tests pin the
 * translation between the two, because a mistake there silently moves a layer
 * to the wrong place - or to no place at all.
 */

import { describe, expect, it } from "vitest";
import {
  dropSlot,
  isAboveRowMidpoint,
  markerIndex,
  moveDeltaForSlot,
  nextRowIndex,
  topFirstLayers,
} from "../core/document/layerOrdering";
import { createDocument } from "../core/document/document";

/** Three layers, bottom-first, as the document stores them. */
function stack() {
  const document = createDocument({ name: "Test", width: 100, height: 100 });
  const [bottom, ...rest] = document.layers;
  return [bottom!, ...rest];
}

describe("topFirstLayers", () => {
  it("shows the top of the stack first", () => {
    const layers = stack();
    const reversed = topFirstLayers(layers);
    expect(reversed.map((layer) => layer.id)).toEqual(
      [...layers].reverse().map((layer) => layer.id),
    );
  });

  it("does not touch the document's own array", () => {
    const layers = stack();
    const before = layers.map((layer) => layer.id);
    topFirstLayers(layers);
    expect(layers.map((layer) => layer.id)).toEqual(before);
  });
});

describe("isAboveRowMidpoint", () => {
  it("reads the top half of a row as above it", () => {
    expect(isAboveRowMidpoint(0, 0, 20)).toBe(true);
    expect(isAboveRowMidpoint(9, 0, 20)).toBe(true);
  });

  it("reads the bottom half of a row as below it", () => {
    expect(isAboveRowMidpoint(10, 0, 20)).toBe(false);
    expect(isAboveRowMidpoint(19, 0, 20)).toBe(false);
  });

  it("is measured against the row's own top, not the viewport's", () => {
    expect(isAboveRowMidpoint(105, 100, 20)).toBe(true);
    expect(isAboveRowMidpoint(115, 100, 20)).toBe(false);
  });
});

describe("dropSlot", () => {
  it("lands below the last row in the last slot, whichever row is dragged", () => {
    // The list without the dragged row has one row fewer, so its last slot is
    // the one below the last row - and the dragged row's own position does
    // not change that.
    expect(dropSlot(2, false, 0)).toBe(2);
    expect(dropSlot(2, false, 1)).toBe(2);
    expect(dropSlot(2, false, 2)).toBe(2);
  });

  it("lands above the first row in the first slot", () => {
    expect(dropSlot(0, true, 0)).toBe(0);
    expect(dropSlot(0, true, 1)).toBe(0);
    expect(dropSlot(0, true, 2)).toBe(0);
  });

  it("keeps a drop on the dragged row where the row already is", () => {
    expect(dropSlot(1, true, 1)).toBe(1);
    expect(dropSlot(1, false, 1)).toBe(1);
  });

  it("moves the slot back over the dragged row when the drop is below it", () => {
    // Row 1 is not the dragged row here: dropping just below it is the slot
    // between row 1 and row 2 of the list without the dragged row 0.
    expect(dropSlot(1, false, 0)).toBe(1);
  });
});

describe("moveDeltaForSlot", () => {
  it("is zero when the layer stays where it is", () => {
    expect(moveDeltaForSlot(0, 0)).toBe(0);
    expect(moveDeltaForSlot(2, 2)).toBe(0);
  });

  it("moves a layer up the stack when the slot is above it", () => {
    // The panel counts from the top, the document from the bottom, so a slot
    // above the dragged row is a positive delta in the document's order.
    expect(moveDeltaForSlot(2, 0)).toBe(2);
  });

  it("moves a layer down the stack when the slot is below it", () => {
    expect(moveDeltaForSlot(0, 2)).toBe(-2);
  });
});

describe("markerIndex", () => {
  it("sits before the rows above the dragged one", () => {
    expect(markerIndex(2, 0)).toBe(0);
  });

  it("steps over the dragged row when the drop is below it", () => {
    expect(markerIndex(0, 1)).toBe(2);
    expect(markerIndex(1, 1)).toBe(2);
  });
});

describe("nextRowIndex", () => {
  it("moves one row up or down", () => {
    expect(nextRowIndex(1, -1, 3)).toBe(0);
    expect(nextRowIndex(1, 1, 3)).toBe(2);
  });

  it("stays put at the ends instead of wrapping", () => {
    expect(nextRowIndex(0, -1, 3)).toBeNull();
    expect(nextRowIndex(2, 1, 3)).toBeNull();
  });

  it("is null when the list is empty", () => {
    expect(nextRowIndex(0, 1, 0)).toBeNull();
  });
});
