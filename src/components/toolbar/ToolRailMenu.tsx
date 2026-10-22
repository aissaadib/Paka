/**
 * The flyout of a collapsed tool group.
 *
 * A `role="menu"` popup anchored to the rail slot that opened it. It is
 * portalled to the body so the rail's own scrolling never clips it, and it
 * keeps the keyboard contract of a menu: the arrow keys move between the
 * tools, Enter picks one, Escape closes it and returns the focus.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getToolDefinition } from "../../core/tools/toolDefinitions";
import type { ToolGroup } from "../../core/tools/toolRail";
import type { ToolId } from "../../types/tool";
import { TOOL_ICONS } from "./toolIcons";

export interface ToolRailMenuProps {
  readonly group: ToolGroup;
  readonly activeToolId: ToolId;
  /**
   * The slot that opened the flyout.
   *
   * The element, not a rectangle: the rail can scroll, and the flyout has to
   * follow its button rather than stay where it opened.
   */
  readonly anchor: HTMLElement;
  readonly onSelect: (toolId: ToolId) => void;
  readonly onClose: () => void;
}

/** The gap to the rail, and the margin kept from the window edge. */
const MENU_GAP = 6;
const MENU_MARGIN = 8;

export function ToolRailMenu({
  group,
  activeToolId,
  anchor,
  onSelect,
  onClose,
}: ToolRailMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  /** Puts the flyout beside its button, inside the window. */
  const place = useCallback(() => {
    const element = menuRef.current;
    if (!element) {
      return;
    }
    const box = element.getBoundingClientRect();
    const anchorBox = anchor.getBoundingClientRect();
    const left = Math.max(
      MENU_MARGIN,
      Math.min(anchorBox.right + MENU_GAP, window.innerWidth - box.width - MENU_MARGIN),
    );
    const top = Math.max(
      MENU_MARGIN,
      Math.min(anchorBox.top, window.innerHeight - box.height - MENU_MARGIN),
    );
    setPosition({ left, top });
  }, [anchor]);

  // The menu is measured after it is in the document, so it can be kept
  // inside the window instead of hanging off the edge.
  useLayoutEffect(() => {
    place();
  }, [place]);

  // A resize or a scroll moves the button; the flyout follows it.
  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);

  // The focus moves into the menu: on the active tool when there is one, on
  // the first tool otherwise.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) {
      return;
    }
    const active = element.querySelector<HTMLButtonElement>('[aria-current="true"]');
    const first = element.querySelector<HTMLButtonElement>('[role="menuitem"]');
    (active ?? first)?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) {
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLButtonElement);

    // The menu owns the arrow keys while it is open, so they cannot nudge a
    // selection at the same time.
    const move = (next: number) => {
      event.preventDefault();
      event.stopPropagation();
      items[next]?.focus();
    };

    switch (event.key) {
      case "ArrowDown":
        move((index + 1) % items.length);
        return;
      case "ArrowUp":
        move((index - 1 + items.length) % items.length);
        return;
      case "Home":
        move(0);
        return;
      case "End":
        move(items.length - 1);
        return;
      case "Escape":
        // The menu owns Escape while it is open: the app's own Escape (clear
        // the selection) must not fire behind it.
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      case "Tab":
        onClose();
        return;
      default:
        return;
    }
  };

  return createPortal(
    <div
      className="tool-rail__menu"
      role="menu"
      aria-label={group.label}
      ref={menuRef}
      style={{
        left: position?.left ?? anchor.getBoundingClientRect().right + MENU_GAP,
        top: position?.top ?? anchor.getBoundingClientRect().top,
      }}
      onKeyDown={handleKeyDown}
    >
      {group.toolIds.map((toolId) => {
        const tool = getToolDefinition(toolId);
        const isActive = toolId === activeToolId;
        return (
          <button
            type="button"
            role="menuitem"
            className="tool-rail__menu-item"
            key={toolId}
            aria-current={isActive ? "true" : undefined}
            onClick={() => onSelect(toolId)}
          >
            <span className="tool-rail__menu-icon">{TOOL_ICONS[toolId]}</span>
            <span className="tool-rail__menu-label">{tool.label}</span>
            <span className="tool-rail__menu-shortcut">{tool.shortcut}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
