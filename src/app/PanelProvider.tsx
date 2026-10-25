/**
 * Provides the single panel store to the component tree.
 *
 * The panel store is a session-lifetime service like the editor: it is
 * created once per mount of the provider and holds which panels are shown.
 * It is separate from the editor because the panel layout is shell state -
 * it says what the window looks like, never what the drawing contains - and
 * because the engine deliberately knows nothing about windows.
 *
 * The store is also the owner of the panel layout's persistence contract:
 * the settings store reads the layout from the settings file and writes it
 * back, so the layout lives in the same file as the other preferences
 * instead of in a second store of its own.
 */

import { useState, type ReactNode } from "react";
import { PanelContext } from "../state/panelContext";
import { createPanelStore, type PanelStore } from "../state/panelStore";

export interface PanelProviderProps {
  readonly children: ReactNode;
  /** Optional injected store, used by tests. */
  readonly store?: PanelStore;
}

export function PanelProvider({ children, store }: PanelProviderProps) {
  const [value] = useState(() => store ?? createPanelStore());

  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}
