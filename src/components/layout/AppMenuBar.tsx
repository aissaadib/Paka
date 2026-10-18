/**
 * Top menu bar.
 *
 * Only entries backed by real functionality are present: the file operations,
 * undo, redo and the view actions. Disabled states come from the command stack,
 * so the menu never offers an action that cannot run. The file entries are
 * callbacks rather than direct service calls because discarding unsaved work
 * needs a confirmation the workspace owns.
 */

import { useEffect, useRef, useState } from "react";
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
  const { history, document: drawingDocument } = useEditorState();
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
