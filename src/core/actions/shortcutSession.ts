/**
 * The chords the running application uses.
 *
 * The chords are a **preference**, and a preference belongs to the session,
 * not to a component: the dispatcher, the shortcut editor and the settings
 * store all have to see the same chords, or the user would press a key that
 * does nothing.
 *
 * The store is therefore a session-lifetime service, reached through
 * {@link getShortcutStore} rather than through a React context. A provider
 * would have to sit above the editor - the settings store is built inside the
 * editor's provider, and it is the settings store that persists the chords -
 * so the context would be read in the wrong order, and the store would have
 * to be created twice.
 *
 * The store holds the chords and nothing else: the settings file is written
 * by the settings store, through the chords' section, so there is one writer
 * per file.
 */

import { currentPlatform } from "./keyboard";
import { ShortcutStore } from "./shortcutEditor";

let session: ShortcutStore | null = null;

/**
 * The chords the application is running with.
 *
 * The store is created the first time it is asked for and kept for the life
 * of the session.
 */
export function getShortcutStore(): ShortcutStore {
  if (session === null) {
    session = new ShortcutStore({ platform: currentPlatform() });
  }
  return session;
}

/**
 * Drops the session store.
 *
 * Only for tests: the running application keeps one store for the whole
 * session, and a test that needs a clean one asks for this.
 */
export function resetShortcutStore(): void {
  session = null;
}
