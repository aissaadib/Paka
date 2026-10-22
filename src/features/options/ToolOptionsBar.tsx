/**
 * The contextual options bar.
 *
 * It is the first row under the menu bar, and it answers "what is this tool
 * doing right now" in one line: the active tool, the brushes' three stroke
 * controls, the presets, and the options a tool registered for itself.
 *
 * The division is deliberate:
 *
 *  - **one row, always.** The bar is a fixed 38 px tall whatever the tool, so
 *    switching tools never moves the canvas, and a window too narrow scrolls
 *    the bar sideways rather than wrapping it to a new row.
 *  - **frequent controls in front, settings behind.** Size, opacity and
 *    hardness stay visible; sampling, stabilizer, texture, the stamp and the
 *    pressure switches live in the "Brush settings" panel beside them. The
 *    property model's tiers decide that split, not this file.
 *  - **the registry decides the rest.** A tool's own options come from the
 *    shared per-tool registry, so a feature that adds an option to a tool it
 *    does not own still gets a control here.
 */

import { TOOL_ICONS } from "../../components/toolbar/toolIcons";
import { groupToolOptions } from "../../core/options/optionControl";
import { visibleToolOptions } from "../../core/shell/toolOptions";
import { getToolDefinition } from "../../core/tools/toolDefinitions";
import { useEditor, useEditorState } from "../../hooks/useEditor";
// The built-in option table registers itself when this module is imported; the
// bar is the one consumer that must load it, so that a tool's options exist
// before the bar reads the registry.
import { toolShowsBrushControls } from "./toolOptionSchema";
import { BrushAdvancedPopover } from "../brushes/BrushAdvancedPopover";
import { BrushPrimaryControls } from "../brushes/BrushControls";
import { GradientControls } from "../gradient/GradientControls";
import { OptionControl } from "./OptionControl";
import "./toolOptions.css";

export function ToolOptionsBar() {
  const { actions } = useEditor();
  const snapshot = useEditorState();
  const definition = getToolDefinition(snapshot.toolId);
  const groups = groupToolOptions(visibleToolOptions(snapshot.toolId, snapshot));
  const usesBrush = toolShowsBrushControls(snapshot.toolId);

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
        <span className="tool-options-bar__tool-icon" aria-hidden="true">
          {TOOL_ICONS[snapshot.toolId]}
        </span>
        <span className="tool-options-bar__tool-name">{definition.label}</span>
        <kbd className="tool-options-bar__tool-key">{definition.shortcut}</kbd>
      </span>
      <div className="tool-options-bar__scroll">
        {usesBrush ? (
          <div className="tool-options__group" role="group" aria-label="Brush">
            <BrushPrimaryControls />
          </div>
        ) : null}
        <GradientControls />
        {groups.map((group) => (
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
        ))}
        {!usesBrush && groups.length === 0 ? (
          <span className="tool-options-bar__hint">{definition.description}</span>
        ) : null}
      </div>
      {usesBrush ? (
        <div className="tool-options-bar__end">
          <BrushAdvancedPopover />
        </div>
      ) : null}
    </div>
  );
}
