/**
 * The shortcut editor panel.
 *
 * The panel shows what every command answers to, and lets the user give a
 * command a chord of its own. Three rules shape it:
 *
 *  1. **A user's chord replaces the built-in one.** The command answers to the
 *     key the user pressed and to nothing else, so the key it gave up is free
 *     for another command.
 *  2. **A chord belongs to one command.** A chord another command already
 *     holds is *reported*, with the command that holds it, and is never
 *     stolen. The panel shows the reason the model gives.
 *  3. **A shortcut is a preference, not an edit.** Changing one adds no
 *     history step, dirties nothing and never reaches a project file.
 *
 * The panel is a thin shell over `core/actions`: the capture rules, the
 * conflict rules and the list of chords live in the model, where they can be
 * tested without a browser.
 *
 * While a chord is being captured the keys go to a text field, which is what
 * keeps the application's own shortcuts from firing while the user is typing
 * one: the global handler leaves a text field alone.
 */

import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { currentPlatform, formatShortcut } from "../../core/actions/keyboard";
import { captureChord, shortcutEntries } from "../../core/actions/shortcutEditor";
import { registerPanel } from "../../core/shell/panelRegistry";
import type { ActionId, ShortcutSpec } from "../../core/actions/types";
import { Panel } from "../../components/panels/Panel";
import { useShortcutOverrides, useShortcutStore } from "../../hooks/useShortcuts";
import "./shortcuts.css";

/** The chords of one command, as the user reads them. */
function formatChords(chords: readonly ShortcutSpec[], platform: "mac" | "other"): string {
  return chords.map((chord) => formatShortcut(chord, platform)).join(", ");
}

/** The panel's body. */
export function ShortcutEditorPanel() {
  const store = useShortcutStore();
  const overrides = useShortcutOverrides();
  const platform = currentPlatform();
  const entries = useMemo(() => shortcutEntries(overrides), [overrides]);
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  const commands = useMemo(
    () => entries.filter((entry) => !entry.actionId.startsWith("tool:")),
    [entries],
  );
  const tools = useMemo(
    () => entries.filter((entry) => entry.actionId.startsWith("tool:")),
    [entries],
  );

  /** Reads the chord off the key the user pressed. */
  const capture = useCallback(
    async (actionId: ActionId, event: ReactKeyboardEvent<HTMLInputElement>) => {
      // The key is the panel's, not the canvas's: nothing else may act on it.
      event.preventDefault();
      event.stopPropagation();

      const captured = captureChord(event, platform);
      if (!captured.ok) {
        setReason(captured.reason);
        return;
      }
      const result = await store.assign(actionId, captured.shortcut);
      if (!result.ok) {
        // The chord is already held: the model says by whom, and the panel
        // says it rather than taking the chord anyway.
        setReason(result.reason);
        return;
      }
      setReason(null);
      setCapturing(null);
    },
    [platform, store],
  );

  /** Gives a command its built-in chord back. */
  const reset = useCallback(
    async (actionId: ActionId) => {
      await store.reset(actionId);
      setReason(null);
    },
    [store],
  );

  const rows = (list: typeof entries) =>
    list.map((entry) => (
      <li key={entry.actionId} className="shortcuts__row">
        <span className="shortcuts__label">{entry.label}</span>
        {capturing === entry.actionId ? (
          <input
            className="shortcuts__capture"
            type="text"
            readOnly
            autoFocus
            value=""
            placeholder="Press a key…"
            aria-label={`Press a key for ${entry.label}`}
            onKeyDown={(event) => {
              void capture(entry.actionId, event);
            }}
          />
        ) : (
          <span className="shortcuts__chord">{formatChords(entry.shortcuts, platform)}</span>
        )}
        {entry.customized ? (
          <>
            <span className="shortcuts__was">
              was {formatChords(entry.defaults, platform)}
            </span>
            <button
              type="button"
              className="shortcuts__button"
              onClick={() => {
                void reset(entry.actionId);
              }}
            >
              Reset
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="shortcuts__button"
          onClick={() => {
            setReason(null);
            setCapturing(capturing === entry.actionId ? null : entry.actionId);
          }}
        >
          {capturing === entry.actionId ? "Cancel" : "Change"}
        </button>
      </li>
    ));

  return (
    <Panel
      title="Shortcuts"
      footer={
        <p className="shortcuts__hint">
          A shortcut is a preference: it adds no history step and never reaches a project file.
        </p>
      }
    >
      {reason !== null ? (
        <p className="shortcuts__reason" role="alert">
          {reason}
        </p>
      ) : null}
      <ul className="shortcuts__list">{rows(commands)}</ul>
      <h3 className="shortcuts__group">Tools</h3>
      <ul className="shortcuts__list">{rows(tools)}</ul>
    </Panel>
  );
}

/**
 * Registers the editor with the shell's panel registry.
 *
 * The shell reads a list of panels and renders whatever is in it, so a panel
 * joins by registering itself when its module is evaluated.
 */
registerPanel({
  id: "shortcuts",
  title: "Shortcuts",
  slot: "right",
  order: 30,
  icon: "keyboard",
  // The panel keeps the search-free list in React state (the command being
  // captured), so it stays mounted while it is hidden and cannot lose it.
  mounting: "always",
  collapsible: true,
  grow: false,
  description: "The keys the commands answer to, and the ones the user changed.",
  render: () => <ShortcutEditorPanel />,
});
