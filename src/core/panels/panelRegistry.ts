/**
 * The panel manager's view of the shell's panel registry.
 *
 * The registry itself is the wave's shared contract
 * (`core/shell/panelRegistry.ts`): a panel registers itself and the shell
 * renders whatever the registry says. That is what keeps two builders from
 * editing the same file to add a panel - a panel's own module registers it,
 * and the shell only reads.
 *
 * This module is the panel manager's small adapter over that contract: the
 * names the manager, the menu and the layout rules all speak, in one place.
 * It adds no second list - a panel exists because it registered itself, and a
 * panel that is not registered cannot be shown, toggled or offered in the
 * menu.
 *
 * The **side column** is the shell's right-hand stack. A panel says where it
 * docks by default, and the panels that dock in the side column are the ones
 * the panel manager owns.
 */

import {
  findPanel,
  listPanels,
  panelsInSlot,
  registerPanel,
  unregisterPanel,
} from "../shell/panelRegistry";
import type { PanelDefinition } from "../shell/panelRegistry";

export { registerPanel, unregisterPanel };
export type { PanelDefinition };

/** The slot the side column owns. */
export const SIDE_SLOT = "right";

/**
 * A panel's id.
 *
 * The registry's ids are strings, and they are stable: they are written to
 * the settings file, so a renamed panel keeps its id and a removed panel
 * leaves its id behind in old files, where the reader drops it.
 */
export type PanelId = string;

/** Every registered panel, in the order the shell shows them. */
export function panelDefinitions(): readonly PanelDefinition[] {
  return listPanels();
}

/** The panels the side column owns, in order. */
export function sidePanelDefinitions(): readonly PanelDefinition[] {
  return panelsInSlot(SIDE_SLOT);
}

/** One panel by id, or `undefined` when no panel registered that id. */
export function findPanelDefinition(id: PanelId): PanelDefinition | undefined {
  return findPanel(id);
}

/** Whether a value is the id of a registered panel. */
export function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && findPanel(value) !== undefined;
}

/**
 * The panels a fresh layout shows.
 *
 * A panel is shown unless it is docked in the hidden slot: the registry says
 * where a panel lives, and the layout says whether the user turned it off.
 */
export function defaultVisiblePanelIds(): PanelId[] {
  return sidePanelDefinitions()
    .filter((definition) => definition.slot !== "hidden")
    .map((definition) => definition.id);
}
