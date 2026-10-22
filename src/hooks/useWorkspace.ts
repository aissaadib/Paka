/**
 * React bindings for the workspace store.
 *
 * `useWorkspaceSettings` subscribes to the workspace, which changes only when
 * the user rearranges the window, changes the colour scheme or applies a
 * profile - a low-frequency event, like the editor's snapshot.
 */

import { useContext, useSyncExternalStore } from "react";
import type { WorkspaceSettings } from "../core/workspace/workspaceSettings";
import { WorkspaceContext } from "../state/workspaceContext";
import type { WorkspaceActions, WorkspaceStore } from "../state/workspaceStore";

export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(WorkspaceContext);
  if (!store) {
    throw new Error("useWorkspaceStore must be used inside a <WorkspaceProvider>.");
  }
  return store;
}

/** The workspace the shell is showing. */
export function useWorkspaceSettings(): WorkspaceSettings {
  const { getState, subscribe } = useWorkspaceStore();
  return useSyncExternalStore(subscribe, getState, getState);
}

/** The intents the shell offers for the workspace. */
export function useWorkspaceActions(): WorkspaceActions {
  return useWorkspaceStore().actions;
}
