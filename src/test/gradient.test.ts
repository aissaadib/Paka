/**
 * Gradient record and command tests.
 *
 * A gradient's history entry carries its committed geometry and stops, so redo
 * must insert the same record rather than run any blending again. These tests
 * also pin the record helpers used while a drag is previewed.
 */

import { describe, expect, it } from "vitest";
import { createGradientCommand } from "../core/commands/gradientCommand";
import {
  MIN_GRADIENT_LENGTH,
  cloneGradient,
  createGradientRecord,
  gradientIsDegenerate,
  gradientLength,
  moveGradientEnd,
} from "../core/gradient/gradientRecord";
import type { GradientRecord, LayerElement } from "../core/document/types";
import type { StrokeCommandHost } from "../core/commands/strokeCommand";

function createGradient(overrides: Partial<GradientRecord> = {}): GradientRecord {
  return {
    id: "gradient-1",
    layerId: "layer-a",
    kind: "gradient",
    type: "linear",
    x1: 10,
    y1: 12,
    x2: 30,
    y2: 42,
    stops: [
      { offset: 0, color: "#112233" },
      { offset: 1, color: "#ddeeff" },
    ],
    opacity: 0.8,
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
    refresh(layerId) {
      refreshed.push(layerId);
    },
  };
  return { host, elements, refreshed };
}

describe("gradient records", () => {
  it("builds a two-stop record from a drag and clamps opacity", () => {
    const gradient = createGradientRecord(
      "layer-a",
      { type: "radial", x1: 4, y1: 5, x2: 24, y2: 5 },
      "#123456",
      "#abcdef",
      1.4,
    );

    expect(gradient.id).toMatch(/^gradient-/);
    expect(gradient).toMatchObject({
      layerId: "layer-a",
      kind: "gradient",
      type: "radial",
      x1: 4,
      y1: 5,
      x2: 24,
      y2: 5,
      opacity: 1,
    });
    expect(gradient.stops).toEqual([
      { offset: 0, color: "#123456" },
      { offset: 1, color: "#abcdef" },
    ]);

    // The record owns the file-format invariant: shorthand is expanded and an
    // unavailable colour falls back instead of writing a stop the parser rejects.
    const normalized = createGradientRecord(
      "layer-a",
      { type: "linear", x1: 0, y1: 0, x2: 10, y2: 0 },
      "#0f0",
      "tomato",
      1,
    );
    expect(normalized.stops).toEqual([
      { offset: 0, color: "#00ff00" },
      { offset: 1, color: "#ffffff" },
    ]);
  });

  it("moves the free end without replacing the record when nothing changed", () => {
    const gradient = createGradient();
    expect(moveGradientEnd(gradient, 30, 42)).toBe(gradient);

    const moved = moveGradientEnd(gradient, 50, 60);
    expect(moved).not.toBe(gradient);
    expect(moved.id).toBe(gradient.id);
    expect(moved.stops).toBe(gradient.stops);
    expect([moved.x2, moved.y2]).toEqual([50, 60]);
  });

  it("measures linear length and flags too-short drags", () => {
    expect(gradientLength({ type: "linear", x1: 0, y1: 0, x2: 3, y2: 4 })).toBe(5);
    expect(gradientIsDegenerate({ type: "radial", x1: 8, y1: 8, x2: 8, y2: 8 })).toBe(true);
    expect(
      gradientIsDegenerate({
        type: "linear",
        x1: 0,
        y1: 0,
        x2: MIN_GRADIENT_LENGTH,
        y2: 0,
      }),
    ).toBe(false);
  });

  it("clones a gradient with fresh identity and independent stop objects", () => {
    const gradient = createGradient();
    const copy = cloneGradient(gradient, "layer-b");

    expect(copy.id).not.toBe(gradient.id);
    expect(copy.layerId).toBe("layer-b");
    expect(copy.type).toBe(gradient.type);
    expect(copy.opacity).toBe(gradient.opacity);
    expect(copy.stops).toEqual(gradient.stops);
    expect(copy.stops[0]).not.toBe(gradient.stops[0]);
  });
});

describe("createGradientCommand", () => {
  it("inserts the committed gradient at its index and refreshes the layer", () => {
    const gradient = createGradient();
    const { host, elements, refreshed } = createHost();
    const command = createGradientCommand(gradient, 1, host);

    expect(command.label).toBe("Gradient");
    command.apply();

    expect(elements).toEqual([gradient]);
    expect(refreshed).toEqual([gradient.layerId]);
  });

  it("removes on undo and re-inserts the same record on redo", () => {
    const gradient = createGradient();
    const { host, elements, refreshed } = createHost();
    const command = createGradientCommand(gradient, 0, host);

    command.apply();
    command.revert();
    expect(elements).toEqual([]);
    expect(refreshed).toEqual([gradient.layerId, gradient.layerId]);

    command.apply();
    expect(elements[0]).toBe(gradient);
    expect((elements[0] as GradientRecord).stops).toBe(gradient.stops);
  });

  it("returns to its painting index when undone and redone between elements", () => {
    const before = createGradient({ id: "gradient-before" });
    const middle = createGradient({ id: "gradient-middle" });
    const { host, elements } = createHost();
    host.insert(before);
    const command = createGradientCommand(middle, 1, host);
    command.apply();
    command.revert();
    command.apply();

    expect(elements.map((element) => element.id)).toEqual([
      "gradient-before",
      "gradient-middle",
    ]);
  });
});
