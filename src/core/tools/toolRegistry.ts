/** Tool instances, keyed by tool id. */

import type { ToolId } from "../../types/tool";
import { BrushTool } from "./brushTool";
import { PanTool } from "./panTool";
import { PickerTool } from "./pickerTool";
import { ShapeTool } from "./shapeTool";
import {
  BRUSH_TOOL,
  ELLIPSE_TOOL,
  ERASER_TOOL,
  LINE_TOOL,
  RECTANGLE_TOOL,
} from "./toolDefinitions";
import type { Tool } from "./types";

export type ToolRegistry = Readonly<Record<ToolId, Tool>>;

export function createToolRegistry(): ToolRegistry {
  return {
    brush: new BrushTool(BRUSH_TOOL),
    // Same pointer behaviour as the brush; only the stroke payload differs.
    eraser: new BrushTool(ERASER_TOOL, true),
    // One class parameterised by kind; the geometry lives in shapeGeometry.
    line: new ShapeTool("line", LINE_TOOL),
    rectangle: new ShapeTool("rectangle", RECTANGLE_TOOL),
    ellipse: new ShapeTool("ellipse", ELLIPSE_TOOL),
    picker: new PickerTool(),
    pan: new PanTool(),
  };
}
