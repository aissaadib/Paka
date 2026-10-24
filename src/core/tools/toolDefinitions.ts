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

export const SELECT_TOOL: ToolDefinition = {
  id: "select",
  label: "Select",
  shortcut: "M",
  description: "Select strokes with a marquee, then drag to move them",
};

export const LINE_TOOL: ToolDefinition = {
  id: "line",
  label: "Line",
  shortcut: "L",
  description: "Draw a straight line with the current brush",
};

export const RECTANGLE_TOOL: ToolDefinition = {
  id: "rectangle",
  label: "Rectangle",
  shortcut: "R",
  description: "Draw a rectangle with the current brush",
  fillable: true,
};

export const ELLIPSE_TOOL: ToolDefinition = {
  id: "ellipse",
  label: "Ellipse",
  shortcut: "O",
  description: "Draw an ellipse with the current brush",
  fillable: true,
};

export const POLYGON_TOOL: ToolDefinition = {
  id: "polygon",
  label: "Polygon",
  shortcut: "P",
  description: "Draw a regular polygon inscribed in the dragged box",
  fillable: true,
};

export const STAR_TOOL: ToolDefinition = {
  id: "star",
  label: "Star",
  shortcut: "S",
  description: "Draw a star inscribed in the dragged box",
  fillable: true,
};

export const PICKER_TOOL: ToolDefinition = {
  id: "picker",
  label: "Colour picker",
  shortcut: "I",
  description: "Pick a colour from the canvas",
};

export const BUCKET_TOOL: ToolDefinition = {
  id: "bucket",
  label: "Bucket fill",
  shortcut: "F",
  description: "Fill a contiguous region with the current colour",
};

export const GRADIENT_TOOL: ToolDefinition = {
  id: "gradient",
  label: "Gradient",
  shortcut: "G",
  description: "Drag a linear or radial colour gradient",
};

export const PAN_TOOL: ToolDefinition = {
  id: "pan",
  label: "Pan",
  shortcut: "H",
  description: "Move the canvas view",
};

export const GUIDES_TOOL: ToolDefinition = {
  id: "guides",
  label: "Guides",
  shortcut: "U",
  description: "Place and move composition guides",
};

export const REFERENCE_TOOL: ToolDefinition = {
  id: "reference",
  label: "Reference",
  shortcut: "Y",
  description: "Select, move, resize and rotate reference images",
};

/** Tools offered by the application, in tool rail order. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  BRUSH_TOOL,
  ERASER_TOOL,
  SELECT_TOOL,
  LINE_TOOL,
  RECTANGLE_TOOL,
  ELLIPSE_TOOL,
  POLYGON_TOOL,
  STAR_TOOL,
  BUCKET_TOOL,
  GRADIENT_TOOL,
  PICKER_TOOL,
  GUIDES_TOOL,
  PAN_TOOL,
  REFERENCE_TOOL,
];

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
