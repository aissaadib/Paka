/**
 * React bindings for the shortcut overrides.
 *
 * The overrides live outside React, in the binding store, because the
 * keyboard hook and the registry both need them and neither of them is a
 * component. The version counter is the snapshot: it changes when - and only
 * when - the chords change, so a component that shows them re-renders exactly
 * when it has to.
 */

import { useSyncExternalStore } from "react";
import { shortcutBindings } from "../core/actions/bindingStore";

function subscribe(listener: () => void): () => void {
  return shortcutBindings.subscribe(listener);
}

function getVersion(): number {
  return shortcutBindings.version;
}

/** Re-renders the caller when the user changes a shortcut. */
export function useShortcutBindings(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}
