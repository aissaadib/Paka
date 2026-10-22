/**
 * The shortcut editor's list: what is shown, in what order, and what a search
 * leaves out.
 *
 * The functions here are pure, so the grouping and the filtering can be
 * tested without a browser. The actions themselves come from the registry:
 * this module never keeps a list of them.
 */

import { formatShortcut, type KeyboardPlatform } from "../../core/actions/keyboard";
import {
  ACTION_CATEGORY_LABELS,
  type ActionCatalogEntry,
} from "../../core/actions/registry";
import type { ActionCategory, ShortcutSpec } from "../../core/actions/types";

/** One chord of an action, and the slot it occupies. */
export interface ShortcutSlot {
  /** Which of the action's chords this is. */
  readonly index: number;
  readonly chord: ShortcutSpec;
}

/** One action and the chords it answers to. */
export interface ShortcutRow {
  readonly entry: ActionCatalogEntry;
  readonly slots: readonly ShortcutSlot[];
}

/** The actions of one category. */
export interface ShortcutGroup {
  readonly category: ActionCategory;
  readonly label: string;
  readonly rows: readonly ShortcutRow[];
}

/** The order the categories are shown in. */
const CATEGORY_ORDER: readonly ActionCategory[] = [
  "file",
  "edit",
  "selection",
  "view",
  "tools",
  "brush",
];

/**
 * The actions a search leaves in.
 *
 * A search matches the action's name, the category it belongs to, or the
 * shortcut it is bound to, so "ctrl+s" finds Save and "tools" finds every
 * tool.
 */
export function filterActions(
  entries: readonly ActionCatalogEntry[],
  query: string,
  platform: KeyboardPlatform,
): readonly ActionCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return entries;
  }
  return entries.filter((entry) => {
    if (entry.label.toLowerCase().includes(needle)) {
      return true;
    }
    if (ACTION_CATEGORY_LABELS[entry.category].toLowerCase().includes(needle)) {
      return true;
    }
    return entry.shortcuts.some((chord) =>
      formatShortcut(chord, platform).toLowerCase().includes(needle),
    );
  });
}

/** The actions, grouped by category, in the order the categories are shown. */
export function groupActions(
  entries: readonly ActionCatalogEntry[],
): readonly ShortcutGroup[] {
  const groups: ShortcutGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const rows = entries
      .filter((entry) => entry.category === category)
      .map((entry) => ({
        entry,
        slots: entry.shortcuts.map((chord, index) => ({ index, chord })),
      }));
    if (rows.length > 0) {
      groups.push({ category, label: ACTION_CATEGORY_LABELS[category], rows });
    }
  }
  return groups;
}

/** The key that identifies a chord: the action and the slot it occupies. */
export function slotKey(actionId: string, index: number): string {
  return `${actionId}:${index}`;
}

/** Every chord of every shown action, in the order they are shown. */
export function slotKeys(groups: readonly ShortcutGroup[]): readonly string[] {
  return groups.flatMap((group) =>
    group.rows.flatMap((row) => row.slots.map((slot) => slotKey(row.entry.id, slot.index))),
  );
}
