/**
 * Tool metadata.
 *
 * Definitions live apart from the tool implementations so that tools can
 * reference their own definition without importing the registry (which would
 * create an import cycle).
 */

import type { ToolDefinition, ToolId } from "../../types/tool";

export const BRUSH_TOOL: ToolDefinition = {
  id: "brush",
  label: "Brush",
  shortcut: "B",
  description: "Paint with the current brush",
};

export const ERASER_TOOL: ToolDefinition = {
  id: "eraser",
  label: "Eraser",
  shortcut: "E",
  description: "Erase with the current brush size and opacity",
};

export const PAN_TOOL: ToolDefinition = {
  id: "pan",
  label: "Pan",
  shortcut: "H",
  description: "Move the canvas view",
};

/** Tools offered by the application, in tool rail order. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [BRUSH_TOOL, ERASER_TOOL, PAN_TOOL];

export function findToolByShortcut(key: string): ToolDefinition | undefined {
  const normalized = key.toLowerCase();
  return TOOL_DEFINITIONS.find((tool) => tool.shortcut.toLowerCase() === normalized);
}

export function getToolDefinition(id: ToolId): ToolDefinition {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.id === id);
  if (!definition) {
    throw new Error(`Unknown tool id "${id}".`);
  }
  return definition;
}
