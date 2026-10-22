/**
 * The action registry.
 *
 * One readonly table is the single source of truth for the global commands and
 * for tool selection. Tool entries are derived from `TOOL_DEFINITIONS`, so a
 * tool's shortcut is written once.
 *
 * The registry refuses an ambiguous chord at load time. Guessing between two
 * actions is how a shortcut silently stops working, so a duplicate is a
 * programming error, not a runtime tie-break.
 *
 * The table holds the **default** chords. The chords the user has changed live
 * in the binding store, and an action's effective chords are its override when
 * it has one and its default when it does not. Everything that matches a key -
 * the keyboard hook, the menu bar, the shortcut editor - reads the effective
 * chords, so a rebound shortcut is the shortcut the app really answers to.
 */

import { stepBrushSize } from "../brushes/defaults";
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions";
import type { ToolId } from "../../types/tool";
import {
  chordId,
  formatShortcut,
  matchesShortcut,
  type KeyboardEventLike,
  type KeyboardPlatform,
} from "./keyboard";
import {
  readShortcutOverrides,
  serializeShortcut,
  shortcutBindings,
  type SerializedShortcut,
  type SerializedShortcutOverrides,
} from "./bindingStore";
import { normalizeShortcut } from "./shortcuts";
import type {
  ActionCategory,
  ActionContext,
  ActionDefinition,
  ActionId,
  FileActionHandlers,
  ShortcutSpec,
} from "./types";

function key(key: string, code: string): ShortcutSpec {
  return { key, code };
}

function mod(keyValue: string, code: string, shift = false): ShortcutSpec {
  return shift
    ? { key: keyValue, code, mod: true, shift: true }
    : { key: keyValue, code, mod: true };
}

/** Arrow-key nudge distances, in document pixels. */
const NUDGE_STEP = 1;
const NUDGE_LARGE_STEP = 10;

const GLOBAL_ACTIONS: readonly ActionDefinition[] = [
  {
    id: "undo",
    label: "Undo",
    category: "edit",
    shortcuts: [mod("z", "KeyZ")],
    run: ({ actions }) => actions.undo(),
  },
  {
    id: "redo",
    label: "Redo",
    category: "edit",
    shortcuts: [mod("z", "KeyZ", true), mod("y", "KeyY"), mod("y", "KeyY", true)],
    run: ({ actions }) => actions.redo(),
  },
  {
    id: "save",
    label: "Save",
    category: "file",
    shortcuts: [mod("s", "KeyS")],
    run: ({ file }) => file.save?.(),
  },
  {
    id: "saveAs",
    label: "Save As",
    category: "file",
    shortcuts: [mod("s", "KeyS", true)],
    run: ({ file }) => file.saveAs?.(),
  },
  {
    id: "open",
    label: "Open",
    category: "file",
    shortcuts: [mod("o", "KeyO")],
    run: ({ file }) => file.open?.(),
  },
  {
    id: "duplicateLayer",
    label: "Duplicate Layer",
    category: "edit",
    shortcuts: [mod("j", "KeyJ")],
    run: ({ actions, engine }) => {
      const activeLayerId = engine.getState().document.activeLayerId;
      if (activeLayerId !== null) {
        actions.duplicateLayer(activeLayerId);
      }
    },
  },
  {
    id: "duplicateSelection",
    label: "Duplicate Selection",
    category: "selection",
    shortcuts: [mod("d", "KeyD")],
    run: ({ actions }) => actions.duplicateSelection(),
  },
  {
    id: "flipHorizontal",
    label: "Flip Selection Horizontally",
    category: "selection",
    shortcuts: [mod("h", "KeyH", true)],
    run: ({ actions }) => actions.flipSelection("horizontal"),
  },
  {
    id: "flipVertical",
    label: "Flip Selection Vertically",
    category: "selection",
    shortcuts: [mod("v", "KeyV", true)],
    run: ({ actions }) => actions.flipSelection("vertical"),
  },
  {
    id: "zoomIn",
    label: "Zoom In",
    category: "view",
    // Both Ctrl+= and the shifted Ctrl++ (which arrives as `=`) zoom in.
    shortcuts: [mod("=", "Equal"), mod("=", "Equal", true)],
    run: ({ actions }) => actions.zoomIn(),
  },
  {
    id: "zoomOut",
    label: "Zoom Out",
    category: "view",
    shortcuts: [mod("-", "Minus")],
    run: ({ actions }) => actions.zoomOut(),
  },
  {
    id: "zoomActual",
    label: "Actual Size",
    category: "view",
    shortcuts: [mod("1", "Digit1")],
    run: ({ actions }) => actions.zoomTo(1),
  },
  {
    id: "zoomFit",
    label: "Fit to Window",
    category: "view",
    shortcuts: [mod("0", "Digit0")],
    run: ({ actions }) => actions.zoomToFit(),
  },
  {
    id: "toggleGrid",
    label: "Show Grid",
    category: "view",
    shortcuts: [mod("'", "Quote")],
    run: ({ actions, engine }) => actions.setGridVisible(!engine.getState().gridVisible),
  },
  {
    id: "toggleGridSnapping",
    label: "Snap to Guides and Grid",
    category: "view",
    shortcuts: [mod("'", "Quote", true)],
    run: ({ actions, engine }) => actions.setGridSnapping(!engine.getState().gridSnapping),
  },
  {
    id: "nudgeLeft",
    label: "Nudge Left",
    category: "selection",
    shortcuts: [key("arrowleft", "ArrowLeft"), { ...key("arrowleft", "ArrowLeft"), shift: true }],
    // Without a selection the arrow keys keep their scrolling behaviour.
    when: ({ engine }) => engine.getState().selectedStrokes > 0,
    run: ({ actions, shift }) => actions.nudgeSelection(shift ? -NUDGE_LARGE_STEP : -NUDGE_STEP, 0),
  },
  {
    id: "nudgeRight",
    label: "Nudge Right",
    category: "selection",
    shortcuts: [key("arrowright", "ArrowRight"), { ...key("arrowright", "ArrowRight"), shift: true }],
    when: ({ engine }) => engine.getState().selectedStrokes > 0,
    run: ({ actions, shift }) => actions.nudgeSelection(shift ? NUDGE_LARGE_STEP : NUDGE_STEP, 0),
  },
  {
    id: "nudgeUp",
    label: "Nudge Up",
    category: "selection",
    shortcuts: [key("arrowup", "ArrowUp"), { ...key("arrowup", "ArrowUp"), shift: true }],
    when: ({ engine }) => engine.getState().selectedStrokes > 0,
    run: ({ actions, shift }) => actions.nudgeSelection(0, shift ? -NUDGE_LARGE_STEP : -NUDGE_STEP),
  },
  {
    id: "nudgeDown",
    label: "Nudge Down",
    category: "selection",
    shortcuts: [key("arrowdown", "ArrowDown"), { ...key("arrowdown", "ArrowDown"), shift: true }],
    when: ({ engine }) => engine.getState().selectedStrokes > 0,
    run: ({ actions, shift }) => actions.nudgeSelection(0, shift ? NUDGE_LARGE_STEP : NUDGE_STEP),
  },
  {
    id: "escape",
    label: "Escape",
    category: "edit",
    shortcuts: [key("escape", "Escape")],
    run: ({ actions, engine }) => {
      // The guides tool owns Escape while it is active: it cancels the drag in
      // flight and clears the guide selection.
      if (engine.getState().toolId === "guides") {
        actions.cancelGuideGesture();
        return;
      }
      actions.clearSelection();
    },
  },
  {
    id: "delete",
    label: "Delete Selected",
    category: "selection",
    // Backspace is also the browser's "go back" gesture; the editor owns it.
    shortcuts: [key("delete", "Delete"), key("backspace", "Backspace")],
    run: ({ actions, engine }) => {
      // A selected guide is the guides tool's selection, so Delete removes that
      // first; the stroke selection is untouched by it.
      if (engine.getState().toolId === "guides" && engine.getState().selectedGuideId !== null) {
        actions.deleteSelectedGuide();
        return;
      }
      actions.deleteSelection();
    },
  },
  {
    id: "brushSizeDown",
    label: "Decrease Brush Size",
    category: "brush",
    shortcuts: [key("[", "BracketLeft")],
    run: ({ actions, engine }) => {
      actions.setBrush({ size: stepBrushSize(engine.getState().brush.size, -1) });
    },
  },
  {
    id: "brushSizeUp",
    label: "Increase Brush Size",
    category: "brush",
    shortcuts: [key("]", "BracketRight")],
    run: ({ actions, engine }) => {
      actions.setBrush({ size: stepBrushSize(engine.getState().brush.size, 1) });
    },
  },
];

/** One tool-select action per tool, derived from the tool's own definition. */
const TOOL_ACTIONS: readonly ActionDefinition[] = TOOL_DEFINITIONS.map((tool) => ({
  id: `tool:${tool.id}` as ActionId,
  label: tool.label,
  category: "tools" as ActionCategory,
  shortcuts: [{ key: tool.shortcut.toLowerCase(), code: `Key${tool.shortcut.toUpperCase()}` }],
  run: ({ actions }) => actions.setTool(tool.id as ToolId),
}));

export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  ...GLOBAL_ACTIONS,
  ...TOOL_ACTIONS,
];

/** The groups the actions are listed in, in the order they are shown. */
export const ACTION_CATEGORIES: readonly ActionCategory[] = [
  "file",
  "edit",
  "selection",
  "view",
  "tools",
  "brush",
];

/** The heading a category is shown under. */
export const ACTION_CATEGORY_LABELS: Readonly<Record<ActionCategory, string>> = {
  file: "File",
  edit: "Edit",
  selection: "Selection",
  view: "View",
  tools: "Tools",
  brush: "Brush",
};

/**
 * Refuses duplicate action ids and chords.
 *
 * Exported for tests: a synthetic registry with a clash must throw rather than
 * let one action shadow another.
 */
export function validateRegistry(actions: readonly ActionDefinition[]): void {
  const ids = new Set<string>();
  const chords = new Map<string, string>();
  const platforms: readonly KeyboardPlatform[] = ["mac", "other"];

  for (const action of actions) {
    if (ids.has(action.id)) {
      throw new Error(`Duplicate action id "${action.id}".`);
    }
    ids.add(action.id);
    if (action.shortcuts.length === 0) {
      throw new Error(`Action "${action.id}" has no shortcut.`);
    }
    for (const shortcut of action.shortcuts) {
      for (const platform of platforms) {
        const chord = chordId(shortcut, platform);
        const existing = chords.get(chord);
        if (existing !== undefined) {
          throw new Error(
            `Ambiguous shortcut ${chord}: claimed by "${existing}" and "${action.id}".`,
          );
        }
        chords.set(chord, action.id);
      }
    }
  }
}

validateRegistry(ACTION_DEFINITIONS);

/** The action with an id, or `null` when there is none. */
export function findAction(actionId: string): ActionDefinition | null {
  return ACTION_DEFINITIONS.find((action) => action.id === actionId) ?? null;
}

/**
 * The chords an action answers to right now.
 *
 * The user's override when there is one, the default when there is not.
 */
export function effectiveShortcuts(action: ActionDefinition): readonly ShortcutSpec[] {
  return shortcutBindings.get(action.id) ?? action.shortcuts;
}

/** The chords an action answers to right now, by id. */
export function effectiveShortcutsFor(actionId: ActionId): readonly ShortcutSpec[] {
  const action = findAction(actionId);
  return action === null ? [] : effectiveShortcuts(action);
}

/** True when the user has changed this action's chords. */
export function isRebound(actionId: ActionId): boolean {
  return shortcutBindings.has(actionId);
}

/** One action, as the shortcut editor lists it. */
export interface ActionCatalogEntry {
  readonly id: ActionId;
  readonly label: string;
  readonly category: ActionCategory;
  /** The chords the action answers to right now. */
  readonly shortcuts: readonly ShortcutSpec[];
  /** True when the user has changed them. */
  readonly changed: boolean;
}

/** Every action, in registry order, with the chords it answers to now. */
export function actionCatalog(): readonly ActionCatalogEntry[] {
  return ACTION_DEFINITIONS.map((action) => ({
    id: action.id,
    label: action.label,
    category: action.category,
    shortcuts: effectiveShortcuts(action),
    changed: shortcutBindings.has(action.id),
  }));
}

/**
 * The label a shortcut is shown with, or `null` when the action has none.
 *
 * The menu bar uses this, so a rebound shortcut is shown as the shortcut the
 * app really answers to.
 */
export function shortcutLabel(actionId: ActionId, platform: KeyboardPlatform): string | null {
  const chords = effectiveShortcutsFor(actionId);
  return chords.length > 0 ? formatShortcut(chords[0], platform) : null;
}

/** Another action that already claims a chord. */
export interface BindingConflict {
  readonly actionId: ActionId;
  readonly label: string;
  /** Which of that action's chords holds it. */
  readonly index: number;
  readonly platform: KeyboardPlatform;
}

/** True when two chords are the same combination on one platform. */
function sameChord(
  a: ShortcutSpec,
  b: ShortcutSpec,
  platform: KeyboardPlatform,
): boolean {
  return chordId(a, platform) === chordId(b, platform);
}

/**
 * The action that already claims a chord, or `null` when the chord is free.
 *
 * The chord slot being replaced is not a conflict: replacing it is the point.
 * Both platforms are checked, because a chord that is free on one of them can
 * still be ambiguous on the other, and an ambiguous chord is a shortcut that
 * silently stops working.
 */
export function findBindingConflict(
  actionId: ActionId,
  index: number,
  shortcut: ShortcutSpec,
  platform: KeyboardPlatform,
): BindingConflict | null {
  const platforms: readonly KeyboardPlatform[] =
    platform === "mac" ? ["mac", "other"] : ["other", "mac"];
  for (const candidate of platforms) {
    const chord = chordId(shortcut, candidate);
    for (const action of ACTION_DEFINITIONS) {
      const chords = effectiveShortcuts(action);
      for (let i = 0; i < chords.length; i += 1) {
        if (action.id === actionId && i === index) {
          continue;
        }
        if (chordId(chords[i], candidate) === chord) {
          return {
            actionId: action.id,
            label: action.label,
            index: i,
            platform: candidate,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Replaces one of an action's chords.
 *
 * The action keeps its other chords, so an action with two ways of being
 * triggered still has them.
 */
export function setActionChord(
  actionId: ActionId,
  index: number,
  shortcut: ShortcutSpec,
): void {
  const action = findAction(actionId);
  if (action === null) {
    return;
  }
  const current = effectiveShortcuts(action);
  if (index < 0 || index >= current.length) {
    return;
  }
  const next = current.map((chord, i) => (i === index ? normalizeShortcut(shortcut) : chord));
  shortcutBindings.set(actionId, next);
}

/**
 * Exchanges two chords between two actions.
 *
 * The explicit answer to a conflict: neither action is left without a chord,
 * and neither silently takes the other's.
 */
export function swapActionChords(
  from: { readonly actionId: ActionId; readonly index: number },
  to: { readonly actionId: ActionId; readonly index: number },
): void {
  if (from.actionId === to.actionId) {
    return;
  }
  const first = findAction(from.actionId);
  const second = findAction(to.actionId);
  if (first === null || second === null) {
    return;
  }
  const firstChords = effectiveShortcuts(first);
  const secondChords = effectiveShortcuts(second);
  if (
    from.index < 0 ||
    from.index >= firstChords.length ||
    to.index < 0 ||
    to.index >= secondChords.length
  ) {
    return;
  }
  const nextFirst = firstChords.slice();
  const nextSecond = secondChords.slice();
  nextFirst[from.index] = secondChords[to.index];
  nextSecond[to.index] = firstChords[from.index];
  shortcutBindings.set(from.actionId, nextFirst);
  shortcutBindings.set(to.actionId, nextSecond);
}

/** Puts one action's chords back to their defaults. */
export function resetActionShortcuts(actionId: ActionId): void {
  shortcutBindings.remove(actionId);
}

/** Puts every action's chords back to their defaults. */
export function resetAllShortcuts(): void {
  shortcutBindings.clear();
}

/**
 * The overrides in a file, checked against the actions and their chords.
 *
 * An action that does not exist is dropped, a chord that is malformed is
 * dropped, and a chord that another action already claims is dropped: a file
 * that cannot be honoured must not leave two actions fighting over one key.
 */
export function normalizeShortcutOverrides(value: unknown): SerializedShortcutOverrides {
  const read = readShortcutOverrides(value);
  if (read.size === 0) {
    return {};
  }

  // The actions the file mentions, in registry order, so the result does not
  // depend on the order the keys happen to be written in.
  const mentioned = ACTION_DEFINITIONS.filter((action) => read.has(action.id));
  const mentionedIds = new Set(mentioned.map((action) => action.id));
  const accepted = new Map<string, readonly ShortcutSpec[]>();

  for (const action of mentioned) {
    const chords = read.get(action.id) ?? [];
    const kept: ShortcutSpec[] = [];
    for (const chord of chords) {
      if (kept.some((other) => sameChord(other, chord, "other") || sameChord(other, chord, "mac"))) {
        continue;
      }
      if (collidesWithOthers(action.id, chord, mentionedIds, accepted)) {
        continue;
      }
      kept.push(chord);
    }
    if (kept.length > 0) {
      accepted.set(action.id, kept);
    }
  }

  const result: Record<string, readonly SerializedShortcut[]> = {};
  for (const [actionId, chords] of accepted) {
    result[actionId] = chords.map(serializeShortcut);
  }
  return result;
}

/**
 * True when a chord collides with an action that is not being overridden, or
 * with an override that has already been accepted.
 */
function collidesWithOthers(
  actionId: ActionId,
  chord: ShortcutSpec,
  mentionedIds: ReadonlySet<string>,
  accepted: ReadonlyMap<string, readonly ShortcutSpec[]>,
): boolean {
  for (const action of ACTION_DEFINITIONS) {
    if (action.id === actionId) {
      continue;
    }
    // An action the file overrides keeps only its override, so its defaults
    // are not chords any more.
    const chords = mentionedIds.has(action.id)
      ? (accepted.get(action.id) ?? [])
      : action.shortcuts;
    for (const other of chords) {
      if (sameChord(other, chord, "other") || sameChord(other, chord, "mac")) {
        return true;
      }
    }
  }
  return false;
}

/** Applies the overrides from a settings file, replacing what was there. */
export function applyShortcutOverrides(value: unknown): void {
  const normalized = normalizeShortcutOverrides(value);
  shortcutBindings.replaceAll(readShortcutOverrides(normalized));
}

export interface ActionMatch {
  readonly action: ActionDefinition;
  readonly shortcut: ShortcutSpec;
}

function baseContext(
  engine: ActionContext["engine"],
  actions: ActionContext["actions"],
  file: FileActionHandlers,
): ActionContext {
  return { engine, actions, file, shift: false };
}

/**
 * The action an event resolves to, or `null` when it claims no key.
 *
 * An action whose `when` guard is false claims nothing, so the key keeps its
 * default behaviour (arrows scroll, for example) instead of being swallowed.
 * The chords that are matched are the effective ones, so a rebound shortcut
 * is the shortcut the app answers to.
 */
export function findActionForEvent(
  event: KeyboardEventLike,
  platform: KeyboardPlatform,
  context: ActionContext,
): ActionMatch | null {
  for (const action of ACTION_DEFINITIONS) {
    for (const shortcut of effectiveShortcuts(action)) {
      if (!matchesShortcut(event, shortcut, platform)) {
        continue;
      }
      if (action.when && !action.when(context)) {
        return null;
      }
      return { action, shortcut };
    }
  }
  return null;
}

export interface DispatchContext {
  readonly engine: ActionContext["engine"];
  readonly actions: ActionContext["actions"];
  readonly file: FileActionHandlers;
}

/**
 * Runs the action an event resolves to.
 *
 * Returns the match when an action ran, or `null` when the key was left alone.
 * The caller decides whether to call `preventDefault`, so unmatched keys keep
 * their native behaviour.
 */
export function dispatchKeyboardEvent(
  event: KeyboardEventLike,
  context: DispatchContext,
  platform: KeyboardPlatform,
): ActionMatch | null {
  const match = findActionForEvent(
    event,
    platform,
    baseContext(context.engine, context.actions, context.file),
  );
  if (!match) {
    return null;
  }
  match.action.run({
    ...baseContext(context.engine, context.actions, context.file),
    shift: match.shortcut.shift === true,
  });
  return match;
}

/** The overrides as they are written to disk. */
export function currentShortcutOverrides(): SerializedShortcutOverrides {
  return shortcutBindings.toJSON();
}
