/**
 * Top menu bar.
 *
 * Only entries backed by real functionality are present: the file operations,
 * undo, redo, the selection transforms and the view actions. Disabled states
 * come from the command stack and the selection, so the menu never offers an
 * action that cannot run. The file entries are
 * callbacks rather than direct service calls because discarding unsaved work
 * needs a confirmation the workspace owns.
 *
 * The shortcut an entry shows is the one the **registry** holds, not a string
 * written here, so a rebound shortcut is shown as the shortcut the app really
 * answers to. An entry with no registry action - "New Document", "Export PNG" -
 * shows no shortcut, because there is none.
 */

import { useEffect, useRef, useState } from "react";
import {
  FIXED_ROTATION_DEGREES,
  FIXED_SCALE_FACTOR,
} from "../../core/document/selectionTransform";
import { currentPlatform } from "../../core/actions/keyboard";
import { shortcutLabel } from "../../core/actions/registry";
import type { ActionId } from "../../core/actions/types";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { useShortcutBindings } from "../../hooks/useShortcutBindings";
import { IconChevronDown } from "../icons";

interface MenuItemSpec {
  readonly type: "item";
  readonly label: string;
  /** The registry action the entry runs; its shortcut is read from there. */
  readonly actionId?: ActionId;
  readonly disabled?: boolean;
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
  readonly onOpenShortcutEditor: () => void;
}

export function AppMenuBar({
  onNewDocument,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onExportPng,
  onOpenShortcutEditor,
}: AppMenuBarProps) {
  const { actions } = useEditor();
  const { history, document: drawingDocument, selectedStrokes } = useEditorState();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const platform = currentPlatform();
  // The menu shows the shortcuts the app answers to, so it follows a rebind.
  useShortcutBindings();

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

  const menus: readonly MenuSpec[] = [
    {
      id: "file",
      label: "File",
      entries: [
        { type: "item", label: "New Document…", onSelect: onNewDocument },
        { type: "item", label: "Open…", actionId: "open", onSelect: onOpenProject },
        { type: "separator" },
        { type: "item", label: "Save", actionId: "save", onSelect: onSaveProject },
        { type: "item", label: "Save As…", actionId: "saveAs", onSelect: onSaveProjectAs },
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
          actionId: "undo",
          disabled: !history.canUndo,
          onSelect: actions.undo,
        },
        {
          type: "item",
          label: "Redo",
          actionId: "redo",
          disabled: !history.canRedo,
          onSelect: actions.redo,
        },
        { type: "separator" },
        {
          type: "item",
          label: "Duplicate Layer",
          actionId: "duplicateLayer",
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
          actionId: "duplicateSelection",
          disabled: selectedStrokes === 0,
          onSelect: actions.duplicateSelection,
        },
        { type: "separator" },
        {
          type: "item",
          label: "Nudge Left",
          actionId: "nudgeLeft",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.nudgeSelection(-1, 0),
        },
        {
          type: "item",
          label: "Nudge Right",
          actionId: "nudgeRight",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.nudgeSelection(1, 0),
        },
        {
          type: "item",
          label: "Nudge Up",
          actionId: "nudgeUp",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.nudgeSelection(0, -1),
        },
        {
          type: "item",
          label: "Nudge Down",
          actionId: "nudgeDown",
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
          actionId: "flipHorizontal",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.flipSelection("horizontal"),
        },
        {
          type: "item",
          label: "Flip Vertical",
          actionId: "flipVertical",
          disabled: selectedStrokes === 0,
          onSelect: () => actions.flipSelection("vertical"),
        },
        { type: "separator" },
        {
          type: "item",
          label: "Delete Selected",
          actionId: "delete",
          disabled: selectedStrokes === 0,
          onSelect: actions.deleteSelection,
        },
        {
          type: "item",
          label: "Clear Selection",
          actionId: "escape",
          disabled: selectedStrokes === 0,
          onSelect: actions.clearSelection,
        },
      ],
    },
    {
      id: "view",
      label: "View",
      entries: [
        { type: "item", label: "Zoom In", actionId: "zoomIn", onSelect: actions.zoomIn },
        { type: "item", label: "Zoom Out", actionId: "zoomOut", onSelect: actions.zoomOut },
        { type: "separator" },
        {
          type: "item",
          label: "Actual Size",
          actionId: "zoomActual",
          onSelect: () => actions.zoomTo(1),
        },
        { type: "item", label: "Fit to Window", actionId: "zoomFit", onSelect: actions.zoomToFit },
      ],
    },
    {
      id: "help",
      label: "Help",
      entries: [
        { type: "item", label: "Keyboard Shortcuts…", onSelect: onOpenShortcutEditor },
      ],
    },
  ];

  return (
    <div className="menu-bar" ref={containerRef}>
      <span className="menu-bar__brand">Paka</span>
      {menus.map((menu) => {
        const isOpen = openMenu === menu.id;
        return (
          <div className="menu" key={menu.id}>
            <button
              type="button"
              className={["menu__trigger", isOpen ? "is-open" : ""].filter(Boolean).join(" ")}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => setOpenMenu(isOpen ? null : menu.id)}
            >
              {menu.label}
              <IconChevronDown width="12" height="12" />
            </button>
            {isOpen ? (
              <div className="menu__popup" role="menu">
                {menu.entries.map((entry, index) => {
                  if (entry.type === "separator") {
                    return <div className="menu__separator" key={`separator-${index}`} />;
                  }
                  const shortcut =
                    entry.actionId === undefined ? null : shortcutLabel(entry.actionId, platform);
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      className="menu__item"
                      key={entry.label}
                      disabled={entry.disabled ?? false}
                      onClick={() => {
                        setOpenMenu(null);
                        entry.onSelect();
                      }}
                    >
                      <span>{entry.label}</span>
                      {shortcut === null ? null : (
                        <span className="menu__shortcut">{shortcut}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
