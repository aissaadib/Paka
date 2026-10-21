/**
 * Renders the active tool's declarative options.
 *
 * The schema decides which fields exist; this component only maps a slider to
 * `SliderField` and a toggle to the toolbar's existing checkbox markup. Keeping
 * the renderer this small is deliberate: a generic form framework would be more
 * code than the five fields it replaces.
 */

import { SliderField } from "../../components/toolbar/SliderField";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import {
  toolOptionLabel,
  visibleToolOptions,
  type ToggleToolOption,
} from "./toolOptionSchema";

export function ToolOptionsPanel() {
  const { actions } = useEditor();
  const snapshot = useEditorState();
  const options = visibleToolOptions(snapshot.toolId, snapshot);

  if (options.length === 0) {
    return null;
  }

  return (
    <>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        {options.map((option) => {
          const label = toolOptionLabel(option, snapshot);
          if (option.kind === "toggle") {
            const toggle = option as ToggleToolOption;
            return (
              <label className="toggle" title={toggle.title} key={toggle.id}>
                <input
                  type="checkbox"
                  checked={toggle.read(snapshot)}
                  onChange={(event) => toggle.write(actions, event.target.checked)}
                />
                {label}
              </label>
            );
          }
          return (
            <SliderField
              key={option.id}
              label={label}
              min={option.min}
              max={option.max}
              step={option.step}
              scale={option.scale}
              value={option.read(snapshot)}
              title={option.title}
              format={option.format}
              onChange={(value) => option.write(actions, value)}
            />
          );
        })}
      </div>
    </>
  );
}
