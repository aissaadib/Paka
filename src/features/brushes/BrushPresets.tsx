/**
 * Named brush presets: apply, save, rename, duplicate and delete.
 *
 * The picker applies the preset it selects to the live brush, so the next
 * stroke is drawn with it. The management actions work on the preset the
 * picker has selected and never apply it first, so renaming, duplicating or
 * deleting one leaves the current brush exactly as it was.
 *
 * The name field is empty until something is typed, and the button that uses
 * it is the one the user presses: "Save" stores the current brush as a new
 * preset under that name, "Rename" gives the selected preset that name.
 *
 * Every action is editor state only: applying a preset goes through the
 * engine's `setBrush`, and none of the preset operations touch history or the
 * file's dirty flag. The settings store persists the list.
 */

import { useState } from "react";
import { brushSettingsEqual } from "../../core/brushes/defaults";
import {
  MAX_PRESET_NAME_LENGTH,
  normalizePresetName,
} from "../../core/brushes/presets";
import { useEditor, useEditorState } from "../../hooks/useEditor";

export function BrushPresets() {
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
      <input
        className="text-input brush-presets__name"
        type="text"
        aria-label="Preset name"
        placeholder="Preset name"
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
      <button
        type="button"
        className="button brush-presets__action"
        disabled={typed === ""}
        title="Save the current brush as a new preset with this name"
        onClick={save}
      >
        Save
      </button>
      <button
        type="button"
        className="button brush-presets__action"
        disabled={current === null || typed === "" || typed === current?.name}
        title="Rename the selected preset to this name"
        onClick={rename}
      >
        Rename
      </button>
      <button
        type="button"
        className="button brush-presets__action"
        disabled={current === null}
        title="Duplicate the selected preset"
        onClick={duplicate}
      >
        Duplicate
      </button>
      <button
        type="button"
        className="button brush-presets__action"
        disabled={current === null}
        title="Delete the selected preset"
        onClick={remove}
      >
        Delete
      </button>
    </div>
  );
}
