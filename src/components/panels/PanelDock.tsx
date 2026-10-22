/**
 * A tabbed group of docked panels.
 *
 * The side column used to stack every panel, so five panels shared one
 * column: the colour wheel took what it needed, the shortcut list took
 * nearly 300 px, and the layers list was left 48 px tall at a 900 px window
 * and 24 px at 600 px. Tabbing the inspect-and-adjust panels fixes that
 * without hiding any of them: one panel occupies the column, the layers list
 * gets a real share of the height, and every panel stays mounted, so its
 * state survives a switch.
 *
 * The tabs are the panels the composition already says are visible, in its
 * order. This component does not decide which panels exist or whether they
 * are shown - it only decides which visible one is on top.
 *
 * Keyboard: the tab strip follows the WAI-ARIA tabs pattern. Left/Right move
 * between tabs, Home/End jump to the ends, and the tab strip has one stop in
 * the page's tab order rather than one per tab.
 */

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  IconBrush,
  IconFile,
  IconKeyboard,
  IconNavigator,
  IconPalette,
} from "../icons";
import "./panel.css";

/** One panel the dock can show. */
export interface DockPanel {
  /** The panel's stable id, from the composition. */
  readonly id: string;
  /** The name the tab announces and its tooltip. */
  readonly title: string;
  /** The panel's body. */
  readonly render: () => ReactNode;
}

/** The glyph for a panel, by its stable id. */
function panelIcon(id: string): ReactNode {
  switch (id) {
    case "color":
      return <IconPalette />;
    case "brushes":
      return <IconBrush />;
    case "navigator":
      return <IconNavigator />;
    case "shortcuts":
      return <IconKeyboard />;
    default:
      return <IconFile />;
  }
}

export function PanelDock({ panels }: { readonly panels: readonly DockPanel[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const active = panels.find((panel) => panel.id === activeId) ?? panels[0];

  if (!active) {
    return null;
  }

  /** Moves the selection to a tab and gives it the focus. */
  const select = (id: string, focus = false) => {
    setActiveId(id);
    if (focus) {
      tabRefs.current.get(id)?.focus();
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = panels.findIndex((panel) => panel.id === active.id);
    let next = -1;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % panels.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + panels.length) % panels.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = panels.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = panels[next];
    if (target) {
      select(target.id, true);
    }
  };

  return (
    <div className="panel-dock">
      <div
        className="panel-dock__tabs"
        role="tablist"
        aria-label="Panels"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
      >
        {panels.map((panel) => {
          const selected = panel.id === active.id;
          return (
            <button
              key={panel.id}
              ref={(element) => {
                if (element) {
                  tabRefs.current.set(panel.id, element);
                } else {
                  tabRefs.current.delete(panel.id);
                }
              }}
              type="button"
              role="tab"
              id={`dock-tab-${panel.id}`}
              aria-label={panel.title}
              aria-selected={selected}
              aria-controls={`dock-panel-${panel.id}`}
              tabIndex={selected ? 0 : -1}
              title={panel.title}
              className={selected ? "panel-dock__tab is-active" : "panel-dock__tab"}
              onClick={() => select(panel.id)}
            >
              {panelIcon(panel.id)}
            </button>
          );
        })}
      </div>
      <div className="panel-dock__body">
        {panels.map((panel) => (
          <div
            key={panel.id}
            className="panel-dock__panel"
            id={`dock-panel-${panel.id}`}
            role="tabpanel"
            aria-labelledby={`dock-tab-${panel.id}`}
            hidden={panel.id !== active.id}
          >
            {panel.render()}
          </div>
        ))}
      </div>
    </div>
  );
}
