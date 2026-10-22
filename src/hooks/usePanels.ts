/**
 * React bindings for the panel store.
 *
 * `usePanelState` subscribes to the layout, which changes only when the user
 * shows, hides, folds or resets a panel - a low-frequency event, like the
 * editor's snapshot.
 */

import { useContext, useSyncExternalStore } from "react";
import type { PanelLayoutState } from "../core/panels/panelLayout";
import { PanelContext } from "../state/panelContext";
import type { PanelActions, PanelStore } from "../state/panelStore";

export function usePanelStore(): PanelStore {
  const store = useContext(PanelContext);
  if (!store) {
    throw new Error("usePanelStore must be used inside a <PanelProvider>.");
  }
  return store;
}

/** The layout the shell is showing. */
export function usePanelState(): PanelLayoutState {
  const { getState, subscribe } = usePanelStore();
  return useSyncExternalStore(subscribe, getState, getState);
}

/** The intents the shell offers for the panels. */
export function usePanelActions(): PanelActions {
  return usePanelStore().actions;
}
