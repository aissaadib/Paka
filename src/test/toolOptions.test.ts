/**
 * Tool-option schema tests.
 *
 * The point of the schema is behavioural equivalence with the hand-written
 * controls it replaced, so these tests pin the fields each tool shows, the
 * labels, and the exact action each write reaches.
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import type { EditorSnapshot } from "../core/engine/DrawingEngine";
import type { EditorActions } from "../state/editorStore";
import type { ToolId } from "../types/tool";
import {
  TOOL_OPTION_GROUP_IDS,
  toolOptionFields,
  toolOptionGroups,
  toolOptionLabel,
  toolShowsBrushControls,
  type ToolOptionGroupId,
} from "../features/options/toolOptionSchema";

function snapshotFor(toolId: ToolId): EditorSnapshot {
  return {
    toolId,
    brush: { ...DEFAULT_BRUSH },
    shapeFill: true,
    shapeSides: 7,
    shapeInnerRatio: 0.42,
    shapeRotation: 33,
    fillTolerance: 19,
    fillReference: "merged",
    fillReferenceLayerId: null,
    fillExpand: 2,
    fillAntialias: 1,
    fillCloseGaps: 3,
    document: {
      activeLayerId: "layer-a",
      layers: [
        { id: "layer-a", name: "Paper", visible: true, opacity: 1, blendMode: "normal" },
        { id: "layer-b", name: "Lines", visible: false, opacity: 1, blendMode: "normal" },
      ],
    },
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
    setFillReference: vi.fn((value: string) => calls.push(["setFillReference", value])),
    setFillReferenceLayer: vi.fn((value: string | null) => calls.push(["setFillReferenceLayer", value])),
    setFillExpand: vi.fn((value: number) => calls.push(["setFillExpand", value])),
    setFillAntialias: vi.fn((value: number) => calls.push(["setFillAntialias", value])),
    setFillCloseGaps: vi.fn((value: number) => calls.push(["setFillCloseGaps", value])),
  } as unknown as EditorActions;
  return { actions, calls };
}

const ids = (toolId: ToolId, groupId: ToolOptionGroupId = "shape") =>
  toolOptionFields(groupId, toolId, snapshotFor(toolId)).map((option) => option.id);

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
  });

  it("shows the bucket the options the scanner really implements", () => {
    expect(ids("bucket", "fill")).toEqual([
      "fillReference",
      "fillTolerance",
      "fillExpand",
      "fillAntialias",
      "fillCloseGaps",
    ]);
  });

  it("only offers the layer picker in the layer reference mode", () => {
    const merged = toolOptionFields("fill", "bucket", snapshotFor("bucket"));
    expect(merged.map((option) => option.id)).not.toContain("fillReferenceLayer");

    const layered = toolOptionFields("fill", "bucket", {
      ...snapshotFor("bucket"),
      fillReference: "layer",
    } as EditorSnapshot);
    expect(layered.map((option) => option.id)).toContain("fillReferenceLayer");
  });

  it("gives tools without options an empty list", () => {
    // A tool the schema lists no group for shows nothing at all.
    for (const toolId of ["picker", "pan"] as const) {
      expect(TOOL_OPTION_GROUP_IDS[toolId] ?? []).toEqual([]);
      expect(toolOptionGroups(toolId, snapshotFor(toolId))).toEqual([]);
    }
  });

  it("keeps option ids unique within a tool", () => {
    for (const toolId of ["brush", "eraser", "line", "rectangle", "ellipse", "polygon", "star", "select", "bucket", "gradient"] as const) {
      const list = toolOptionGroups(toolId, snapshotFor(toolId)).flatMap((group) =>
        group.fields.map((field) => field.id),
      );
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("follows the active tool in the shared sides/points label", () => {
    const polygon = toolOptionFields("shape", "polygon", snapshotFor("polygon"))[0];
    const star = toolOptionFields("shape", "star", snapshotFor("star"))[0];
    expect(toolOptionLabel(polygon, snapshotFor("polygon"))).toBe("Sides");
    expect(toolOptionLabel(star, snapshotFor("star"))).toBe("Points");
  });
});

describe("tool option reads and writes", () => {
  it("reads the current snapshot values", () => {
    const snapshot = snapshotFor("star");
    const shape = toolOptionFields("shape", "star", snapshot);
    const sides = shape.find((option) => option.id === "shapeSides");
    const inner = shape.find((option) => option.id === "shapeInnerRatio");
    const rotation = shape.find((option) => option.id === "shapeRotation");
    const fill = shape.find((option) => option.id === "shapeFill");
    expect(sides?.kind === "slider" && sides.read(snapshot)).toBe(7);
    expect(inner?.kind === "slider" && inner.read(snapshot)).toBe(0.42);
    expect(rotation?.kind === "slider" && rotation.read(snapshot)).toBe(33);
    expect(fill?.kind === "toggle" && fill.read(snapshot)).toBe(true);

    const bucket = toolOptionFields("fill", "bucket", snapshot);
    const reference = bucket.find((option) => option.id === "fillReference");
    const tolerance = bucket.find((option) => option.id === "fillTolerance");
    const expand = bucket.find((option) => option.id === "fillExpand");
    const antialias = bucket.find((option) => option.id === "fillAntialias");
    const closeGaps = bucket.find((option) => option.id === "fillCloseGaps");
    expect(reference?.kind === "select" && reference.read(snapshot)).toBe("merged");
    expect(tolerance?.kind === "slider" && tolerance.read(snapshot)).toBe(19);
    expect(expand?.kind === "slider" && expand.read(snapshot)).toBe(2);
    expect(antialias?.kind === "slider" && antialias.read(snapshot)).toBe(1);
    expect(closeGaps?.kind === "slider" && closeGaps.read(snapshot)).toBe(3);
  });

  it("writes through the matching editor action", () => {
    const { actions, calls } = recorder();
    const snapshot = snapshotFor("star");
    for (const option of toolOptionFields("shape", "star", snapshot)) {
      if (option.kind === "toggle") {
        option.write(actions, false);
      } else if (option.kind === "slider") {
        option.write(actions, option.id === "shapeSides" ? 5 : 0.25);
      }
    }
    expect(calls).toEqual([
      ["setShapeSides", 5],
      ["setShapeInnerRatio", 0.25],
      ["setShapeRotation", 0.25],
      ["setShapeFill", false],
    ]);
  });

  it("writes the bucket's options through their own actions", () => {
    const { actions, calls } = recorder();
    const snapshot = snapshotFor("bucket");
    for (const option of toolOptionFields("fill", "bucket", snapshot)) {
      if (option.kind === "select") {
        option.write(actions, "active");
      } else if (option.kind === "slider") {
        option.write(actions, 5);
      }
    }
    expect(calls).toEqual([
      ["setFillReference", "active"],
      ["setFillTolerance", 5],
      ["setFillExpand", 5],
      ["setFillAntialias", 5],
      ["setFillCloseGaps", 5],
    ]);
  });

  it("snaps the star's inner radius to its step", () => {
    const { actions, calls } = recorder();
    const inner = toolOptionFields("shape", "star", snapshotFor("star")).find(
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
