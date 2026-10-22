/**
 * A button of the tool rail.
 *
 * The rail draws its own button rather than the shared `IconButton` because a
 * rail button needs three things the shared control does not carry: a roving
 * tab stop, the pointer handlers the tooltip hangs on, and no native `title`
 * (the browser's own tooltip follows the pointer and covers the canvas). The
 * look is still the shared `icon-button` class, so the rail and the toolbars
 * stay the same control.
 */

import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  Ref,
} from "react";

export interface ToolRailButtonProps {
  /** The tool's name. It is the button's accessible name. */
  readonly label: string;
  /** The shortcut that selects the tool, shown in the tooltip. */
  readonly shortcut?: string;
  /** The button's own description, read out after the name. */
  readonly description?: string;
  readonly active?: boolean;
  /**
   * True for the slot of a collapsed group that holds the active tool.
   *
   * A menu trigger cannot also be a toggle button, so the current item of
   * the group is marked with `aria-current` instead of `aria-pressed`.
   */
  readonly current?: boolean;
  readonly onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly children: ReactNode;
  /** The button element, for focus management. */
  readonly buttonRef?: Ref<HTMLButtonElement>;
  /** The tab stop of the rail: 0 for the active tool, -1 for the rest. */
  readonly tabIndex?: number;
  /** True for the slot that opens a flyout. */
  readonly hasPopup?: boolean;
  /** True while the flyout is open. */
  readonly expanded?: boolean;
  readonly onPointerEnter?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onPointerLeave?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function ToolRailButton({
  label,
  shortcut,
  description,
  active = false,
  current = false,
  onClick,
  children,
  buttonRef,
  tabIndex,
  hasPopup = false,
  expanded = false,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
}: ToolRailButtonProps) {
  const descriptionId = description
    ? `tool-rail-description-${label.replace(/\s+/g, "-")}`
    : undefined;

  return (
    <button
      type="button"
      ref={buttonRef}
      className={["icon-button", active ? "is-active" : ""].filter(Boolean).join(" ")}
      data-rail-item=""
      aria-label={label}
      aria-describedby={descriptionId}
      aria-pressed={hasPopup ? undefined : active || undefined}
      aria-current={hasPopup && current ? "true" : undefined}
      aria-haspopup={hasPopup ? "menu" : undefined}
      aria-expanded={hasPopup ? expanded : undefined}
      aria-keyshortcuts={shortcut}
      tabIndex={tabIndex}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
    >
      {children}
      {description ? (
        <span className="tool-rail__sr-only" id={descriptionId}>
          {description}
        </span>
      ) : null}
    </button>
  );
}
