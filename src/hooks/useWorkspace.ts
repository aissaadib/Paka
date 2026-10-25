/**
 * React bindings for the workspace store.
 *
 * `useWorkspaceComposition` subscribes to the composition, which changes only
 * when the user rearranges the window - a low-frequency event, like the
 * editor's snapshot. The composition is a stable object between changes, so
 * React re-renders the shell when it really changed and not otherwise.
 */

import { useContext, useSyncExternalStore } from "react";
import type {
  WorkspaceComposition,
  WorkspaceSettings,
} from "../core/workspace/workspaceSettings";
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

/** What the shell is made of: its parts, its panels and their slots. */
export function useWorkspaceComposition(): WorkspaceComposition {
  const { getComposition, subscribe } = useWorkspaceStore();
  return useSyncExternalStore(subscribe, getComposition, getComposition);
}

/** The intents the shell offers for the workspace. */
export function useWorkspaceActions(): WorkspaceActions {
  return useWorkspaceStore().actions;
}
