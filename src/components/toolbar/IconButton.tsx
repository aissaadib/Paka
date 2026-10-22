/**
 * Icon button.
 *
 * Square, compact control used by the tool rail, the app bar and the panels.
 * Always labelled for accessibility; the label doubles as the tooltip, which
 * is anchored to the button instead of following the pointer.
 */

import type { ReactNode } from "react";
import { Tooltip, type TooltipPlacement } from "./Tooltip";

export interface IconButtonProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly active?: boolean;
  /** Shortcut hint appended to the tooltip. */
  readonly shortcut?: string;
  readonly size?: "sm" | "md" | "lg";
  /** Which side of the button the tooltip sits on. */
  readonly tooltipPlacement?: TooltipPlacement;
  /** A class for the button, so a context can place or hide it. */
  readonly className?: string;
}

export function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  active = false,
  shortcut,
  size = "md",
  tooltipPlacement = "bottom",
  className,
}: IconButtonProps) {
  const classes = [
    "icon-button",
    `icon-button--${size}`,
    active ? "is-active" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tooltip
      label={label}
      shortcut={shortcut}
      placement={tooltipPlacement}
      className={className}
    >
      <button
        type="button"
        className={classes}
        aria-label={label}
        aria-pressed={active || undefined}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}
