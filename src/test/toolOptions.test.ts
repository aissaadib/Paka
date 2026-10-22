/**
 * Tool-option schema tests.
 *
 * The point of the schema is behavioural equivalence with the hand-written
 * controls it replaced, so these tests pin the fields each tool shows, the
 * labels, and the exact action each write reaches.
 *
 * The second half of the file covers the options bar: the control the bar
 * draws for every kind the contract defines, the layout it lays them out in,
 * and the path a feature takes when it adds an option to a tool it does not
 * own.
 */

import { describe, expect, it, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import type { EditorSnapshot } from "../core/engine/DrawingEngine";
import type { EditorActions, Editor } from "../state/editorStore";
import { EditorContext } from "../state/editorContext";
import type { ToolId } from "../types/tool";
import {
  appendToolOptions,
  TOOL_OPTION_KINDS,
  unregisterToolOptions,
  type ToolOptionKind,
} from "../core/shell/toolOptions";
import {
  colorInputValue,
  groupToolOptions,
  optionControl,
  optionStepValue,
  OPTION_CONTROL_KINDS,
} from "../core/options/optionControl";
import { OptionControl } from "../features/options/OptionControl";
import { ToolOptionsBar } from "../features/options/ToolOptionsBar";
import {
  TOOL_OPTION_FIELDS,
  toolOptionLabel,
  toolShowsBrushControls,
  visibleToolOptions,
  type ColorToolOption,
  type GroupToolOption,
  type NumberToolOption,
  type SelectToolOption,
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
    // The bar draws the brush's primary controls for a brush-using tool, so
    // the snapshot carries the brush and the preset list the real one does.
    brush: DEFAULT_BRUSH,
    presets: [],
    document: { background: "#ffffff" },
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
    setGridSnapping: vi.fn((value: boolean) => calls.push(["setGridSnapping", value])),
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

/* ------------------------------------------------------------------ options bar */

const sliderOption: SliderToolOption = {
  id: "slider",
  kind: "slider",
  label: "Slider",
  min: 0,
  max: 10,
  step: 1,
  read: () => 4,
  write: () => undefined,
};

const numberOption: NumberToolOption = {
  id: "number",
  kind: "number",
  label: "Number",
  min: 0,
  max: 10,
  step: 1,
  read: () => 6,
  write: () => undefined,
};

const toggleOption: ToggleToolOption = {
  id: "toggle",
  kind: "toggle",
  label: "Toggle",
  read: () => true,
  write: () => undefined,
};

const selectOption: SelectToolOption = {
  id: "select",
  kind: "select",
  label: "Select",
  choices: [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ],
  read: () => "b",
  write: () => undefined,
};

const colorOption: ColorToolOption = {
  id: "color",
  kind: "color",
  label: "Colour",
  read: () => "#ff8800",
  write: () => undefined,
};

const groupOption: GroupToolOption = {
  id: "group",
  kind: "group",
  label: "Group",
  children: [toggleOption, sliderOption],
};

/** One option of each kind the contract defines. */
const optionByKind: Record<ToolOptionKind, ToolOption> = {
  slider: sliderOption,
  number: numberOption,
  toggle: toggleOption,
  select: selectOption,
  color: colorOption,
  group: groupOption,
};

/** The markup the options bar draws for one option. */
function markupOf(option: ToolOption): string {
  const { actions } = recorder();
  return renderToStaticMarkup(
    createElement(OptionControl, {
      option,
      snapshot: snapshotFor("brush"),
      actions,
    }),
  );
}

describe("the option control", () => {
  it("builds a control for every kind the contract defines", () => {
    expect([...TOOL_OPTION_KINDS]).toEqual([
      "slider",
      "number",
      "toggle",
      "select",
      "color",
      "group",
    ]);
    const { actions } = recorder();
    for (const kind of TOOL_OPTION_KINDS) {
      const control = optionControl(optionByKind[kind], snapshotFor("brush"), actions);
      expect(control.kind).toBe(kind);
    }
  });

  it("has a drawing for every kind the contract lists", () => {
    // The dispatch on the kind lives in one place, and it is exhaustive
    // against the contract's list: a kind the contract gains without a
    // builder is a compile error in the module that holds the dispatch, and
    // in no other. The options bar draws the drawing, not the kind, so a
    // new kind does not reach it.
    const { actions } = recorder();
    for (const kind of TOOL_OPTION_KINDS) {
      const control = optionControl(optionByKind[kind], snapshotFor("brush"), actions);
      expect(OPTION_CONTROL_KINDS).toContain(control.kind);
    }
  });

  it("knows the drawings it can draw", () => {
    expect([...OPTION_CONTROL_KINDS]).toEqual([
      "slider",
      "number",
      "toggle",
      "select",
      "color",
      "group",
    ]);
  });

  it("draws a control for every kind", () => {
    expect(markupOf(sliderOption)).toContain('type="range"');
    expect(markupOf(numberOption)).toContain('type="number"');
    expect(markupOf(toggleOption)).toContain('type="checkbox"');
    expect(markupOf(selectOption)).toContain("<select");
    expect(markupOf(colorOption)).toContain('type="color"');
    expect(markupOf(groupOption)).toContain("<fieldset");
  });

  it("draws a group's children with the same control", () => {
    const markup = markupOf(groupOption);
    expect(markup).toContain("Toggle");
    expect(markup).toContain("Slider");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('type="range"');
  });

  it("refuses a kind it does not know rather than showing nothing", () => {
    const bogus = {
      id: "bogus",
      kind: "hologram",
      label: "Bogus",
    } as unknown as ToolOption;
    const { actions } = recorder();
    expect(() => optionControl(bogus, snapshotFor("brush"), actions)).toThrow(
      /Unknown tool option kind/,
    );
    expect(() => markupOf(bogus)).toThrow(/Unknown tool option kind/);
  });

  it("keeps a value inside the option's range", () => {
    const { actions } = recorder();
    const control = optionControl(
      { ...sliderOption, read: () => 99 },
      snapshotFor("brush"),
      actions,
    );
    expect(control).toMatchObject({ kind: "slider", value: 10 });
  });

  it("falls back to the first choice when the value is not one of them", () => {
    const { actions } = recorder();
    const control = optionControl(
      { ...selectOption, read: () => "missing" },
      snapshotFor("brush"),
      actions,
    );
    expect(control).toMatchObject({ kind: "select", value: "a" });
  });

  it("writes a number on the option's step", () => {
    const write = vi.fn();
    const { actions } = recorder();
    const control = optionControl({ ...numberOption, write }, snapshotFor("brush"), actions);
    if (control.kind !== "number") {
      throw new Error("expected a number control");
    }
    control.write(4.4);
    expect(write).toHaveBeenCalledWith(actions, 4);
  });

  it("writes nothing for a value that is not a number", () => {
    const write = vi.fn();
    const { actions } = recorder();
    const control = optionControl({ ...numberOption, write }, snapshotFor("brush"), actions);
    if (control.kind !== "number") {
      throw new Error("expected a number control");
    }
    control.write(Number.NaN);
    expect(write).not.toHaveBeenCalled();
  });

  it("shows a colour the native colour well understands", () => {
    expect(colorInputValue("#abc")).toBe("#aabbcc");
    expect(colorInputValue("#112233")).toBe("#112233");
    expect(colorInputValue("#11223344")).toBe("#112233");
    expect(colorInputValue("nonsense")).toBe("#000000");
  });

  it("snaps a value onto the step and inside the range", () => {
    expect(optionStepValue(0.333, 0, 1, 0.05)).toBeCloseTo(0.35, 10);
    expect(optionStepValue(-4, 0, 10, 1)).toBe(0);
    expect(optionStepValue(40, 0, 10, 1)).toBe(10);
  });
});

describe("the options bar layout", () => {
  it("keeps the options in the order they were registered", () => {
    const groups = groupToolOptions([toggleOption, sliderOption, numberOption]);
    expect(groups).toHaveLength(1);
    expect(groups[0].options.map((option) => option.id)).toEqual([
      "toggle",
      "slider",
      "number",
    ]);
  });

  it("groups the options under the heading they carry", () => {
    const groups = groupToolOptions([
      { ...toggleOption, group: "Behaviour" },
      sliderOption,
      { ...numberOption, group: "Behaviour" },
    ]);
    expect(groups.map((group) => group.id)).toEqual(["Behaviour", ""]);
    expect(groups[0].label).toBe("Behaviour");
    expect(groups[0].options.map((option) => option.id)).toEqual(["toggle", "number"]);
    expect(groups[1].options.map((option) => option.id)).toEqual(["slider"]);
  });

  it("has no groups when there are no options", () => {
    expect(groupToolOptions([])).toEqual([]);
  });
});

describe("the options bar", () => {
  it("shows the active tool's name and the options it registered", () => {
    const snapshot = snapshotFor("star");
    const editor = {
      engine: {},
      actions: {},
      files: {},
      getState: () => snapshot,
      subscribe: () => () => undefined,
    } as unknown as Editor;
    const markup = renderToStaticMarkup(
      createElement(
        EditorContext.Provider,
        { value: editor },
        createElement(ToolOptionsBar),
      ),
    );
    expect(markup).toContain("Star");
    expect(markup).toContain("Points");
    expect(markup).toContain("Fill shape");
  });

  it("says what a tool with no options is for", () => {
    const snapshot = snapshotFor("pan");
    const editor = {
      engine: {},
      actions: {},
      files: {},
      getState: () => snapshot,
      subscribe: () => () => undefined,
    } as unknown as Editor;
    const markup = renderToStaticMarkup(
      createElement(
        EditorContext.Provider,
        { value: editor },
        createElement(ToolOptionsBar),
      ),
    );
    expect(markup).toContain("Pan");
    expect(markup).not.toContain('type="range"');
  });
});

describe("a feature that adds an option to a tool it does not own", () => {
  afterEach(() => {
    unregisterToolOptions("brush");
  });

  it("shows the appended option in the bar", () => {
    const write = vi.fn();
    appendToolOptions("brush", [
      {
        id: "featureToggle",
        kind: "toggle",
        label: "Feature",
        read: () => false,
        write,
      },
    ]);
    const visible = visibleToolOptions("brush", snapshotFor("brush"));
    expect(visible.map((option) => option.id)).toEqual(["featureToggle"]);
    expect(markupOf(visible[0])).toContain("Feature");
  });

  it("reaches the action the feature named", () => {
    const { actions, calls } = recorder();
    appendToolOptions("brush", [
      {
        id: "featureToggle",
        kind: "toggle",
        label: "Feature",
        read: () => false,
        write: (editorActions, value) => editorActions.setGridSnapping(value),
      },
    ]);
    const visible = visibleToolOptions("brush", snapshotFor("brush"));
    const option = visible[0];
    if (option.kind !== "toggle") {
      throw new Error("expected a toggle");
    }
    option.write(actions, true);
    expect(calls).toEqual([["setGridSnapping", true]]);
  });
});
