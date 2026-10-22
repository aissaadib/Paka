/**
 * The tool rail's model.
 *
 * The rail's rules - which tools are grouped, which slot is active, where a
 * click goes and how the temporary pan tool is left again - live in a
 * DOM-free module (`core/tools/toolRail`), so they are tested here without a
 * browser and without a canvas.
 */

import { describe, expect, it } from "vitest";
import { ACTION_DEFINITIONS } from "../core/actions/registry";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { createDocument } from "../core/document/document";
import { getToolDefinition, TOOL_DEFINITIONS } from "../core/tools/toolDefinitions";
import {
  DEFAULT_TOOL_ID,
  TOOL_GROUPS,
  panReturnToolName,
  railToolTarget,
  rememberTool,
  toolGroupOf,
  toolRailSlots,
  ungroupedToolIds,
} from "../core/tools/toolRail";
import type { ToolId } from "../types/tool";

describe("the tool groups", () => {
  it("claims every registered tool", () => {
    // A tool in no group is a tool the rail cannot show, which is how a tool
    // silently becomes unreachable.
    expect(ungroupedToolIds()).toEqual([]);
  });

  it("claims each tool exactly once", () => {
    const claimed = TOOL_GROUPS.flatMap((group) => group.toolIds);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.sort()).toEqual(TOOL_DEFINITIONS.map((tool) => tool.id).sort());
  });

  it("gives every group a name and a description", () => {
    for (const group of TOOL_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.description.length).toBeGreaterThan(0);
    }
  });

  it("keeps the groups in the order the rail draws them", () => {
    expect(TOOL_GROUPS.map((group) => group.id)).toEqual([
      "draw",
      "shape",
      "fill",
      "select",
      "colour",
      "navigate",
      "assist",
    ]);
  });

  it("puts the brush and the eraser in one group", () => {
    expect(toolGroupOf("brush").id).toBe("draw");
    expect(toolGroupOf("eraser").id).toBe("draw");
  });

  it("puts the selection and its transform in one group", () => {
    // There is no separate transform tool: the select tool carries the
    // scale and rotate handles, so the group says so.
    expect(toolGroupOf("select").id).toBe("select");
    expect(toolGroupOf("select").toolIds).toEqual(["select"]);
  });

  it("collapses only the shape family", () => {
    const collapsed = TOOL_GROUPS.filter((group) => group.collapsed);
    expect(collapsed.map((group) => group.id)).toEqual(["shape"]);
    expect(collapsed[0].toolIds).toEqual(["line", "rectangle", "ellipse", "polygon", "star"]);
  });

  it("keeps the common tools on the rail itself", () => {
    // A collapsed tool is one click further away, so only the family that
    // shares one gesture may be hidden behind a flyout.
    const onTheRail = TOOL_GROUPS.filter((group) => !group.collapsed).flatMap(
      (group) => group.toolIds,
    );
    expect(onTheRail).toContain("brush");
    expect(onTheRail).toContain("eraser");
    expect(onTheRail).toContain("bucket");
    expect(onTheRail).toContain("gradient");
    expect(onTheRail).toContain("select");
    expect(onTheRail).toContain("picker");
    expect(onTheRail).toContain("pan");
  });
});

describe("the rail's slots", () => {
  it("shows one button per tool, and one for the whole shape family", () => {
    const slots = toolRailSlots("brush");
    expect(slots).toHaveLength(9);
    expect(slots.filter((slot) => slot.isMenu)).toHaveLength(1);
  });

  it("marks the active tool's slot", () => {
    const slots = toolRailSlots("bucket");
    const active = slots.filter((slot) => slot.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].toolId).toBe("bucket");
  });

  it("marks the shape slot when a shape tool is active", () => {
    const slots = toolRailSlots("star");
    const active = slots.filter((slot) => slot.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].isMenu).toBe(true);
    expect(active[0].toolId).toBe("star");
  });

  it("shows the armed shape on the shape slot", () => {
    expect(toolRailSlots("polygon").find((slot) => slot.isMenu)?.toolId).toBe("polygon");
  });

  it("falls back to the group's default when no shape is armed", () => {
    const slot = toolRailSlots("brush").find((entry) => entry.isMenu);
    expect(slot?.toolId).toBe("rectangle");
    expect(slot?.isActive).toBe(false);
  });

  it("never leaves two slots active", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const active = toolRailSlots(tool.id).filter((slot) => slot.isActive);
      expect(active).toHaveLength(1);
    }
  });

  it("only ever stands for a registered tool", () => {
    for (const tool of TOOL_DEFINITIONS) {
      for (const slot of toolRailSlots(tool.id)) {
        expect(() => getToolDefinition(slot.toolId)).not.toThrow();
      }
    }
  });

  it("gives every tool a slot, directly or through the flyout", () => {
    const reachable = new Set<ToolId>();
    for (const slot of toolRailSlots("brush")) {
      if (slot.isMenu) {
        for (const toolId of slot.group.toolIds) {
          reachable.add(toolId);
        }
      } else {
        reachable.add(slot.toolId);
      }
    }
    expect(reachable.size).toBe(TOOL_DEFINITIONS.length);
  });
});

describe("where a click on the rail goes", () => {
  it("selects the tool that was asked for", () => {
    expect(railToolTarget("brush", "eraser", "brush")).toBe("eraser");
    expect(railToolTarget("brush", "gradient", "brush")).toBe("gradient");
  });

  it("selects the pan tool like any other", () => {
    expect(railToolTarget("brush", "pan", "brush")).toBe("pan");
  });

  it("returns from the pan tool to where the artist came from", () => {
    // The pan tool is temporary navigation: a second click must not leave the
    // app in a mode that cannot paint.
    expect(railToolTarget("pan", "pan", "eraser")).toBe("eraser");
  });

  it("returns to the brush when the pan tool has nowhere to go back to", () => {
    expect(railToolTarget("pan", "pan", null)).toBe(DEFAULT_TOOL_ID);
  });

  it("never turns another tool into the pan tool's way back", () => {
    expect(railToolTarget("brush", "brush", "brush")).toBe("brush");
    expect(railToolTarget("pan", "brush", "eraser")).toBe("brush");
  });
});

describe("the tool the rail remembers", () => {
  it("remembers the tool that is active", () => {
    expect(rememberTool(null, "brush")).toBe("brush");
    expect(rememberTool("brush", "rectangle")).toBe("rectangle");
  });

  it("does not remember the pan tool", () => {
    // The pan tool is the way *out* of the view, not a place to come back to.
    expect(rememberTool("brush", "pan")).toBe("brush");
    expect(rememberTool(null, "pan")).toBeNull();
  });

  it("names the tool the pan button returns to", () => {
    expect(panReturnToolName("eraser")).toBe("Eraser");
    expect(panReturnToolName(null)).toBeNull();
  });
});

describe("the engine behind the rail", () => {
  function createEngine() {
    return new DrawingEngine({ document: createDocument({ name: "Test", width: 400, height: 300 }) });
  }

  it("starts with the brush", () => {
    expect(createEngine().getState().toolId).toBe(DEFAULT_TOOL_ID);
  });

  it("switches to the tool the rail asks for", () => {
    const engine = createEngine();
    engine.setTool("gradient");
    expect(engine.getState().toolId).toBe("gradient");
    engine.setTool("select");
    expect(engine.getState().toolId).toBe("select");
  });

  it("keeps a switched tool across a publish", () => {
    const engine = createEngine();
    engine.setTool("polygon");
    expect(engine.getState().toolId).toBe("polygon");
    expect(engine.getState().toolId).toBe(toolRailSlots("polygon").find((s) => s.isActive)?.toolId);
  });

  it("switches to every registered tool", () => {
    const engine = createEngine();
    for (const tool of TOOL_DEFINITIONS) {
      engine.setTool(tool.id);
      expect(engine.getState().toolId).toBe(tool.id);
    }
  });
});

describe("the shortcut hints the rail shows", () => {
  it("agree with the action registry", () => {
    // The registry is the single source of truth for the chords; the rail
    // only repeats what the tool's own definition says.
    for (const tool of TOOL_DEFINITIONS) {
      const action = ACTION_DEFINITIONS.find((entry) => entry.id === `tool:${tool.id}`);
      expect(action).toBeDefined();
      expect(action?.shortcuts[0].key.toUpperCase()).toBe(tool.shortcut.toUpperCase());
    }
  });

  it("are unique, so no two tools claim the same key", () => {
    const shortcuts = TOOL_DEFINITIONS.map((tool) => tool.shortcut.toLowerCase());
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });
});
