/**
 * The brush preset browser.
 *
 * A list of the user's brushes and the built-in ones, with a search box, an
 * order and a favourites filter, and the operations the library supports:
 * create, rename, duplicate, delete, star, import and export.
 *
 * Three rules shape it:
 *
 *  1. **The built-in list is handed in.** `core/brushes/bundledPresets.ts`
 *     belongs to another slice, so the built-in brushes arrive as a prop and
 *     the model never imports them. A built-in brush is protected: it cannot
 *     be renamed or deleted, because that would take the feature away rather
 *     than the user's data. Duplicating it is how the user gets a copy they
 *     can change.
 *  2. **The selection and the live brush are two things.** The selection is
 *     the row the keyboard is on and the actions act on; the live brush is
 *     what the next stroke is drawn with. Applying a preset copies its
 *     values into the live brush and leaves the stored copy alone, so an
 *     edit of the brush is visibly *not* an edit of the preset.
 *  3. **Nothing here is an edit.** Applying a preset goes through the
 *     engine's `setBrush`, and none of the preset operations touch history
 *     or the file's dirty flag.
 *
 * The model behind this panel is `core/brushes/presetBrowser.ts`; this file
 * only holds the little state the browser owns and calls the editor.
 */

import { useEffect, useMemo, useState } from "react";
import { brushSettingsEqual } from "../../core/brushes/defaults";
import {
  DEFAULT_PRESET_BROWSER_STATE,
  PRESET_SORT_OPTIONS,
  canModifyPreset,
  findPreset,
  groupPresets,
  isBundledPreset,
  nextSelectionId,
  presetMatchingBrush,
  runPresetAction,
  type PresetAction,
  type PresetActionResult,
  type PresetBrowserState,
  type PresetLibrary,
  type PresetLibraryPort,
  type PresetSort,
} from "../../core/brushes/presetBrowser";
import {
  PresetLibraryFiles,
  type PresetLibraryGateway,
} from "../../core/brushes/presetLibraryFiles";
import { MAX_PRESET_NAME_LENGTH, type BrushPreset } from "../../core/brushes/presets";
import { registerPanel } from "../../core/shell/panelRegistry";
import type { ShellSlotId } from "../../core/shell/slots";
import { Panel } from "../../components/panels/Panel";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { PresetRow } from "./PresetRow";
import "./brushPresets.css";

export interface BrushPresetPanelProps {
  /**
   * The built-in brushes.
   *
   * They arrive as an argument because the module that lists them belongs to
   * another slice; an empty list is a browser with no built-in brushes in it.
   */
  readonly bundled?: readonly BrushPreset[];
  /**
   * The file service for the import and export buttons.
   *
   * Without it the two buttons are disabled: the file dialogs live outside
   * the model, behind this port.
   */
  readonly gateway?: PresetLibraryGateway | null;
}

export function BrushPresetPanel({ bundled = [], gateway = null }: BrushPresetPanelProps) {
  const editor = useEditor();
  const { actions, engine } = editor;
  const { brush, presets } = useEditorState();

  const [state, setState] = useState(DEFAULT_PRESET_BROWSER_STATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const library: PresetLibrary = useMemo(() => ({ presets, bundled }), [presets, bundled]);
  const groups = useMemo(() => groupPresets(library, state), [library, state]);
  const visible = useMemo(() => [...groups.user, ...groups.builtin], [groups]);
  const files = useMemo(() => (gateway ? new PresetLibraryFiles(gateway) : null), [gateway]);

  // The selection falls back to nothing when the brush it named is gone.
  useEffect(() => {
    setSelectedId((current) =>
      current !== null && findPreset(library, current) === null ? null : current,
    );
  }, [library]);

  const selected = findPreset(library, selectedId);
  const confirming = findPreset(library, confirmingId);
  const current = presetMatchingBrush(library, brush);
  // The brush has been changed since the preset was applied: the stored copy
  // and the live brush are two things, and the panel says so.
  const edited = current !== null && !brushSettingsEqual(current.brush, brush);
  const protectedSelected = selected !== null && !canModifyPreset(selected, bundled);

  const port: PresetLibraryPort = useMemo(
    () => ({
      save: (presetName) => actions.saveBrushPreset(presetName),
      rename: (id, presetName) => actions.renameBrushPreset(id, presetName),
      duplicate: (id) => actions.duplicateBrushPreset(id),
      remove: (id) => actions.deleteBrushPreset(id),
      apply: (preset) => {
        if (actions.applyBrushPreset(preset.id)) {
          return true;
        }
        // A built-in brush is not in the user's library, so it is applied by
        // setting its brush: the same editor-only change, with no history
        // step and no dirty flag.
        actions.setBrush(preset.brush);
        return true;
      },
      import: (added) => {
        // The editor owns the list; the browser only says what should be in
        // it. The engine's own reader gives every entry a fresh id and a
        // name that does not clash.
        engine.setPresets([...presets, ...added]);
        const ids = new Set(added.map((preset) => preset.id));
        return engine.getState().presets.filter((preset) => ids.has(preset.id));
      },
    }),
    [actions, engine, presets],
  );

  /** Runs an action and reports what it did. */
  const run = (action: PresetAction): PresetActionResult => {
    const result = runPresetAction(library, state, port, action);
    if (result.state !== null) {
      setState(result.state);
    }
    if (result.selection !== null) {
      setSelectedId(result.selection);
    }
    if (result.message !== null) {
      setMessage(result.message);
    }
    if (result.ok && (action.kind === "save" || action.kind === "rename")) {
      // The name has done its job; the field starts empty for the next one.
      setName("");
    }
    return result;
  };

  const apply = (id: string) => {
    setSelectedId(id);
    setConfirmingId(null);
    run({ kind: "apply", id });
  };

  const move = (direction: 1 | -1) => {
    const next = nextSelectionId(visible, selectedId, direction);
    if (next !== null) {
      setSelectedId(next);
    }
  };

  const exportLibrary = async () => {
    if (files === null) {
      return;
    }
    setBusy(true);
    try {
      const outcome = await files.exportLibrary(presets, state.favorites);
      if (outcome.status === "exported") {
        setMessage(
          outcome.count === 1 ? "Exported 1 brush." : `Exported ${outcome.count} brushes.`,
        );
      } else if (outcome.status === "error") {
        setMessage(outcome.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const importLibrary = async () => {
    if (files === null) {
      return;
    }
    setBusy(true);
    try {
      const outcome = await files.importLibrary();
      if (outcome.status === "read") {
        const result = run({ kind: "import", entries: outcome.entries });
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
            disabled={busy || files === null}
            onClick={() => void importLibrary()}
          >
            Import
          </button>
          <button
            type="button"
            className="brush-browser__header-button"
            title="Export the brushes to a file"
            disabled={busy || files === null}
            onClick={() => void exportLibrary()}
          >
            Export
          </button>
        </>
      }
      footer={
        <div className="brush-browser__footer">
          {confirming !== null ? (
            <div
              className="brush-browser__confirm"
              role="alertdialog"
              aria-label="Delete the brush"
            >
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
                aria-label="Brush name"
                placeholder="Name this brush"
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
                  disabled={selected === null || name.trim() === "" || protectedSelected}
                  title={
                    protectedSelected
                      ? "A built-in brush cannot be renamed - duplicate it instead"
                      : "Rename the selected brush"
                  }
                  onClick={() => selected && run({ kind: "rename", id: selected.id, name })}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={selected === null}
                  title="Duplicate the selected brush"
                  onClick={() => selected && run({ kind: "duplicate", id: selected.id })}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={selected === null || protectedSelected}
                  title={
                    protectedSelected
                      ? "A built-in brush cannot be deleted"
                      : "Delete the selected brush"
                  }
                  onClick={() => selected && setConfirmingId(selected.id)}
                >
                  Delete
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
            value={state.query}
            onChange={(event) => setState({ ...state, query: event.target.value })}
          />
          <select
            className="brush-browser__sort"
            aria-label="Order the brushes"
            value={state.sort}
            onChange={(event) =>
              setState({ ...state, sort: event.target.value as PresetSort })
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
            aria-pressed={state.favoritesOnly}
            aria-label="Show only the starred brushes"
            title="Show only the starred brushes"
            onClick={() => setState({ ...state, favoritesOnly: !state.favoritesOnly })}
          >
            ★
          </button>
        </div>

        <div
          className="brush-browser__list"
          tabIndex={0}
          aria-label="Brush presets"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
              return;
            }
            if (event.key === "Home") {
              event.preventDefault();
              setSelectedId(visible[0]?.id ?? null);
              return;
            }
            if (event.key === "End") {
              event.preventDefault();
              setSelectedId(visible[visible.length - 1]?.id ?? null);
              return;
            }
            if (event.key === "Enter" && selectedId !== null) {
              event.preventDefault();
              apply(selectedId);
            }
          }}
        >
          {groups.user.length === 0 && groups.builtin.length === 0 ? (
            <p className="brush-browser__empty">
              {state.query === ""
                ? "No brushes yet. Adjust the brush and press Save."
                : "No brush matches the search."}
            </p>
          ) : null}
          {groups.user.length > 0 ? (
            <PresetGroup
              label="Your brushes"
              presets={groups.user}
              bundled={bundled}
              state={state}
              selectedId={selectedId}
              currentId={current?.id ?? null}
              edited={edited}
              onSelect={apply}
              onToggleFavorite={(id) => run({ kind: "favorite", id })}
            />
          ) : null}
          {groups.builtin.length > 0 ? (
            <PresetGroup
              label="Built-in"
              presets={groups.builtin}
              bundled={bundled}
              state={state}
              selectedId={selectedId}
              currentId={current?.id ?? null}
              edited={edited}
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

/**
 * Registers the browser with the shell's panel registry.
 *
 * The shell reads a list of panels and renders whatever is in it, so a panel
 * joins by registering itself. The built-in brushes and the file gateway are
 * handed in, because the module that lists the built-in brushes belongs to
 * another slice and the file dialogs live behind a port.
 */
export function registerBrushPresetPanel(
  bundled: readonly BrushPreset[] = [],
  gateway: PresetLibraryGateway | null = null,
  slot: ShellSlotId = "right",
  order = 20,
): void {
  registerPanel({
    id: "brushes",
    title: "Brushes",
    slot,
    order,
    render: () => <BrushPresetPanel bundled={bundled} gateway={gateway} />,
  });
}

interface PresetGroupProps {
  readonly label: string;
  readonly presets: readonly BrushPreset[];
  readonly bundled: readonly BrushPreset[];
  readonly state: PresetBrowserState;
  readonly selectedId: string | null;
  readonly currentId: string | null;
  readonly edited: boolean;
  readonly onSelect: (id: string) => void;
  readonly onToggleFavorite: (id: string) => void;
}

function PresetGroup({
  label,
  presets,
  bundled,
  state,
  selectedId,
  currentId,
  edited,
  onSelect,
  onToggleFavorite,
}: PresetGroupProps) {
  return (
    <div className="brush-browser__group">
      <h3 className="brush-browser__group-title">{label}</h3>
      <ul className="brush-browser__rows">
        {presets.map((preset) => (
          <PresetRow
            key={preset.id}
            preset={preset}
            bundled={isBundledPreset(preset, bundled)}
            selected={preset.id === selectedId}
            current={preset.id === currentId}
            edited={preset.id === currentId && edited}
            favorite={state.favorites.includes(preset.id)}
            onSelect={onSelect}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </ul>
    </div>
  );
}
