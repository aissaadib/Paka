/** Left tool rail: one button per registered tool. */

import { currentPlatform } from "../../core/actions/keyboard";
import { shortcutLabel } from "../../core/actions/registry";
import { TOOL_DEFINITIONS } from "../../core/tools/toolDefinitions";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { useShortcutBindings } from "../../hooks/useShortcutBindings";
import { IconButton } from "./IconButton";
import { TOOL_ICONS } from "./toolIcons";

export function ToolRail() {
  const { actions } = useEditor();
  const { toolId } = useEditorState();
  // The hint is the shortcut the tool answers to *now*, so a rebound tool does
  // not keep advertising a chord that no longer works.
  useShortcutBindings();
  const platform = currentPlatform();

  return (
    <nav className="tool-rail" aria-label="Tools">
      {TOOL_DEFINITIONS.map((tool) => (
        <IconButton
          key={tool.id}
          label={tool.label}
          shortcut={shortcutLabel(`tool:${tool.id}`, platform) ?? undefined}
          active={tool.id === toolId}
          onClick={() => actions.setTool(tool.id)}
        >
          {TOOL_ICONS[tool.id]}
        </IconButton>
      ))}
    </nav>
  );
}
