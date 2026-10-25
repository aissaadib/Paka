/**
 * The brush preset picker: choose a preset, and manage the saved ones.
 *
 * The picker is the one control a drawing session reaches for constantly, so
 * it stays in the options bar as a plain select. Managing presets - naming,
 * saving, renaming, duplicating and deleting - is a deliberate, occasional
 * act, so it lives behind the "Manage" popover beside the select. Both halves
 * share one piece of state, so the name field and the select can never
 * disagree about which preset is selected.
 *
 * The picker applies the preset it selects to the live brush, so the next
 * stroke is drawn with it. The management actions work on the preset the
 * picker has selected and never apply it first, so renaming, duplicating or
 * deleting one leaves the current brush exactly as it was.
 *
 * Every action is editor state only: applying a preset goes through the
 * engine's `setBrush`, and none of the preset operations touch history or the
 * file's dirty flag. The settings store persists the list.
 */

import { useState } from "react";
import { Popover } from "../../components/toolbar/Popover";
import { brushSettingsEqual } from "../../core/brushes/defaults";
import {
  MAX_PRESET_NAME_LENGTH,
  normalizePresetName,
} from "../../core/brushes/presets";
import { useEditor, useEditorState } from "../../hooks/useEditor";

export function BrushPresetControls() {
  const { actions } = useEditor();
  const { brush, presets } = useEditorState();
  // `undefined` means "the user has not picked one yet", so the picker shows
  // the preset the current brush matches - the brush the settings file
  // restored, after a restart. `null` means the user picked "Custom / unsaved".
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState("");

  const matching = presets.find((preset) => brushSettingsEqual(preset.brush, brush)) ?? null;
  const chosen =
    selectedId === undefined
      ? null
      : (presets.find((preset) => preset.id === selectedId) ?? null);
  const current = selectedId === undefined ? matching : chosen;
  const typed = normalizePresetName(name);
  // The brush may have been changed after the preset was applied; the picker
  // says so rather than claiming the brush is still the preset.
  const edited = current !== null && !brushSettingsEqual(current.brush, brush);

  const save = () => {
    const preset = actions.saveBrushPreset(name);
    if (preset) {
      setSelectedId(preset.id);
      setName("");
    }
  };

  const rename = () => {
    if (!current) {
      return;
    }
    const renamed = actions.renameBrushPreset(current.id, name);
    if (renamed) {
      setName("");
    }
  };

  const duplicate = () => {
    if (!current) {
      return;
    }
    const copy = actions.duplicateBrushPreset(current.id);
    if (copy) {
      setSelectedId(copy.id);
      setName("");
    }
  };

  const remove = () => {
    if (current && actions.deleteBrushPreset(current.id)) {
      setSelectedId(null);
      setName("");
    }
  };

  return (
    <div className="brush-presets">
      <label
        className="brush-presets__field"
        title={
          edited
            ? "The current brush has changed since this preset was applied"
            : "Pick a preset to use it for the next stroke"
        }
      >
        <span className="brush-presets__label">Preset</span>
        <select
          className="brush-presets__select"
          aria-label="Brush preset"
          value={current?.id ?? ""}
          onChange={(event) => {
            const id = event.target.value;
            if (id === "") {
              setSelectedId(null);
              return;
            }
            if (actions.applyBrushPreset(id)) {
              setSelectedId(id);
            }
          }}
        >
          <option value="">
            {presets.length === 0 ? "No saved presets" : "Custom / unsaved"}
          </option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
      <span className="brush-presets__state" aria-hidden={!edited}>
        {edited ? "edited" : ""}
      </span>
      <Popover
        label="Manage"
        title="Save the current brush, or rename, duplicate and delete the selected preset"
        className="brush-preset-editor"
        ariaLabel="Brush presets"
      >
        <label className="brush-preset-editor__field">
          <span className="brush-preset-editor__label">Preset name</span>
          <input
            className="text-input"
            type="text"
            aria-label="Preset name"
            placeholder="Name the brush…"
            maxLength={MAX_PRESET_NAME_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || typed === "") {
                return;
              }
              event.preventDefault();
              if (current) {
                rename();
              } else {
                save();
              }
            }}
          />
        </label>
        <p className="brush-preset-editor__current">
          {current ? `Selected: ${current.name}${edited ? " (edited)" : ""}` : "No preset selected"}
        </p>
        <div className="brush-preset-editor__actions">
          <button
            type="button"
            className="button"
            disabled={typed === ""}
            title="Save the current brush as a new preset with this name"
            onClick={save}
          >
            Save
          </button>
          <button
            type="button"
            className="button"
            disabled={current === null || typed === "" || typed === current?.name}
            title="Rename the selected preset to this name"
            onClick={rename}
          >
            Rename
          </button>
          <button
            type="button"
            className="button"
            disabled={current === null}
            title="Duplicate the selected preset"
            onClick={duplicate}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="button"
            disabled={current === null}
            title="Delete the selected preset"
            onClick={remove}
          >
            Delete
          </button>
        </div>
      </Popover>
    </div>
  );
}
