/**
 * The brush preset browser.
 *
 * A list of the user's brushes and the built-in ones, with a search box, a
 * sort order and a favourites filter, and every operation the library
 * supports: create, rename, overwrite, duplicate, delete, star, import and
 * export.
 *
 * Three rules shape it:
 *
 *  1. **The swatch is the brush.** Each row shows the mark the preset paints,
 *     drawn by the renderer's own code from the preset's own brush settings.
 *     A property that changes a stroke changes the swatch.
 *  2. **A built-in brush is protected.** It is code, so it cannot be renamed,
 *     overwritten or deleted; duplicating it is how the user gets a version
 *     they can change. Its star is the user's, so it can be starred like any
 *     other.
 *  3. **The selection and the live brush are two things.** The selection is
 *     the row the keyboard is on and the actions act on; the live brush is
 *     what the next stroke is drawn with. Applying a preset copies its values
 *     into the live brush and leaves the stored copy alone, so an edit of the
 *     brush is visibly *not* an edit of the preset until it is written back.
 *
 * Every action is editor state: applying a preset goes through the engine's
 * `setBrush`, and none of the preset operations touch history or the file's
 * dirty flag.
 */

import { useEffect, useMemo, useState } from "react";
import { brushSettingsEqual } from "../../core/brushes/defaults";
import {
  DEFAULT_PRESET_FILTER,
  PRESET_SORT_OPTIONS,
  canModifyPreset,
  groupPresets,
  nextSelectionId,
  presetListIntent,
  runPresetAction,
  type PresetFilter,
  type PresetLibraryPort,
  type PresetSort,
} from "../../core/brushes/presetBrowser";
import { MAX_PRESET_NAME_LENGTH, type BrushPreset } from "../../core/brushes/presets";
import { Panel } from "../../components/panels/Panel";
import { registerPanel } from "../../core/shell/panelRegistry";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { PresetRow } from "./PresetRow";
import "./brushPresets.css";

export function BrushPresetPanel() {
  const { actions, presetLibrary } = useEditor();
  const { brush, presets, activePresetId, document: drawingDocument } = useEditorState();

  const [filter, setFilter] = useState<PresetFilter>(DEFAULT_PRESET_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => groupPresets(presets, filter), [presets, filter]);
  const visible = useMemo(() => [...groups.user, ...groups.builtin], [groups]);
  // The row the list points at. A selection the search has filtered out is
  // not in the list, so it cannot be the active descendant: the attribute
  // would name an element that is not there.
  const activeOptionId =
    selectedId !== null && visible.some((preset) => preset.id === selectedId)
      ? `brush-option-${selectedId}`
      : undefined;

  // The selection follows the live brush when the user picks a preset
  // somewhere else, and falls back to it when the selected preset is gone.
  useEffect(() => {
    setSelectedId((current) =>
      current !== null && presets.some((preset) => preset.id === current) ? current : activePresetId,
    );
  }, [presets, activePresetId]);

  const selected =
    selectedId === null ? null : (presets.find((preset) => preset.id === selectedId) ?? null);
  const current =
    activePresetId === null ? null : (presets.find((preset) => preset.id === activePresetId) ?? null);
  // The preset the confirmation is about: the one the user asked to delete,
  // not the one that happens to be selected now.
  const confirming =
    confirmingId === null ? null : (presets.find((preset) => preset.id === confirmingId) ?? null);

  // The brush has been changed since the preset was applied: the stored copy
  // and the live brush are two things, and the panel says so.
  const edited = current !== null && !brushSettingsEqual(current.brush, brush);
  const protectedSelected = selected !== null && !canModifyPreset(selected);

  const port: PresetLibraryPort = useMemo(
    () => ({
      save: (presetName) => actions.saveBrushPreset(presetName),
      rename: (id, presetName) => actions.renameBrushPreset(id, presetName),
      duplicate: (id) => actions.duplicateBrushPreset(id),
      update: (id) => actions.updateBrushPreset(id),
      remove: (id) => actions.deleteBrushPreset(id),
      apply: (id) => actions.applyBrushPreset(id),
      toggleFavorite: (id) => actions.toggleBrushPresetFavorite(id),
      import: (entries) => actions.importBrushPresets(entries),
      resetBrush: () => actions.resetBrush(),
    }),
    [actions],
  );

  /** Runs an action and reports what it did. */
  const run = (action: Parameters<typeof runPresetAction>[1]) => {
    const result = runPresetAction(port, action);
    if (result.message !== null) {
      setMessage(result.message);
    }
    if (result.selection !== null) {
      setSelectedId(result.selection);
    }
    // The name has done its work: leaving it in the box would offer the same
    // name again, and the next Save would store a second copy of it.
    if (result.ok && (action.kind === "save" || action.kind === "rename")) {
      setName("");
    }
    return result;
  };

  const apply = (id: string) => {
    setSelectedId(id);
    run({ kind: "apply", id });
  };

  /**
   * Asks for a deletion.
   *
   * A built-in brush is code, so it is never asked about: the refusal is
   * reported rather than a confirmation that could not be carried out.
   */
  const requestDelete = (id: string) => {
    const preset = presets.find((candidate) => candidate.id === id) ?? null;
    if (!canModifyPreset(preset)) {
      setMessage("A built-in brush cannot be deleted - duplicate it instead.");
      return;
    }
    setConfirmingId(id);
  };

  const move = (direction: 1 | -1) => {
    const next = nextSelectionId(visible, selectedId, direction);
    if (next !== null) {
      setSelectedId(next);
    }
  };

  const exportLibrary = async () => {
    setBusy(true);
    try {
      const outcome = await presetLibrary.exportLibrary(presets);
      if (outcome.status === "exported") {
        setMessage(
          outcome.count === 1
            ? "Exported 1 brush."
            : `Exported ${outcome.count} brushes.`,
        );
      } else if (outcome.status === "error") {
        setMessage(outcome.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const importLibrary = async () => {
    setBusy(true);
    try {
      const outcome = await presetLibrary.importLibrary();
      if (outcome.status === "read") {
        const result = run({ kind: "import", entries: outcome.presets });
        if (outcome.skipped > 0) {
          setMessage(
            `${result.message ?? "Imported."} ${outcome.skipped} malformed ${
              outcome.skipped === 1 ? "entry was" : "entries were"
            } skipped.`,
          );
        }
      } else if (outcome.status === "error") {
        setMessage(outcome.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Brushes"
      actions={
        <>
          <button
            type="button"
            className="brush-browser__header-button"
            title="Import brushes from a file"
            disabled={busy}
            onClick={() => void importLibrary()}
          >
            Import
          </button>
          <button
            type="button"
            className="brush-browser__header-button"
            title="Export the brushes to a file"
            disabled={busy}
            onClick={() => void exportLibrary()}
          >
            Export
          </button>
        </>
      }
      footer={
        <div className="brush-browser__footer">
          {confirming !== null ? (
            <div className="brush-browser__confirm" role="alertdialog" aria-label="Delete the preset">
              <span>Delete “{confirming.name}”?</span>
              <button
                type="button"
                className="button brush-browser__confirm-yes"
                onClick={() => {
                  setConfirmingId(null);
                  run({ kind: "delete", id: confirming.id });
                }}
              >
                Delete
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setConfirmingId(null)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <input
                className="text-input brush-browser__name"
                type="text"
                aria-label="Preset name"
                placeholder={selected === null ? "Name this brush" : "Rename to…"}
                maxLength={MAX_PRESET_NAME_LENGTH}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  event.preventDefault();
                  if (selected === null) {
                    run({ kind: "save", name });
                  } else {
                    run({ kind: "rename", id: selected.id, name });
                  }
                }}
              />
              <div className="brush-browser__actions">
                <button
                  type="button"
                  className="button"
                  disabled={name.trim() === ""}
                  title="Save the current brush as a new preset"
                  onClick={() => run({ kind: "save", name })}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={!canModifyPreset(selected)}
                  title={
                    protectedSelected
                      ? "A built-in brush cannot be overwritten - duplicate it instead"
                      : "Store the current brush in the selected preset"
                  }
                  onClick={() => selected && run({ kind: "update", id: selected.id })}
                >
                  Update
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={selected === null || name.trim() === ""}
                  title={
                    protectedSelected
                      ? "A built-in brush cannot be renamed - duplicate it instead"
                      : "Rename the selected preset"
                  }
                  onClick={() => selected && run({ kind: "rename", id: selected.id, name })}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={selected === null}
                  title="Duplicate the selected preset"
                  onClick={() => selected && run({ kind: "duplicate", id: selected.id })}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={!canModifyPreset(selected)}
                  title={
                    protectedSelected
                      ? "A built-in brush cannot be deleted"
                      : "Delete the selected preset"
                  }
                  onClick={() => selected && requestDelete(selected.id)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="button"
                  title={
                    current === null
                      ? "Restore Paka's default brush"
                      : `Restore the brush to the values of "${current.name}"`
                  }
                  onClick={() => {
                    run({ kind: "reset" });
                    setMessage(
                      current === null
                        ? "The brush was restored to Paka's default."
                        : `The brush was restored to “${current.name}”.`,
                    );
                  }}
                >
                  Reset
                </button>
              </div>
            </>
          )}
          {message !== null ? (
            <p className="brush-browser__message" role="status">
              {message}
            </p>
          ) : null}
        </div>
      }
    >
      <div className="brush-browser">
        <div className="brush-browser__filters">
          <input
            className="text-input brush-browser__search"
            type="search"
            aria-label="Search brushes"
            placeholder="Search brushes"
            value={filter.query}
            onChange={(event) => setFilter({ ...filter, query: event.target.value })}
          />
          <select
            className="brush-browser__sort"
            aria-label="Order the brushes"
            value={filter.sort}
            onChange={(event) =>
              setFilter({ ...filter, sort: event.target.value as PresetSort })
            }
          >
            {PRESET_SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="brush-browser__favourites"
            aria-label={filter.favoritesOnly ? "Show every brush" : "Show only the starred brushes"}
            aria-pressed={filter.favoritesOnly}
            title="Show only the starred brushes"
            onClick={() => setFilter({ ...filter, favoritesOnly: !filter.favoritesOnly })}
          >
            ★
          </button>
        </div>

        <div
          className="brush-browser__list"
          role="listbox"
          aria-label="Brush presets"
          aria-activedescendant={activeOptionId}
          tabIndex={0}
          onKeyDown={(event) => {
            const intent = presetListIntent(event.key, selectedId !== null);
            if (intent === null) {
              return;
            }
            // The list owns the key. Delete is a global shortcut in the editor
            // - it deletes the selected strokes - and Backspace is the
            // browser's own "go back", so neither may travel past the list
            // while the brushes are being browsed.
            event.preventDefault();
            event.stopPropagation();
            if (intent.kind === "move") {
              move(intent.direction);
              return;
            }
            if (intent.kind === "first") {
              setSelectedId(visible[0]?.id ?? null);
              return;
            }
            if (intent.kind === "last") {
              setSelectedId(visible[visible.length - 1]?.id ?? null);
              return;
            }
            if (intent.kind === "apply" && selectedId !== null) {
              apply(selectedId);
              return;
            }
            if (intent.kind === "delete" && selectedId !== null) {
              requestDelete(selectedId);
            }
          }}
        >
          {groups.user.length === 0 ? (
            <p className="brush-browser__empty">{emptyText(filter, "user")}</p>
          ) : null}
          {groups.user.length > 0 ? (
            <PresetGroup
              label="Your brushes"
              presets={groups.user}
              selectedId={selectedId}
              currentId={activePresetId}
              edited={edited}
              background={drawingDocument.background}
              onSelect={apply}
              onToggleFavorite={(id) => run({ kind: "favorite", id })}
            />
          ) : null}
          {groups.builtin.length === 0 ? (
            <p className="brush-browser__empty">{emptyText(filter, "builtin")}</p>
          ) : null}
          {groups.builtin.length > 0 ? (
            <PresetGroup
              label="Built-in"
              presets={groups.builtin}
              selectedId={selectedId}
              currentId={activePresetId}
              edited={edited}
              background={drawingDocument.background}
              onSelect={apply}
              onToggleFavorite={(id) => run({ kind: "favorite", id })}
            />
          ) : null}
        </div>

        {current !== null ? (
          <p className="brush-browser__origin">
            {edited
              ? `“${current.name}” is in effect, but the brush has changed since it was applied.`
              : `“${current.name}” is in effect.`}
          </p>
        ) : (
          <p className="brush-browser__origin">The brush is your own.</p>
        )}
      </div>
    </Panel>
  );
}

registerPanel({
  id: "brushes",
  title: "Brushes",
  slot: "right",
  order: 5,
  icon: "brush",
  // The browser keeps the search text and the selection in React state, so
  // the panel stays mounted while it is hidden and cannot lose them.
  mounting: "always",
  collapsible: true,
  grow: false,
  description: "The brush library: search it, apply a brush, and manage the saved ones.",
  render: () => <BrushPresetPanel />,
});

interface PresetGroupProps {
  readonly label: string;
  readonly presets: readonly BrushPreset[];
  readonly selectedId: string | null;
  readonly currentId: string | null;
  readonly edited: boolean;
  readonly background: string;
  readonly onSelect: (id: string) => void;
  readonly onToggleFavorite: (id: string) => void;
}

/**
 * What an empty list says.
 *
 * The three reasons a list is empty are told apart, because they ask
 * different things of the user: a search that found nothing is fixed by
 * typing something else, an empty favourites filter by starring a brush, and
 * an empty library by saving one.
 */
function emptyText(filter: PresetFilter, group: "user" | "builtin"): string {
  if (filter.query !== "") {
    return group === "user"
      ? "No saved brush matches the search."
      : "No built-in brush matches the search.";
  }
  if (filter.favoritesOnly) {
    return group === "user"
      ? "None of your own brushes is starred."
      : "No built-in brush is starred.";
  }
  return group === "user"
    ? "No saved brushes yet. Adjust the brush and press Save."
    : "No built-in brush is available.";
}

function PresetGroup({
  label,
  presets,
  selectedId,
  currentId,
  edited,
  background,
  onSelect,
  onToggleFavorite,
}: PresetGroupProps) {
  return (
    <div className="brush-browser__group">
      <h3 className="brush-browser__group-title">{label}</h3>
      {presets.map((preset) => (
        <PresetRow
          key={preset.id}
          preset={preset}
          selected={preset.id === selectedId}
          current={preset.id === currentId}
          edited={preset.id === currentId && edited}
          background={background}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
}
