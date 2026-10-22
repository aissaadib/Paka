/**
 * Top menu bar.
 *
 * Only entries backed by real functionality are present: the file operations,
 * undo, redo, the selection transforms and the view actions. Disabled states
 * come from the command stack and the selection, so the menu never offers an
 * action that cannot run. The file entries are
 * callbacks rather than direct service calls because discarding unsaved work
 * needs a confirmation the workspace owns.
 */

import { useEffect, useRef, useState } from "react";
import {
  FIXED_ROTATION_DEGREES,
  FIXED_SCALE_FACTOR,
} from "../../core/document/selectionTransform";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { IconChevronDown } from "../icons";

interface MenuItemSpec {
  readonly type: "item";
  readonly label: string;
  readonly shortcut?: string;
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
}

export function AppMenuBar({
  onNewDocument,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onExportPng,
}: AppMenuBarProps) {
  const { actions } = useEditor();
  const { history, document: drawingDocument, selectedStrokes, toolId } = useEditorState();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
          label: "Select All",
          shortcut: "Ctrl+A",
          // A selection belongs to the select tool, so the menu offers these
          // only there - exactly where the shortcut is claimed.
          disabled: drawingDocument.activeLayerId === null || toolId !== "select",
          onSelect: actions.selectAll,
        },
        {
          type: "item",
          label: "Invert Selection",
          shortcut: "Ctrl+Shift+I",
          disabled: drawingDocument.activeLayerId === null || toolId !== "select",
          onSelect: actions.invertSelection,
        },
        { type: "separator" },
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
                {menu.entries.map((entry, index) =>
                  entry.type === "separator" ? (
                    <div className="menu__separator" key={`separator-${index}`} />
                  ) : (
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
