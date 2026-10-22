/**
 * React bindings for the workspace profile store.
 *
 * The profiles change rarely - the user picks one, or saves one - so the
 * store is read through `useSyncExternalStore`, the same way the workspace
 * and the editor are. The store's state is a stable object between changes,
 * so React re-renders the control when the profiles really changed and not
 * otherwise.
 */

import { useContext, useSyncExternalStore } from "react";
import type { WorkspaceProfileSet } from "../core/workspace/workspaceProfiles";
import type { WorkspaceProfileActions } from "../core/workspace/workspaceProfileStore";
import { WorkspaceProfileContext } from "../state/workspaceProfileContext";

export function useWorkspaceProfileStore() {
  const store = useContext(WorkspaceProfileContext);
  if (!store) {
    throw new Error(
      "useWorkspaceProfileStore must be used inside a <WorkspaceProfileProvider>.",
    );
  }
  return store;
}

/** The profiles the shell holds, and the one it is showing. */
export function useWorkspaceProfiles(): WorkspaceProfileSet {
  const { getState, subscribe } = useWorkspaceProfileStore();
  return useSyncExternalStore(subscribe, getState, getState);
}

/** The intents the shell offers for the profiles. */
export function useWorkspaceProfileActions(): WorkspaceProfileActions {
  return useWorkspaceProfileStore().actions;
}
