/**
 * The active tool, named.
 *
 * The tool rail shows the tools as icons; the options bar's contents belong
 * to one of them, so the bar says whose they are. The badge reads the tool id
 * from the engine's snapshot and the rest from the tool definitions, so
 * there is one source of truth for a tool's name, its shortcut and its icon.
 */

import { getToolDefinition } from "../../core/tools/toolDefinitions";
import { useEditorToolId } from "../../hooks/useEditor";
import { TOOL_ICONS } from "../toolbar/toolIcons";

export function ToolBadge() {
  const toolId = useEditorToolId();
  const tool = getToolDefinition(toolId);

  return (
    <span className="tool-badge">
      <span className="tool-badge__icon" aria-hidden="true">
        {TOOL_ICONS[toolId]}
      </span>
      <span className="tool-badge__name">{tool.label}</span>
      <span className="kbd" aria-hidden="true">
        {tool.shortcut}
      </span>
    </span>
  );
}
