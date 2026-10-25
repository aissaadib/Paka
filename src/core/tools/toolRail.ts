/**
 * The left tool rail's model.
 *
 * The rail arranges the registered tools into named groups (draw, shapes,
 * fill, select, colour, navigate, assist) and holds the rules that decide
 * what the rail shows and what a click does:
 *
 * - a family of tools that share one gesture (the shapes) collapses into a
 *   single slot that opens a flyout, so the rail stays short;
 * - the pan tool is temporary navigation, so clicking it while it is already
 *   active returns to the tool the artist came from instead of stranding them
 *   in a view-only mode;
 * - the shortcut the rail shows is the one the action registry binds, so the
 *   hint on the button and the key that works can never drift apart.
 *
 * The module is DOM-free on purpose. The rail renders it, and the rules are
 * unit tested without a browser.
 */

import { ACTION_DEFINITIONS } from "../actions/registry";
import { formatShortcut, type KeyboardPlatform } from "../actions/keyboard";
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
    description: "Select strokes or shapes, then move, scale or rotate them",
    toolIds: ["select", "shapeEdit"],
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
    description: "Composition guides and reference images for the layout",
    toolIds: ["guides", "reference"],
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

/**
 * The slots grouped by their group, in rail order.
 *
 * The rail draws one row per group, with a separator between the rows, so it
 * needs the slots of a group together rather than one flat list.
 */
export function toolRailSlotGroups(
  slots: readonly ToolRailSlot[],
): ToolRailSlot[][] {
  const grouped: ToolRailSlot[][] = [];
  for (const slot of slots) {
    const last = grouped[grouped.length - 1];
    if (last && last[0].group.id === slot.group.id) {
      last.push(slot);
      continue;
    }
    grouped.push([slot]);
  }
  return grouped;
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

/**
 * The shortcut the action registry binds for a tool.
 *
 * The registry is the one table that knows which key selects which tool, so
 * the rail shows what the registry binds rather than a second copy of it.
 * `undefined` when the registry has no action for the tool, which is a
 * programming error the caller should not paper over.
 */
export function toolShortcut(
  toolId: ToolId,
  platform: KeyboardPlatform = "other",
): string | undefined {
  const action = ACTION_DEFINITIONS.find((entry) => entry.id === `tool:${toolId}`);
  const shortcut = action?.shortcuts[0];
  return shortcut ? formatShortcut(shortcut, platform) : undefined;
}

/** What a slot's tooltip says. */
export interface ToolRailTooltipContent {
  /** The tool's name, or the group's name for a slot that stands for a family. */
  readonly title: string;
  /** What the tool does, in one line. */
  readonly description?: string;
  /** The shortcut that selects the tool. */
  readonly shortcut?: string;
  /** An extra line, for the case the description does not cover. */
  readonly hint?: string;
}

/**
 * What a slot's tooltip says.
 *
 * A collapsed slot names the family and points at the tool that is armed; a
 * plain slot names its tool. The pan slot adds the way back, because that is
 * the one button whose second click means something else.
 */
export function toolRailTooltip(
  slot: ToolRailSlot,
  activeToolId: ToolId,
  rememberedToolId: ToolId | null,
  platform: KeyboardPlatform = "other",
): ToolRailTooltipContent {
  if (slot.isMenu) {
    const holdsActiveTool = slot.group.toolIds.includes(activeToolId);
    const activeTool = holdsActiveTool ? getToolDefinition(activeToolId) : null;
    return {
      title: slot.group.label,
      description: `${slot.group.description} - click to choose`,
      shortcut: activeTool ? toolShortcut(activeTool.id, platform) : undefined,
      hint: activeTool ? `${activeTool.label} is active` : undefined,
    };
  }

  const tool = getToolDefinition(slot.toolId);
  const isPanReturning = slot.toolId === "pan" && activeToolId === "pan";
  const returnName = panReturnToolName(rememberedToolId);
  return {
    title: tool.label,
    description: tool.description,
    shortcut: toolShortcut(tool.id, platform),
    hint:
      slot.group.hint ??
      (isPanReturning
        ? `Click again to return to ${returnName ?? getToolDefinition(DEFAULT_TOOL_ID).label}`
        : undefined),
  };
}

/** A rectangle in viewport coordinates. A `DOMRect` satisfies it. */
export interface ToolRailRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** A size in pixels. */
export interface ToolRailSize {
  readonly width: number;
  readonly height: number;
}

/** Which side of the anchor a floating panel opens on. */
export type PopoverSide = "right" | "right-centre" | "below";

/** How a floating panel is placed. */
export interface PopoverPlacementOptions {
  /** The side of the anchor the panel opens on. */
  readonly side?: PopoverSide;
  /** The gap between the anchor and the panel. */
  readonly gap?: number;
  /** The margin the panel keeps from the window's edge. */
  readonly margin?: number;
}

/** Where a floating panel sits, in viewport coordinates. */
export interface PopoverPlacement {
  readonly left: number;
  readonly top: number;
}

/** The gap between a rail button and its panel, and the window's edge margin. */
export const POPOVER_GAP = 8;
export const POPOVER_MARGIN = 8;

/**
 * Where a floating panel goes next to its anchor.
 *
 * The panel opens beside the anchor and is then kept inside the window: a
 * tooltip on the last row of a short window would otherwise hang off the
 * bottom of the screen. A panel wider than the window is pinned to the
 * margin instead of being pushed off the other side.
 */
export function placePopover(
  anchor: ToolRailRect,
  size: ToolRailSize,
  viewport: ToolRailSize,
  options: PopoverPlacementOptions = {},
): PopoverPlacement {
  const gap = options.gap ?? POPOVER_GAP;
  const margin = options.margin ?? POPOVER_MARGIN;
  const side = options.side ?? "right";

  const left = side === "below" ? anchor.left : anchor.right + gap;
  const top =
    side === "right-centre"
      ? anchor.top + anchor.height / 2 - size.height / 2
      : side === "below"
        ? anchor.bottom + gap
        : anchor.top;

  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const maxTop = Math.max(margin, viewport.height - size.height - margin);

  return {
    left: Math.max(margin, Math.min(left, maxLeft)),
    top: Math.max(margin, Math.min(top, maxTop)),
  };
}
