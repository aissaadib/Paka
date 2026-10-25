/**
 * The menu bar's keyboard rules.
 *
 * The rules are a pure function of the current state and the key pressed, so
 * they can be tested in Node: the React layer has no automated tests, but
 * "the arrow keys walk the items, skip the disabled ones and wrap around" is a
 * rule worth pinning down.
 *
 * Two things are kept apart on purpose:
 *
 *  - *navigation* — where the focus is. This module owns it.
 *  - *dispatch* — which command runs. `core/actions/registry.ts` owns it.
 *
 * The menu therefore never writes a chord of its own: it asks the registry for
 * the shortcut an action defines, so the menu and the keyboard can never
 * disagree about one.
 *
 * The movement inside a menu is `nextMenuIndex` (and `firstMenuIndex` /
 * `lastMenuIndex`); the movement *between* menus is `nextMenu` /
 * `previousMenu`.
 */

import {
  formatShortcut,
  logicalKey,
  type KeyboardEventLike,
  type KeyboardPlatform,
} from "../core/actions/keyboard";
import { ACTION_DEFINITIONS } from "../core/actions/registry";
import type { ActionContext, ActionId } from "../core/actions/types";

/**
 * Where the keyboard focus is.
 *
 * - `outside`: the focus is somewhere else in the app. The menu bar claims no
 *   key, so the editor's own shortcuts keep working.
 * - `bar`: a top-level trigger holds the focus and its popup is closed.
 * - `menu`: a popup is open. `itemIndex` is the focused entry, or `-1` when
 *   the popup is open but the focus is still on the trigger.
 */
export type MenuNavigationState =
  | { readonly mode: "outside" }
  | { readonly mode: "bar"; readonly menuIndex: number }
  | { readonly mode: "menu"; readonly menuIndex: number; readonly itemIndex: number };

/** One menu of the bar. */
export interface MenuNavigationMenu {
  /**
   * One flag per popup entry, in render order.
   *
   * A separator and a disabled entry are `false`: neither can take the focus,
   * so the arrow keys step over them.
   */
  readonly enabled: readonly boolean[];
}

/** The shape of the menu bar: its menus, in the order they appear. */
export interface MenuNavigationModel {
  readonly menus: readonly MenuNavigationMenu[];
}

/** What the caller has to do after a key. */
export type MenuNavigationEffect =
  /** Nothing to do. */
  | { readonly kind: "none" }
  /** Move the focus to a top-level trigger. */
  | { readonly kind: "focus-trigger"; readonly menuIndex: number }
  /** Move the focus to an entry of the open popup. */
  | { readonly kind: "focus-item"; readonly menuIndex: number; readonly itemIndex: number }
  /** Run the focused entry. */
  | { readonly kind: "activate"; readonly menuIndex: number; readonly itemIndex: number };

/** The state after an operation, and what the caller has to do. */
export interface MenuNavigationOutcome {
  readonly state: MenuNavigationState;
  readonly effect: MenuNavigationEffect;
}

/** The result of a key press. */
export interface MenuNavigationResult extends MenuNavigationOutcome {
  /**
   * True when the menu bar owns the key.
   *
   * The caller prevents the default and stops the event there, so the
   * editor's own shortcuts do not fire behind the menu's back.
   */
  readonly consumed: boolean;
}

const NO_EFFECT: MenuNavigationEffect = { kind: "none" };

/**
 * The index of the next entry to focus inside one menu.
 *
 * The disabled entries are skipped and the search wraps around, so the arrow
 * keys always land somewhere. Returns `-1` when there is nothing to focus.
 */
export function nextMenuIndex(
  enabled: readonly boolean[],
  from: number,
  direction: 1 | -1,
): number {
  const count = enabled.length;
  if (count === 0) {
    return -1;
  }
  for (let step = 1; step <= count; step += 1) {
    const index = (((from + direction * step) % count) + count) % count;
    if (enabled[index]) {
      return index;
    }
  }
  return -1;
}

/** The index of the first entry that can be focused, or `-1`. */
export function firstMenuIndex(enabled: readonly boolean[]): number {
  return enabled.findIndex((isEnabled) => isEnabled);
}

/** The index of the last entry that can be focused, or `-1`. */
export function lastMenuIndex(enabled: readonly boolean[]): number {
  for (let index = enabled.length - 1; index >= 0; index -= 1) {
    if (enabled[index]) {
      return index;
    }
  }
  return -1;
}

/** The logical key a key press stands for. */
export function menuKeyFromEvent(event: KeyboardEventLike): string {
  return logicalKey(event);
}

function outcome(
  state: MenuNavigationState,
  effect: MenuNavigationEffect = NO_EFFECT,
): MenuNavigationOutcome {
  return { state, effect };
}

function consumed(result: MenuNavigationOutcome): MenuNavigationResult {
  return { state: result.state, effect: result.effect, consumed: true };
}

function notConsumed(state: MenuNavigationState): MenuNavigationResult {
  return { state, effect: NO_EFFECT, consumed: false };
}

/**
 * Opens a popup and moves the focus into it.
 *
 * A popup whose entries are all disabled opens with the focus left on the
 * trigger: there is nothing inside it to focus.
 */
function openWith(
  state: MenuNavigationState,
  model: MenuNavigationModel,
  menuIndex: number,
  which: "first" | "last",
): MenuNavigationOutcome {
  const menu = model.menus[menuIndex];
  if (!menu) {
    return outcome(state);
  }
  const itemIndex =
    which === "first" ? firstMenuIndex(menu.enabled) : lastMenuIndex(menu.enabled);
  if (itemIndex < 0) {
    return outcome(
      { mode: "menu", menuIndex, itemIndex: -1 },
      { kind: "focus-trigger", menuIndex },
    );
  }
  return outcome(
    { mode: "menu", menuIndex, itemIndex },
    { kind: "focus-item", menuIndex, itemIndex },
  );
}

/** Moves the focus to a top-level trigger without opening its popup. */
function focusTrigger(
  state: MenuNavigationState,
  model: MenuNavigationModel,
  menuIndex: number,
): MenuNavigationOutcome {
  if (menuIndex < 0 || menuIndex >= model.menus.length) {
    return outcome(state);
  }
  return outcome({ mode: "bar", menuIndex }, { kind: "focus-trigger", menuIndex });
}

/**
 * Opens a popup and leaves the focus on its trigger.
 *
 * This is what a click does: the popup appears, the arrow keys take over from
 * there.
 */
export function openMenu(
  state: MenuNavigationState,
  model: MenuNavigationModel,
  menuIndex: number,
): MenuNavigationOutcome {
  if (!model.menus[menuIndex]) {
    return outcome(state);
  }
  return outcome(
    { mode: "menu", menuIndex, itemIndex: -1 },
    { kind: "focus-trigger", menuIndex },
  );
}

/**
 * Closes the open popup and gives the focus back to its trigger.
 *
 * Closing a popup that is not open changes nothing.
 */
export function closeMenu(state: MenuNavigationState): MenuNavigationOutcome {
  if (state.mode !== "menu") {
    return outcome(state);
  }
  return outcome(
    { mode: "bar", menuIndex: state.menuIndex },
    { kind: "focus-trigger", menuIndex: state.menuIndex },
  );
}

/**
 * Moves the focus to the next entry of the open popup.
 *
 * From a trigger it opens the popup on its first entry; the disabled entries
 * are skipped.
 */
export function nextItem(
  state: MenuNavigationState,
  model: MenuNavigationModel,
): MenuNavigationOutcome {
  if (state.mode === "outside") {
    return outcome(state);
  }
  if (state.mode === "bar") {
    return openWith(state, model, state.menuIndex, "first");
  }
  const menu = model.menus[state.menuIndex];
  if (!menu) {
    return outcome(state);
  }
  const itemIndex = nextMenuIndex(menu.enabled, state.itemIndex, 1);
  if (itemIndex < 0 || itemIndex === state.itemIndex) {
    return outcome(state);
  }
  return outcome(
    { mode: "menu", menuIndex: state.menuIndex, itemIndex },
    { kind: "focus-item", menuIndex: state.menuIndex, itemIndex },
  );
}

/**
 * Moves the focus to the previous entry of the open popup.
 *
 * From a trigger it opens the popup on its last entry.
 */
export function previousItem(
  state: MenuNavigationState,
  model: MenuNavigationModel,
): MenuNavigationOutcome {
  if (state.mode === "outside") {
    return outcome(state);
  }
  if (state.mode === "bar") {
    return openWith(state, model, state.menuIndex, "last");
  }
  const menu = model.menus[state.menuIndex];
  if (!menu) {
    return outcome(state);
  }
  const itemIndex =
    state.itemIndex < 0
      ? lastMenuIndex(menu.enabled)
      : nextMenuIndex(menu.enabled, state.itemIndex, -1);
  if (itemIndex < 0 || itemIndex === state.itemIndex) {
    return outcome(state);
  }
  return outcome(
    { mode: "menu", menuIndex: state.menuIndex, itemIndex },
    { kind: "focus-item", menuIndex: state.menuIndex, itemIndex },
  );
}

/** Moves to the next menu: the next trigger, or the next open popup. */
export function nextMenu(
  state: MenuNavigationState,
  model: MenuNavigationModel,
): MenuNavigationOutcome {
  return moveMenu(state, model, 1);
}

/** Moves to the previous menu: the previous trigger, or the previous popup. */
export function previousMenu(
  state: MenuNavigationState,
  model: MenuNavigationModel,
): MenuNavigationOutcome {
  return moveMenu(state, model, -1);
}

function moveMenu(
  state: MenuNavigationState,
  model: MenuNavigationModel,
  direction: 1 | -1,
): MenuNavigationOutcome {
  if (state.mode === "outside") {
    return outcome(state);
  }
  const count = model.menus.length;
  if (count === 0) {
    return outcome(state);
  }
  const menuIndex = (((state.menuIndex + direction) % count) + count) % count;
  if (state.mode === "bar") {
    return outcome({ mode: "bar", menuIndex }, { kind: "focus-trigger", menuIndex });
  }
  return openWith(state, model, menuIndex, "first");
}

/** Moves the focus to the first entry of the open popup. */
export function firstItem(
  state: MenuNavigationState,
  model: MenuNavigationModel,
): MenuNavigationOutcome {
  if (state.mode === "outside") {
    return outcome(state);
  }
  if (state.mode === "bar") {
    return openWith(state, model, state.menuIndex, "first");
  }
  const menu = model.menus[state.menuIndex];
  if (!menu) {
    return outcome(state);
  }
  const itemIndex = firstMenuIndex(menu.enabled);
  if (itemIndex < 0 || itemIndex === state.itemIndex) {
    return outcome(state);
  }
  return outcome(
    { mode: "menu", menuIndex: state.menuIndex, itemIndex },
    { kind: "focus-item", menuIndex: state.menuIndex, itemIndex },
  );
}

/** Moves the focus to the last entry of the open popup. */
export function lastItem(
  state: MenuNavigationState,
  model: MenuNavigationModel,
): MenuNavigationOutcome {
  if (state.mode === "outside") {
    return outcome(state);
  }
  if (state.mode === "bar") {
    return openWith(state, model, state.menuIndex, "last");
  }
  const menu = model.menus[state.menuIndex];
  if (!menu) {
    return outcome(state);
  }
  const itemIndex = lastMenuIndex(menu.enabled);
  if (itemIndex < 0 || itemIndex === state.itemIndex) {
    return outcome(state);
  }
  return outcome(
    { mode: "menu", menuIndex: state.menuIndex, itemIndex },
    { kind: "focus-item", menuIndex: state.menuIndex, itemIndex },
  );
}

/**
 * What a key does in a state.
 *
 * The whole keyboard model of the menu bar is this one function: the state
 * and the key decide what happens, and the result says what the caller has to
 * do. A key the menu bar does not own is left alone, so the editor's own
 * shortcuts keep working while no menu is open.
 */
export function menuNavigationKey(
  state: MenuNavigationState,
  key: string,
  model: MenuNavigationModel,
): MenuNavigationResult {
  if (state.mode === "outside") {
    // The focus is not in the menu bar: the menu claims no key.
    return notConsumed(state);
  }
  return state.mode === "bar" ? barKey(state, key, model) : menuKey(state, key, model);
}

/** The keys that act on a focused trigger. */
function barKey(
  state: { readonly mode: "bar"; readonly menuIndex: number },
  key: string,
  model: MenuNavigationModel,
): MenuNavigationResult {
  switch (key) {
    case "arrowright":
      return consumed(nextMenu(state, model));
    case "arrowleft":
      return consumed(previousMenu(state, model));
    case "arrowdown":
    case "enter":
    case " ":
    case "spacebar":
      return consumed(openWith(state, model, state.menuIndex, "first"));
    case "arrowup":
      return consumed(openWith(state, model, state.menuIndex, "last"));
    case "home":
      return consumed(focusTrigger(state, model, 0));
    case "end":
      return consumed(focusTrigger(state, model, model.menus.length - 1));
    default:
      return notConsumed(state);
  }
}

/** The keys that act on an open popup. */
function menuKey(
  state: {
    readonly mode: "menu";
    readonly menuIndex: number;
    readonly itemIndex: number;
  },
  key: string,
  model: MenuNavigationModel,
): MenuNavigationResult {
  switch (key) {
    case "arrowdown":
      return consumed(nextItem(state, model));
    case "arrowup":
      return consumed(previousItem(state, model));
    case "arrowright":
      return consumed(nextMenu(state, model));
    case "arrowleft":
      return consumed(previousMenu(state, model));
    case "home":
      return consumed(firstItem(state, model));
    case "end":
      return consumed(lastItem(state, model));
    case "enter":
    case " ":
    case "spacebar": {
      if (state.itemIndex < 0) {
        // The popup is open but the focus is still on the trigger: Enter
        // moves it into the popup rather than doing nothing.
        return consumed(openWith(state, model, state.menuIndex, "first"));
      }
      return {
        state: { mode: "bar", menuIndex: state.menuIndex },
        effect: {
          kind: "activate",
          menuIndex: state.menuIndex,
          itemIndex: state.itemIndex,
        },
        consumed: true,
      };
    }
    case "escape":
      // The menu owns Escape while it is open: it closes the popup instead of
      // reaching the editor.
      return consumed(closeMenu(state));
    case "tab":
      // The popup closes and the browser moves the focus on, so the key is
      // not consumed.
      return { state: { mode: "outside" }, effect: NO_EFFECT, consumed: false };
    default:
      return notConsumed(state);
  }
}

const ACTIONS_BY_ID: ReadonlyMap<ActionId, (typeof ACTION_DEFINITIONS)[number]> = new Map(
  ACTION_DEFINITIONS.map((action) => [action.id, action]),
);

/**
 * The shortcut the registry defines for an action, as the menu shows it.
 *
 * `null` when the action has no shortcut. The menu asks the registry instead
 * of writing the chord itself, so the menu cannot show a chord the keyboard
 * does not have.
 */
export function menuShortcutLabel(
  actionId: ActionId,
  platform: KeyboardPlatform,
): string | null {
  const action = ACTIONS_BY_ID.get(actionId);
  if (!action || action.shortcuts.length === 0) {
    return null;
  }
  return formatShortcut(action.shortcuts[0], platform);
}

/**
 * Runs the action a menu item stands for.
 *
 * The registry owns the command, so the menu and the keyboard run the same
 * thing. Returns `false` when the action is unknown.
 */
export function runMenuAction(actionId: ActionId, context: ActionContext): boolean {
  const action = ACTIONS_BY_ID.get(actionId);
  if (!action) {
    return false;
  }
  action.run(context);
  return true;
}
