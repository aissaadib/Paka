/**
 * Tool-options tests.
 *
 * The schema is the options bar's contract: which groups a tool shows, which
 * controls each group holds, what every control reads, and which editor
 * action it reaches. These tests pin that contract against the *real* engine,
 * so a control that stops changing something real fails here rather than in
 * the app.
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import type { EditorSnapshot } from "../core/engine/DrawingEngine";
import {
  isToolOptionDisabled,
  TOOL_OPTION_GROUP_IDS,
  toolOptionFields,
  toolOptionGroups,
  toolOptionLabel,
  toolShowsBrushControls,
  toolUsesWholeBrush,
  type SliderToolOption,
  type ToolOption,
  type ToolOptionGroupId,
} from "../features/options/toolOptionSchema";
import { createEditor, type Editor, type EditorActions } from "../state/editorStore";
import type { ToolId } from "../types/tool";
import { MemoryProjectGateway } from "./support/memoryGateway";

const ALL_TOOLS: readonly ToolId[] = [
  "brush",
  "eraser",
  "select",
  "line",
  "rectangle",
  "ellipse",
  "polygon",
  "star",
  "bucket",
  "gradient",
  "picker",
  "guides",
  "pan",
];

function createTestEditor(): Editor {
  return createEditor({ fileGateway: new MemoryProjectGateway() });
}

/** An editor whose active tool is `toolId`. */
function editorFor(toolId: ToolId): Editor {
  const editor = createTestEditor();
  editor.actions.setTool(toolId);
  return editor;
}

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
  return editorFor(toolId).getState();
}

function groupIds(toolId: ToolId): readonly ToolOptionGroupId[] {
  return toolOptionGroups(toolId, snapshotFor(toolId)).map((group) => group.id);
}

function fieldIds(groupId: ToolOptionGroupId, toolId: ToolId): readonly string[] {
  return toolOptionFields(groupId, toolId, snapshotFor(toolId)).map((option) => option.id);
}

/** Records which editor action each control reaches. */
function recorder() {
  const calls: Array<[string, unknown]> = [];
  const actions = {
    setBrush: vi.fn((patch: unknown) => calls.push(["setBrush", patch])),
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
    setGradientType: vi.fn((value: string) => calls.push(["setGradientType", value])),
    setGradientEndColor: vi.fn((value: string) => calls.push(["setGradientEndColor", value])),
    duplicateSelection: vi.fn(() => calls.push(["duplicateSelection", undefined])),
    flipSelection: vi.fn((axis: string) => calls.push(["flipSelection", axis])),
    deleteSelection: vi.fn(() => calls.push(["deleteSelection", undefined])),
    clearSelection: vi.fn(() => calls.push(["clearSelection", undefined])),
  } as unknown as EditorActions;
  return { actions, calls };
}

const ids = (toolId: ToolId, groupId: ToolOptionGroupId = "shape") =>
  toolOptionFields(groupId, toolId, snapshotFor(toolId)).map((option) => option.id);
/** The values a control could be moved to, best first. */
function candidateValues(option: ToolOption, snapshot: EditorSnapshot): Array<number | boolean | string> {
  if (option.kind === "action") {
    return [];
  }
  if (option.kind === "toggle") {
    return [!option.read(snapshot)];
  }
  if (option.kind === "color") {
    return ["#123456", "#654321", "#00ff00", "#000000"];
  }
  const current = option.read(snapshot);
  const span = option.max - option.min;
  const values: number[] = [];
  for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9, 0, 1]) {
    values.push(option.min + span * fraction);
  }
  values.push(current + option.step, current - option.step);
  return values;
}

/** Writes a value through a control, whatever kind it is. */
function write(option: ToolOption, actions: EditorActions, value: number | boolean | string): void {
  if (option.kind === "toggle") {
    option.write(actions, value as boolean);
    return;
  }
  if (option.kind === "color") {
    option.write(actions, value as string);
    return;
  }
  if (option.kind === "slider") {
    option.write(actions, value as number);
  }
}

/** The slider control with the given id, or a failure. */
function sliderWithId(fields: readonly ToolOption[], id: string): SliderToolOption {
  const option = fields.find((field) => field.id === id);
  if (!option || option.kind !== "slider") {
    throw new Error(`the slider "${id}" is missing`);
  }
  return option;
}

describe("the groups each tool shows", () => {
  it("shows the brush for the tools that paint with one", () => {
    expect(groupIds("brush")).toEqual(["brush"]);
    expect(groupIds("eraser")).toEqual(["brush"]);
    expect(groupIds("line")).toEqual(["brush"]);
  });

  it("shows the brush and the shape for the shape tools", () => {
    expect(groupIds("rectangle")).toEqual(["brush", "shape"]);
    expect(groupIds("ellipse")).toEqual(["brush", "shape"]);
    expect(groupIds("polygon")).toEqual(["brush", "shape"]);
    expect(groupIds("star")).toEqual(["brush", "shape"]);
  });

  it("shows the selection actions for the select tool", () => {
    expect(groupIds("select")).toEqual(["selection"]);
  });

  it("shows the tolerance for the bucket and the gradient's own controls", () => {
    expect(groupIds("bucket")).toEqual(["fill"]);
    expect(groupIds("gradient")).toEqual(["brush", "gradient"]);
  });

  it("gives the tools without options no group at all", () => {
    expect(groupIds("picker")).toEqual([]);
    expect(groupIds("guides")).toEqual([]);
    expect(groupIds("pan")).toEqual([]);
  });

  it("names a group for every tool it lists", () => {
    for (const toolId of ALL_TOOLS) {
      const ids = TOOL_OPTION_GROUP_IDS[toolId] ?? [];
      expect(new Set(ids).size, `${toolId} lists a group twice`).toBe(ids.length);
    }
  });
});

describe("the controls inside a group", () => {
  it("shows only the shape controls that belong to the tool", () => {
    expect(fieldIds("shape", "rectangle")).toEqual(["shapeFill"]);
    expect(fieldIds("shape", "ellipse")).toEqual(["shapeFill"]);
    expect(fieldIds("shape", "polygon")).toEqual(["shapeSides", "shapeRotation", "shapeFill"]);
    expect(fieldIds("shape", "star")).toEqual([
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

  it("shows only the brush controls the tool really reads", () => {
    // The brush and the eraser sample a path, so they use the whole brush.
    expect(fieldIds("brush", "brush")).toContain("brushStabilizer");
    expect(fieldIds("brush", "eraser")).toContain("brushStabilizer");
    // A shape traces an outline: no sample density, no stabilizer, no dabs and
    // no pressure, but it does have a width, an opacity, an edge and a grain.
    expect(fieldIds("brush", "star")).not.toContain("brushStabilizer");
    expect(fieldIds("brush", "star")).not.toContain("brushStamp");
    expect(fieldIds("brush", "star")).not.toContain("brushPressureSize");
    expect(fieldIds("brush", "star")).toContain("brushTexture");
    expect(fieldIds("brush", "star")).toContain("brushHardness");
    // A gradient captures the brush's opacity and nothing else.
    expect(fieldIds("brush", "gradient")).toEqual(["brushOpacity"]);
  });

  it("keeps the size and the opacity in the strip and the rest behind the popover", () => {
    const fields = toolOptionFields("brush", "brush", snapshotFor("brush"));
    const inline = fields.filter((field) => field.placement !== "popover").map((f) => f.id);
    const popover = fields.filter((field) => field.placement === "popover").map((f) => f.id);
    expect(inline).toEqual(["brushSize", "brushOpacity"]);
    expect(popover).toContain("brushHardness");
    expect(popover).toContain("brushSampling");
    expect(popover).toContain("brushTexture");
    expect(popover).toContain("brushStamp");
  });

  it("hides the stamp's own controls while the stamp is off", () => {
    const off = fieldIds("brush", "brush");
    expect(off).not.toContain("brushStampSpacing");

    const editor = editorFor("brush");
    editor.actions.setBrush({ stamp: true });
    const on = toolOptionFields("brush", "brush", editor.getState()).map((f) => f.id);
    expect(on).toContain("brushStampSpacing");
    expect(on).toContain("brushStampHardness");
    expect(on).toContain("brushStampTexture");
  });

  it("follows the active tool in the shared sides/points label", () => {
    const polygon = toolOptionFields("shape", "polygon", snapshotFor("polygon"))[0];
    const star = toolOptionFields("shape", "star", snapshotFor("star"))[0];
    expect(toolOptionLabel(polygon, snapshotFor("polygon"))).toBe("Sides");
    expect(toolOptionLabel(star, snapshotFor("star"))).toBe("Points");
  });

  it("gives every control a label and a tooltip", () => {
    for (const toolId of ALL_TOOLS) {
      for (const group of toolOptionGroups(toolId, snapshotFor(toolId))) {
        for (const option of group.fields) {
          const label = toolOptionLabel(option, snapshotFor(toolId));
          expect(label, `${toolId}/${option.id} has no label`).not.toBe("");
          expect(option.title, `${toolId}/${option.id} has no tooltip`).toBeTruthy();
        }
      }
    }
  });
});

describe("reading the controls", () => {
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
    const editor = editorFor("star");
    editor.actions.setShapeSides(7);
    editor.actions.setShapeInnerRatio(0.42);
    editor.actions.setShapeRotation(33);
    editor.actions.setShapeFill(true);
    const snapshot = editor.getState();
    const fields = toolOptionFields("shape", "star", snapshot);
    expect(sliderWithId(fields, "shapeSides").read(snapshot)).toBe(7);
    expect(sliderWithId(fields, "shapeInnerRatio").read(snapshot)).toBe(0.42);
    expect(sliderWithId(fields, "shapeRotation").read(snapshot)).toBe(33);
    const fill = fields.find((field) => field.id === "shapeFill");
    if (fill?.kind !== "toggle") {
      throw new Error("the fill toggle is missing");
    }
    expect(fill.read(snapshot)).toBe(true);
  });

  it("reads the brush values the brush group shows", () => {
    const editor = editorFor("brush");
    editor.actions.setBrush({ size: 24, opacity: 0.5, hardness: 0.25 });
    const snapshot = editor.getState();
    const fields = toolOptionFields("brush", "brush", snapshot);
    expect(sliderWithId(fields, "brushSize").read(snapshot)).toBe(24);
    expect(sliderWithId(fields, "brushOpacity").read(snapshot)).toBe(0.5);
    expect(sliderWithId(fields, "brushHardness").read(snapshot)).toBe(0.25);
  });
});

describe("writing the controls", () => {
  it("changes the engine's real state for every visible control", () => {
    for (const toolId of ALL_TOOLS) {
      const editor = editorFor(toolId);
      // The stamp's own controls only exist while the stamp is on, so the
      // whole brush group is exercised with it on.
      if (toolId === "brush" || toolId === "eraser") {
        editor.actions.setBrush({ stamp: true });
      }
      const snapshot = editor.getState();
      for (const group of toolOptionGroups(toolId, snapshot)) {
        for (const option of group.fields) {
          if (option.kind === "action") {
            continue;
          }
          const before = JSON.stringify(editor.getState());
          const changed = candidateValues(option, snapshot).some((value) => {
            write(option, editor.actions, value);
            return JSON.stringify(editor.getState()) !== before;
          });
          expect(
            changed,
            `${toolId}/${group.id}/${option.id} changed nothing in the engine`,
          ).toBe(true);
        }
      }
    }
  });

  it("reaches the matching editor action", () => {
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
  it("writes the brush through the brush setter", () => {
    const { actions, calls } = recorder();
    const snapshot = snapshotFor("brush");
    const size = sliderWithId(toolOptionFields("brush", "brush", snapshot), "brushSize");
    size.write(actions, 42);
    expect(calls).toEqual([["setBrush", { size: 42 }]]);
  });

  it("snaps the star's inner radius to its step", () => {
    const { actions, calls } = recorder();
    const inner = toolOptionFields("shape", "star", snapshotFor("star")).find(
      (option) => option.id === "shapeInnerRatio",
    const inner = sliderWithId(
      toolOptionFields("shape", "star", snapshotFor("star")),
      "shapeInnerRatio",
    );
    inner.write(actions, 0.333);
    const [, value] = calls[0];
    // The step is 0.05: 0.333 snaps to 0.35, the nearest reachable ratio.
    expect(value).toBeCloseTo(0.35, 10);
  });

  it("keeps the options when the tool changes", () => {
    const editor = createTestEditor();
    editor.actions.setTool("polygon");
    editor.actions.setShapeSides(11);
    editor.actions.setShapeRotation(45);
    editor.actions.setBrush({ size: 23 });

    editor.actions.setTool("brush");
    editor.actions.setBrush({ size: 31 });

    editor.actions.setTool("polygon");
    const state = editor.getState();
    expect(state.shapeSides).toBe(11);
    expect(state.shapeRotation).toBe(45);
    expect(state.brush.size).toBe(31);
  });

  it("does not make the document dirty", () => {
    const editor = editorFor("star");
    editor.actions.setShapeSides(9);
    editor.actions.setShapeRotation(12);
    editor.actions.setBrush({ size: 19 });
    expect(editor.getState().file.dirty).toBe(false);
  });
});

describe("the selection actions", () => {
  it("reaches the editor's selection actions", () => {
    const { actions, calls } = recorder();
    const snapshot = snapshotFor("select");
    for (const option of toolOptionFields("selection", "select", snapshot)) {
      if (option.kind === "action") {
        option.run(actions);
      }
    }
    expect(calls).toEqual([
      ["duplicateSelection", undefined],
      ["flipSelection", "horizontal"],
      ["flipSelection", "vertical"],
      ["deleteSelection", undefined],
      ["clearSelection", undefined],
    ]);
  });

  it("is disabled while nothing is selected", () => {
    const editor = editorFor("select");
    const snapshot = editor.getState();
    expect(snapshot.selectedStrokes).toBe(0);
    for (const option of toolOptionFields("selection", "select", snapshot)) {
      expect(isToolOptionDisabled(option, snapshot), option.id).toBe(true);
    }
  });

  it("is enabled once strokes are selected", () => {
    const selected = { ...snapshotFor("select"), selectedStrokes: 3 };
    for (const option of toolOptionFields("selection", "select", selected)) {
      expect(isToolOptionDisabled(option, selected), option.id).toBe(false);
    }
  });

  it("names the shortcut the action already has", () => {
    const snapshot = snapshotFor("select");
    const duplicate = toolOptionFields("selection", "select", snapshot).find(
      (option) => option.id === "selectionDuplicate",
    );
    if (duplicate?.kind !== "action") {
      throw new Error("the duplicate action is missing");
    }
    expect(duplicate.shortcut).toBe("Ctrl+D");
  });
});

describe("the brush group", () => {
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
      expect(toolShowsBrushControls(toolId), toolId).toBe(true);
    }
  });

  it("hides the brush group for tools that do not use it", () => {
    for (const toolId of ["select", "bucket", "picker", "guides", "pan"] as const) {
      expect(toolShowsBrushControls(toolId), toolId).toBe(false);
    }
  });

  it("offers the whole brush only to the tools that use all of it", () => {
    expect(toolUsesWholeBrush("brush")).toBe(true);
    expect(toolUsesWholeBrush("eraser")).toBe(true);
    expect(toolUsesWholeBrush("star")).toBe(false);
    expect(toolUsesWholeBrush("gradient")).toBe(false);
  });
});
