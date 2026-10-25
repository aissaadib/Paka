/**
 * The compact shape editor in the options bar.
 *
 * The controls are registered on the shape-edit tool, not on the shape tools:
 * they edit the **selected** shape, and they must appear only when there is one
 * and only for the kinds that can actually change. These tests pin down which
 * fields each kind shows, what they read, and which action each write reaches.
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import type {
  BoxShapeGeometry,
  LineShapeGeometry,
  ShapeGeometry,
  ShapeRecord,
} from "../core/document/types";
import type { EditorSnapshot } from "../core/engine/DrawingEngine";
import {
  MAX_SHAPE_INNER_RATIO,
  MAX_SHAPE_SIDES,
  MIN_SHAPE_INNER_RATIO,
  MIN_SHAPE_SIDES,
  SHAPE_INNER_RATIO_STEP,
} from "../core/tools/shapeOptions";
import type { EditorActions } from "../state/editorStore";
import {
  TOOL_OPTION_FIELDS,
  toolOptionLabel,
  visibleToolOptions,
  type ColorToolOption,
  type NumberToolOption,
  type SliderToolOption,
  type ToggleToolOption,
  type ToolOption,
} from "../features/options/toolOptionSchema";

function box(overrides: Partial<BoxShapeGeometry> = {}): BoxShapeGeometry {
  return {
    shape: "rectangle",
    x: 10,
    y: 20,
    width: 120,
    height: 60,
    rotation: 0,
    sides: 5,
    innerRatio: 0.5,
    ...overrides,
  };
}

function line(): LineShapeGeometry {
  return { shape: "line", x1: 10, y1: 20, x2: 110, y2: 70 };
}

function shape(
  geometry: ShapeGeometry,
  overrides: Partial<ShapeRecord> = {},
): ShapeRecord {
  return {
    id: "shape-1",
    layerId: "layer-1",
    kind: "shape",
    geometry,
    brush: DEFAULT_BRUSH,
    fill: false,
    ...overrides,
  };
}

function snapshotFor(selectedShape: ShapeRecord | null): EditorSnapshot {
  return {
    toolId: "shapeEdit",
    selectedShape,
    selectedShapeId: selectedShape?.id ?? null,
  } as unknown as EditorSnapshot;
}

/** The option ids the compact editor shows for a selection. */
function ids(selectedShape: ShapeRecord | null): string[] {
  return visibleToolOptions("shapeEdit", snapshotFor(selectedShape)).map(
    (option) => option.id,
  );
}

function optionById(selectedShape: ShapeRecord | null, id: string): ToolOption {
  const option = visibleToolOptions("shapeEdit", snapshotFor(selectedShape)).find(
    (entry) => entry.id === id,
  );
  if (!option) {
    throw new Error(`"${id}" is not visible for this selection`);
  }
  return option;
}

function asSlider(option: ToolOption): SliderToolOption {
  if (option.kind !== "slider") {
    throw new Error(`expected a slider, got "${option.kind}"`);
  }
  return option;
}

function asNumber(option: ToolOption): NumberToolOption {
  if (option.kind !== "number") {
    throw new Error(`expected a number, got "${option.kind}"`);
  }
  return option;
}

function asToggle(option: ToolOption): ToggleToolOption {
  if (option.kind !== "toggle") {
    throw new Error(`expected a toggle, got "${option.kind}"`);
  }
  return option;
}

function asColor(option: ToolOption): ColorToolOption {
  if (option.kind !== "color") {
    throw new Error(`expected a colour, got "${option.kind}"`);
  }
  return option;
}

function recorder() {
  const calls: Array<[string, ...unknown[]]> = [];
  const actions = {
    setSelectedShapeFill: vi.fn((value: boolean) =>
      calls.push(["setSelectedShapeFill", value]),
    ),
    setSelectedShapeSides: vi.fn((value: number) =>
      calls.push(["setSelectedShapeSides", value]),
    ),
    setSelectedShapeInnerRatio: vi.fn((value: number) =>
      calls.push(["setSelectedShapeInnerRatio", value]),
    ),
    setSelectedShapeRotation: vi.fn((value: number) =>
      calls.push(["setSelectedShapeRotation", value]),
    ),
    setSelectedShapeWidth: vi.fn((value: number) =>
      calls.push(["setSelectedShapeWidth", value]),
    ),
    setSelectedShapeHeight: vi.fn((value: number) =>
      calls.push(["setSelectedShapeHeight", value]),
    ),
    setSelectedShapeBrush: vi.fn((patch: Record<string, unknown>) =>
      calls.push(["setSelectedShapeBrush", patch]),
    ),
  } as unknown as EditorActions;
  return { actions, calls };
}

describe("the compact shape editor", () => {
  it("is registered on the shape-edit tool", () => {
    const fields = TOOL_OPTION_FIELDS.shapeEdit ?? [];
    expect(fields.map((field) => field.id)).toEqual([
      "shapeEditFill",
      "shapeEditSides",
      "shapeEditInnerRatio",
      "shapeEditRotation",
      "shapeEditWidth",
      "shapeEditHeight",
      "shapeEditColor",
      "shapeEditStroke",
      "shapeEditOpacity",
    ]);
  });

  it("shows nothing until a shape is selected", () => {
    expect(ids(null)).toEqual([]);
  });

  it("shows only the fields a rectangle can change", () => {
    expect(ids(shape(box()))).toEqual([
      "shapeEditFill",
      "shapeEditRotation",
      "shapeEditWidth",
      "shapeEditHeight",
      "shapeEditColor",
      "shapeEditStroke",
      "shapeEditOpacity",
    ]);
  });

  it("adds sides for a polygon but no inner radius", () => {
    expect(ids(shape(box({ shape: "polygon", sides: 6 })))).toEqual([
      "shapeEditFill",
      "shapeEditSides",
      "shapeEditRotation",
      "shapeEditWidth",
      "shapeEditHeight",
      "shapeEditColor",
      "shapeEditStroke",
      "shapeEditOpacity",
    ]);
  });

  it("adds sides and an inner radius for a star", () => {
    expect(ids(shape(box({ shape: "star", sides: 6 })))).toEqual([
      "shapeEditFill",
      "shapeEditSides",
      "shapeEditInnerRatio",
      "shapeEditRotation",
      "shapeEditWidth",
      "shapeEditHeight",
      "shapeEditColor",
      "shapeEditStroke",
      "shapeEditOpacity",
    ]);
  });

  it("offers a line only its appearance, since it has no box or interior", () => {
    expect(ids(shape(line()))).toEqual([
      "shapeEditColor",
      "shapeEditStroke",
      "shapeEditOpacity",
    ]);
  });

  it("labels the polygon's count Sides and the star's Points", () => {
    const polygon = optionById(shape(box({ shape: "polygon" })), "shapeEditSides");
    const star = optionById(shape(box({ shape: "star" })), "shapeEditSides");
    expect(toolOptionLabel(polygon, snapshotFor(shape(box({ shape: "polygon" }))))).toBe(
      "Sides",
    );
    expect(toolOptionLabel(star, snapshotFor(shape(box({ shape: "star" }))))).toBe(
      "Points",
    );
  });

  it("groups the geometry under Shape and the look under Appearance", () => {
    const selected = shape(box({ shape: "star" }));
    for (const id of [
      "shapeEditFill",
      "shapeEditSides",
      "shapeEditInnerRatio",
      "shapeEditRotation",
      "shapeEditWidth",
      "shapeEditHeight",
    ]) {
      expect(optionById(selected, id).group).toBe("Shape");
    }
    for (const id of ["shapeEditColor", "shapeEditStroke", "shapeEditOpacity"]) {
      expect(optionById(selected, id).group).toBe("Appearance");
    }
  });
});

describe("the compact shape editor's values", () => {
  const selected = shape(box({ shape: "star", sides: 8, innerRatio: 0.3, rotation: 45 }), {
    fill: true,
    brush: { ...DEFAULT_BRUSH, size: 14, opacity: 0.75, color: "#123456" },
  });
  const snapshot = snapshotFor(selected);

  it("reads the selected shape, not the tool defaults", () => {
    expect(asToggle(optionById(selected, "shapeEditFill")).read(snapshot)).toBe(true);
    expect(asSlider(optionById(selected, "shapeEditSides")).read(snapshot)).toBe(8);
    expect(asSlider(optionById(selected, "shapeEditInnerRatio")).read(snapshot)).toBe(
      0.3,
    );
    expect(asSlider(optionById(selected, "shapeEditRotation")).read(snapshot)).toBe(45);
    expect(asNumber(optionById(selected, "shapeEditWidth")).read(snapshot)).toBe(120);
    expect(asNumber(optionById(selected, "shapeEditHeight")).read(snapshot)).toBe(60);
    expect(asColor(optionById(selected, "shapeEditColor")).read(snapshot)).toBe(
      "#123456",
    );    expect(asSlider(optionById(selected, "shapeEditStroke")).read(snapshot)).toBe(14);
    expect(asSlider(optionById(selected, "shapeEditOpacity")).read(snapshot)).toBe(0.75);
  });

  it("bounds the count and the inner radius by the shape options' range", () => {
    const sides = asSlider(optionById(selected, "shapeEditSides"));
    expect(sides.min).toBe(MIN_SHAPE_SIDES);
    expect(sides.max).toBe(MAX_SHAPE_SIDES);
    const inner = asSlider(optionById(selected, "shapeEditInnerRatio"));
    expect(inner.min).toBe(MIN_SHAPE_INNER_RATIO);
    expect(inner.max).toBe(MAX_SHAPE_INNER_RATIO);
  });

  it("writes each field through the action that edits the selected shape", () => {
    const { actions, calls } = recorder();
    asToggle(optionById(selected, "shapeEditFill")).write(actions, false);
    asSlider(optionById(selected, "shapeEditSides")).write(actions, 6);
    asSlider(optionById(selected, "shapeEditInnerRatio")).write(actions, 0.4);
    asSlider(optionById(selected, "shapeEditRotation")).write(actions, 30);
    asNumber(optionById(selected, "shapeEditWidth")).write(actions, 150);
    asNumber(optionById(selected, "shapeEditHeight")).write(actions, 80);
    asColor(optionById(selected, "shapeEditColor")).write(actions, "#ff0000");
    asSlider(optionById(selected, "shapeEditStroke")).write(actions, 20);
    asSlider(optionById(selected, "shapeEditOpacity")).write(actions, 0.5);

    expect(calls).toEqual([
      ["setSelectedShapeFill", false],
      ["setSelectedShapeSides", 6],
      ["setSelectedShapeInnerRatio", 0.4],
      ["setSelectedShapeRotation", 30],
      ["setSelectedShapeWidth", 150],
      ["setSelectedShapeHeight", 80],
      ["setSelectedShapeBrush", { color: "#ff0000" }],
      ["setSelectedShapeBrush", { size: 20 }],
      ["setSelectedShapeBrush", { opacity: 0.5 }],
    ]);
  });

  it("snaps the inner radius to the control's step", () => {
    const { actions, calls } = recorder();
    asSlider(optionById(selected, "shapeEditInnerRatio")).write(actions, 0.3333);
    expect(calls).toEqual([
      [
        "setSelectedShapeInnerRatio",
        Math.round(0.3333 / SHAPE_INNER_RATIO_STEP) * SHAPE_INNER_RATIO_STEP,
      ],
    ]);
  });
});
