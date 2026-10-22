/**
 * The shortcut editor: the chords the user has chosen for the commands.
 *
 * The registry owns the built-in chords; this module owns what the user
 * changed on top of them. Four rules shape it:
 *
 *  1. **A user chord replaces the built-in one.** The user asked for this key,
 *     so the command answers to that key and no longer to the key Paka shipped
 *     with. The key it gave up is free for another command.
 *  2. **A chord belongs to one command.** A chord that is already taken is
 *     *reported*, with the command that holds it, and is never silently
 *     reassigned. The registry refuses two built-in chords that clash; the
 *     editor refuses the same thing for the user's.
 *  3. **A chord is matched on the logical key, with the physical code as the
 *     fallback**, so a chord the user recorded on a layout that does not
 *     produce the Latin key keeps working on that layout and on others.
 *  4. **A shortcut is a preference, not an edit.** Changing one adds no
 *     history step, dirties nothing and never reaches a project file. It
 *     lives in the preferences document and survives a restart.
 *
 * The module is framework-free on purpose: the whole "read the chords, change
 * one, write them back" cycle is exercised in Node, and the React layer is a
 * thin shell over it.
 */

import {
  chordId,
  eventModifiers,
  formatShortcut,
  logicalKey,
  type ChordLike,
  type KeyboardEventLike,
  type KeyboardPlatform,
} from "./keyboard";
import { ACTION_DEFINITIONS, effectiveShortcuts } from "./registry";
import type { ActionDefinition, ActionId, ShortcutOverrides, ShortcutSpec } from "./types";

/** The version of the shortcuts document this build reads and writes. */
export const USER_SHORTCUTS_VERSION = 1;

/** The chords a fresh installation starts from: none of the user's own. */
export const DEFAULT_USER_SHORTCUTS: ShortcutOverrides = Object.freeze({});

/**
 * The key names a chord may not be written with.
 *
 * A modifier pressed on its own is not a shortcut: the user is reaching for
 * Ctrl, not asking for a command called "Control".
 */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "alt",
  "capslock",
  "cmd",
  "command",
  "control",
  "ctrl",
  "meta",
  "option",
  "os",
  "shift",
]);

/** True when two chords are the same chord. */
export function sameChord(a: ChordLike, b: ChordLike, platform: KeyboardPlatform): boolean {
  return chordId(a, platform) === chordId(b, platform);
}

/** The command that holds a chord. */
export interface ShortcutOwner {
  readonly actionId: ActionId;
  readonly label: string;
}

/**
 * The command that holds a chord, or `null` when the chord is free.
 *
 * The chords that are checked are the ones the commands actually claim: a
 * command the user has given a chord of its own answers to that chord and no
 * longer to the built-in one, so the key it gave up is free.
 *
 * `except` is the command the user is rebinding: its own chords never make
 * its new chord a conflict.
 */
export function findChordOwner(
  chord: ChordLike,
  shortcuts: ShortcutOverrides,
  platform: KeyboardPlatform,
  actions: readonly ActionDefinition[] = ACTION_DEFINITIONS,
  except?: ActionId,
): ShortcutOwner | null {
  for (const action of actions) {
    if (except !== undefined && action.id === except) {
      continue;
    }
    for (const held of effectiveShortcuts(action, shortcuts)) {
      if (sameChord(chord, held, platform)) {
        return { actionId: action.id, label: action.label };
      }
    }
  }
  return null;
}

/** The result of reading a chord off a key event. */
export type CaptureResult =
  | { readonly ok: true; readonly shortcut: ShortcutSpec }
  | { readonly ok: false; readonly reason: string };

/**
 * The chord a key event describes.
 *
 * The logical key is what the chord is written with; the physical code is
 * kept beside it so the chord still matches on a layout that does not produce
 * the Latin character.
 *
 * The platform's primary modifier is Ctrl, or Cmd on macOS. The other one
 * binds no chord at all, so a capture that carries it is refused with the
 * reason rather than quietly reinterpreted.
 */
export function captureChord(
  event: KeyboardEventLike,
  platform: KeyboardPlatform,
): CaptureResult {
  const modifiers = eventModifiers(event, platform);
  if (modifiers.secondary) {
    return {
      ok: false,
      reason:
        platform === "mac"
          ? "Ctrl is not a modifier Paka binds on macOS. Use Cmd."
          : "Cmd is not a modifier Paka binds outside macOS. Use Ctrl.",
    };
  }

  const key = logicalKey(event);
  if (key === "" || MODIFIER_KEYS.has(key)) {
    return { ok: false, reason: "A modifier on its own is not a shortcut." };
  }

  return {
    ok: true,
    shortcut: {
      key,
      code: event.code,
      ...(modifiers.primary ? { mod: true } : {}),
      ...(modifiers.shift ? { shift: true } : {}),
      ...(modifiers.alt ? { alt: true } : {}),
    },
  };
}

/** The result of giving a command a chord. */
export type AssignResult =
  | { readonly ok: true; readonly shortcuts: ShortcutOverrides }
  | {
      readonly ok: false;
      /** The message the editor shows. */
      readonly reason: string;
      /** The command that already holds the chord. */
      readonly owner: ShortcutOwner;
    };

/**
 * Gives a command the user's own chord.
 *
 * A chord that another command already holds is **reported**, not taken: the
 * caller gets the command that holds it and the reason to show. Nothing is
 * changed in that case, so a chord is never silently stolen.
 */
export function assignShortcut(
  shortcuts: ShortcutOverrides,
  actionId: ActionId,
  chord: ShortcutSpec,
  platform: KeyboardPlatform = "other",
  actions: readonly ActionDefinition[] = ACTION_DEFINITIONS,
): AssignResult {
  const owner = findChordOwner(chord, shortcuts, platform, actions, actionId);
  if (owner !== null) {
    return {
      ok: false,
      reason: `${formatShortcut(chord, platform)} is already used by ${owner.label}.`,
      owner,
    };
  }
  return { ok: true, shortcuts: { ...shortcuts, [actionId]: chord } };
}

/**
 * Gives a command its built-in chord back.
 *
 * Resetting is not the same as assigning the built-in chord: the command may
 * have several of them, and the user gets all of them back.
 */
export function resetShortcut(
  shortcuts: ShortcutOverrides,
  actionId: ActionId,
): ShortcutOverrides {
  if (!Object.prototype.hasOwnProperty.call(shortcuts, actionId)) {
    return shortcuts;
  }
  const next: Record<string, ShortcutSpec> = { ...shortcuts };
  delete next[actionId];
  return next;
}

/** One command, as the editor shows it. */
export interface ShortcutEntry {
  readonly actionId: ActionId;
  readonly label: string;
  /** The chords the command answers to now. */
  readonly shortcuts: readonly ShortcutSpec[];
  /** The built-in chords, for the editor to show what was replaced. */
  readonly defaults: readonly ShortcutSpec[];
  /** True when the user has given the command a chord of its own. */
  readonly customized: boolean;
}

/**
 * Every command, with the chord it answers to.
 *
 * The list is the editor's whole content: the user can see what every
 * command is bound to, and which ones they have changed.
 */
export function shortcutEntries(
  shortcuts: ShortcutOverrides = DEFAULT_USER_SHORTCUTS,
  actions: readonly ActionDefinition[] = ACTION_DEFINITIONS,
): readonly ShortcutEntry[] {
  return actions.map((action) => ({
    actionId: action.id,
    label: action.label,
    shortcuts: effectiveShortcuts(action, shortcuts),
    defaults: action.shortcuts,
    customized: Object.prototype.hasOwnProperty.call(shortcuts, action.id),
  }));
}

/**
 * The canonical form of one chord.
 *
 * The key is lower-cased and the modifiers that are not held are dropped, so
 * two spellings of the same chord compare equal.
 */
export function normalizeChord(value: unknown): ShortcutSpec | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as {
    key?: unknown;
    code?: unknown;
    mod?: unknown;
    shift?: unknown;
    alt?: unknown;
  };
  if (typeof record.key !== "string") {
    return null;
  }
  const key = record.key.trim().toLowerCase();
  if (key === "" || MODIFIER_KEYS.has(key)) {
    return null;
  }
  return {
    key,
    code: typeof record.code === "string" ? record.code : "",
    ...(record.mod === true ? { mod: true } : {}),
    ...(record.shift === true ? { shift: true } : {}),
    ...(record.alt === true ? { alt: true } : {}),
  };
}

/**
 * The user's chords, read out of an untrusted value.
 *
 * Every chord is checked on its own: a malformed one is skipped and the rest
 * are kept, so one bad entry cannot lose the user's other chords.
 */
export function normalizeUserShortcuts(value: unknown): ShortcutOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_USER_SHORTCUTS;
  }
  const result: Record<string, ShortcutSpec> = {};
  for (const [actionId, chord] of Object.entries(value as Record<string, unknown>)) {
    if (actionId.trim() === "") {
      continue;
    }
    const normalized = normalizeChord(chord);
    if (normalized === null) {
      continue;
    }
    result[actionId] = normalized;
  }
  return result;
}

/**
 * The user's chords, read out of a file's text.
 *
 * A file that is not JSON, a document without the chords, and a document from
 * a newer version all yield no chords: a shortcuts file must never stop the
 * editor from starting, and a document whose meaning is unknown is ignored
 * rather than half-read.
 */
export function parseUserShortcuts(text: string | null): ShortcutOverrides {
  if (text === null) {
    return DEFAULT_USER_SHORTCUTS;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return DEFAULT_USER_SHORTCUTS;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_USER_SHORTCUTS;
  }
  const record = parsed as { version?: unknown; shortcuts?: unknown };
  if (
    typeof record.version === "number" &&
    Number.isFinite(record.version) &&
    record.version > USER_SHORTCUTS_VERSION
  ) {
    return DEFAULT_USER_SHORTCUTS;
  }
  return normalizeUserShortcuts(record.shortcuts);
}

/** The user's chords, written out with a stable order. */
export function serializeUserShortcuts(shortcuts: ShortcutOverrides): string {
  const entries = Object.keys(shortcuts)
    .sort()
    .map((actionId) => [actionId, normalizeChord(shortcuts[actionId])] as const);
  return `${JSON.stringify(
    {
      version: USER_SHORTCUTS_VERSION,
      shortcuts: Object.fromEntries(entries),
    },
    null,
    2,
  )}\n`;
}

/** Whether two sets of chords say the same thing. */
export function userShortcutsEqual(a: ShortcutOverrides, b: ShortcutOverrides): boolean {
  return serializeUserShortcuts(a) === serializeUserShortcuts(b);
}

/**
 * The user's chords, with the ones that cannot be honoured dropped.
 *
 * A chords file is untrusted: it may name a chord that a built-in chord
 * already holds, or two chords that hold the same key. The built-in chord
 * wins, because a shortcut Paka shipped must keep working, and the user's
 * chord is dropped rather than allowed to shadow it.
 */
export function sanitizeUserShortcuts(
  shortcuts: ShortcutOverrides,
  actions: readonly ActionDefinition[] = ACTION_DEFINITIONS,
  platform: KeyboardPlatform = "other",
): ShortcutOverrides {
  const claimed = new Set<string>();
  // The built-in chords are claimed first, except for the commands the user
  // has given a chord of their own: those have given their built-in chord up.
  for (const action of actions) {
    if (Object.prototype.hasOwnProperty.call(shortcuts, action.id)) {
      continue;
    }
    for (const chord of action.shortcuts) {
      claimed.add(chordId(chord, platform));
    }
  }

  const result: Record<string, ShortcutSpec> = {};
  for (const actionId of Object.keys(shortcuts).sort()) {
    const chord = shortcuts[actionId];
    const normalized = normalizeChord(chord);
    if (normalized === null) {
      continue;
    }
    const id = chordId(normalized, platform);
    if (claimed.has(id)) {
      continue;
    }
    claimed.add(id);
    result[actionId] = normalized;
  }
  return result;
}

/**
 * Where the user's chords live.
 *
 * The port mirrors the settings gateway: the editor asks for the document's
 * text and hands back the new text. The file that holds it is the host's
 * business - the settings file, the shell preferences - so this module never
 * decides where a preference lives.
 */
export interface ShortcutGateway {
  /** The stored document, or `null` when there is none yet. */
  read(): Promise<string | null>;
  /** Replaces the document. */
  write(contents: string): Promise<void>;
}

/** How long a change waits before the document is written. */
const DEFAULT_DEBOUNCE_MS = 300;

export interface ShortcutStoreOptions {
  /**
   * Where the chords document lives.
   *
   * It is optional, because the chords do not have to live in a file of their
   * own: when they live in the **settings file**, the settings store owns
   * that file and writes them back, and the store only holds them. A store
   * without a gateway never writes anything - it is the settings store that
   * persists the chords, so the two writers cannot race for the same file.
   */
  readonly gateway?: ShortcutGateway;
  /** The commands the chords are checked against. */
  readonly actions?: readonly ActionDefinition[];
  /** The platform the chords are read and written for. */
  readonly platform?: KeyboardPlatform;
  /** How long a change waits before the document is written. */
  readonly debounceMs?: number;
  /** Injected timer functions, so the tests need not wait in real time. */
  readonly schedule?: (callback: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

/**
 * The user's chords, held in memory and written back.
 *
 * The store never touches the editor: a shortcut is a preference, so there is
 * no history step, no revision bump and no dirty flag anywhere in it. The
 * document is read once at startup and written when the user changes a chord.
 */
export class ShortcutStore {
  private readonly gateway: ShortcutGateway | null;
  private readonly actions: readonly ActionDefinition[];
  private readonly platform: KeyboardPlatform;
  private readonly debounceMs: number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  private shortcuts: ShortcutOverrides = DEFAULT_USER_SHORTCUTS;
  private readonly listeners = new Set<(shortcuts: ShortcutOverrides) => void>();
  private pending: unknown = null;
  private writing = false;
  private queued = false;
  private destroyed = false;
  private written: string | null = null;
  private readError: string | null = null;
  private writeError: string | null = null;

  constructor(options: ShortcutStoreOptions) {
    this.gateway = options.gateway ?? null;
    this.actions = options.actions ?? ACTION_DEFINITIONS;
    this.platform = options.platform ?? "other";
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.schedule =
      options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as never));
  }

  /** The chords the store holds. */
  get current(): ShortcutOverrides {
    return this.shortcuts;
  }

  /**
   * The chords the store holds, for a reader that wants a snapshot.
   *
   * The same object is returned until the chords change, so a reader can
   * compare it by identity.
   */
  readonly getSnapshot = (): ShortcutOverrides => this.shortcuts;

  /** The last read or write failure, or `null`. Recorded, never raised. */
  get lastError(): string | null {
    return this.readError ?? this.writeError;
  }

  /**
   * Reads the document and holds the chords it carries.
   *
   * A document that cannot be read, cannot be parsed, or holds a chord that
   * clashes with a built-in one yields the chords that can be honoured. None
   * of them is an error, and none of them stops the editor.
   *
   * A store without a gateway has no document of its own: the chords live in
   * the settings file and are handed over by {@link apply}, so there is
   * nothing to read here.
   */
  async load(): Promise<ShortcutOverrides> {
    if (this.gateway === null) {
      return this.shortcuts;
    }
    let text: string | null = null;
    try {
      text = await this.gateway.read();
    } catch (error) {
      this.readError = describe(error);
    }
    if (this.destroyed) {
      return this.shortcuts;
    }
    const parsed = parseUserShortcuts(text);
    this.shortcuts = sanitizeUserShortcuts(parsed, this.actions, this.platform);
    this.written = serializeUserShortcuts(this.shortcuts);
    this.publish();
    return this.shortcuts;
  }

  /**
   * Hands the store the chords that were read from the settings file.
   *
   * The chords are a preference, so nothing here touches the document, the
   * history or the dirty flag. A chord that cannot be honoured - one that
   * clashes with a built-in chord another command still holds - is dropped
   * rather than allowed to shadow it.
   */
  apply(shortcuts: ShortcutOverrides): void {
    const next = sanitizeUserShortcuts(shortcuts, this.actions, this.platform);
    if (userShortcutsEqual(next, this.shortcuts)) {
      return;
    }
    this.shortcuts = next;
    this.publish();
  }

  /**
   * Gives a command the user's own chord and writes the document back.
   *
   * A chord another command already holds is reported and nothing is written:
   * the chord is never silently stolen.
   */
  async assign(actionId: ActionId, chord: ShortcutSpec): Promise<AssignResult> {
    const result = assignShortcut(
      this.shortcuts,
      actionId,
      chord,
      this.platform,
      this.actions,
    );
    if (!result.ok) {
      return result;
    }
    this.shortcuts = result.shortcuts;
    this.publish();
    this.scheduleWrite();
    return result;
  }

  /** Gives a command its built-in chord back and writes the document. */
  async reset(actionId: ActionId): Promise<ShortcutOverrides> {
    this.shortcuts = resetShortcut(this.shortcuts, actionId);
    this.publish();
    this.scheduleWrite();
    return this.shortcuts;
  }

  /**
   * Watches the chords. Returns the function that stops watching.
   *
   * The listener is told the chords, so a reader that wants to know what
   * changed does not have to ask again.
   */
  readonly subscribe = (listener: (shortcuts: ShortcutOverrides) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Writes the document now, without waiting for the debounce.
   *
   * A store without a gateway writes nothing: the settings store owns the
   * settings file and writes the chords back, so there is one writer per
   * file and the two cannot race.
   */
  async flush(): Promise<void> {
    if (this.gateway === null) {
      return;
    }
    if (this.writing) {
      this.queued = true;
      return;
    }
    this.writing = true;
    try {
      do {
        this.queued = false;
        const contents = serializeUserShortcuts(this.shortcuts);
        if (contents === this.written) {
          // Nothing changed: the document on disk is already the right one.
          continue;
        }
        try {
          await this.gateway.write(contents);
          this.written = contents;
          this.writeError = null;
        } catch (error) {
          // A document that cannot be written is a minor inconvenience, not a
          // failure: the chords stay in memory and the next change tries again.
          this.writeError = describe(error);
        }
      } while (this.queued);
    } finally {
      this.writing = false;
    }
  }

  /** Stops watching, and writes anything still pending. */
  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
    if (this.pending !== null) {
      this.cancel(this.pending);
      this.pending = null;
      void this.flush();
    }
  }

  private publish(): void {
    for (const listener of this.listeners) {
      listener(this.shortcuts);
    }
  }

  private scheduleWrite(): void {
    if (this.gateway === null) {
      // The settings store owns the file: it writes the chords back when it
      // is told that they changed.
      return;
    }
    if (this.pending !== null) {
      this.cancel(this.pending);
      this.pending = null;
    }
    this.pending = this.schedule(() => {
      this.pending = null;
      void this.flush();
    }, this.debounceMs);
  }
}
