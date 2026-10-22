/**
 * The user's chords as a section of the settings file.
 *
 * The settings store owns the settings file, so the chords cannot write to
 * it directly without two writers racing for the same document. A **section**
 * is the hand-off instead: the store reads the section out of the file, gives
 * it to its owner, and writes the owner's state back whenever it changes.
 * That is the whole persistence contract for the chords - one key in the
 * settings document, and no second store.
 *
 * The section is **additive**: a settings file written before the shortcut
 * editor existed has no `shortcuts` key, and the chords then start from
 * nothing, which is the built-in behaviour.
 *
 * The reader and the writer are the model's own: the chords are read with
 * {@link parseUserShortcuts} and written with {@link serializeUserShortcuts},
 * so the file's shape and the editor's shape cannot drift apart. A file that
 * cannot be parsed yields no chords, and a chord that clashes with a built-in
 * one is dropped rather than allowed to shadow it: a shortcut Paka shipped
 * must keep working.
 */

import {
  parseUserShortcuts,
  sanitizeUserShortcuts,
  serializeUserShortcuts,
  USER_SHORTCUTS_VERSION,
} from "./shortcutEditor";
import { ACTION_DEFINITIONS } from "./registry";
import type { ActionDefinition, ShortcutOverrides } from "./types";

/** The key the chords are stored under in the settings document. */
export const SHORTCUT_SECTION_KEY = "shortcuts";

/**
 * The version of the chords document this build reads and writes.
 *
 * The section is versioned on its own, so the chords can be read without
 * knowing the rest of the settings format.
 */
export const SHORTCUT_SECTION_VERSION = USER_SHORTCUTS_VERSION;

/**
 * The port the chords' owner implements.
 *
 * The owner is the store that holds the chords. It is asked for the chords
 * when the file is written, handed the chords that were read from it, and
 * listened to for the changes.
 */
export interface ShortcutSectionSource {
  /** The chords the owner holds. */
  readonly current: ShortcutOverrides;
  /** Subscribes to the owner's changes. */
  subscribe(listener: (shortcuts: ShortcutOverrides) => void): () => void;
  /** Hands the owner the chords that were read from the file. */
  apply(shortcuts: ShortcutOverrides): void;
}

/**
 * The section, shaped like the settings store's section contract.
 *
 * The members are the ones the store needs: the key the state is stored
 * under, how to read it out of a settings document, how to write it back,
 * and how to be told that the owner's state changed.
 */
export interface ShortcutSection {
  /** The key the section's state is stored under in the settings document. */
  readonly key: string;
  /** The version of the chords document the section reads and writes. */
  readonly version: number;
  /** Reads the section's state out of a settings document. */
  read(document: Record<string, unknown>): ShortcutOverrides;
  /** Writes the section's state into a settings document. */
  write(document: Record<string, unknown>, shortcuts: ShortcutOverrides): void;
  /** The state the section's owner currently holds. */
  current(): ShortcutOverrides;
  /** Hands the owner the state that was read from the file. */
  apply(shortcuts: ShortcutOverrides): void;
  /** Subscribes to the owner's changes. */
  subscribe(listener: () => void): () => void;
}

export interface ShortcutSectionOptions {
  /** The commands the chords are checked against. */
  readonly actions?: readonly ActionDefinition[];
}

/**
 * The section's own value, as the text the model's reader understands.
 *
 * The settings document holds a plain value, so the section's value is
 * turned back into text and handed to {@link parseUserShortcuts}. A value
 * that is already text - a hand-edited file - is used as it is.
 */
function sectionText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    // A value that cannot even be turned into text says nothing.
    return null;
  }
}

/**
 * The chords, wired into the settings file.
 *
 * `read` is tolerant: a missing key, a malformed value or a document from a
 * newer version all yield the chords that can be honoured, so a broken
 * shortcuts file never stops the editor from starting.
 *
 * `write` touches its own key and nothing else. The settings document holds
 * the other preferences too, and the chords are not allowed to disturb them.
 */
export function createShortcutSection(
  source: ShortcutSectionSource,
  options: ShortcutSectionOptions = {},
): ShortcutSection {
  const actions = options.actions ?? ACTION_DEFINITIONS;
  return {
    key: SHORTCUT_SECTION_KEY,
    version: SHORTCUT_SECTION_VERSION,
    read: (document) => {
      const parsed = parseUserShortcuts(sectionText(document[SHORTCUT_SECTION_KEY]));
      // A chords file is untrusted: a chord that a built-in chord still holds
      // is dropped rather than allowed to shadow it.
      return sanitizeUserShortcuts(parsed, actions);
    },
    write: (document, shortcuts) => {
      const written: unknown = JSON.parse(serializeUserShortcuts(shortcuts));
      document[SHORTCUT_SECTION_KEY] = written;
    },
    current: () => source.current,
    apply: (shortcuts) => source.apply(shortcuts),
    subscribe: (listener) => source.subscribe(() => listener()),
  };
}
