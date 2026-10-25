/**
 * React bindings for the chords.
 *
 * The chords live in a session store, so React reads them through
 * `useSyncExternalStore`: the store is told when they change, and the
 * component that shows them re-renders.
 *
 * The hook is a thin shell over the store. Everything the chords *mean* - the
 * conflict rules, the capture rules, the built-in chords a command gives up
 * - lives in `core/actions`, where it can be tested without a browser.
 */

import { useSyncExternalStore } from "react";
import { getShortcutStore } from "../core/actions/shortcutSession";
import type { ShortcutStore } from "../core/actions/shortcutEditor";
import type { ShortcutOverrides } from "../core/actions/types";

/** The store the chords live in. */
export function useShortcutStore(): ShortcutStore {
  return getShortcutStore();
}

/**
 * The chords the commands answer to.
 *
 * The same object comes back until the chords change, so the dispatcher can
 * take it as the fourth argument without re-registering its listener on
 * every render.
 */
export function useShortcutOverrides(): ShortcutOverrides {
  const store = getShortcutStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
