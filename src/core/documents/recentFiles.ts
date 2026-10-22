/**
 * The recent files list: the paths of the documents that were opened lately.
 *
 * The list holds **paths only**. No drawing, no file contents, no preview: the
 * settings file that carries the list is a plain JSON document, and a path is
 * all that is needed to offer the file again.
 *
 * The list is a convenience, never a promise: a file that has been moved,
 * renamed or deleted is still listed until the user tries to open it, and
 * then the failure is reported plainly instead of the entry silently
 * disappearing.
 *
 * It is stored in the settings file, so the persistence goes through the
 * settings store's section mechanism - one file, one writer.
 */

import type { SettingsSection } from "../settings/settingsSection";
import type { Listener } from "../../utils/store";

/** The key the list is stored under in the settings document. */
export const RECENT_FILES_KEY = "recentFiles";

/** How many entries the list keeps. */
export const RECENT_FILES_LIMIT = 10;

/**
 * The paths, most recent first.
 *
 * A path is only a path: it is never interpreted, never opened and never
 * resolved while it is being stored.
 */
export type RecentFilesState = readonly string[];

/**
 * Turns whatever was in the settings file into a usable list.
 *
 * A missing key, a value that is not an array, an entry that is not a string
 * and a path that is empty are all skipped rather than rejected: a broken
 * list must never stop the editor from starting.
 */
export function normalizeRecentFiles(value: unknown): RecentFilesState {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const path = entry.trim();
    if (path === "" || seen.has(path)) {
      continue;
    }
    seen.add(path);
    paths.push(path);
    if (paths.length >= RECENT_FILES_LIMIT) {
      break;
    }
  }
  return paths;
}

/**
 * The list, with `path` at the front.
 *
 * A file that is already in the list moves to the front rather than being
 * listed twice, so the order always reads "most recent first".
 */
export function recentFilesWith(path: string, current: RecentFilesState): RecentFilesState {
  const trimmed = path.trim();
  if (trimmed === "") {
    return current;
  }
  return [trimmed, ...current.filter((entry) => entry !== trimmed)].slice(0, RECENT_FILES_LIMIT);
}

/**
 * The live list.
 *
 * A tiny store of its own: the tab strip does not need it, but the file menu
 * does, and the settings store needs a section that can read and write it.
 */
export class RecentFilesStore {
  private state: RecentFilesState = [];
  private readonly listeners = new Set<Listener>();

  /** The paths, most recent first. */
  getState(): RecentFilesState {
    return this.state;
  }

  /** Notified when the list changes. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Records that a document was opened or saved at `path`. */
  note(path: string): void {
    const next = recentFilesWith(path, this.state);
    if (next.length === this.state.length && next.every((entry, index) => entry === this.state[index])) {
      return;
    }
    this.state = next;
    this.notify();
  }

  /** Forgets one path. */
  remove(path: string): void {
    const next = this.state.filter((entry) => entry !== path);
    if (next.length === this.state.length) {
      return;
    }
    this.state = next;
    this.notify();
  }

  /** Forgets every path. */
  clear(): void {
    if (this.state.length === 0) {
      return;
    }
    this.state = [];
    this.notify();
  }

  /** Replaces the list with what was read from the settings file. */
  apply(state: RecentFilesState): void {
    this.state = state;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * The recent files, wired into the settings file.
 *
 * The section is the hand-off: the settings store owns the file, so the list
 * is read out of it at startup and written back whenever it changes.
 */
export function createRecentFilesSection(store: RecentFilesStore): SettingsSection<RecentFilesState> {
  return {
    key: RECENT_FILES_KEY,
    read: (document) => normalizeRecentFiles(document[RECENT_FILES_KEY]),
    write: (document, state) => {
      document[RECENT_FILES_KEY] = [...state];
    },
    current: () => store.getState(),
    apply: (state) => store.apply(state),
    subscribe: (listener) => store.subscribe(listener),
  };
}
