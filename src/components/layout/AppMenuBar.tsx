/**
 * Top menu bar.
 *
 * Only entries backed by real functionality are present: the file operations,
 * undo, redo, the selection transforms, the view actions and the panels the
 * user can show or hide. Disabled states come from the command stack, the
 * selection and the panel layout, so the menu never offers an action that
 * cannot run. The file entries are
 * callbacks rather than direct service calls because discarding unsaved work
 * needs a confirmation the workspace owns.
 *
 * The menu is keyboard driven: the arrow keys open a menu and walk its
 * items, the disabled items are skipped, Home and End jump to the ends, and
 * Escape closes the menu and puts the focus back on the menu it came from.
 */

import { useEffect, useRef, useState } from "react";
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, SVGProps } from "react";
import {
  FIXED_ROTATION_DEGREES,
  FIXED_SCALE_FACTOR,
} from "../../core/document/selectionTransform";
import {
  isDefaultPanelLayout,
  isPanelVisible,
} from "../../core/panels/panelLayout";
import { sidePanelDefinitions } from "../../core/panels/panelRegistry";
import { WORKSPACE_PROFILES } from "../../core/workspace/workspaceProfiles";
import { UI_SCALE_STEPS, WORKSPACE_THEMES } from "../../core/workspace/workspaceSettings";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { usePanelActions, usePanelState } from "../../hooks/usePanels";
import { useWorkspaceActions, useWorkspaceSettings } from "../../hooks/useWorkspace";
import { VIEW_ROTATION_DEGREES } from "../../features/view/viewNavigation";
import { IconCheck, IconChevronDown } from "../icons";
import { panelIcon } from "../panels/panelIcons";
import {
  firstMenuIndex,
  lastMenuIndex,
  nextMenuIndex,
} from "../../utils/menuNavigation";

interface MenuItemSpec {
  readonly type: "item";
  readonly label: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  /** The item's state, for an item that toggles something. */
  readonly checked?: boolean;
  /** The item's glyph, when it has one. */
  readonly icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** A line of explanation, shown as the item's tooltip. */
  readonly description?: string;
  readonly onSelect: () => void;
}

interface MenuSeparatorSpec {
  readonly type: "separator";
}

type MenuEntry = MenuItemSpec | MenuSeparatorSpec;

interface MenuSpec {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly MenuEntry[];
}

export interface AppMenuBarProps {
  readonly onNewDocument: () => void;
  readonly onOpenProject: () => void;
  readonly onSaveProject: () => void;
  readonly onSaveProjectAs: () => void;
  readonly onExportPng: () => void;
}

/** The items of the open menu, in order. The separators are not items. */
function menuItems(popup: HTMLDivElement | null): HTMLButtonElement[] {
  if (popup === null) {
    return [];
  }
  return Array.from(popup.querySelectorAll<HTMLButtonElement>("button[role^='menuitem']"));
}

export function AppMenuBar({
  onNewDocument,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onExportPng,
}: AppMenuBarProps) {
  const { actions } = useEditor();
  const { history, document: drawingDocument, selectedStrokes, secondaryViewOpen } =
    useEditorState();
  const layout = usePanelState();
  const panelActions = usePanelActions();
  const workspace = useWorkspaceSettings();
  const workspaceActions = useWorkspaceActions();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  /** Where the focus goes when the open menu appears. */
  const pendingFocus = useRef<"first" | "last" | null>(null);

  useEffect(() => {
    if (openMenu === null) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  // The focus lands on the first (or the last) item as soon as the menu is
  // open, so the keyboard can walk the menu without a mouse.
  useEffect(() => {
    if (openMenu === null) {
      pendingFocus.current = null;
      return;
    }
    const focus = pendingFocus.current;
    pendingFocus.current = null;
    if (focus === null) {
      return;
    }
    const items = menuItems(popupRef.current);
    const enabled = items.map((item) => !item.disabled);
    const index = focus === "first" ? firstMenuIndex(enabled) : lastMenuIndex(enabled);
    if (index >= 0) {
      items[index]?.focus();
    }
  }, [openMenu]);

  /** Opens a menu, optionally moving the focus into it. */
  const openWith = (id: string, focus: "first" | "last" | null): void => {
    pendingFocus.current = focus;
    setOpenMenu(id);
  };

  /** Closes the menu and, when asked, puts the focus back on its trigger. */
  const closeWith = (id: string | null, refocus: boolean): void => {
    setOpenMenu(null);
    if (refocus && id !== null) {
      triggerRefs.current.get(id)?.focus();
    }
  };

  const handleTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    id: string,
  ): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openWith(id, "first");
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      openWith(id, "last");
    }
  };

  const handlePopupKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = menuItems(popupRef.current);
    const enabled = items.map((item) => !item.disabled);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case "ArrowDown": {
        const next = nextMenuIndex(enabled, current, 1);
        if (next >= 0) {
          event.preventDefault();
          items[next]?.focus();
        }
        return;
      }
      case "ArrowUp": {
        const previous = nextMenuIndex(enabled, current, -1);
        if (previous >= 0) {
          event.preventDefault();
          items[previous]?.focus();
        }
        return;
      }
      case "Home": {
        const first = firstMenuIndex(enabled);
        if (first >= 0) {
          event.preventDefault();
          items[first]?.focus();
        }
        return;
      }
      case "End": {
        const last = lastMenuIndex(enabled);
        if (last >= 0) {
          event.preventDefault();
          items[last]?.focus();
        }
        return;
      }
      case "Escape": {
        event.preventDefault();
        closeWith(openMenu, true);
        return;
      }
      case "Tab": {
        // The focus leaves the menu, so the menu closes behind it.
        closeWith(openMenu, false);
        return;
      }
      default:
    }
  };

  const menus: readonly MenuSpec[] = [
    {
      id: "file",
      label: "File",
      entries: [
        { type: "item", label: "New Document…", onSelect: onNewDocument },
        { type: "item", label: "Open…", shortcut: "Ctrl+O", onSelect: onOpenProject },
        { type: "separator" },
        { type: "item", label: "Save", shortcut: "Ctrl+S", onSelect: onSaveProject },
        { type: "item", label: "Save As…", shortcut: "Ctrl+Shift+S", onSelect: onSaveProjectAs },
        { type: "separator" },
        { type: "item", label: "Export PNG…", onSelect: onExportPng },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      entries: [
        {
          type: "item",
          label: "Undo",
          shortcut: "Ctrl+Z",
          disabled: !history.canUndo,
          onSelect: actions.undo,
        },
        {
          type: "item",
          label: "Redo",
          shortcut: "Ctrl+Shift+Z",
          disabled: !history.canRedo,
          onSelect: actions.redo,
        },
        { type: "separator" },
        {
          type: "item",
          label: "Duplicate Layer",
          shortcut: "Ctrl+J",
          disabled: drawingDocument.activeLayerId === null,
          onSelect: () => {
            const activeLayerId = drawingDocument.activeLayerId;
            if (activeLayerId !== null) {
              actions.duplicateLayer(activeLayerId);
            }
          },
        },
      ],
    },
    {
      id: "selection",
      label: "Selection",
      entries: [
        {
          type: "item",
          label: "Duplicate",
          shortcut: "Ctrl+D",
          disabled: selectedStrokes === 0,
          onSelect: actions.duplicateSelection,
        },
        { type: "separator" },
        {
          type: "item",
          label: "Nudge Left",
          shortcut: "←",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.nudgeSelection(-1, 0),
        },
        {
          type: "item",
          label: "Nudge Right",
          shortcut: "→",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.nudgeSelection(1, 0),
        },
        {
          type: "item",
          label: "Nudge Up",
          shortcut: "↑",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.nudgeSelection(0, -1),
        },
        {
          type: "item",
          label: "Nudge Down",
          shortcut: "↓",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.nudgeSelection(0, 1),
        },
        { type: "separator" },
        {
          type: "item",
          label: "Scale by 150%",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.scaleSelection(FIXED_SCALE_FACTOR),
        },
        {
          type: "item",
          label: "Rotate 15° Clockwise",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.rotateSelection(FIXED_ROTATION_DEGREES),
        },
        {
          type: "item",
          label: "Rotate 15° Counter-Clockwise",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.rotateSelection(-FIXED_ROTATION_DEGREES),
        },
        { type: "separator" },
        {
          type: "item",
          label: "Flip Horizontal",
          shortcut: "Ctrl+Shift+H",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.flipSelection("horizontal"),
        },
        {
          type: "item",
          label: "Flip Vertical",
          shortcut: "Ctrl+Shift+V",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.flipSelection("vertical"),
        },
        { type: "separator" },
        {
          type: "item",
          label: "Delete Selected",
          shortcut: "Delete",
          disabled: selectedStrokes === 0,
          onSelect: actions.deleteSelection,
        },
        {
          type: "item",
          label: "Clear Selection",
          shortcut: "Esc",
          disabled: selectedStrokes === 0,
          onSelect: actions.clearSelection,
        },
      ],
    },
    {
      id: "panels",
      label: "Panels",
      entries: [
        ...sidePanelDefinitions().map((definition) => ({
          type: "item" as const,
          label: definition.title,
          checked: isPanelVisible(layout, definition.id),
          icon: panelIcon(definition.icon),
          description: definition.description,
          onSelect: () => panelActions.togglePanel(definition.id),
        })),
        { type: "separator" as const },
        {
          type: "item" as const,
          label: "Show All Panels",
          disabled: layout.hidden.length === 0,
          onSelect: panelActions.showAllPanels,
        },
        {
          type: "item" as const,
          label: "Hide All Panels",
          disabled: layout.hidden.length === sidePanelDefinitions().length,
          onSelect: panelActions.hideAllPanels,
        },
        {
          type: "item" as const,
          label: "Reset Layout",
          disabled: isDefaultPanelLayout(layout),
          onSelect: panelActions.resetLayout,
        },
      ],
    },
    {
      id: "workspace",
      label: "Workspace",
      entries: [
        ...WORKSPACE_PROFILES.map((profile) => ({
          type: "item" as const,
          label: profile.label,
          checked: workspace.profile === profile.id,
          description: profile.description,
          onSelect: () => workspaceActions.applyProfile(profile.id),
        })),
        { type: "separator" as const },
        {
          type: "item",
          label: "Tool Rail",
          checked: workspace.shell.toolRail,
          description: "The row of tools down the left of the canvas.",
          onSelect: () => workspaceActions.setToolRailVisible(!workspace.shell.toolRail),
        },
        { type: "separator" as const },
        {
          type: "item",
          label: "Advanced Brush Controls",
          checked: workspace.brushPanel.advanced,
          description:
            "The sampling, the stabilizer, the grain, the dab settings and the pressure mapping.",
          onSelect: () =>
            workspaceActions.setAdvancedBrushControls(!workspace.brushPanel.advanced),
        },
        {
          type: "item",
          label: "Brush Preset Library",
          checked: workspace.brushPanel.presets,
          description: "The row of saved brushes above the brush controls.",
          onSelect: () => workspaceActions.setBrushPresetRow(!workspace.brushPanel.presets),
        },
        { type: "separator" as const },
        ...UI_SCALE_STEPS.map((step) => ({
          type: "item" as const,
          label: `Scale ${Math.round(step * 100)}%`,
          checked: workspace.uiScale === step,
          onSelect: () => workspaceActions.setUiScale(step),
        })),
        { type: "separator" as const },
        ...WORKSPACE_THEMES.map((theme) => ({
          type: "item" as const,
          label: theme === "dark" ? "Dark Scheme" : "Light Scheme",
          checked: workspace.theme === theme,
          onSelect: () => workspaceActions.setTheme(theme),
        })),
        { type: "separator" as const },
        {
          type: "item",
          label: "Restore Workspace Defaults",
          description:
            "The panels, the rows, the scale, the brush panel and the colour scheme, as they were on a fresh install.",
          onSelect: workspaceActions.restoreDefaults,
        },
      ],
    },
    {
      id: "view",
      label: "View",
      entries: [
        { type: "item", label: "Zoom In", shortcut: "Ctrl+=", onSelect: actions.zoomIn },
        { type: "item", label: "Zoom Out", shortcut: "Ctrl+-", onSelect: actions.zoomOut },
        { type: "separator" },
        {
          type: "item",
          label: "Actual Size",
          shortcut: "Ctrl+1",
          onSelect: () => actions.zoomTo(1),
        },
        { type: "item", label: "Fit to Window", shortcut: "Ctrl+0", onSelect: actions.zoomToFit },
        { type: "separator" },
        {
          type: "item",
          label: "Rotate View 90° Clockwise",
          shortcut: "Shift+R",
          onSelect: () => actions.rotateView(VIEW_ROTATION_DEGREES),
        },
        {
          type: "item",
          label: "Mirror View Horizontally",
          shortcut: "Shift+M",
          onSelect: actions.toggleViewMirror,
        },
        {
          type: "item",
          label: "Reset View",
          shortcut: "Ctrl+Shift+0",
          onSelect: actions.resetView,
        },
        { type: "separator" },
        {
          type: "item",
          label: "New View of Canvas",
          checked: secondaryViewOpen,
          onSelect: actions.toggleSecondaryView,
        },
      ],
    },
  ];

  return (
    <div className="menu-bar" ref={containerRef}>
      <span className="menu-bar__brand">Paka</span>
      {menus.map((menu) => {
        const isOpen = openMenu === menu.id;
        // A menu that shows a state column keeps it for every item, so the
        // labels line up.
        const hasChecks = menu.entries.some(
          (entry) => entry.type === "item" && entry.checked !== undefined,
        );
        return (
          <div className="menu" key={menu.id}>
            <button
              type="button"
              className={["menu__trigger", isOpen ? "is-open" : ""].filter(Boolean).join(" ")}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              ref={(node) => {
                if (node === null) {
                  triggerRefs.current.delete(menu.id);
                } else {
                  triggerRefs.current.set(menu.id, node);
                }
              }}
              onClick={() => (isOpen ? closeWith(menu.id, true) : openWith(menu.id, "first"))}
              onKeyDown={(event) => handleTriggerKeyDown(event, menu.id)}
            >
              {menu.label}
              <IconChevronDown width="12" height="12" />
            </button>
            {isOpen ? (
              <div
                className="menu__popup"
                role="menu"
                ref={popupRef}
                onKeyDown={handlePopupKeyDown}
              >
                {menu.entries.map((entry, index) =>
                  entry.type === "separator" ? (
                    <div className="menu__separator" key={`separator-${index}`} />
                  ) : (
                    <button
                      type="button"
                      role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                      aria-checked={entry.checked}
                      className="menu__item"
                      key={entry.label}
                      title={entry.description}
                      disabled={entry.disabled ?? false}
                      onClick={() => {
                        // The focus goes back to the menu it came from, so the
                        // keyboard can carry on from there.
                        closeWith(menu.id, true);
                        entry.onSelect();
                      }}
                    >
                      {hasChecks ? (
                        <span className="menu__check" aria-hidden="true">
                          {entry.checked ? <IconCheck width="12" height="12" /> : null}
                        </span>
                      ) : null}
                      {entry.icon ? (
                        <span className="menu__icon" aria-hidden="true">
                          <entry.icon width="14" height="14" />
                        </span>
                      ) : null}
                      <span className="menu__label">{entry.label}</span>
                      {entry.shortcut ? <span className="menu__shortcut">{entry.shortcut}</span> : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
