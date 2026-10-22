/**
 * The user's shortcut overrides.
 *
 * The registry owns the *default* chords; this store owns the chords the user
 * has changed. Nothing else is kept here: an action's effective chords are
 * its override when it has one and its default when it does not, so a reset is
 * simply "forget the override".
 *
 * The store is deliberately ignorant of the actions themselves. It knows how
 * to hold a list of chords under a name, how to tell anyone who is listening
 * that they changed, and how to write them down and read them back. Which
 * actions exist, and whether two chords collide, is the registry's business.
 */

import type { Listener } from "../../utils/store";
import type { ShortcutSpec } from "./types";

/** A chord as it is written to disk. */
export interface SerializedShortcut {
  readonly key: string;
  readonly code: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
}

/** The overrides as they are written to disk: an action id and its chords. */
export type SerializedShortcutOverrides = Readonly<
  Record<string, readonly SerializedShortcut[]>
>;

/** One chord, as it is read back from an untrusted file. */
export function serializeShortcut(spec: ShortcutSpec): SerializedShortcut {
  return {
    key: spec.key,
    code: spec.code,
    ...(spec.mod === true ? { mod: true } : {}),
    ...(spec.shift === true ? { shift: true } : {}),
    ...(spec.alt === true ? { alt: true } : {}),
    ...(spec.ctrl === true ? { ctrl: true } : {}),
  };
}

/** The chords of every action the user has changed. */
export function serializeShortcutOverrides(
  overrides: ReadonlyMap<string, readonly ShortcutSpec[]>,
): SerializedShortcutOverrides {
  const result: Record<string, readonly SerializedShortcut[]> = {};
  for (const [actionId, chords] of overrides) {
    result[actionId] = chords.map(serializeShortcut);
  }
  return result;
}

/**
 * Reads the chords of one action out of an untrusted value.
 *
 * A value that is not a list of chords yields an empty list, and a chord that
 * is not one yields nothing: a malformed file must not be able to install a
 * chord the rest of the app cannot match.
 */
function readChord(value: unknown): ShortcutSpec | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const key = record.key;
  const code = record.code;
  if (typeof key !== "string" || key === "") {
    return null;
  }
  if (typeof code !== "string" || code === "") {
    return null;
  }
  return {
    key: key.toLowerCase(),
    code,
    ...(record.mod === true ? { mod: true } : {}),
    ...(record.shift === true ? { shift: true } : {}),
    ...(record.alt === true ? { alt: true } : {}),
    ...(record.ctrl === true ? { ctrl: true } : {}),
  };
}

/**
 * Reads the overrides out of an untrusted value.
 *
 * The shape is checked here; whether the action exists and whether the chords
 * collide is the registry's answer, not this one's.
 */
export function readShortcutOverrides(
  value: unknown,
): Map<string, readonly ShortcutSpec[]> {
  const result = new Map<string, readonly ShortcutSpec[]>();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return result;
  }
  for (const [actionId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(raw)) {
      continue;
    }
    const chords: ShortcutSpec[] = [];
    for (const item of raw) {
      const chord = readChord(item);
      if (chord !== null) {
        chords.push(chord);
      }
    }
    if (chords.length > 0) {
      result.set(actionId, chords);
    }
  }
  return result;
}

/** The chords the user has changed, one list per action. */
export class ShortcutBindingStore {
  private overrides = new Map<string, readonly ShortcutSpec[]>();
  private readonly listeners = new Set<Listener>();
  private changes = 0;

  /** A counter that changes whenever the chords change. */
  get version(): number {
    return this.changes;
  }

  /** The chords the user set for an action, or `undefined` when they did not. */
  get(actionId: string): readonly ShortcutSpec[] | undefined {
    return this.overrides.get(actionId);
  }

  /** True when the user has changed this action's chords. */
  has(actionId: string): boolean {
    return this.overrides.has(actionId);
  }

  /** The overrides, in the order they were set. */
  entries(): readonly (readonly [string, readonly ShortcutSpec[]])[] {
    return [...this.overrides.entries()];
  }

  /** Sets the chords of one action. */
  set(actionId: string, chords: readonly ShortcutSpec[]): void {
    this.overrides.set(actionId, chords);
    this.notify();
  }

  /** Forgets the chords of one action, so its defaults apply again. */
  remove(actionId: string): void {
    if (!this.overrides.delete(actionId)) {
      return;
    }
    this.notify();
  }

  /** Forgets every override. */
  clear(): void {
    if (this.overrides.size === 0) {
      return;
    }
    this.overrides.clear();
    this.notify();
  }

  /** Replaces every override at once, with a single notification. */
  replaceAll(overrides: ReadonlyMap<string, readonly ShortcutSpec[]>): void {
    this.overrides = new Map(overrides);
    this.notify();
  }

  /** Watches for changes. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The overrides as they are written to disk. */
  toJSON(): SerializedShortcutOverrides {
    return serializeShortcutOverrides(this.overrides);
  }

  private notify(): void {
    this.changes += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** The one store the editor and the registry share. */
export const shortcutBindings = new ShortcutBindingStore();
