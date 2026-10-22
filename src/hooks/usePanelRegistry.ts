/**
 * The shell's read of the panel registry.
 *
 * The registry is a plain list outside React, so the shell has to be told
 * when it changes: a panel that registers after the first paint is picked up
 * by the next read of the composition, but nothing would ask React to paint
 * again. The hook is that asking.
 *
 * It is a thin shell over the contract - the subscription and the version are
 * the registry's own - so the rule that a panel registers once and the shell
 * draws it once stays in one place, and the list is read during the render
 * rather than cached here.
 */

import { useSyncExternalStore } from "react";
import {
  listPanels,
  panelRegistryVersion,
  subscribeToPanelRegistry,
  type PanelDefinition,
} from "../core/shell/panelRegistry";
import type { ShellSlotId } from "../core/shell/slots";

/**
 * The registry's version, watched as a store's snapshot.
 *
 * The version changes whenever the registry's contents do, which is what the
 * shell needs to know: the composition is read again after a change, so a
 * panel that registered late is mounted.
 */
export function usePanelRegistryVersion(): number {
  return useSyncExternalStore(
    subscribeToPanelRegistry,
    panelRegistryVersion,
    panelRegistryVersion,
  );
}

/** The registered panels, read again whenever the registry changes. */
export function useRegisteredPanels(): readonly PanelDefinition[] {
  usePanelRegistryVersion();
  return listPanels();
}

/** The panels docked in one slot, read again whenever the registry changes. */
export function useRegisteredPanelsInSlot(slot: ShellSlotId): readonly PanelDefinition[] {
  usePanelRegistryVersion();
  return listPanels().filter((panel) => panel.slot === slot);
}
