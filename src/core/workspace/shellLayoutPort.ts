/**
 * The live shell layout as a port the profile store can use.
 *
 * The panel manager owns the arrangement of the shell: which panel is docked
 * where, and which ones are hidden. Until it publishes that arrangement as a
 * `WorkspaceLayoutPort`, the arrangement the shell has today is the one its
 * preferences describe, and this module turns those preferences into the
 * port the profile store reads and writes.
 *
 * The translation is the shell's own: the preferences name a slot for a panel
 * and list the panels in the order the user chose, and the shell's composer
 * reads that into an arrangement. Writing is the inverse - the arrangement
 * becomes a slot for each panel, the hidden panels become the hidden list and
 * the panels of each slot become the order.
 *
 * The module is pure and framework-free: it holds no state of its own and
 * writes only through the source it is given.
 */

import { listPanels } from "../shell/panelRegistry";
import type { ShellPreferences } from "../shell/preferences";
import {
  placementsInSlot,
  SHELL_SLOT_IDS,
  type ShellLayout,
  type ShellSlotId,
} from "../shell/slots";
import { composeWorkspace, DEFAULT_WORKSPACE_SETTINGS } from "./workspaceSettings";
import type { WorkspaceLayoutPort } from "./workspaceProfileStore";

/**
 * The port the shell's preferences implement.
 *
 * The preferences source is somebody else's state, so the port only reads it
 * and writes it back; it keeps no copy of its own.
 */
export interface ShellPreferencesSource {
  /** The preferences the shell is showing. */
  getPreferences(): ShellPreferences;
  /** Replaces the preferences and tells the listeners. */
  setPreferences(preferences: ShellPreferences): void;
  /** Subscribes to the preferences' changes. */
  subscribe(listener: () => void): () => void;
}

/** The arrangement the shell's preferences describe. */
export function layoutOfPreferences(preferences: ShellPreferences): ShellLayout {
  // The composition is the shell's own reader: it places every panel the
  // registry knows in the slot the preferences name, in the order the
  // preferences give.
  return composeWorkspace(DEFAULT_WORKSPACE_SETTINGS, preferences, listPanels()).layout;
}

/**
 * The preferences that describe an arrangement.
 *
 * The inverse of {@link layoutOfPreferences}: every panel the arrangement
 * places gets its slot, the panels in the hidden slot become the hidden list,
 * and the panels of each slot, in the order the slot shows them, become the
 * order the shell keeps.
 */
export function preferencesOfLayout(
  preferences: ShellPreferences,
  layout: ShellLayout,
): ShellPreferences {
  const panelSlots: Record<string, ShellSlotId> = {};
  const hiddenPanels: string[] = [];
  for (const placement of layout.placements) {
    if (placement.slot === "hidden") {
      hiddenPanels.push(placement.panelId);
      continue;
    }
    panelSlots[placement.panelId] = placement.slot;
  }

  const panelOrder: string[] = [];
  for (const slot of SHELL_SLOT_IDS) {
    for (const placement of placementsInSlot(layout, slot)) {
      panelOrder.push(placement.panelId);
    }
  }

  return { ...preferences, hiddenPanels, panelOrder, panelSlots };
}

/**
 * The live layout, as the port the profile store uses.
 *
 * The port is the meeting point between the profiles and the panel manager:
 * the store reads the arrangement through it and asks the shell to adopt a
 * new one through it. Nothing here knows about profiles.
 */
export function createShellPreferencesLayoutPort(
  source: ShellPreferencesSource,
): WorkspaceLayoutPort {
  return {
    getLayout: () => layoutOfPreferences(source.getPreferences()),
    applyLayout: (layout) => {
      source.setPreferences(preferencesOfLayout(source.getPreferences(), layout));
    },
    subscribe: (listener) => source.subscribe(listener),
  };
}
