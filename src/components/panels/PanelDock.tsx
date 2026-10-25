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
 * A tab is also the panel's handle. Dragging it over another tab reorders the
 * dock; dragging it onto the canvas floats the panel, where it becomes a
 * window the user can move and resize. The small actions menu is the
 * keyboard-and-pointer equivalent of the same two moves, so the feature does
 * not depend on a drag gesture.
 *
 * Keyboard: the tab strip follows the WAI-ARIA tabs pattern. Left/Right move
 * between tabs, Home/End jump to the ends, and the tab strip has one stop in
 * the page's tab order rather than one per tab.
 */

import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  IconBrush,
  IconFile,
  IconKeyboard,
  IconMore,
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

export interface PanelDockProps {
  readonly panels: readonly DockPanel[];
  /** Moves a panel to a position inside the dock. */
  readonly onMovePanel?: (panelId: string, index: number) => void;
  /** Pulls a panel out of the dock into its own window. */
  readonly onFloatPanel?: (panelId: string) => void;
  /** Puts every panel back where the registry says. */
  readonly onResetPanels?: () => void;
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

export function PanelDock({
  panels,
  onMovePanel,
  onFloatPanel,
  onResetPanels,
}: PanelDockProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [floatDropLeft, setFloatDropLeft] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const active = panels.find((panel) => panel.id === activeId) ?? panels[0];

  // If the active panel was floated or hidden, the first remaining tab takes
  // over. The dock is a view of the composition, so it must never point at a
  // panel that is no longer in it.
  useEffect(() => {
    if (activeId !== null && !panels.some((panel) => panel.id === activeId)) {
      setActiveId(null);
    }
  }, [activeId, panels]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const first = menuRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]',
    );
    first?.focus();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) === true ||
        menuTriggerRef.current?.contains(target) === true
      ) {
        return;
      }
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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

  const clearDrag = () => {
    setDraggingId(null);
    setDropIndex(null);
    setFloatDropLeft(null);
  };

  const onDragStart = (
    event: ReactDragEvent<HTMLButtonElement>,
    panelId: string,
  ) => {
    setDraggingId(panelId);
    setMenuOpen(false);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-paka-panel", panelId);
    // Playwright and some browsers only expose text/plain reliably.
    event.dataTransfer.setData("text/plain", panelId);

    const side = event.currentTarget.closest(".side-panels");
    const rect = side instanceof HTMLElement ? side.getBoundingClientRect() : null;
    setFloatDropLeft(rect === null ? null : Math.max(0, rect.left));
  };

  const dropTarget = (
    event: ReactDragEvent<HTMLButtonElement>,
    index: number,
  ): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX > rect.left + rect.width / 2 ? index + 1 : index;
  };

  const onDragOverTab = (
    event: ReactDragEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (draggingId === null) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndex(dropTarget(event, index));
  };

  const onDropTab = (
    event: ReactDragEvent<HTMLButtonElement>,
    index: number,
  ) => {
    event.preventDefault();
    const panelId =
      draggingId ?? event.dataTransfer.getData("application/x-paka-panel");
    if (panelId !== "" && onMovePanel !== undefined) {
      onMovePanel(panelId, dropTarget(event, index));
    }
    clearDrag();
  };

  const onDropFloat = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const panelId =
      draggingId ?? event.dataTransfer.getData("application/x-paka-panel");
    if (panelId !== "" && onFloatPanel !== undefined) {
      onFloatPanel(panelId);
    }
    clearDrag();
  };

  const draggingTitle =
    panels.find((panel) => panel.id === draggingId)?.title ?? "panel";

  return (
    <div className="panel-dock">
      <div className="panel-dock__bar">
        <div
          className="panel-dock__tabs"
          role="tablist"
          aria-label="Panels"
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
        >
          {panels.map((panel, index) => {
            const selected = panel.id === active.id;
            const drop =
              dropIndex === index
                ? "before"
                : index === panels.length - 1 && dropIndex === panels.length
                  ? "after"
                  : undefined;
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
                title={
                  onMovePanel === undefined && onFloatPanel === undefined
                    ? panel.title
                    : `${panel.title} - drag to reorder or float`
                }
                className={[
                  "panel-dock__tab",
                  selected ? "is-active" : "",
                  draggingId === panel.id ? "is-dragging" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-drop={drop}
                draggable={onMovePanel !== undefined || onFloatPanel !== undefined}
                onClick={() => select(panel.id)}
                onDragStart={(event) => onDragStart(event, panel.id)}
                onDragOver={(event) => onDragOverTab(event, index)}
                onDrop={(event) => onDropTab(event, index)}
                onDragEnd={clearDrag}
              >
                {panelIcon(panel.id)}
              </button>
            );
          })}
        </div>
        {onFloatPanel === undefined && onResetPanels === undefined ? null : (
          <button
            ref={menuTriggerRef}
            type="button"
            className="panel-dock__menu-trigger"
            aria-label="Panel actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Panel actions"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <IconMore />
          </button>
        )}
        {menuOpen ? (
          <div
            ref={menuRef}
            className="panel-dock__menu"
            role="menu"
            aria-label="Panel actions"
          >
            {onFloatPanel === undefined ? null : (
              <button
                type="button"
                role="menuitem"
                className="panel-dock__menu-item"
                onClick={() => {
                  onFloatPanel(active.id);
                  setMenuOpen(false);
                }}
              >
                Float {active.title}
              </button>
            )}
            {onFloatPanel !== undefined && onResetPanels !== undefined ? (
              <div className="panel-dock__menu-separator" role="separator" />
            ) : null}
            {onResetPanels === undefined ? null : (
              <button
                type="button"
                role="menuitem"
                className="panel-dock__menu-item"
                onClick={() => {
                  onResetPanels();
                  setMenuOpen(false);
                }}
              >
                Reset panel layout
              </button>
            )}
          </div>
        ) : null}
      </div>
      <div className="panel-dock__body">
        {panels.map((panel) => (
          <div
            key={panel.id}
            className="panel-dock__panel"
            id={`dock-panel-${panel.id}`}
            data-panel-id={panel.id}
            role="tabpanel"
            aria-labelledby={`dock-tab-${panel.id}`}
            hidden={panel.id !== active.id}
          >
            {panel.render()}
          </div>
        ))}
      </div>
      {draggingId !== null && floatDropLeft !== null && onFloatPanel !== undefined
        ? createPortal(
            <div
              className="panel-float-drop"
              style={{ width: `${floatDropLeft}px` }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={onDropFloat}
            >
              <p>
                Drop to float <strong>{draggingTitle}</strong>
              </p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
