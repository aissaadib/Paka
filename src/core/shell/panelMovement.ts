/**
 * Moving a panel between the shell's slots.
 *
 * The shell already knows *where* a panel may live: `core/shell/slots.ts`
 * names the closed set of slots and the rules for placing a panel in one.
 * What was missing was the user's intent - "put this panel here, at this
 * position" - expressed as a change to the preferences document.
 *
 * This module is that translation, and it is deliberately pure: it reads a
 * `ShellPreferences`, returns the next one, and never touches React, the DOM
 * or the settings file. That keeps the drag-and-drop rules testable in Node
 * and keeps the shell's components from learning how a layout is stored.
 *
 * Two details matter:
 *
 *  1. **The order is global, the position is local.** `panelOrder` is one flat
 *     list, while a panel's index is relative to the panels in its slot. The
 *     function rebuilds the flat list slot by slot, so moving a panel to
 *     index 0 of the floating slot means "first floating panel", not "first
 *     panel overall".
 *  2. **Unknown ids are preserved.** A preferences file may name a panel this
 *     build does not have yet, or one a later build adds. Moving a known
 *     panel must not silently delete that entry.
 */

import { findPanel, listPanels } from "./panelRegistry";
import type { ShellPreferences } from "./preferences";
import { isShellSlotId, SHELL_SLOT_IDS, type ShellSlotId } from "./slots";

/** One user intent: put a panel in a slot, optionally at a position. */
export interface PanelMove {
  /** The panel's stable id. */
  readonly panelId: string;
  /** Where the panel should be docked. */
  readonly slot: ShellSlotId;
  /**
   * The position inside the target slot.
   *
   * Omitted means "at the end of the slot", which is what a Dock action wants.
   * A value past either end is clamped, so an untrusted drop index cannot
   * create a hole in the list.
   */
  readonly index?: number;
}

/** The slot a panel is in, or `null` when the registry does not know it. */
export function panelSlotOf(
  preferences: ShellPreferences,
  panelId: string,
): ShellSlotId | null {
  const panel = findPanel(panelId);
  if (panel === undefined) {
    return null;
  }
  const preferred = preferences.panelSlots[panel.id];
  return preferred !== undefined && isShellSlotId(preferred) ? preferred : panel.slot;
}

/**
 * Returns the preferences with one panel moved.
 *
 * The move is a no-op - the same object is returned - when the panel is not
 * registered, the slot is not one of the shell's slots, or the result would
 * say exactly what the input already said. Identity is useful here: the
 * workspace store uses it to decide whether a change is worth notifying.
 */
export function movePanelInPreferences(
  preferences: ShellPreferences,
  move: PanelMove,
): ShellPreferences {
  const panel = findPanel(move.panelId.trim());
  if (panel === undefined || !isShellSlotId(move.slot)) {
    return preferences;
  }

  const slot = move.slot;
  const panelId = panel.id;
  const lists = new Map<ShellSlotId, string[]>();
  for (const id of SHELL_SLOT_IDS) {
    lists.set(id, []);
  }

  /*
   * Build the current order slot by slot. The preferences' flat order wins
   * where it names a panel; the registry's own order fills in panels the
   * preferences have never mentioned.
   */
  const placed = new Set<string>();
  for (const id of preferences.panelOrder) {
    const entry = findPanel(id);
    if (entry === undefined || placed.has(entry.id)) {
      continue;
    }
    const entrySlot = preferences.panelSlots[entry.id] ?? entry.slot;
    if (!isShellSlotId(entrySlot)) {
      continue;
    }
    lists.get(entrySlot)?.push(entry.id);
    placed.add(entry.id);
  }

  for (const entry of listPanels()) {
    if (placed.has(entry.id)) {
      continue;
    }
    const entrySlot = preferences.panelSlots[entry.id] ?? entry.slot;
    if (!isShellSlotId(entrySlot)) {
      continue;
    }
    lists.get(entrySlot)?.push(entry.id);
    placed.add(entry.id);
  }

  // Remove the panel from wherever it was before inserting it again.
  for (const list of lists.values()) {
    const at = list.indexOf(panelId);
    if (at >= 0) {
      list.splice(at, 1);
    }
  }

  const target = lists.get(slot);
  if (target === undefined) {
    return preferences;
  }
  const at = clampIndex(move.index ?? target.length, target.length);
  target.splice(at, 0, panelId);

  const panelOrder: string[] = [];
  for (const id of SHELL_SLOT_IDS) {
    for (const entry of lists.get(id) ?? []) {
      if (!panelOrder.includes(entry)) {
        panelOrder.push(entry);
      }
    }
  }
  // Keep ids this build does not know, so a future build's panel is not
  // erased by a move made in this one.
  for (const id of preferences.panelOrder) {
    if (!panelOrder.includes(id)) {
      panelOrder.push(id);
    }
  }

  const panelSlots: Record<string, ShellSlotId> = {
    ...preferences.panelSlots,
    [panelId]: slot,
  };
  const hiddenPanels = preferences.hiddenPanels.filter((id) => id !== panelId);
  if (slot === "hidden") {
    hiddenPanels.push(panelId);
  }

  if (
    sameList(panelOrder, preferences.panelOrder) &&
    sameSlots(panelSlots, preferences.panelSlots) &&
    sameList(hiddenPanels, preferences.hiddenPanels)
  ) {
    return preferences;
  }

  return {
    ...preferences,
    panelOrder,
    panelSlots,
    hiddenPanels,
  };
}

/**
 * Puts every panel back in the registry's slot and order.
 *
 * Only the arrangement is cleared; the theme, the remembered viewport and the
 * other shell preferences are untouched. Folded panels are unfolded too,
 * because "reset the panel layout" should not leave a panel folded for a
 * reason the user can no longer see.
 */
export function resetPanelPlacement(preferences: ShellPreferences): ShellPreferences {
  if (
    preferences.hiddenPanels.length === 0 &&
    preferences.panelOrder.length === 0 &&
    Object.keys(preferences.panelSlots).length === 0 &&
    preferences.foldedPanels.length === 0
  ) {
    return preferences;
  }
  return {
    ...preferences,
    hiddenPanels: [],
    panelOrder: [],
    panelSlots: {},
    foldedPanels: [],
  };
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) {
    return length;
  }
  return Math.max(0, Math.min(Math.trunc(value), length));
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => b[index] === value);
}

function sameSlots(
  a: Readonly<Record<string, ShellSlotId>>,
  b: Readonly<Record<string, ShellSlotId>>,
): boolean {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) {
    if (a[id] !== b[id]) {
      return false;
    }
  }
  return true;
}
