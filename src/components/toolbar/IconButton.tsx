/**
 * Icon button.
 *
 * Square, compact control used by the tool rail, toolbars and panels. Always
 * labelled for accessibility; the label doubles as the tooltip.
 */

import type { ReactNode } from "react";

export interface IconButtonProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly active?: boolean;
  /** Shortcut hint appended to the tooltip. */
  readonly shortcut?: string;
  readonly size?: "sm" | "md";
}

export function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  active = false,
  shortcut,
  size = "md",
}: IconButtonProps) {
  const className = ["icon-button", `icon-button--${size}`, active ? "is-active" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
