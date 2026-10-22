/**
 * Panel chrome for the side panels.
 *
 * Provides the header, the optional action row and the scrollable body used
 * by the colour and layers panels; kept generic so every panel matches.
 *
 * The chrome reads the panel chrome context, so the panel manager can fold a
 * panel to its header and hide it without the panel itself knowing: a panel
 * component renders its content and nothing else.
 */

import { useContext } from "react";
import type { ReactNode } from "react";
import { IconChevronDown } from "../icons";
import { IconButton } from "../toolbar/IconButton";
import { PanelChromeContext } from "./panelChrome";
import "./panel.css";

export interface PanelProps {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

export function Panel({ title, actions, footer, children }: PanelProps) {
  const chrome = useContext(PanelChromeContext);
  const collapsed = chrome?.collapsed ?? false;
  const hidden = chrome?.hidden ?? false;

  const className = [
    "panel",
    hidden ? "panel--hidden" : "",
    collapsed ? "panel--collapsed" : "",
    chrome?.grow ? "panel--grow" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={className} aria-hidden={hidden ? true : undefined}>
      <header className="panel__header">
        <h2 className="panel__title">{title}</h2>
        <div className="panel__actions">
          {actions}
          {chrome?.collapsible ? (
            <IconButton
              label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
              size="sm"
              active={collapsed}
              onClick={chrome.onToggleCollapsed}
            >
              <IconChevronDown className="panel__collapse-icon" />
            </IconButton>
          ) : null}
        </div>
      </header>
      {/* The body stays mounted while the panel is folded, so folding a panel
          cannot lose the state it holds. */}
      <div className="panel__body" hidden={collapsed}>
        {children}
      </div>
      {footer ? (
        <div className="panel__footer" hidden={collapsed}>
          {footer}
        </div>
      ) : null}
    </section>
  );
}
