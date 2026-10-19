/** Left tool rail: one button per registered tool. */

import type { ReactNode } from "react";
import { TOOL_DEFINITIONS } from "../../core/tools/toolDefinitions";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import type { ToolId } from "../../types/tool";
import {
  IconBrush,
  IconBucket,
  IconEllipse,
  IconEraser,
  IconHand,
  IconLine,
  IconPicker,
  IconRectangle,
  IconSelect,
} from "../icons";
import { IconButton } from "./IconButton";

const TOOL_ICONS: Record<ToolId, ReactNode> = {
  brush: <IconBrush />,
  eraser: <IconEraser />,
  select: <IconSelect />,
  line: <IconLine />,
  rectangle: <IconRectangle />,
  ellipse: <IconEllipse />,
  bucket: <IconBucket />,
  picker: <IconPicker />,
  pan: <IconHand />,
};

export function ToolRail() {
  const { actions } = useEditor();
  const { toolId } = useEditorState();

  return (
    <nav className="tool-rail" aria-label="Tools">
      {TOOL_DEFINITIONS.map((tool) => (
        <IconButton
          key={tool.id}
          label={tool.label}
          shortcut={tool.shortcut}
          active={tool.id === toolId}
          onClick={() => actions.setTool(tool.id)}
        >
          {TOOL_ICONS[tool.id]}
        </IconButton>
      ))}
    </nav>
  );
}
