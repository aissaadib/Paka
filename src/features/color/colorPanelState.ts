/**
 * Where the colour dock lives in the shell's layout.
 *
 * The dock's own facts - its id, the slot it docks in, the order it takes
 * there - live in `colorPanelRegistration.ts`. This module reads them back
 * through the shell's *preferences*: the document that says which panels the
 * user has turned off, where they are docked, in which order they are shown
 * and which of them are folded down to their header.
 *
 * The preferences are shell state, not document state. Showing, hiding, moving
 * or folding the dock adds no history step, bumps no revision and never makes
 * a drawing dirty - the same contract the brush and the grid have always had.
 *
 * Everything here is a pure function of the preferences, so the shell's layout
 * can be checked without a browser.
 */

import type { ShellPreferences } from "../../core/shell/preferences";
import type { PanelPlacement, ShellSlotId } from "../../core/shell/slots";
import {
  COLOR_PANEL_ID,
  COLOR_PANEL_ORDER,
  COLOR_PANEL_SLOT,
} from "./colorPanelRegistration";

/**
 * The ids of the panels that are folded down to their header.
 *
 * A list of ids rather than a map, because folding is a property of the
 * panels that *are* folded: a panel that is not named is open.
 *
 * The list is the shell's own: the preferences carry it, so a fold survives
 * a restart. These helpers are the rule the list follows; the dock's own
 * read and write are in terms of the preferences, because the preferences
 * are what the fold is saved in.
 */
export type FoldedPanelIds = readonly string[];

/**
 * Whether the dock is shown.
 *
 * A panel that is not named in the preferences' hidden list is shown: the
 * preferences name the panels the user turned off, not the ones they left
 * alone.
 */
export function isColorPanelVisible(preferences: ShellPreferences): boolean {
  return !preferences.hiddenPanels.includes(COLOR_PANEL_ID);
}

/**
 * The slot the dock is docked in.
 *
 * The preferences remember where the user put it; a dock that was never moved
 * sits in the side column, where it has always lived.
 */
export function colorPanelSlot(preferences: ShellPreferences): ShellSlotId {
  return preferences.panelSlots[COLOR_PANEL_ID] ?? COLOR_PANEL_SLOT;
}

/**
 * The dock's place among the panels the shell shows.
 *
 * The preferences remember the order; a dock that was never reordered keeps the
 * place its registration gave it.
 */
export function colorPanelOrder(preferences: ShellPreferences): number {
  const index = preferences.panelOrder.indexOf(COLOR_PANEL_ID);
  return index >= 0 ? index : COLOR_PANEL_ORDER;
}

/** Where the dock sits, in the shell's own vocabulary. */
export function colorPanelPlacement(preferences: ShellPreferences): PanelPlacement {
  return {
    panelId: COLOR_PANEL_ID,
    slot: colorPanelSlot(preferences),
    order: colorPanelOrder(preferences),
  };
}

/**
 * Whether the dock is folded down to its header.
 *
 * The answer comes from the saved preferences: the shell's document says
 * which panels are folded, so a restart finds the dock as the user left it.
 */
export function isColorPanelFolded(preferences: ShellPreferences): boolean {
  return preferences.foldedPanels.includes(COLOR_PANEL_ID);
}

/**
 * Folds the dock, or unfolds it.
 *
 * The rest of the preferences are left alone: the fold is one field of the
 * shell's document and it changes nothing else. The same document comes
 * back when the dock is already in the state asked for, so a caller that
 * writes the preferences back does not write a file for nothing.
 */
export function setColorPanelFolded(
  preferences: ShellPreferences,
  folded: boolean,
): ShellPreferences {
  const foldedPanels = folded
    ? foldColorPanel(preferences.foldedPanels)
    : unfoldColorPanel(preferences.foldedPanels);
  if (foldedPanels === preferences.foldedPanels) {
    return preferences;
  }
  return { ...preferences, foldedPanels };
}

/**
 * Folds the dock.
 *
 * The list is left alone when the dock is already folded, so folding twice
 * cannot list it twice.
 */
export function foldColorPanel(folded: FoldedPanelIds): FoldedPanelIds {
  if (listsPanel(folded, COLOR_PANEL_ID)) {
    return folded;
  }
  return [...folded, COLOR_PANEL_ID];
}

/** Unfolds the dock, and leaves the list alone when it is already open. */
export function unfoldColorPanel(folded: FoldedPanelIds): FoldedPanelIds {
  if (!listsPanel(folded, COLOR_PANEL_ID)) {
    return folded;
  }
  return folded.filter((id) => id !== COLOR_PANEL_ID);
}

/** Folds the dock when it is open, and unfolds it when it is folded. */
export function toggleColorPanelFold(folded: FoldedPanelIds): FoldedPanelIds {
  return listsPanel(folded, COLOR_PANEL_ID)
    ? unfoldColorPanel(folded)
    : foldColorPanel(folded);
}

/** Whether the folded list names a panel. */
function listsPanel(folded: FoldedPanelIds, panelId: string): boolean {
  return folded.includes(panelId);
}
