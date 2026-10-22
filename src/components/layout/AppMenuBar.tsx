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
 * The keyboard rules live in `utils/menuNavigation.ts`; this component is the
 * thin shell over them. Two things are kept apart:
 *
 *  - the rules decide *where the focus is* (which menu, which entry);
 *  - the action registry owns the *chords* and the *commands*.
 *
 * So the menu writes no chord of its own: an entry names the registry action
 * it stands for and the menu shows the shortcut that action defines. The menu
 * and the keyboard can therefore never disagree about a shortcut. The two
 * entries whose registry action is context-sensitive (the guides tool owns
 * Delete and Escape) keep the menu's own command and borrow only the
 * shortcut.
 */

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { currentPlatform } from "../../core/actions/keyboard";
import type { ActionContext, ActionId } from "../../core/actions/types";
import {
  FIXED_ROTATION_DEGREES,
  FIXED_SCALE_FACTOR,
} from "../../core/document/selectionTransform";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import {
  menuKeyFromEvent,
  menuNavigationKey,
  menuShortcutLabel,
  runMenuAction,
  type MenuNavigationModel,
  type MenuNavigationState,
} from "../../utils/menuNavigation";
import { IconChevronDown } from "../icons";

interface MenuItemSpec {
  readonly type: "item";
  readonly label: string;
  /**
   * The registry action this entry stands for.
   *
   * The entry shows the shortcut that action defines and, unless it also has
   * an `onSelect`, runs it.
   */
  readonly actionId?: ActionId;
  /** Runs the entry. Overrides the registry action when it is present. */
  readonly onSelect?: () => void;
  readonly disabled?: boolean;
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

/** The key under which a popup entry is remembered. */
function entryKey(menuIndex: number, entryIndex: number): string {
  return `${menuIndex}:${entryIndex}`;
}

export function AppMenuBar({
  onNewDocument,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onExportPng,
}: AppMenuBarProps) {
  const { engine, actions } = useEditor();
  const { history, document: drawingDocument, selectedStrokes } = useEditorState();
  const [navigation, setNavigation] = useState<MenuNavigationState>({ mode: "outside" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const entryRefs = useRef(new Map<string, HTMLButtonElement>());
  const platform = currentPlatform();

  const actionContext: ActionContext = {
    engine,
    actions,
    file: { save: onSaveProject, saveAs: onSaveProjectAs, open: onOpenProject },
    shift: false,
  };

  const menus: readonly MenuSpec[] = [
    {
      id: "file",
      label: "File",
      entries: [
        { type: "item", label: "New Document…", onSelect: onNewDocument },
        { type: "item", label: "Open…", actionId: "open" },
        { type: "separator" },
        { type: "item", label: "Save", actionId: "save" },
        { type: "item", label: "Save As…", actionId: "saveAs" },
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
        },
        {
          type: "item",
          label: "Redo",
          actionId: "redo",
          disabled: !history.canRedo,
        },
        { type: "separator" },
        {
          type: "item",
          label: "Duplicate Layer",
          actionId: "duplicateLayer",
          disabled: drawingDocument.activeLayerId === null,
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
        },
        { type: "separator" },
        {
          type: "item",
          label: "Nudge Left",
          actionId: "nudgeLeft",
          disabled: selectedStrokes === 0,
        },
        {
          type: "item",
          label: "Nudge Right",
          actionId: "nudgeRight",
          disabled: selectedStrokes === 0,
        },
        {
          type: "item",
          label: "Nudge Up",
          actionId: "nudgeUp",
          disabled: selectedStrokes === 0,
        },
        {
          type: "item",
          label: "Nudge Down",
          actionId: "nudgeDown",
          disabled: selectedStrokes === 0,
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
        },
        {
          type: "item",
          label: "Flip Vertical",
          actionId: "flipVertical",
          disabled: selectedStrokes === 0,
        },
        { type: "separator" },
        {
          type: "item",
          label: "Delete Selected",
          actionId: "delete",
          disabled: selectedStrokes === 0,
          // The registry's Delete belongs to the guides tool while that tool
          // is active; the menu deletes the stroke selection.
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
        { type: "item", label: "Zoom In", actionId: "zoomIn" },
        { type: "item", label: "Zoom Out", actionId: "zoomOut" },
        { type: "separator" },
        { type: "item", label: "Actual Size", actionId: "zoomActual" },
        { type: "item", label: "Fit to Window", actionId: "zoomFit" },
        { type: "separator" },
        { type: "item", label: "Show Rulers", actionId: "toggleRulers" },
      ],
    },
  ];

  /**
   * The shape the rules work on: one flag per popup entry.
   *
   * A separator and a disabled entry cannot take the focus, so the arrow keys
   * step over them.
   */
  const model: MenuNavigationModel = {
    menus: menus.map((menu) => ({
      enabled: menu.entries.map(
        (entry) => entry.type === "item" && entry.disabled !== true,
      ),
    })),
  };

  const activate = (entry: MenuItemSpec) => {
    if (entry.onSelect) {
      entry.onSelect();
      return;
    }
    if (entry.actionId) {
      runMenuAction(entry.actionId, actionContext);
    }
  };

  useEffect(() => {
    if (navigation.mode === "outside") {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        setNavigation({ mode: "outside" });
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [navigation.mode]);

  // The state says where the focus belongs; the DOM follows it.
  useEffect(() => {
    if (navigation.mode === "bar") {
      triggerRefs.current[navigation.menuIndex]?.focus();
      return;
    }
    if (navigation.mode === "menu") {
      if (navigation.itemIndex < 0) {
        triggerRefs.current[navigation.menuIndex]?.focus();
        return;
      }
      entryRefs.current.get(entryKey(navigation.menuIndex, navigation.itemIndex))?.focus();
    }
  }, [navigation]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const result = menuNavigationKey(
      navigation,
      menuKeyFromEvent(event.nativeEvent),
      model,
    );
    if (result.consumed) {
      // The menu owns the key: the editor's own shortcuts must not fire.
      event.preventDefault();
      event.stopPropagation();
    }
    if (result.state !== navigation) {
      setNavigation(result.state);
    }
    if (result.effect.kind === "activate") {
      const menu = menus[result.effect.menuIndex];
      const entry = menu?.entries[result.effect.itemIndex];
      if (entry && entry.type === "item") {
        activate(entry);
      }
    }
  };

  /** A trigger took the focus: the bar mode starts there. */
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const menuIndex = triggerRefs.current.findIndex((node) => node === target);
    if (menuIndex < 0) {
      return;
    }
    setNavigation((current) =>
      current.mode === "outside" ? { mode: "bar", menuIndex } : current,
    );
  };

  /** The focus left the menu bar: every popup closes. */
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && containerRef.current?.contains(next)) {
      return;
    }
    setNavigation((current) => (current.mode === "outside" ? current : { mode: "outside" }));
  };

  const handleTriggerClick = (menuIndex: number) => {
    const isOpen = navigation.mode === "menu" && navigation.menuIndex === menuIndex;
    setNavigation(
      isOpen
        ? { mode: "bar", menuIndex }
        : { mode: "menu", menuIndex, itemIndex: -1 },
    );
  };

  return (
    <div
      className="menu-bar"
      ref={containerRef}
      role="menubar"
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <span className="menu-bar__brand">Paka</span>
      {menus.map((menu, menuIndex) => {
        const isOpen = navigation.mode === "menu" && navigation.menuIndex === menuIndex;
        return (
          <div className="menu" key={menu.id}>
            <button
              type="button"
              role="menuitem"
              className={["menu__trigger", isOpen ? "is-open" : ""].filter(Boolean).join(" ")}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              ref={(node) => {
                triggerRefs.current[menuIndex] = node;
              }}
              onClick={() => handleTriggerClick(menuIndex)}
            >
              {menu.label}
              <IconChevronDown width="12" height="12" />
            </button>
            {isOpen ? (
              <div className="menu__popup" role="menu">
                {menu.entries.map((entry, entryIndex) => {
                  if (entry.type === "separator") {
                    return (
                      <div className="menu__separator" role="separator" key={`separator-${entryIndex}`} />
                    );
                  }
                  const shortcut = entry.actionId
                    ? menuShortcutLabel(entry.actionId, platform)
                    : null;
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      className="menu__item"
                      key={entry.label}
                      tabIndex={-1}
                      disabled={entry.disabled ?? false}
                      ref={(node) => {
                        const key = entryKey(menuIndex, entryIndex);
                        if (node) {
                          entryRefs.current.set(key, node);
                        } else {
                          entryRefs.current.delete(key);
                        }
                      }}
                      onClick={() => {
                        setNavigation({ mode: "bar", menuIndex });
                        activate(entry);
                      }}
                    >
                      <span>{entry.label}</span>
                      {shortcut ? <span className="menu__shortcut">{shortcut}</span> : null}
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
