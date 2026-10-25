/**
 * Menu navigation tests.
 *
 * The React layer has no automated tests, so the rules the menu depends on
 * are plain functions: the arrow keys walk the entries, skip the disabled
 * ones and wrap around, so the keyboard can always reach an entry, and the
 * menu shows the chord the action registry defines.
 */

import { describe, expect, it } from "vitest";
import { formatShortcut, type KeyboardEventLike } from "../core/actions/keyboard";
import { ACTION_DEFINITIONS } from "../core/actions/registry";
import type { ActionContext, ActionId } from "../core/actions/types";
import {
  closeMenu,
  firstItem,
  firstMenuIndex,
  lastItem,
  lastMenuIndex,
  menuKeyFromEvent,
  menuNavigationKey,
  menuShortcutLabel,
  nextItem,
  nextMenu,
  nextMenuIndex,
  openMenu,
  previousItem,
  previousMenu,
  runMenuAction,
  type MenuNavigationModel,
  type MenuNavigationState,
} from "../utils/menuNavigation";

/**
 * Three menus. A separator and a disabled entry are both `false`: neither can
 * take the focus.
 *
 *   File   New, Open, ---, Save, Save As, ---, Export
 *   Edit   Undo, Redo, ---
 *   View   Zoom In, ---
 */
const MODEL: MenuNavigationModel = {
  menus: [
    { enabled: [true, true, false, true, true, false, true] },
    { enabled: [true, true, false] },
    { enabled: [true, false] },
  ],
};

const OUTSIDE: MenuNavigationState = { mode: "outside" };
const BAR: MenuNavigationState = { mode: "bar", menuIndex: 0 };

function event(overrides: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("menu entries", () => {
  it("moves to the next enabled item", () => {
    const enabled = [true, true, true];

    expect(nextMenuIndex(enabled, 0, 1)).toBe(1);
    expect(nextMenuIndex(enabled, 1, 1)).toBe(2);
  });

  it("skips the disabled items", () => {
    const enabled = [true, false, false, true];

    expect(nextMenuIndex(enabled, 0, 1)).toBe(3);
    expect(nextMenuIndex(enabled, 3, 1)).toBe(0);
  });

  it("wraps around", () => {
    const enabled = [true, true];

    expect(nextMenuIndex(enabled, 1, 1)).toBe(0);
    expect(nextMenuIndex(enabled, 0, -1)).toBe(1);
  });

  it("starts at the first item when nothing is focused yet", () => {
    const enabled = [false, true];

    expect(nextMenuIndex(enabled, -1, 1)).toBe(1);
  });

  it("has nowhere to go when every item is disabled", () => {
    expect(nextMenuIndex([false, false], 0, 1)).toBe(-1);
    expect(nextMenuIndex([], 0, 1)).toBe(-1);
    expect(firstMenuIndex([false, false])).toBe(-1);
    expect(lastMenuIndex([false, false])).toBe(-1);
  });

  it("finds the first and the last enabled item", () => {
    const enabled = [false, true, false, true];

    expect(firstMenuIndex(enabled)).toBe(1);
    expect(lastMenuIndex(enabled)).toBe(3);
  });
});

describe("the keys the menu bar claims", () => {
  it("claims nothing while the focus is outside the menu bar", () => {
    for (const key of ["arrowdown", "arrowup", "enter", "escape", "tab", "a"]) {
      const result = menuNavigationKey(OUTSIDE, key, MODEL);

      expect(result.consumed).toBe(false);
      expect(result.state).toBe(OUTSIDE);
      expect(result.effect.kind).toBe("none");
    }
  });

  it("reads the logical key, whatever the layout", () => {
    expect(menuKeyFromEvent(event({ key: "ArrowDown", code: "ArrowDown" }))).toBe("arrowdown");
    expect(menuKeyFromEvent(event({ key: "Enter", code: "Enter" }))).toBe("enter");
    expect(menuKeyFromEvent(event({ key: " ", code: "Space" }))).toBe(" ");
    // A Cyrillic layout still moves the focus with the arrow keys.
    expect(menuKeyFromEvent(event({ key: "вниз", code: "ArrowDown" }))).toBe("arrowdown");
  });
});

describe("a focused trigger", () => {
  it("moves to the next and the previous menu", () => {
    const next = menuNavigationKey(BAR, "arrowright", MODEL);
    expect(next.consumed).toBe(true);
    expect(next.state).toEqual({ mode: "bar", menuIndex: 1 });
    expect(next.effect).toEqual({ kind: "focus-trigger", menuIndex: 1 });

    const previous = menuNavigationKey(BAR, "arrowleft", MODEL);
    expect(previous.state).toEqual({ mode: "bar", menuIndex: 2 });
  });

  it("wraps around the menus", () => {
    const last: MenuNavigationState = { mode: "bar", menuIndex: 2 };

    expect(menuNavigationKey(last, "arrowright", MODEL).state).toEqual({
      mode: "bar",
      menuIndex: 0,
    });
    expect(menuNavigationKey(BAR, "arrowleft", MODEL).state).toEqual({
      mode: "bar",
      menuIndex: 2,
    });
  });

  it("opens the popup on its first entry", () => {
    const result = menuNavigationKey(BAR, "arrowdown", MODEL);

    expect(result.consumed).toBe(true);
    expect(result.state).toEqual({ mode: "menu", menuIndex: 0, itemIndex: 0 });
    expect(result.effect).toEqual({ kind: "focus-item", menuIndex: 0, itemIndex: 0 });
  });

  it("opens the popup on its last entry", () => {
    const result = menuNavigationKey(BAR, "arrowup", MODEL);

    expect(result.state).toEqual({ mode: "menu", menuIndex: 0, itemIndex: 6 });
    expect(result.effect).toEqual({ kind: "focus-item", menuIndex: 0, itemIndex: 6 });
  });

  it("opens the popup with Enter and with Space", () => {
    expect(menuNavigationKey(BAR, "enter", MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 0,
    });
    expect(menuNavigationKey(BAR, " ", MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 0,
    });
  });

  it("jumps to the first and the last menu", () => {
    expect(menuNavigationKey(BAR, "home", MODEL).state).toEqual({
      mode: "bar",
      menuIndex: 0,
    });
    expect(menuNavigationKey(BAR, "end", MODEL).state).toEqual({
      mode: "bar",
      menuIndex: 2,
    });
  });

  it("leaves the editor's own keys alone", () => {
    const result = menuNavigationKey(BAR, "b", MODEL);

    expect(result.consumed).toBe(false);
    expect(result.state).toBe(BAR);
  });
});

describe("an open popup", () => {
  const OPEN: MenuNavigationState = { mode: "menu", menuIndex: 0, itemIndex: 0 };

  it("walks the entries and skips the separators", () => {
    expect(menuNavigationKey(OPEN, "arrowdown", MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 1,
    });
    // Entry 2 is a separator and entry 6 follows one: both are stepped over.
    expect(menuNavigationKey({ ...OPEN, itemIndex: 1 }, "arrowdown", MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 3,
    });
  });

  it("wraps around the entries", () => {
    expect(menuNavigationKey({ ...OPEN, itemIndex: 6 }, "arrowdown", MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 0,
    });
    expect(menuNavigationKey(OPEN, "arrowup", MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 6,
    });
  });

  it("moves to the next and the previous menu", () => {
    const next = menuNavigationKey(OPEN, "arrowright", MODEL);
    expect(next.state).toEqual({ mode: "menu", menuIndex: 1, itemIndex: 0 });
    expect(next.effect).toEqual({ kind: "focus-item", menuIndex: 1, itemIndex: 0 });

    const previous = menuNavigationKey(OPEN, "arrowleft", MODEL);
    expect(previous.state).toEqual({ mode: "menu", menuIndex: 2, itemIndex: 0 });
  });

  it("jumps to the first and the last entry", () => {
    const open: MenuNavigationState = { mode: "menu", menuIndex: 0, itemIndex: 3 };

    expect(menuNavigationKey(open, "home", MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 0,
    });
    expect(menuNavigationKey(open, "end", MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 6,
    });
  });

  it("runs the focused entry with Enter", () => {
    const result = menuNavigationKey({ ...OPEN, itemIndex: 4 }, "enter", MODEL);

    expect(result.consumed).toBe(true);
    expect(result.effect).toEqual({ kind: "activate", menuIndex: 0, itemIndex: 4 });
    // The popup closes and the focus goes back to the trigger.
    expect(result.state).toEqual({ mode: "bar", menuIndex: 0 });
  });

  it("runs the focused entry with Space", () => {
    const result = menuNavigationKey({ ...OPEN, itemIndex: 4 }, " ", MODEL);

    expect(result.effect).toEqual({ kind: "activate", menuIndex: 0, itemIndex: 4 });
  });

  it("moves the focus into the popup on Enter when no entry is focused", () => {
    const open: MenuNavigationState = { mode: "menu", menuIndex: 0, itemIndex: -1 };
    const result = menuNavigationKey(open, "enter", MODEL);

    expect(result.consumed).toBe(true);
    expect(result.state).toEqual({ mode: "menu", menuIndex: 0, itemIndex: 0 });
    expect(result.effect).toEqual({ kind: "focus-item", menuIndex: 0, itemIndex: 0 });
  });

  it("closes on Escape and gives the focus back to the trigger", () => {
    const result = menuNavigationKey({ ...OPEN, itemIndex: 3 }, "escape", MODEL);

    expect(result.consumed).toBe(true);
    expect(result.state).toEqual({ mode: "bar", menuIndex: 0 });
    expect(result.effect).toEqual({ kind: "focus-trigger", menuIndex: 0 });
  });

  it("closes on Tab but lets the browser move the focus on", () => {
    const result = menuNavigationKey({ ...OPEN, itemIndex: 3 }, "tab", MODEL);

    expect(result.consumed).toBe(false);
    expect(result.state).toEqual({ mode: "outside" });
  });
});

describe("the operations", () => {
  it("opens a popup without moving the focus into it", () => {
    const result = openMenu(OUTSIDE, MODEL, 1);

    expect(result.state).toEqual({ mode: "menu", menuIndex: 1, itemIndex: -1 });
    expect(result.effect).toEqual({ kind: "focus-trigger", menuIndex: 1 });
  });

  it("opens nothing when the menu does not exist", () => {
    const result = openMenu(OUTSIDE, MODEL, 9);

    expect(result.state).toBe(OUTSIDE);
    expect(result.effect.kind).toBe("none");
  });

  it("closes the popup and gives the focus back to the trigger", () => {
    const open: MenuNavigationState = { mode: "menu", menuIndex: 1, itemIndex: 0 };
    const result = closeMenu(open);

    expect(result.state).toEqual({ mode: "bar", menuIndex: 1 });
    expect(result.effect).toEqual({ kind: "focus-trigger", menuIndex: 1 });
  });

  it("closes nothing when no popup is open", () => {
    expect(closeMenu(BAR).state).toBe(BAR);
    expect(closeMenu(OUTSIDE).state).toBe(OUTSIDE);
  });

  it("moves to the next and the previous entry", () => {
    const open: MenuNavigationState = { mode: "menu", menuIndex: 0, itemIndex: 0 };

    expect(nextItem(open, MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 1,
    });
    expect(previousItem(open, MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 6,
    });
  });

  it("moves to the next and the previous menu", () => {
    expect(nextMenu(BAR, MODEL).state).toEqual({ mode: "bar", menuIndex: 1 });
    expect(previousMenu(BAR, MODEL).state).toEqual({ mode: "bar", menuIndex: 2 });
  });

  it("moves to the first and the last entry", () => {
    const open: MenuNavigationState = { mode: "menu", menuIndex: 0, itemIndex: 3 };

    expect(firstItem(open, MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 0,
    });
    expect(lastItem(open, MODEL).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: 6,
    });
  });

  it("never focuses a disabled entry", () => {
    const model: MenuNavigationModel = {
      menus: [{ enabled: [false, false, false] }],
    };
    const open: MenuNavigationState = { mode: "menu", menuIndex: 0, itemIndex: -1 };

    // Nothing can be focused: the popup opens with the focus on the trigger.
    expect(nextItem(open, model).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: -1,
    });
    expect(previousItem(open, model).state).toEqual({
      mode: "menu",
      menuIndex: 0,
      itemIndex: -1,
    });
    expect(firstItem(open, model).effect.kind).toBe("none");
    expect(lastItem(open, model).effect.kind).toBe("none");
  });

  it("changes nothing when there is only one menu", () => {
    const model: MenuNavigationModel = { menus: [{ enabled: [true] }] };
    const open: MenuNavigationState = { mode: "menu", menuIndex: 0, itemIndex: 0 };

    expect(nextMenu(open, model).state).toEqual(open);
    expect(previousMenu(open, model).state).toEqual(open);
    expect(nextItem(open, model).state).toEqual(open);
    expect(previousItem(open, model).state).toEqual(open);
  });

  it("is a pure function of the state and the key", () => {
    const state: MenuNavigationState = { mode: "menu", menuIndex: 0, itemIndex: 1 };
    const frozen = Object.freeze({ ...state });

    const first = menuNavigationKey(state, "arrowdown", MODEL);
    const second = menuNavigationKey(state, "arrowdown", MODEL);

    expect(first).toEqual(second);
    expect(state).toEqual(frozen);
  });
});

describe("the shortcuts the menu shows", () => {
  it("shows the chord the registry defines", () => {
    expect(menuShortcutLabel("open", "other")).toBe("Ctrl+O");
    expect(menuShortcutLabel("open", "mac")).toBe("Cmd+O");
    expect(menuShortcutLabel("save", "other")).toBe("Ctrl+S");
    expect(menuShortcutLabel("saveAs", "other")).toBe("Ctrl+Shift+S");
    expect(menuShortcutLabel("zoomIn", "other")).toBe("Ctrl+=");
    expect(menuShortcutLabel("zoomActual", "other")).toBe("Ctrl+1");
    expect(menuShortcutLabel("flipHorizontal", "other")).toBe("Ctrl+Shift+H");
    expect(menuShortcutLabel("nudgeLeft", "other")).toBe("←");
    expect(menuShortcutLabel("delete", "other")).toBe("Delete");
    expect(menuShortcutLabel("escape", "other")).toBe("Esc");
  });

  it("shows the first chord of every action the registry defines", () => {
    for (const action of ACTION_DEFINITIONS) {
      expect(menuShortcutLabel(action.id, "other")).toBe(
        formatShortcut(action.shortcuts[0], "other"),
      );
      expect(menuShortcutLabel(action.id, "mac")).toBe(
        formatShortcut(action.shortcuts[0], "mac"),
      );
    }
  });

  it("has no shortcut for an action that does not exist", () => {
    expect(menuShortcutLabel("nope" as ActionId, "other")).toBeNull();
  });
});

describe("the commands the menu runs", () => {
  it("runs the command the registry defines", () => {
    let undone = 0;
    const context = {
      engine: {} as ActionContext["engine"],
      actions: {
        undo: () => {
          undone += 1;
        },
      } as unknown as ActionContext["actions"],
      file: {},
      shift: false,
    };

    expect(runMenuAction("undo", context)).toBe(true);
    expect(undone).toBe(1);
  });

  it("runs nothing for an action that does not exist", () => {
    const context = {
      engine: {} as ActionContext["engine"],
      actions: {} as unknown as ActionContext["actions"],
      file: {},
      shift: false,
    };

    expect(runMenuAction("nope" as ActionId, context)).toBe(false);
  });
});
