/**
 * The canvas context menu.
 *
 * The menu owns no commands: every row is a registry action, so the label,
 * the chord and the enabled state come from the same table the keyboard
 * uses. A row that cannot run is shown disabled with the reason, rather than
 * vanishing, so the user learns where the command lives.
 *
 * The menu is a portal on the document body, so it is positioned against the
 * window and never clipped by the canvas frame.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildCanvasMenu, type CanvasMenuRow } from "../../core/actions/canvasMenu";
import { currentPlatform } from "../../core/actions/keyboard";
import { findActionById } from "../../core/actions/registry";
import type { ActionContext } from "../../core/actions/types";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { firstMenuIndex, lastMenuIndex, nextMenuIndex } from "../../utils/menuNavigation";
import { clampMenuPosition } from "../../utils/menuPosition";
import "./commands.css";

export interface CanvasContextMenuProps {
  /** The pointer position, in client coordinates. */
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}

export function CanvasContextMenu({ x, y, onClose }: CanvasContextMenuProps) {
  const { engine, actions } = useEditor();
  // The rows follow the editor's state: a selection made while the menu is
  // open changes what the menu offers.
  useEditorState();
  const platform = currentPlatform();

  const context: ActionContext = { engine, actions, file: {}, shift: false };
  const rows = buildCanvasMenu(context, platform, findActionById);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });
  const [focusIndex, setFocusIndex] = useState(() => firstFocusable(rows));

  // The menu is measured after it is laid out, so it can be kept inside the
  // window: a menu opened at the very edge would otherwise hang off screen.
  // The effect depends on the requested position alone: the rows change on
  // every render, and measuring them here would measure the menu again and
  // again.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (element === null) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const clamped = clampMenuPosition(
      x,
      y,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPosition((current) =>
      current.x === clamped.x && current.y === clamped.y ? current : clamped,
    );
  }, [x, y]);

  // A click anywhere else dismisses the menu, and the pointer that opened it
  // is already outside the menu.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target !== null && menuRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClose]);

  // The focused row takes the keyboard focus, so the menu can be driven from
  // the keyboard without touching the pointer - and the arrow keys move the
  // focus with them.
  useEffect(() => {
    const element = menuRef.current?.querySelector<HTMLElement>('[data-focused="true"]');
    element?.focus();
  }, [focusIndex]);

  const run = useCallback(
    (row: CanvasMenuRow) => {
      if (row.type !== "item" || !row.enabled) {
        return;
      }
      onClose();
      row.action.run(context);
    },
    [context, onClose],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const enabled = rows.map((row) => row.type === "item" && row.enabled);
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          event.stopPropagation();
          setFocusIndex((current) => nextMenuIndex(enabled, current, 1));
          return;
        case "ArrowUp":
          event.preventDefault();
          event.stopPropagation();
          setFocusIndex((current) => nextMenuIndex(enabled, current, -1));
          return;
        case "Home":
          event.preventDefault();
          event.stopPropagation();
          setFocusIndex(firstMenuIndex(enabled));
          return;
        case "End":
          event.preventDefault();
          event.stopPropagation();
          setFocusIndex(lastMenuIndex(enabled));
          return;
        case "Enter":
        case " ":
          event.preventDefault();
          event.stopPropagation();
          run(rows[focusIndex]);
          return;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        case "Tab":
          // The menu is a popup, not a stop in the tab order: tabbing moves on
          // and the menu goes away.
          onClose();
          return;
        default:
          return;
      }
    },
    [focusIndex, onClose, rows, run],
  );

  return createPortal(
    <div
      className="canvas-menu"
      role="menu"
      aria-label="Canvas menu"
      ref={menuRef}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onKeyDown={handleKeyDown}
    >
      {rows.map((row, index) =>
        row.type === "separator" ? (
          <div className="canvas-menu__separator" key={`separator-${index}`} role="separator" />
        ) : (
          <button
            type="button"
            role="menuitem"
            className="canvas-menu__item"
            key={row.action.id}
            disabled={!row.enabled}
            aria-disabled={!row.enabled}
            data-focused={index === focusIndex ? "true" : "false"}
            tabIndex={index === focusIndex ? 0 : -1}
            title={row.reason ?? undefined}
            onClick={() => run(row)}
            onMouseEnter={() => setFocusIndex(index)}
          >
            <span className="canvas-menu__check" aria-hidden="true">
              {row.checked ? "✓" : ""}
            </span>
            <span className="canvas-menu__label">{row.action.label}</span>
            {row.enabled ? (
              row.shortcut === null ? null : (
                <span className="canvas-menu__shortcut">{row.shortcut}</span>
              )
            ) : (
              <span className="canvas-menu__reason">{row.reason}</span>
            )}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** The index of the first row that can be focused, or `-1`. */
function firstFocusable(rows: readonly CanvasMenuRow[]): number {
  return firstMenuIndex(rows.map((row) => row.type === "item" && row.enabled));
}
