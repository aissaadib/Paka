/**
 * React bindings for the open documents.
 *
 * The tab strip reads the session registry's state through
 * `useSyncExternalStore`, so it re-renders when a tab is opened, closed,
 * switched or marked dirty - and not when something else happens.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { DocumentSessionState } from "../core/documents/sessionRegistry";
import { useEditor } from "./useEditor";
import type { Listener } from "../utils/store";

/** The open documents, and which one is active. */
export function useDocumentSessions(): DocumentSessionState {
  const { sessions } = useEditor();
  const subscribe = useCallback(
    (listener: Listener) => sessions.subscribe(listener),
    [sessions],
  );
  const getState = useCallback(() => sessions.getState(), [sessions]);
  return useSyncExternalStore(subscribe, getState, getState);
}
