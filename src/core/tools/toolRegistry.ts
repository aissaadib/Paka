/** Tool instances, keyed by tool id. */

import type { ToolId } from "../../types/tool";
import { BrushTool } from "./brushTool";
import { PanTool } from "./panTool";
import type { Tool } from "./types";

export type ToolRegistry = Readonly<Record<ToolId, Tool>>;

export function createToolRegistry(): ToolRegistry {
  return {
    brush: new BrushTool(),
    pan: new PanTool(),
  };
}
