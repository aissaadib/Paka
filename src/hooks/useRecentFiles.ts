/**
 * React bindings for the recent files list.
 *
 * The list is a convenience for the file menu, so it is read through
 * `useSyncExternalStore`: the menu re-renders when the list changes and not
 * when anything else does.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { RecentFilesState } from "../core/documents/recentFiles";
import { useEditor } from "./useEditor";
import type { Listener } from "../utils/store";

/** The paths of the documents that were opened lately, most recent first. */
export function useRecentFiles(): RecentFilesState {
  const { recentFiles } = useEditor();
  const subscribe = useCallback(
    (listener: Listener) => recentFiles.subscribe(listener),
    [recentFiles],
  );
  const getState = useCallback(() => recentFiles.getState(), [recentFiles]);
  return useSyncExternalStore(subscribe, getState, getState);
}
