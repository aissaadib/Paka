/** Tool instances, keyed by tool id. */

import type { ToolId } from "../../types/tool";
import { BrushTool } from "./brushTool";
import { PanTool } from "./panTool";
import { PickerTool } from "./pickerTool";
import { BRUSH_TOOL, ERASER_TOOL } from "./toolDefinitions";
import type { Tool } from "./types";

export type ToolRegistry = Readonly<Record<ToolId, Tool>>;

export function createToolRegistry(): ToolRegistry {
  return {
    brush: new BrushTool(BRUSH_TOOL),
    // Same pointer behaviour as the brush; only the stroke payload differs.
    eraser: new BrushTool(ERASER_TOOL, true),
    picker: new PickerTool(),
    pan: new PanTool(),
  };
}
