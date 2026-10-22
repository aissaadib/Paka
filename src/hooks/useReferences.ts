/**
 * React bindings for the reference images.
 *
 * The references have a store of their own, outside the editor's snapshot: a
 * reference is not document state, so it must not appear in the snapshot the
 * whole editor publishes. The hook subscribes to that store instead, so a
 * component that shows the references re-renders when they change and not
 * when the drawing does.
 */

import { useSyncExternalStore } from "react";
import type { ReferenceState } from "../core/reference/types";
import type { ReferenceImageStore } from "../core/reference/store";
import { useEditor } from "./useEditor";

/** The reference store the editor owns. */
export function useReferenceStore(): ReferenceImageStore {
  return useEditor().references;
}

/** What the reference panel shows. */
export function useReferenceState(): ReferenceState {
  const { references } = useEditor();
  return useSyncExternalStore(references.subscribe, references.getState, references.getState);
}
