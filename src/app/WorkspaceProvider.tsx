/**
 * Provides the single workspace store to the component tree.
 *
 * The workspace store is a session-lifetime service like the editor and the
 * panel store: it is created once per mount of the provider and holds how the
 * window is arranged. It is separate from the editor because the workspace is
 * shell state - it says what the window looks like, never what the drawing
 * contains - and because the engine deliberately knows nothing about windows.
 *
 * The provider also owns the two things that have to reach the document
 * itself: the colour scheme and the interface scale. They are written onto
 * the root element as a data attribute and a custom property, because that is
 * what the stylesheet reads; nothing else in the tree has to know about them.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePanelStore } from "../hooks/usePanels";
import { WorkspaceContext } from "../state/workspaceContext";
import { createWorkspaceStore, type WorkspaceStore } from "../state/workspaceStore";

export interface WorkspaceProviderProps {
  readonly children: ReactNode;
  /** Optional injected store, used by tests. */
  readonly store?: WorkspaceStore;
}

export function WorkspaceProvider({ children, store }: WorkspaceProviderProps) {
  const panels = usePanelStore();
  const [value] = useState(() => store ?? createWorkspaceStore({ panels }));
  const settings = useSyncExternalStore(value.subscribe, value.getState, value.getState);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty("--ui-scale", String(settings.uiScale));
  }, [settings.theme, settings.uiScale]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
