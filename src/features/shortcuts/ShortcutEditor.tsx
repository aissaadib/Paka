/**
 * The shortcut editor.
 *
 * A dialog that lists the actions the app really has - the registry is the
 * only list - and lets the user press a key combination to rebind one of
 * them. Three rules shape it:
 *
 *  - **Nothing is stored that the app cannot deliver.** A combination the
 *    operating system owns, or one the runtime never sends to the app, is
 *    refused with the reason, not saved and quietly ignored.
 *  - **A conflict is a decision, not a tie-break.** When the new chord is
 *    already claimed, the editor names the action that claims it and asks:
 *    exchange the two, or leave it alone. It never lets one action silently
 *    take the other's key.
 *  - **The editor shows the app's real state.** A chord is read from the
 *    registry's effective chords, so a rebound shortcut is shown as the
 *    shortcut the app answers to, and a rebound shortcut *is* the shortcut the
 *    app answers to.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { currentPlatform, formatShortcut } from "../../core/actions/keyboard";
import {
  actionCatalog,
  findBindingConflict,
  resetActionShortcuts,
  resetAllShortcuts,
  setActionChord,
  swapActionChords,
  type ActionCatalogEntry,
  type BindingConflict,
} from "../../core/actions/registry";
import { captureShortcut } from "../../core/actions/shortcuts";
import { resumeShortcuts, suspendShortcuts } from "../../core/actions/suspension";
import type { ActionId, ShortcutSpec } from "../../core/actions/types";
import { useShortcutBindings } from "../../hooks/useShortcutBindings";
import { clamp } from "../../utils/math";
import { filterActions, groupActions, slotKey, slotKeys } from "./shortcutEditorModel";
import "./shortcuts.css";

export interface ShortcutEditorProps {
  readonly onClose: () => void;
}

/** What the editor is doing with the keyboard right now. */
type CaptureState =
  | { readonly kind: "idle" }
  | { readonly kind: "capturing"; readonly actionId: ActionId; readonly index: number }
  | {
      readonly kind: "conflict";
      readonly actionId: ActionId;
      readonly index: number;
      readonly shortcut: ShortcutSpec;
      readonly conflict: BindingConflict;
    };

export function ShortcutEditor({ onClose }: ShortcutEditorProps) {
  const platform = currentPlatform();
  const version = useShortcutBindings();
  const [query, setQuery] = useState("");
  const [capture, setCapture] = useState<CaptureState>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedSlot, setFocusedSlot] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const slotRefs = useRef(new Map<string, HTMLButtonElement>());

  const catalog = useMemo(() => actionCatalog(), [version]);
  const groups = useMemo(
    () => groupActions(filterActions(catalog, query, platform)),
    [catalog, query, platform],
  );
  const keys = useMemo(() => slotKeys(groups), [groups]);
  const activeSlot = focusedSlot !== null && keys.includes(focusedSlot) ? focusedSlot : keys[0];

  const anyChanged = catalog.some((entry) => entry.changed);
  const labelOf = (actionId: ActionId): string =>
    catalog.find((entry) => entry.id === actionId)?.label ?? actionId;

  // The dialog takes the keyboard while it is open: the search field has the
  // focus, so a search never triggers an action, and the app's own shortcuts
  // do not run behind the dialog.
  useEffect(() => {
    suspendShortcuts();
    searchRef.current?.focus();
    return () => {
      resumeShortcuts();
    };
  }, []);

  // The capture owns the keyboard. The listener sits in the capture phase, so
  // the pressed key never reaches the app's own shortcut handler and never
  // reaches the button that was clicked.
  useEffect(() => {
    if (capture.kind === "idle") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapture({ kind: "idle" });
        setError(null);
        setNotice(null);
        return;
      }
      if (capture.kind !== "capturing") {
        // A conflict is waiting for an answer; other keys do nothing.
        return;
      }
      const result = captureShortcut(event, platform);
      if (result.kind === "waiting") {
        setNotice(result.reason);
        setError(null);
        return;
      }
      if (result.kind !== "captured") {
        setNotice(null);
        setError(result.reason);
        return;
      }
      const conflict = findBindingConflict(
        capture.actionId,
        capture.index,
        result.shortcut,
        platform,
      );
      if (conflict !== null) {
        setNotice(null);
        setError(null);
        setCapture({
          kind: "conflict",
          actionId: capture.actionId,
          index: capture.index,
          shortcut: result.shortcut,
          conflict,
        });
        return;
      }
      setActionChord(capture.actionId, capture.index, result.shortcut);
      setCapture({ kind: "idle" });
      setError(null);
      setNotice(
        `${labelOf(capture.actionId)} is now ${formatShortcut(result.shortcut, platform)}.`,
      );
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [capture, platform, catalog]);

  const startCapture = (actionId: ActionId, index: number) => {
    setCapture({ kind: "capturing", actionId, index });
    setNotice(null);
    setError(null);
  };

  const acceptSwap = () => {
    if (capture.kind !== "conflict") {
      return;
    }
    swapActionChords(
      { actionId: capture.actionId, index: capture.index },
      { actionId: capture.conflict.actionId, index: capture.conflict.index },
    );
    setCapture({ kind: "idle" });
    setError(null);
    setNotice(
      `${labelOf(capture.actionId)} and ${labelOf(capture.conflict.actionId)} exchanged their shortcuts.`,
    );
  };

  const declineSwap = () => {
    setCapture({ kind: "idle" });
    setError(null);
    setNotice(null);
  };

  const resetAction = (entry: ActionCatalogEntry) => {
    resetActionShortcuts(entry.id);
    setNotice(`${entry.label} is back to its default shortcut.`);
    setError(null);
  };

  const resetEverything = () => {
    resetAllShortcuts();
    setNotice("Every shortcut is back to its default.");
    setError(null);
  };

  // The arrow keys walk the list of shortcuts, so the editor can be driven
  // without a mouse.
  const moveFocus = (delta: number) => {
    if (keys.length === 0) {
      return;
    }
    const current = keys.indexOf(activeSlot);
    const next = clamp(current + delta, 0, keys.length - 1);
    setFocusedSlot(keys[next]);
    slotRefs.current.get(keys[next])?.focus();
  };

  // Tab stays inside the dialog: it is modal, so the keyboard must not wander
  // into the editor behind it.
  const trapFocus = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="dialog shortcut-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-editor-title"
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
            return;
          }
          trapFocus(event);
        }}
      >
        <header className="shortcut-editor__header">
          <h2 className="dialog__title" id="shortcut-editor-title">
            Keyboard Shortcuts
          </h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="shortcut-editor__toolbar">
          <input
            ref={searchRef}
            className="text-input shortcut-editor__search"
            type="text"
            value={query}
            placeholder="Search actions"
            aria-label="Search actions"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(1);
              }
            }}
          />
          <button
            type="button"
            className="button"
            disabled={!anyChanged}
            onClick={resetEverything}
          >
            Reset all
          </button>
        </div>

        {capture.kind === "conflict" ? (
          <div className="shortcut-editor__conflict" role="alert">
            <p className="shortcut-editor__conflict-text">
              <strong>{formatShortcut(capture.shortcut, platform)}</strong> is already used by{" "}
              {capture.conflict.label}.
            </p>
            <div className="shortcut-editor__conflict-actions">
              <button type="button" className="button button--primary" onClick={acceptSwap}>
                Swap the two
              </button>
              <button type="button" className="button" onClick={declineSwap}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {capture.kind === "capturing" ? (
          <p className="shortcut-editor__capturing" aria-live="polite">
            Press the key combination for <strong>{labelOf(capture.actionId)}</strong>, or press
            Esc to cancel.
          </p>
        ) : null}

        {error !== null ? (
          <p className="shortcut-editor__error" role="alert">
            {error}
          </p>
        ) : null}
        {notice !== null ? (
          <p className="shortcut-editor__notice" aria-live="polite">
            {notice}
          </p>
        ) : null}

        <div className="shortcut-editor__list" onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveFocus(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveFocus(-1);
          } else if (event.key === "Home") {
            event.preventDefault();
            moveFocus(-keys.length);
          } else if (event.key === "End") {
            event.preventDefault();
            moveFocus(keys.length);
          }
        }}>
          {groups.length === 0 ? (
            <p className="shortcut-editor__empty">No action matches “{query.trim()}”.</p>
          ) : null}
          {groups.map((group) => (
            <section className="shortcut-editor__group" key={group.category}>
              <h3 className="shortcut-editor__group-title">{group.label}</h3>
              <ul className="shortcut-editor__rows">
                {group.rows.map((row) => (
                  <li className="shortcut-editor__row" key={row.entry.id}>
                    <span className="shortcut-editor__label">{row.entry.label}</span>
                    <span className="shortcut-editor__slots">
                      {row.slots.map((slot) => {
                        const key = slotKey(row.entry.id, slot.index);
                        const isCapturing =
                          capture.kind !== "idle" &&
                          capture.actionId === row.entry.id &&
                          capture.index === slot.index;
                        return (
                          <button
                            type="button"
                            key={key}
                            className={[
                              "shortcut-editor__chip",
                              isCapturing ? "is-capturing" : "",
                              row.entry.changed ? "is-changed" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            ref={(node) => {
                              if (node) {
                                slotRefs.current.set(key, node);
                              } else {
                                slotRefs.current.delete(key);
                              }
                            }}
                            tabIndex={key === activeSlot ? 0 : -1}
                            aria-label={`${row.entry.label}: ${formatShortcut(slot.chord, platform)}. Press Enter to change it.`}
                            onFocus={() => setFocusedSlot(key)}
                            onClick={() => startCapture(row.entry.id, slot.index)}
                          >
                            {isCapturing ? "Press keys…" : formatShortcut(slot.chord, platform)}
                          </button>
                        );
                      })}
                    </span>
                    {row.entry.changed ? (
                      <button
                        type="button"
                        className="shortcut-editor__reset"
                        onClick={() => resetAction(row.entry)}
                      >
                        Reset
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
