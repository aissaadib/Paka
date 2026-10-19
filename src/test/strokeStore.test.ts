import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createStrokeRecord } from "../core/brushes/strokeBuilder";
import { StrokeStore } from "../core/document/strokeStore";
import type { FillPatchRecord, StrokeRecord } from "../core/document/types";

function stroke(layerId: string, id: number): StrokeRecord {
  const record = createStrokeRecord(layerId, DEFAULT_BRUSH);
  record.xs.push(id);
  record.ys.push(0);
  record.pressures.push(1);
  record.times.push(0);
  return record;
}

describe("StrokeStore", () => {
  it("appends strokes per layer and reports counts", () => {
    const store = new StrokeStore();
    const first = stroke("layer-a", 1);
    const second = stroke("layer-a", 2);
    store.insert(first);
    store.insert(second);

    expect(store.list("layer-a")).toHaveLength(2);
    expect(store.list("layer-a")[0]).toBe(first);
    expect(store.count("layer-a")).toBe(2);
    expect(store.count("layer-b")).toBe(0);
    expect(store.list("layer-b")).toEqual([]);
    expect(store.totalCount).toBe(2);
  });

  it("inserts at an index to restore painting order after redo", () => {
    const store = new StrokeStore();
    const first = stroke("layer-a", 1);
    const third = stroke("layer-a", 3);
    const second = stroke("layer-a", 2);
    store.insert(first);
    store.insert(third);
    store.insert(second, 1);

    expect(store.list("layer-a").map((entry) => entry.xs[0])).toEqual([1, 2, 3]);
  });

  it("clamps an out-of-range insert index", () => {
    const store = new StrokeStore();
    store.insert(stroke("layer-a", 1));
    store.insert(stroke("layer-a", 2), 99);
    expect(store.list("layer-a")).toHaveLength(2);
  });

  it("removes a stroke and reports its index", () => {
    const store = new StrokeStore();
    const first = stroke("layer-a", 1);
    const second = stroke("layer-a", 2);
    store.insert(first);
    store.insert(second);

    const removed = store.remove("layer-a", second.id);
    expect(removed?.index).toBe(1);
    expect(removed?.element).toBe(second);
    expect(store.list("layer-a")).toEqual([first]);
    expect(store.remove("layer-a", second.id)).toBeNull();
    expect(store.remove("missing", second.id)).toBeNull();
  });

  it("finds strokes by id and clears layers", () => {
    const store = new StrokeStore();
    const entry = stroke("layer-a", 1);
    store.insert(entry);
    expect(store.indexOf("layer-a", entry.id)).toBe(0);
    expect(store.indexOf("layer-a", "nope")).toBe(-1);

    store.clearLayer("layer-a");
    expect(store.list("layer-a")).toEqual([]);
    expect(store.totalCount).toBe(0);
  });

  it("keeps element count and the live element array so rendering can iterate without copying", () => {
    const store = new StrokeStore();
    const empty = store.listElements("layer-a");
    store.insert(stroke("layer-a", 1));
    expect(store.listElements("layer-a")).not.toBe(empty);

    const live = store.listElements("layer-a");
    store.insert(stroke("layer-a", 2));
    expect(store.listElements("layer-a")).toBe(live);
    expect(live).toHaveLength(2);
    expect(store.elementCount("layer-a")).toBe(2);
  });

  it("interleaves strokes and fills in painting order while filtering stroke-only views", () => {
    const store = new StrokeStore();
    const first = stroke("layer-a", 1);
    const fill: FillPatchRecord = {
      id: "fill-1",
      layerId: "layer-a",
      kind: "fill",
      color: "#ff0000",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      mask: new Uint8Array([255]),
    };
    const last = stroke("layer-a", 2);

    store.insert(first);
    store.insert(fill);
    store.insert(last);

    expect(store.listElements("layer-a")).toEqual([first, fill, last]);
    // Selection and transforms must never see the patch as a path.
    expect(store.list("layer-a")).toEqual([first, last]);
    expect(store.count("layer-a")).toBe(2);
    expect(store.elementCount("layer-a")).toBe(3);
    expect(store.totalCount).toBe(3);
    expect(store.indexOf("layer-a", fill.id)).toBe(1);
  });

  it("restores a complete element list without duplicating content", () => {
    const store = new StrokeStore();
    const first = stroke("layer-a", 1);
    const fill: FillPatchRecord = {
      id: "fill-1",
      layerId: "layer-a",
      kind: "fill",
      color: "#ff0000",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      mask: new Uint8Array([255]),
    };

    store.restore("layer-a", [first, fill]);
    store.restore("layer-a", [first, fill]);

    expect(store.listElements("layer-a")).toEqual([first, fill]);
  });
});
