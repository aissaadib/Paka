/**
 * The flyout of a collapsed tool group.
 *
 * A `role="menu"` popup anchored to the rail slot that opened it. It is
 * portalled to the body so the rail's own scrolling never clips it, and it
 * keeps the keyboard contract of a menu: the arrow keys move between the
 * tools, Enter picks one, Escape closes it and returns the focus.
 */

import { useCallback, useRef } from "react";
import { getToolDefinition } from "../../core/tools/toolDefinitions";
import { toolShortcut, type ToolGroup, type ToolRailRect } from "../../core/tools/toolRail";
import type { ToolId } from "../../types/tool";
import { Popover } from "./Popover";
import { TOOL_ICONS } from "./toolIcons";

export interface ToolRailMenuProps {
  readonly group: ToolGroup;
  readonly activeToolId: ToolId;
  /** The slot that opened the flyout, in viewport coordinates. */
  readonly anchor: ToolRailRect;
  /** The slot that opened the flyout, so the menu can follow it. */
  readonly anchorElement?: HTMLElement | null;
  readonly onSelect: (toolId: ToolId) => void;
  readonly onClose: () => void;
}

/** The gap to the rail. */
const MENU_GAP = 6;

export function ToolRailMenu({
  group,
  activeToolId,
  anchor,
  anchorElement,
  onSelect,
  onClose,
}: ToolRailMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  /**
   * The focus moves into the menu: on the active tool when there is one, on
   * the first tool otherwise.
   *
   * It happens once the flyout is placed: a panel that is still hidden
   * cannot take the focus, and the browser drops the request.
   */
  const focusMenuItem = useCallback(() => {
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

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        // The rail's own arrow keys must not run behind the menu: they would
        // take the focus back to the rail.
        event.stopPropagation();
        items[(index + 1) % items.length]?.focus();
        return;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        items[(index - 1 + items.length) % items.length]?.focus();
        return;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        items[0]?.focus();
        return;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        items[items.length - 1]?.focus();
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

  return (
    <Popover
      open
      anchor={anchor}
      anchorElement={anchorElement}
      side="right"
      gap={MENU_GAP}
      role="menu"
      ariaLabel={group.label}
      className="tool-rail__menu"
      onClose={onClose}
      onPlaced={focusMenuItem}
    >
      <div ref={menuRef} role="none" onKeyDown={handleKeyDown}>
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
              <span className="tool-rail__menu-shortcut">{toolShortcut(tool.id)}</span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
