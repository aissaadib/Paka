/**
 * The contextual tool-options bar.
 *
 * It shows the active tool's name and the options that tool registered. The
 * options come from the shared per-tool registry, so a feature that adds an
 * option to a tool it does not own gets a control here without this file
 * knowing about it: the registry hands over the options, and every one of
 * them is drawn by the same control.
 *
 * The bar is one row tall whatever the tool, so switching tools never moves
 * the canvas, and it scrolls sideways when the window is too narrow instead
 * of wrapping.
 */

import { groupToolOptions } from "../../core/options/optionControl";
import { visibleToolOptions } from "../../core/shell/toolOptions";
import { getToolDefinition } from "../../core/tools/toolDefinitions";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { OptionControl } from "./OptionControl";
import "./toolOptions.css";

export function ToolOptionsBar() {
  const { actions } = useEditor();
  const snapshot = useEditorState();
  const definition = getToolDefinition(snapshot.toolId);
  const groups = groupToolOptions(visibleToolOptions(snapshot.toolId, snapshot));

  return (
    <div
      className="tool-options-bar"
      role="toolbar"
      aria-label={`${definition.label} options`}
    >
      <span
        className="tool-options-bar__tool"
        title={`${definition.description} (${definition.shortcut})`}
      >
        <span className="tool-options-bar__tool-name">{definition.label}</span>
      </span>
      {groups.length === 0 ? (
        <span className="tool-options-bar__hint">{definition.description}</span>
      ) : (
        groups.map((group) => (
          <div
            className="tool-options__group"
            key={group.id === "" ? "options" : group.id}
            role="group"
            aria-label={group.label ?? definition.label}
          >
            {group.label ? (
              <span className="tool-options__group-label">{group.label}</span>
            ) : null}
            {group.options.map((option) => (
              <OptionControl
                key={option.id}
                option={option}
                snapshot={snapshot}
                actions={actions}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
