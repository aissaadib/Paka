/**
 * The quick preset picker in the toolbar.
 *
 * The toolbar row is a switcher: it picks the brush the next stroke is drawn
 * with, and it saves the current brush under a name. The rest of the library
 * - searching, renaming, overwriting, duplicating, deleting, starring and
 * importing - lives in the Brushes panel, where a deletion can be confirmed
 * and a built-in brush is protected. One place does each job, so the two
 * cannot disagree.
 *
 * The picker applies the preset it selects to the live brush, so the next
 * stroke is drawn with it. "Custom / unsaved" leaves the brush as it is and
 * says that it is no longer based on a preset.
 *
 * Every action is editor state only: applying a preset goes through the
 * engine's `setBrush`, and none of the preset operations touch history or the
 * file's dirty flag. The settings store persists the list.
 */

import { useState } from "react";
import { brushSettingsEqual } from "../../core/brushes/defaults";
import { MAX_PRESET_NAME_LENGTH, normalizePresetName } from "../../core/brushes/presets";
import { useEditor, useEditorState } from "../../hooks/useEditor";

export function BrushPresets() {
  const { actions } = useEditor();
  const { brush, presets, activePresetId } = useEditorState();
  const [name, setName] = useState("");

  // The preset the brush is based on. The engine owns it, so the picker, the
  // reset button and the preview cannot disagree about which preset is in
  // effect; `null` means the brush is custom.
  const current =
    activePresetId === null ? null : (presets.find((preset) => preset.id === activePresetId) ?? null);
  const typed = normalizePresetName(name);
  // The brush may have been changed after the preset was applied; the picker
  // says so rather than claiming the brush is still the preset.
  const edited = current !== null && !brushSettingsEqual(current.brush, brush);

  const save = () => {
    const preset = actions.saveBrushPreset(name);
    if (preset) {
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
              // "Custom / unsaved": the brush stays as it is, but it is no
              // longer tied to a preset.
              actions.setActivePreset(null);
              return;
            }
            actions.applyBrushPreset(id);
          }}
        >
          <option value="">
            {presets.length === 0 ? "No saved presets" : "Custom / unsaved"}
          </option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.favorite ? "★ " : ""}
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
          save();
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
    </div>
  );
}
