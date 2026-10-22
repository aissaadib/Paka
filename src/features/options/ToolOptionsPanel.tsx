/**
 * Renders the active tool's declarative options.
 *
 * The schema decides which fields exist; this component only maps a kind to a
 * control. Keeping the renderer this small is deliberate: a generic form
 * framework would be more code than the few fields it replaces.
 *
 * Every kind the contract knows about is handled here, so a feature that adds
 * an option of a new kind gets a control rather than a blank space.
 */

import { SliderField } from "../../components/toolbar/SliderField";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import {
  toolOptionLabel,
  visibleToolOptions,
  type ColorToolOption,
  type GroupToolOption,
  type NumberToolOption,
  type SelectToolOption,
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
          switch (option.kind) {
            case "toggle":
              return (
                <label className="toggle" title={option.title} key={option.id}>
                  <input
                    type="checkbox"
                    checked={option.read(snapshot)}
                    onChange={(event) => option.write(actions, event.target.checked)}
                  />
                  {label}
                </label>
              );
            case "number": {
              const number = option as NumberToolOption;
              return (
                <label className="number-field" title={number.title} key={number.id}>
                  {label}
                  <input
                    type="number"
                    min={number.min}
                    max={number.max}
                    step={number.step}
                    value={number.read(snapshot)}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next)) {
                        number.write(actions, next);
                      }
                    }}
                  />
                </label>
              );
            }
            case "select": {
              const select = option as SelectToolOption;
              return (
                <label className="select-field" title={select.title} key={select.id}>
                  {label}
                  <select
                    value={select.read(snapshot)}
                    onChange={(event) => select.write(actions, event.target.value)}
                  >
                    {select.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            case "color": {
              const color = option as ColorToolOption;
              return (
                <label className="color-field" title={color.title} key={color.id}>
                  {label}
                  <input
                    type="color"
                    value={color.read(snapshot)}
                    onChange={(event) => color.write(actions, event.target.value)}
                  />
                </label>
              );
            }
            case "group": {
              const group = option as GroupToolOption;
              return (
                <fieldset className="toolbar__group" key={group.id} title={group.title}>
                  <legend>{label}</legend>
                  {group.children.map((child) => {
                    const childLabel = toolOptionLabel(child, snapshot);
                    if (child.kind === "toggle") {
                      return (
                        <label className="toggle" title={child.title} key={child.id}>
                          <input
                            type="checkbox"
                            checked={child.read(snapshot)}
                            onChange={(event) =>
                              child.write(actions, event.target.checked)
                            }
                          />
                          {childLabel}
                        </label>
                      );
                    }
                    if (child.kind === "slider") {
                      return (
                        <SliderField
                          key={child.id}
                          label={childLabel}
                          min={child.min}
                          max={child.max}
                          step={child.step}
                          scale={child.scale}
                          value={child.read(snapshot)}
                          title={child.title}
                          format={child.format}
                          onChange={(value) => child.write(actions, value)}
                        />
                      );
                    }
                    return null;
                  })}
                </fieldset>
              );
            }
            default:
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
          }
        })}
      </div>
    </>
  );
}
