/**
 * Tool option contract tests.
 *
 * The contract is the registry: a tool's options are registered, not
 * hard-wired, so a feature can add an option to a tool it does not own. What
 * matters is that the registry is predictable, that a duplicate id does not
 * show a control twice, and that a group with no visible children disappears.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  appendToolOptions,
  findToolOption,
  isToolOptionKind,
  registerToolOptions,
  resetToolOptions,
  toolOptionLabel,
  toolOptionsFor,
  unregisterToolOptions,
  visibleToolOptions,
  type ToggleToolOption,
  type SliderToolOption,
} from "../core/shell/toolOptions";
import type { EditorSnapshot } from "../core/engine/DrawingEngine";
import type { EditorActions } from "../state/editorStore";

function snapshotFor(toolId: string): EditorSnapshot {
  return { toolId } as unknown as EditorSnapshot;
}

const toggle: ToggleToolOption = {
  id: "toggle",
  kind: "toggle",
  label: "Toggle",
  read: () => true,
  write: () => undefined,
};

const slider: SliderToolOption = {
  id: "slider",
  kind: "slider",
  label: "Slider",
  min: 0,
  max: 1,
  step: 0.1,
  read: () => 0.5,
  write: () => undefined,
};

beforeEach(() => {
  resetToolOptions();
});

describe("the tool option registry", () => {
  it("starts empty", () => {
    expect(toolOptionsFor("brush")).toEqual([]);
  });

  it("registers a tool's options in order", () => {
    registerToolOptions("brush", [toggle, slider]);
    expect(toolOptionsFor("brush").map((option) => option.id)).toEqual(["toggle", "slider"]);
  });

  it("replaces a tool's options when they are registered again", () => {
    registerToolOptions("brush", [toggle, slider]);
    registerToolOptions("brush", [slider]);
    expect(toolOptionsFor("brush").map((option) => option.id)).toEqual(["slider"]);
  });

  it("appends without removing what is already there", () => {
    registerToolOptions("brush", [toggle]);
    appendToolOptions("brush", [slider]);
    expect(toolOptionsFor("brush").map((option) => option.id)).toEqual(["toggle", "slider"]);
  });

  it("does not add the same option twice", () => {
    registerToolOptions("brush", [toggle]);
    appendToolOptions("brush", [toggle, slider]);
    expect(toolOptionsFor("brush").map((option) => option.id)).toEqual(["toggle", "slider"]);
  });

  it("removes a tool's options", () => {
    registerToolOptions("brush", [toggle]);
    expect(unregisterToolOptions("brush")).toBe(true);
    expect(unregisterToolOptions("brush")).toBe(false);
  });
});

describe("the kinds of tool option", () => {
  it("names the kinds the contract lists", () => {
    expect(isToolOptionKind("slider")).toBe(true);
    expect(isToolOptionKind("group")).toBe(true);
  });

  it("refuses a kind it does not know", () => {
    expect(isToolOptionKind("hologram")).toBe(false);
    expect(isToolOptionKind("")).toBe(false);
    expect(isToolOptionKind(7)).toBe(false);
    expect(isToolOptionKind(undefined)).toBe(false);
  });
});

describe("visible tool options", () => {
  it("hides an option whose rule says so", () => {
    registerToolOptions("brush", [
      { ...toggle, visible: () => false },
      slider,
    ]);
    expect(visibleToolOptions("brush", snapshotFor("brush")).map((o) => o.id)).toEqual([
      "slider",
    ]);
  });

  it("keeps a group with at least one visible child", () => {
    registerToolOptions("brush", [
      {
        id: "group",
        kind: "group",
        label: "Group",
        children: [{ ...toggle, visible: () => false }, slider],
      },
    ]);
    const visible = visibleToolOptions("brush", snapshotFor("brush"));
    expect(visible).toHaveLength(1);
    expect(visible[0].kind).toBe("group");
    expect(visible[0].kind === "group" && visible[0].children.map((c) => c.id)).toEqual([
      "slider",
    ]);
  });

  it("drops a group with no visible children", () => {
    registerToolOptions("brush", [
      {
        id: "group",
        kind: "group",
        label: "Group",
        children: [{ ...toggle, visible: () => false }],
      },
    ]);
    expect(visibleToolOptions("brush", snapshotFor("brush"))).toEqual([]);
  });

  it("resolves a label that follows the tool", () => {
    registerToolOptions("brush", [
      { ...toggle, label: (snapshot) => (snapshot.toolId === "brush" ? "B" : "E") },
    ]);
    const option = visibleToolOptions("brush", snapshotFor("brush"))[0];
    expect(toolOptionLabel(option, snapshotFor("brush"))).toBe("B");
    expect(toolOptionLabel(option, snapshotFor("eraser"))).toBe("E");
  });
});

describe("finding an option", () => {
  it("finds an option at the top level", () => {
    registerToolOptions("brush", [toggle, slider]);
    expect(findToolOption("brush", "slider")).toBe(slider);
  });

  it("finds an option inside a group", () => {
    registerToolOptions("brush", [
      { id: "group", kind: "group", label: "Group", children: [slider] },
    ]);
    expect(findToolOption("brush", "slider")).toBe(slider);
  });

  it("returns nothing for an unknown id", () => {
    registerToolOptions("brush", [toggle]);
    expect(findToolOption("brush", "nope")).toBeUndefined();
  });
});

describe("writing an option", () => {
  it("reaches the action it names", () => {
    const write = vi.fn();
    registerToolOptions("brush", [
      { ...toggle, write },
    ]);
    const option = visibleToolOptions("brush", snapshotFor("brush"))[0];
    if (option.kind !== "toggle") {
      throw new Error("expected a toggle");
    }
    option.write({} as EditorActions, false);
    expect(write).toHaveBeenCalledWith({}, false);
  });
});
