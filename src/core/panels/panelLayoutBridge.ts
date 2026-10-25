/**
 * The bridge between the live panel layout and the persisted one.
 *
 * Two builders wrote the panel layout and they wrote two different things,
 * because they were two different things:
 *
 *  - `core/panels/panelLayout.ts` holds the **live** layout: which panels
 *    the catalogue knows, which of them the user has turned off and which
 *    are folded to their header. Its ids are the catalogue's closed set.
 *  - `core/panels/panelLayoutSection.ts` holds the **persisted** layout:
 *    the same three preferences the shell's own document carries, plus the
 *    folded panels, in a versioned document the settings file can store.
 *
 * The two have to meet at the settings file, because that is where the
 * layout survives a restart. This module is the meeting point: it turns the
 * live layout into the persisted one on the way out, and the persisted one
 * back into the live layout on the way in.
 *
 * Nothing here is a policy. The persisted layout owns the document's shape
 * and its tolerance of a broken file; the live layout owns the catalogue's
 * ids and the rules about them. This module only carries values across.
 */

import {
  DEFAULT_PANEL_LAYOUT,
  type PanelLayoutState,
} from "./panelLayout";
import {
  DEFAULT_PERSISTED_PANEL_LAYOUT,
  type PersistedPanelLayout,
  type PanelLayoutSectionSource,
} from "./panelLayoutSection";
import { isPanelId } from "./panelRegistry";
import type { ShellPreferences } from "../shell/preferences";

/**
 * The live layout of the persisted one.
 *
 * A panel the catalogue does not know is dropped: the live layout's ids
 * are the catalogue's closed set, and an id outside it has no meaning.
 */
export function panelLayoutStateOfPersisted(
  persisted: PersistedPanelLayout,
): PanelLayoutState {
  const hidden = persisted.hiddenPanels.filter(isPanelId);
  const collapsed = persisted.foldedPanels.filter(isPanelId);
  return {
    version: DEFAULT_PANEL_LAYOUT.version,
    hidden,
    collapsed,
  };
}

/**
 * The persisted layout of the live one.
 *
 * The live layout knows which panels are hidden and which are folded; the
 * persisted one also carries the shell's own panel order and slots, so
 * those are taken from the shell's preferences rather than invented here.
 */
export function persistedLayoutOfState(
  state: PanelLayoutState,
  preferences: ShellPreferences,
): PersistedPanelLayout {
  return {
    version: DEFAULT_PERSISTED_PANEL_LAYOUT.version,
    hiddenPanels: [...state.hidden],
    panelOrder: [...preferences.panelOrder],
    panelSlots: { ...preferences.panelSlots },
    foldedPanels: [...state.collapsed],
  };
}

/**
 * The panel store as the persisted layout's owner.
 *
 * The settings store reads the section out of the file, hands it to this
 * owner and writes the owner's state back. The owner is the live layout,
 * so the two shapes are translated at this boundary and nowhere else.
 */
export function createPanelLayoutSource(
  store: {
    getState(): PanelLayoutState;
    subscribe(listener: () => void): () => void;
    applyLayout(layout: PanelLayoutState): void;
  },
  preferences: () => ShellPreferences,
): PanelLayoutSectionSource {
  return {
    getState: () => persistedLayoutOfState(store.getState(), preferences()),
    subscribe: (listener) => store.subscribe(listener),
    applyLayout: (layout) => store.applyLayout(panelLayoutStateOfPersisted(layout)),
  };
}
