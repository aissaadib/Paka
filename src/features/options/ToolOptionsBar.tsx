/**
 * The contextual tool-options strip.
 *
 * It sits directly under the menu bar and shows the *active tool's* options:
 * the brush for the brush and the eraser, the brush and the shape for the
 * shape tools, the selection actions for the select tool, the tolerance for
 * the bucket and the gradient's own controls for the gradient tool.
 *
 * The strip is one row tall whatever the tool, so switching tools never moves
 * the canvas, and it scrolls sideways when the window is too narrow instead of
 * wrapping - a wrapped strip would change the height and push the canvas
 * down.
 */

import { TOOL_ICONS } from "../../components/toolbar/ToolRail";
import { getToolDefinition } from "../../core/tools/toolDefinitions";
import { BrushControls } from "../../features/brushes/BrushControls";
import { GradientControls } from "../../features/gradient/GradientControls";
import { useEditorState } from "../../hooks/useEditor";
import { ToolOptionsPanel } from "./ToolOptionsPanel";
import { toolOptionGroups, type ToolOptionGroup } from "./toolOptionSchema";
import "./toolOptions.css";

/**
 * One group's controls.
 *
 * The brush and the gradient groups carry widgets that are not plain fields -
 * the preset picker, the pressure curve and the stop editor - so they keep
 * their own component. Every other group is a list of fields and is rendered
 * by the shared panel.
 */
function OptionGroup({ group }: { readonly group: ToolOptionGroup }) {
  if (group.id === "brush") {
    return <BrushControls />;
  }
  if (group.id === "gradient") {
    return <GradientControls />;
  }
  return <ToolOptionsPanel groupId={group.id} />;
}

export function ToolOptionsBar() {
  const snapshot = useEditorState();
  const definition = getToolDefinition(snapshot.toolId);
  const groups = toolOptionGroups(snapshot.toolId, snapshot);

  return (
    <div className="tool-options-bar" role="toolbar" aria-label="Tool options">
      <span
        className="tool-options-bar__tool"
        title={`${definition.description} (${definition.shortcut})`}
      >
        <span className="tool-options-bar__tool-icon" aria-hidden="true">
          {TOOL_ICONS[snapshot.toolId]}
        </span>
        <span className="tool-options-bar__tool-name">{definition.label}</span>
      </span>
      {groups.length === 0 ? (
        <span className="tool-options-bar__hint">{definition.description}</span>
      ) : (
        groups.map((group) => (
          <div
            className="tool-options__group"
            key={group.id}
            role="group"
            aria-label={group.label}
          >
            <OptionGroup group={group} />
          </div>
        ))
      )}
    </div>
  );
}
