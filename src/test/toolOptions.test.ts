/**
 * Tool-option schema tests.
 *
 * The point of the schema is behavioural equivalence with the hand-written
 * controls it replaced, so these tests pin the fields each tool shows, the
 * labels, and the exact action each write reaches.
 */

import { describe, expect, it, vi } from "vitest";
import type { EditorSnapshot } from "../core/engine/DrawingEngine";
import type { EditorActions } from "../state/editorStore";
import type { ToolId } from "../types/tool";
import {
  TOOL_OPTION_FIELDS,
  toolOptionLabel,
  toolShowsBrushControls,
  visibleToolOptions,
  type SliderToolOption,
  type ToggleToolOption,
  type ToolOption,
} from "../features/options/toolOptionSchema";

/** Narrows an option to the kind a test expects, so a wrong kind fails loudly. */
function asSlider(option: ToolOption): SliderToolOption {
  if (option.kind !== "slider") {
    throw new Error(`expected a slider, got "${option.kind}"`);
  }
  return option;
}

function asToggle(option: ToolOption): ToggleToolOption {
  if (option.kind !== "toggle") {
    throw new Error(`expected a toggle, got "${option.kind}"`);
  }
  return option;
}

function snapshotFor(toolId: ToolId): EditorSnapshot {
  return {
    toolId,
    shapeFill: true,
    shapeSides: 7,
    shapeInnerRatio: 0.42,
    shapeRotation: 33,
    fillTolerance: 19,
  } as unknown as EditorSnapshot;
}

function recorder() {
  const calls: Array<[string, unknown]> = [];
  const actions = {
    setShapeFill: vi.fn((value: boolean) => calls.push(["setShapeFill", value])),
    setShapeSides: vi.fn((value: number) => calls.push(["setShapeSides", value])),
    setShapeInnerRatio: vi.fn((value: number) => calls.push(["setShapeInnerRatio", value])),
    setShapeRotation: vi.fn((value: number) => calls.push(["setShapeRotation", value])),
    setFillTolerance: vi.fn((value: number) => calls.push(["setFillTolerance", value])),
  } as unknown as EditorActions;
  return { actions, calls };
}

const ids = (toolId: ToolId) =>
  visibleToolOptions(toolId, snapshotFor(toolId)).map((option) => option.id);

describe("tool option fields", () => {
  it("shows only the fields that belong to each tool", () => {
    expect(ids("rectangle")).toEqual(["shapeFill"]);
    expect(ids("ellipse")).toEqual(["shapeFill"]);
    expect(ids("polygon")).toEqual(["shapeSides", "shapeRotation", "shapeFill"]);
    expect(ids("star")).toEqual([
      "shapeSides",
      "shapeInnerRatio",
      "shapeRotation",
      "shapeFill",
    ]);
    expect(ids("bucket")).toEqual(["fillTolerance"]);
  });

  it("gives tools without options an empty list", () => {
    for (const toolId of ["brush", "eraser", "select", "line", "picker", "guides", "pan"] as const) {
      expect(ids(toolId)).toEqual([]);
    }
  });

  it("keeps option ids unique within a tool", () => {
    for (const fields of Object.values(TOOL_OPTION_FIELDS)) {
      const list = fields ?? [];
      expect(new Set(list.map((field) => field.id)).size).toBe(list.length);
    }
  });

  it("follows the active tool in the shared sides/points label", () => {
    const polygon = visibleToolOptions("polygon", snapshotFor("polygon"))[0];
    const star = visibleToolOptions("star", snapshotFor("star"))[0];
    expect(toolOptionLabel(polygon, snapshotFor("polygon"))).toBe("Sides");
    expect(toolOptionLabel(star, snapshotFor("star"))).toBe("Points");
  });
});

describe("tool option reads and writes", () => {
  it("reads the current snapshot values", () => {
    const snapshot = snapshotFor("star");
    const [sides, inner, rotation, fill] = visibleToolOptions("star", snapshot);
    expect(asSlider(sides).read(snapshot)).toBe(7);
    expect(asSlider(inner).read(snapshot)).toBe(0.42);
    expect(asSlider(rotation).read(snapshot)).toBe(33);
    expect(asToggle(fill).read(snapshot)).toBe(true);
    expect(asSlider(visibleToolOptions("bucket", snapshot)[0]).read(snapshot)).toBe(19);
  });

  it("writes through the matching editor action", () => {
    const { actions, calls } = recorder();
    const snapshot = snapshotFor("star");
    for (const option of visibleToolOptions("star", snapshot)) {
      if (option.kind === "toggle") {
        option.write(actions, false);
      } else {
        asSlider(option).write(actions, option.id === "shapeSides" ? 5 : 0.25);
      }
    }
    expect(calls).toEqual([
      ["setShapeSides", 5],
      ["setShapeInnerRatio", 0.25],
      ["setShapeRotation", 0.25],
      ["setShapeFill", false],
    ]);
  });

  it("snaps the star's inner radius to its step", () => {
    const { actions, calls } = recorder();
    const inner = visibleToolOptions("star", snapshotFor("star")).find(
      (option) => option.id === "shapeInnerRatio",
    );
    if (!inner || inner.kind !== "slider") {
      throw new Error("star inner radius control is missing");
    }
    inner.write(actions, 0.333);
    const [, value] = calls[0];
    // The step is 0.05: 0.333 snaps to 0.35, the nearest reachable ratio.
    expect(value).toBeCloseTo(0.35, 10);
  });
});

describe("brush group visibility", () => {
  it("shows the brush group for tools that paint with a brush", () => {
    for (const toolId of [
      "brush",
      "eraser",
      "line",
      "rectangle",
      "ellipse",
      "polygon",
      "star",
      "gradient",
    ] as const) {
      expect(toolShowsBrushControls(toolId)).toBe(true);
    }
  });

  it("hides the brush group for tools that do not use it", () => {
    for (const toolId of ["select", "bucket", "picker", "guides", "pan"] as const) {
      expect(toolShowsBrushControls(toolId)).toBe(false);
    }
  });
});
