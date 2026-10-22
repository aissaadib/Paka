/**
 * The panel store: the shell's view of which panels are shown.
 *
 * The store is deliberately separate from the editor. The engine owns the
 * drawing and knows nothing about windows, panels or menus, and the panel
 * layout must never reach the document: showing or hiding a panel is not an
 * edit, so it pushes no history entry, bumps no revision and never makes a
 * document dirty.
 *
 * The store is framework-free, exactly like the editor store, so the whole
 * "hide, show, reset, restore" cycle can be exercised in Node. React reads
 * it through `useSyncExternalStore`.
 */

import {
  DEFAULT_PANEL_LAYOUT,
  hideAllPanels,
  panelLayoutEqual,
  resetPanelLayout,
  setPanelCollapsed,
  setPanelVisibility,
  showAllPanels,
  togglePanelVisibility,
  type PanelLayoutSource,
  type PanelLayoutState,
} from "../core/panels/panelLayout";
import type { PanelId } from "../core/panels/panelRegistry";
import type { Listener } from "../utils/store";

export interface PanelActions {
  /** Shows or hides one panel. */
  setPanelVisible(id: PanelId, visible: boolean): void;
  /** Shows a hidden panel, or hides a shown one. */
  togglePanel(id: PanelId): void;
  /** Folds a panel to its header, or unfolds it. */
  setPanelCollapsed(id: PanelId, collapsed: boolean): void;
  /** Shows every catalogued panel. */
  showAllPanels(): void;
  /** Hides every catalogued panel, so the canvas takes the whole window. */
  hideAllPanels(): void;
  /** Restores the layout a fresh installation starts from. */
  resetLayout(): void;
}

export interface PanelStore extends PanelLayoutSource {
  /** The layout the shell is showing. */
  getState(): PanelLayoutState;
  /** Subscribes to layout changes. */
  subscribe(listener: Listener): () => void;
  /** Replaces the layout, e.g. with the one read from the settings file. */
  applyLayout(layout: PanelLayoutState): void;
  /** The intents the shell offers. */
  readonly actions: PanelActions;
}

export interface PanelStoreOptions {
  /** The layout the store starts with. */
  readonly initial?: PanelLayoutState;
}

export function createPanelStore(options: PanelStoreOptions = {}): PanelStore {
  let state = options.initial ?? DEFAULT_PANEL_LAYOUT;
  const listeners = new Set<Listener>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  /** Replaces the layout, but only when it really changed. */
  const update = (next: PanelLayoutState): void => {
    if (panelLayoutEqual(state, next)) {
      return;
    }
    state = next;
    notify();
  };

  const actions: PanelActions = {
    setPanelVisible: (id, visible) => {
      update(setPanelVisibility(state, id, visible));
    },
    togglePanel: (id) => {
      update(togglePanelVisibility(state, id));
    },
    setPanelCollapsed: (id, collapsed) => {
      update(setPanelCollapsed(state, id, collapsed));
    },
    showAllPanels: () => {
      update(showAllPanels(state));
    },
    hideAllPanels: () => {
      update(hideAllPanels(state));
    },
    resetLayout: () => {
      update(resetPanelLayout());
    },
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyLayout: (layout) => {
      update(layout);
    },
    actions,
  };
}
