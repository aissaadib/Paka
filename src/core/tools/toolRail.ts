/**
 * The left tool rail's model.
 *
 * The rail arranges the registered tools into named groups (draw, shapes,
 * fill, select, colour, navigate, assist) and holds the two rules that decide
 * what a click does:
 *
 * - a group of tools that share one gesture (the shapes) collapses into a
 *   single slot that opens a flyout, so the rail stays short;
 * - the pan tool is temporary navigation, so clicking it while it is already
 *   active returns to the tool the artist came from instead of stranding them
 *   in a view-only mode.
 *
 * The module is DOM-free on purpose. The rail renders it, and the rules are
 * unit tested without a browser.
 */

import { TOOL_DEFINITIONS, getToolDefinition } from "./toolDefinitions";
import type { ToolId } from "../../types/tool";

/** The tool the editor starts in, and the way back when nothing was remembered. */
export const DEFAULT_TOOL_ID: ToolId = "brush";

/** The group a tool belongs to. */
export type ToolGroupId =
  | "draw"
  | "shape"
  | "fill"
  | "select"
  | "colour"
  | "navigate"
  | "assist";

export interface ToolGroup {
  readonly id: ToolGroupId;
  /** The group's name, shown as the slot's group line. */
  readonly label: string;
  /** What the group is for. */
  readonly description: string;
  /** The tools in the group, in rail order. */
  readonly toolIds: readonly ToolId[];
  /** The tool a collapsed slot shows while none of the group's tools is active. */
  readonly defaultToolId: ToolId;
  /**
   * True when the group collapses into one slot that opens a flyout of its
   * tools.
   *
   * Only a family that shares one gesture earns it: a collapsed tool is one
   * click further away, so the common tools stay on the rail itself.
   */
  readonly collapsed: boolean;
  /** An extra tooltip line, for the group a plain description does not cover. */
  readonly hint?: string;
}

/** The groups, in rail order. */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    id: "draw",
    label: "Draw",
    description: "Paint and erase with the current brush",
    toolIds: ["brush", "eraser"],
    defaultToolId: "brush",
    collapsed: false,
  },
  {
    id: "shape",
    label: "Shapes",
    description: "Line, rectangle, ellipse, polygon and star",
    toolIds: ["line", "rectangle", "ellipse", "polygon", "star"],
    defaultToolId: "rectangle",
    collapsed: true,
  },
  {
    id: "fill",
    label: "Fill",
    description: "Fill a region or drag a gradient",
    toolIds: ["bucket", "gradient"],
    defaultToolId: "bucket",
    collapsed: false,
  },
  {
    id: "select",
    label: "Select & transform",
    description: "Select strokes, then move, scale or rotate them",
    toolIds: ["select"],
    defaultToolId: "select",
    collapsed: false,
    hint: "Drag a corner handle to scale, the handle above to rotate.",
  },
  {
    id: "colour",
    label: "Colour",
    description: "Pick a colour from the canvas",
    toolIds: ["picker"],
    defaultToolId: "picker",
    collapsed: false,
  },
  {
    id: "navigate",
    label: "Navigate",
    description: "Move the canvas view without changing the document",
    toolIds: ["pan"],
    defaultToolId: "pan",
    collapsed: false,
  },
  {
    id: "assist",
    label: "Assist",
    description: "Composition guides for the layout",
    toolIds: ["guides"],
    defaultToolId: "guides",
    collapsed: false,
  },
];

const GROUP_BY_TOOL = new Map<ToolId, ToolGroup>();
for (const group of TOOL_GROUPS) {
  for (const toolId of group.toolIds) {
    GROUP_BY_TOOL.set(toolId, group);
  }
}

/** The group a tool belongs to. */
export function toolGroupOf(toolId: ToolId): ToolGroup {
  const group = GROUP_BY_TOOL.get(toolId);
  if (!group) {
    throw new Error(`Tool "${toolId}" belongs to no tool group.`);
  }
  return group;
}

/**
 * The registered tools that no group claims.
 *
 * Must stay empty: a tool that is in no group is a tool the rail cannot
 * show, which is how a tool silently becomes unreachable.
 */
export function ungroupedToolIds(): ToolId[] {
  return TOOL_DEFINITIONS.map((tool) => tool.id).filter((id) => !GROUP_BY_TOOL.has(id));
}

/** One entry of the rail: a button, or a button that opens a flyout. */
export interface ToolRailSlot {
  readonly group: ToolGroup;
  /** The tool the slot stands for. */
  readonly toolId: ToolId;
  /** True when the slot opens a flyout of the group's tools. */
  readonly isMenu: boolean;
  /** True when the slot's tool is the active tool. */
  readonly isActive: boolean;
}

/**
 * The slots the rail renders for the active tool, in rail order.
 *
 * A collapsed group contributes one slot, a plain group one slot per tool.
 * A collapsed slot shows the active tool of its group when there is one, so
 * the rail says which shape is armed, and the group's default otherwise.
 */
export function toolRailSlots(activeToolId: ToolId): ToolRailSlot[] {
  const slots: ToolRailSlot[] = [];
  for (const group of TOOL_GROUPS) {
    if (group.collapsed) {
      const holdsActiveTool = group.toolIds.includes(activeToolId);
      slots.push({
        group,
        toolId: holdsActiveTool ? activeToolId : group.defaultToolId,
        isMenu: true,
        isActive: holdsActiveTool,
      });
      continue;
    }
    for (const toolId of group.toolIds) {
      slots.push({ group, toolId, isMenu: false, isActive: toolId === activeToolId });
    }
  }
  return slots;
}

/** The slots of one group, in rail order. */
export function toolRailSlotsOfGroup(slots: readonly ToolRailSlot[], groupId: ToolGroupId): ToolRailSlot[] {
  return slots.filter((slot) => slot.group.id === groupId);
}

/**
 * Where a click on the rail goes.
 *
 * The pan tool is temporary navigation: clicking it while it is already
 * active returns to the tool the artist came from, so the rail never leaves
 * the app stuck in a mode that cannot paint.
 */
export function railToolTarget(
  activeToolId: ToolId,
  requestedToolId: ToolId,
  rememberedToolId: ToolId | null,
): ToolId {
  if (requestedToolId === "pan" && activeToolId === "pan") {
    return rememberedToolId ?? DEFAULT_TOOL_ID;
  }
  return requestedToolId;
}

/**
 * The tool the rail remembers, for the way back from the pan tool.
 *
 * The pan tool is never remembered: it is the way *out* of the view, not a
 * place to come back to.
 */
export function rememberTool(
  rememberedToolId: ToolId | null,
  currentToolId: ToolId,
): ToolId | null {
  return currentToolId === "pan" ? rememberedToolId : currentToolId;
}

/** The name of the tool the pan button returns to, when there is one. */
export function panReturnToolName(rememberedToolId: ToolId | null): string | null {
  if (rememberedToolId === null) {
    return null;
  }
  return getToolDefinition(rememberedToolId).label;
}
