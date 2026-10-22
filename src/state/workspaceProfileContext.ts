/**
 * React context holding the single workspace profile store.
 *
 * The profiles are shell state: the named arrangements the user can switch
 * the window to. They are separate from the editor on purpose - the engine
 * owns the drawing and knows nothing about windows - and they are separate
 * from the document for the same reason the brush settings are: switching a
 * profile rearranges the window, it does not edit the drawing.
 *
 * The provider lives here rather than in `app/` because the profiles are the
 * shell's own state: the shell creates the store once, and everything inside
 * the shell reads it.
 */

import { createContext, createElement, useState, type ReactNode } from "react";
import {
  createDetachedLayoutPort,
  createWorkspaceProfileStore,
  type WorkspaceLayoutPort,
  type WorkspaceProfileStore,
} from "../core/workspace/workspaceProfileStore";

export const WorkspaceProfileContext = createContext<WorkspaceProfileStore | null>(null);

export interface WorkspaceProfileProviderProps {
  readonly children: ReactNode;
  /**
   * The live shell layout the profiles are adopted into.
   *
   * The panel manager owns the arrangement, so it is the one that publishes
   * this port. Without it the store keeps the profiles and the choice of the
   * profile being shown, but nothing on screen moves.
   */
  readonly layout?: WorkspaceLayoutPort;
  /** Optional injected store, used by tests. */
  readonly store?: WorkspaceProfileStore;
}

/**
 * Provides the single profile store to the component tree.
 *
 * The store is created once per mount of the provider, so the profiles are
 * the same for every part of the tree that reads them.
 */
export function WorkspaceProfileProvider({ children, layout, store }: WorkspaceProfileProviderProps) {
  const [value] = useState(
    () => store ?? createWorkspaceProfileStore({ layout: layout ?? createDetachedLayoutPort() }),
  );

  return createElement(WorkspaceProfileContext.Provider, { value }, children);
}
