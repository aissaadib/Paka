/**
 * Named brush presets: pick, save, rename and delete.
 *
 * The picker shows the preset whose brush matches the current one, so editing
 * any slider falls back to "Custom / unsaved" without extra state. Every
 * action is editor state only: applying a preset goes through the engine's
 * `setBrush`, and none of the preset operations touch history or the file's
 * dirty flag. The settings store persists the list.
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
  const [name, setName] = useState("");

  const selected = presets.find((preset) => brushSettingsEqual(preset.brush, brush)) ?? null;
  const trimmed = normalizePresetName(name);
  const canSave = trimmed !== "";
  const canRename = selected !== null && trimmed !== "" && trimmed !== selected.name;

  const save = () => {
    const preset = actions.saveBrushPreset(name);
    if (preset) {
      setName(preset.name);
    }
  };

  const rename = () => {
    if (!selected) {
      return;
    }
    const renamed = actions.renameBrushPreset(selected.id, name);
    if (renamed) {
      setName(renamed.name);
    }
  };

  const remove = () => {
    if (selected && actions.deleteBrushPreset(selected.id)) {
      setName("");
    }
  };

  return (
    <div className="brush-presets">
      <label className="brush-presets__field">
        <span className="brush-presets__label">Preset</span>
        <select
          className="brush-presets__select"
          aria-label="Brush preset"
          value={selected?.id ?? ""}
          onChange={(event) => {
            const preset = presets.find((candidate) => candidate.id === event.target.value);
            if (preset) {
              actions.applyBrushPreset(preset.id);
              setName(preset.name);
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
          if (event.key === "Enter" && canSave) {
            event.preventDefault();
            save();
          }
        }}
      />
      <button
        type="button"
        className="button brush-presets__action"
        disabled={!canSave}
        title="Save the current brush under this name"
        onClick={save}
      >
        Save
      </button>
      <button
        type="button"
        className="button brush-presets__action"
        disabled={!canRename}
        title="Rename the selected preset"
        onClick={rename}
      >
        Rename
      </button>
      <button
        type="button"
        className="button brush-presets__action"
        disabled={selected === null}
        title="Delete the selected preset"
        onClick={remove}
      >
        Delete
      </button>
    </div>
  );
}
