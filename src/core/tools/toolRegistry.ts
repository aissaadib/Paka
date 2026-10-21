/** Tool instances, keyed by tool id. */

import type { ToolId } from "../../types/tool";
import { BrushTool } from "./brushTool";
import { BucketTool } from "./bucketTool";
import { GradientTool } from "./gradientTool";
import { GuidesTool } from "./guidesTool";
import { PanTool } from "./panTool";
import { PickerTool } from "./pickerTool";
import { SelectTool } from "./selectTool";
import { ShapeTool } from "./shapeTool";
import {
  BRUSH_TOOL,
  ELLIPSE_TOOL,
  ERASER_TOOL,
  GUIDES_TOOL,
  LINE_TOOL,
  POLYGON_TOOL,
  RECTANGLE_TOOL,
  SELECT_TOOL,
  STAR_TOOL,
} from "./toolDefinitions";
import type { Tool } from "./types";

export type ToolRegistry = Readonly<Record<ToolId, Tool>>;

export function createToolRegistry(): ToolRegistry {
  return {
    brush: new BrushTool(BRUSH_TOOL),
    // Same pointer behaviour as the brush; only the stroke payload differs.
    eraser: new BrushTool(ERASER_TOOL, true),
    // Marquee selection and stroke translation.
    select: new SelectTool(SELECT_TOOL),
    // One class parameterised by kind; the geometry lives in shapeGeometry.
    line: new ShapeTool("line", LINE_TOOL),
    rectangle: new ShapeTool("rectangle", RECTANGLE_TOOL),
    ellipse: new ShapeTool("ellipse", ELLIPSE_TOOL),
    polygon: new ShapeTool("polygon", POLYGON_TOOL),
    star: new ShapeTool("star", STAR_TOOL),
    // Flood fill: a press applies a pixel patch, a release commits it.
    bucket: new BucketTool(),
    // Gradient: a drag previews geometry and the release commits it.
    gradient: new GradientTool(),
    picker: new PickerTool(),
    // Composition guides: a drag places one, a drag on one moves it.
    guides: new GuidesTool(GUIDES_TOOL),
    pan: new PanTool(),
  };
}
