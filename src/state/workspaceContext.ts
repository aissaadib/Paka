/**
 * React context holding the single workspace store.
 *
 * The workspace is shell state: which parts are shown, in what order and how
 * big. It is separate from the editor on purpose - the engine owns the
 * drawing and knows nothing about windows - and it is separate from the
 * document for the same reason the brush settings are: rearranging the
 * window is not an edit.
 *
 * The provider lives here rather than in `app/` because the workspace is the
 * shell's own state: the shell creates it once, and everything inside the
 * shell reads it.
 */

import { createContext, createElement, useState, type ReactNode } from "react";
import { createWorkspaceStore, type WorkspaceStore } from "./workspaceStore";

export const WorkspaceContext = createContext<WorkspaceStore | null>(null);

export interface WorkspaceProviderProps {
  readonly children: ReactNode;
  /** Optional injected store, used by tests. */
  readonly store?: WorkspaceStore;
}

/**
 * Provides the single workspace store to the component tree.
 *
 * The store is created once per mount of the provider, so the shell's
 * arrangement is the same for every part of the tree that reads it.
 */
export function WorkspaceProvider({ children, store }: WorkspaceProviderProps) {
  const [value] = useState(() => store ?? createWorkspaceStore());

  return createElement(WorkspaceContext.Provider, { value }, children);
}
