/**
 * Fill command and patch-helper tests.
 *
 * A bucket fill's history entry must replay the pixels it committed. These
 * tests therefore assert object identity as well as list order: redo inserts
 * the same mask, never a re-run of flood fill.
 */

import { describe, expect, it } from "vitest";
import { createFillCommand } from "../core/commands/fillCommand";
import {
  cloneFillPatch,
  createFillPatch,
  fillPatchPixelCount,
} from "../core/fill/fillPatch";
import type { FillPatchRecord, LayerElement } from "../core/document/types";
import type { StrokeCommandHost } from "../core/commands/strokeCommand";

function createPatch(overrides: Partial<FillPatchRecord> = {}): FillPatchRecord {
  return {
    id: "fill-1",
    layerId: "layer-a",
    kind: "fill",
    color: "#ff0000",
    x: 2,
    y: 3,
    width: 2,
    height: 2,
    mask: new Uint8Array([255, 0, 0, 255]),
    ...overrides,
  };
}

function createHost() {
  const elements: LayerElement[] = [];
  const refreshed: string[] = [];
  const host: StrokeCommandHost = {
    insert(element, index) {
      if (index === undefined) {
        elements.push(element);
      } else {
        elements.splice(index, 0, element);
      }
    },
    remove(element) {
      const index = elements.findIndex((entry) => entry.id === element.id);
      if (index !== -1) {
        elements.splice(index, 1);
      }
    },
    replace(element) {
      const index = elements.findIndex((entry) => entry.id === element.id);
      if (index !== -1) {
        elements[index] = element;
      }
    },
    refresh(layerId) {
      refreshed.push(layerId);
    },
  };
  return { host, elements, refreshed };
}

describe("createFillCommand", () => {
  it("inserts the committed patch at its painting index and refreshes the layer", () => {
    const patch = createPatch();
    const { host, elements, refreshed } = createHost();
    const command = createFillCommand(patch, 1, host);

    expect(command.label).toBe("Fill");
    command.apply();

    expect(elements).toEqual([patch]);
    expect(refreshed).toEqual([patch.layerId]);
  });

  it("removes the patch on undo, then replays the same pixels on redo", () => {
    const patch = createPatch();
    const { host, elements, refreshed } = createHost();
    const command = createFillCommand(patch, 0, host);

    command.apply();
    command.revert();

    expect(elements).toEqual([]);
    expect(refreshed).toEqual([patch.layerId, patch.layerId]);

    command.apply();

    // Identity, not equality: redo must not build a new mask from the current
    // composite, or the result could drift after later edits.
    expect(elements).toEqual([patch]);
    expect(elements[0]).toBe(patch);
    expect((elements[0] as FillPatchRecord).mask).toBe(patch.mask);
  });

  it("returns to the same index when a fill is undone and redone between strokes", () => {
    const before = createPatch({ id: "fill-before" });
    const middle = createPatch({ id: "fill-middle" });
    const { host, elements } = createHost();
    host.insert(before);
    const command = createFillCommand(middle, 1, host);
    command.apply();
    command.revert();
    command.apply();

    expect(elements.map((element) => element.id)).toEqual(["fill-before", "fill-middle"]);
  });
});

describe("fill patch helpers", () => {
  it("builds a patch from a flood region without copying the mask", () => {
    const mask = new Uint8Array([255, 255]);
    const patch = createFillPatch("layer-a", "#123456", {
      x: 4,
      y: 5,
      width: 2,
      height: 1,
      mask,
      pixels: 2,
    });

    expect(patch).toMatchObject({
      layerId: "layer-a",
      kind: "fill",
      color: "#123456",
      x: 4,
      y: 5,
      width: 2,
      height: 1,
    });
    expect(patch.mask).toBe(mask);
    expect(patch.id).toMatch(/^fill-/);
    expect(fillPatchPixelCount(patch)).toBe(2);
  });

  it("clones a patch with a fresh id and its own mask", () => {
    const patch = createPatch();
    const copy = cloneFillPatch(patch, "layer-b");

    expect(copy.id).not.toBe(patch.id);
    expect(copy.layerId).toBe("layer-b");
    expect(copy).toMatchObject({
      kind: "fill",
      color: patch.color,
      x: patch.x,
      y: patch.y,
      width: patch.width,
      height: patch.height,
    });
    expect(copy.mask).not.toBe(patch.mask);
    expect([...copy.mask]).toEqual([...patch.mask]);

    copy.mask[0] = 0;
    expect(patch.mask[0]).toBe(255);
  });
});
