/**
 * The command palette.
 *
 * A searchable list of the commands the registry holds. The palette keeps no
 * list of its own: it filters the registry, so a command that is added to the
 * keyboard table is in the palette too, with the same name and the same
 * chord.
 *
 * The palette is a portal on the document body and takes the keyboard while
 * it is open: the input has the focus, the arrow keys walk the results and
 * Enter runs the highlighted one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { commandRow } from "../../core/actions/commandRows";
import { searchCommands } from "../../core/actions/commandSearch";
import { currentPlatform } from "../../core/actions/keyboard";
import { ACTION_DEFINITIONS } from "../../core/actions/registry";
import type { ActionContext, FileActionHandlers } from "../../core/actions/types";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { firstMenuIndex, nextMenuIndex } from "../../utils/menuNavigation";
import "./commands.css";

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The file commands, so that Save and Open work from the palette. */
  readonly file: FileActionHandlers;
}

export function CommandPalette({ open, onClose, file }: CommandPaletteProps) {
  const { engine, actions } = useEditor();
  useEditorState();
  const platform = currentPlatform();

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const context: ActionContext = { engine, actions, file, shift: false };

  const results = useMemo(
    () => searchCommands(query, ACTION_DEFINITIONS, platform),
    // The results follow the editor's state as well as the query: a command
    // that cannot run now is shown as such.
    [engine, actions, query, platform],
  );

  const rows = useMemo(
    () => results.map((result) => commandRow(result.action, context, platform)),
    [context, platform, results],
  );

  // Opening the palette starts from a clean query, so the same command can be
  // found again without clearing the field first.
  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setHighlight(0);
    inputRef.current?.focus();
  }, [open]);

  // A click outside the palette dismisses it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target !== null && listRef.current?.contains(target)) {
        return;
      }
      if (target !== null && inputRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClose, open]);

  const run = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row === undefined || !row.enabled) {
        return;
      }
      onClose();
      row.action.run(context);
    },
    [context, onClose, rows],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const enabled = rows.map((row) => row.enabled);
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setHighlight((current) => nextMenuIndex(enabled, current, 1));
          return;
        case "ArrowUp":
          event.preventDefault();
          setHighlight((current) => nextMenuIndex(enabled, current, -1));
          return;
        case "Enter":
          event.preventDefault();
          run(highlight);
          return;
        case "Escape":
          event.preventDefault();
          onClose();
          return;
        default:
          return;
      }
    },
    [highlight, onClose, rows, run],
  );

  if (!open) {
    return null;
  }

  const enabled = rows.map((row) => row.enabled);
  const firstEnabled = firstMenuIndex(enabled);

  return createPortal(
    <div className="command-palette" role="dialog" aria-label="Command palette">
      <div className="command-palette__panel">
        <input
          className="command-palette__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-activedescendant={
            rows[highlight] === undefined ? undefined : `command-palette-option-${highlight}`
          }
          aria-label="Search commands"
          placeholder="Search commands…"
          autoComplete="off"
          spellCheck={false}
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="command-palette__results" id="command-palette-results" role="listbox" ref={listRef}>
          {rows.length === 0 ? (
            <p className="command-palette__empty">No command matches that.</p>
          ) : (
            rows.map((row, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                aria-disabled={!row.enabled}
                className={[
                  "command-palette__item",
                  index === highlight ? "is-highlighted" : "",
                  row.enabled ? "" : "is-disabled",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={row.action.id}
                id={`command-palette-option-${index}`}
                disabled={!row.enabled}
                title={row.reason ?? undefined}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => run(index)}
              >
                <span className="command-palette__label">{row.action.label}</span>
                {row.enabled ? (
                  row.shortcut === null ? null : (
                    <span className="command-palette__shortcut">{row.shortcut}</span>
                  )
                ) : (
                  <span className="command-palette__reason">{row.reason}</span>
                )}
              </button>
            ))
          )}
        </div>
        {firstEnabled < 0 ? null : (
          <p className="command-palette__hint">
            ↑ ↓ to move · Enter to run · Esc to close
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
