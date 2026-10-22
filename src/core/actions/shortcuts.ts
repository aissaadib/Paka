/**
 * Turning a key press into a shortcut, and refusing the combinations that must
 * not become one.
 *
 * The rules live here, apart from the registry, because they are about the
 * *keyboard and the platform*, not about any one action:
 *
 *  - a **bare modifier** is not a chord yet: the user is still holding it
 *    down, waiting for the key;
 *  - a **reserved** chord belongs to the operating system, the web view or the
 *    app itself, so binding it would either do nothing or break the window;
 *  - an **unsupported** chord is one the runtime never delivers to the app, so
 *    storing it would be a promise the app cannot keep.
 *
 * Refusing is always explicit: the caller is told *why*, so the editor can
 * say so instead of silently keeping a combination that would never fire.
 */

import {
  codeFromKey,
  isBindableKey,
  logicalKey,
  type KeyboardEventLike,
  type KeyboardPlatform,
} from "./keyboard";
import type { ShortcutSpec } from "./types";

/**
 * A chord something else owns.
 *
 * `mod` means the platform's primary modifier (Ctrl, or Cmd on macOS), so one
 * entry covers both platforms. `platforms` narrows an entry to the systems it
 * really belongs to.
 */
export interface ReservedChord {
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly platforms?: readonly KeyboardPlatform[];
  /** Why the chord is refused, in words a user can act on. */
  readonly reason: string;
}

/**
 * The chords Paka refuses to bind.
 *
 * The list is deliberately short and specific: it names the combinations the
 * operating system, the web view or Paka itself already uses. A chord that is
 * merely *unusual* is not reserved - the user may well want it.
 *
 * The entries that name a Shift state come first, so the reason the user is
 * given is the specific one.
 */
export const RESERVED_CHORDS: readonly ReservedChord[] = [
  { key: "n", mod: true, shift: true, reason: "the web view opens a private window with it" },
  { key: "t", mod: true, shift: true, reason: "the web view reopens the last closed tab with it" },
  { key: "r", mod: true, shift: true, reason: "the web view hard-reloads the window with it" },
  { key: "i", mod: true, shift: true, reason: "the web view opens the developer tools with it" },
  { key: "j", mod: true, shift: true, reason: "the web view opens the developer tools with it" },
  { key: "c", mod: true, shift: true, reason: "the web view opens the developer tools with it" },
  { key: "w", mod: true, reason: "the window manager closes the window with it" },
  { key: "q", mod: true, platforms: ["mac"], reason: "macOS quits the application with it" },
  { key: "t", mod: true, reason: "the web view opens a new tab with it" },
  { key: "n", mod: true, reason: "the web view opens a new window with it" },
  { key: "r", mod: true, reason: "the web view reloads the window with it" },
  { key: "p", mod: true, reason: "the web view opens the print dialog with it" },
  { key: "tab", mod: true, reason: "the window manager switches tabs with it" },
  { key: ",", mod: true, platforms: ["mac"], reason: "macOS opens the application menu with it" },
  {
    key: "escape",
    mod: true,
    alt: true,
    platforms: ["mac"],
    reason: "macOS opens the force-quit dialog with it",
  },
  {
    key: "delete",
    mod: true,
    alt: true,
    platforms: ["other"],
    reason: "Windows restarts the machine with it",
  },
  { key: "f4", alt: true, platforms: ["other"], reason: "Windows closes the window with it" },
  { key: "f1", reason: "the operating system opens its help with it" },
  { key: "f5", reason: "the web view reloads the window with it" },
  { key: "f11", reason: "the window manager toggles full screen with it" },
  { key: "f12", reason: "the web view opens the developer tools with it" },
  { key: "escape", reason: "Esc cancels a gesture and closes a dialog" },
];

/** Keys the operating system keeps, so the app never sees them. */
const UNDELIVERABLE_CODES: Readonly<Record<string, string>> = {
  PrintScreen: "the operating system takes the screenshot with it",
  ScrollLock: "the operating system owns the scroll lock",
  Pause: "the operating system owns the pause key",
  NumLock: "the operating system owns the num lock",
  CapsLock: "the operating system owns the caps lock",
};

/** The keys that are only ever a modifier, never a chord of their own. */
const MODIFIER_KEYS = new Set(["shift", "control", "alt", "meta", "os", "altgraph"]);
const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

/** What a key press turned out to be. */
export type CaptureResult =
  /** A chord the app can deliver. */
  | { readonly kind: "captured"; readonly shortcut: ShortcutSpec }
  /** A modifier on its own: the user has not finished the combination. */
  | { readonly kind: "waiting"; readonly reason: string }
  /** A chord something else owns. */
  | { readonly kind: "reserved"; readonly reason: string }
  /** A chord the runtime never delivers, so it cannot be stored. */
  | { readonly kind: "unsupported"; readonly reason: string };

/** True when the press was only a modifier. */
function isModifierPress(event: KeyboardEventLike): boolean {
  return MODIFIER_KEYS.has(event.key.toLowerCase()) || MODIFIER_CODES.has(event.code);
}

/**
 * The canonical form of a chord.
 *
 * The key is lower-cased, the code is the canonical one for that key (so the
 * same chord is written the same way on every layout) and the modifier flags
 * are only present when they are on.
 */
export function normalizeShortcut(spec: ShortcutSpec): ShortcutSpec {
  const key = spec.key.toLowerCase();
  const code = codeFromKey(key) ?? spec.code;
  return {
    key,
    code,
    ...(spec.mod === true ? { mod: true } : {}),
    ...(spec.shift === true ? { shift: true } : {}),
    ...(spec.alt === true ? { alt: true } : {}),
    ...(spec.ctrl === true ? { ctrl: true } : {}),
  };
}

/** True when two chords are the same combination. */
export function shortcutEquals(a: ShortcutSpec, b: ShortcutSpec): boolean {
  const left = normalizeShortcut(a);
  const right = normalizeShortcut(b);
  return (
    left.key === right.key &&
    left.code === right.code &&
    left.mod === right.mod &&
    left.shift === right.shift &&
    left.alt === right.alt &&
    left.ctrl === right.ctrl
  );
}

/**
 * Why a chord is reserved, or `null` when it is not.
 *
 * A reserved entry with a modifier matches a chord that carries *any* primary
 * modifier, because Ctrl and Cmd are the same gesture on their platform.
 */
export function reservedReason(
  shortcut: ShortcutSpec,
  platform: KeyboardPlatform,
): string | null {
  const key = shortcut.key.toLowerCase();
  const hasMod = shortcut.mod === true || shortcut.ctrl === true;
  for (const entry of RESERVED_CHORDS) {
    if (entry.key !== key) {
      continue;
    }
    if (entry.platforms !== undefined && !entry.platforms.includes(platform)) {
      continue;
    }
    if ((entry.mod === true) !== hasMod) {
      continue;
    }
    if (entry.shift === true && shortcut.shift !== true) {
      continue;
    }
    if (entry.alt === true && shortcut.alt !== true) {
      continue;
    }
    return entry.reason;
  }
  return null;
}

/**
 * The chord a key press describes, or the reason it cannot be one.
 *
 * The platform decides which modifier is the primary one, so the chord that
 * comes out is written the same way on every platform: `mod` is the platform's
 * primary modifier and `ctrl` is the physical Control key, which only macOS
 * needs.
 */
export function captureShortcut(
  event: KeyboardEventLike,
  platform: KeyboardPlatform,
): CaptureResult {
  if (isModifierPress(event)) {
    return {
      kind: "waiting",
      reason: "Hold the key you want, then press the combination.",
    };
  }

  const undeliverable = UNDELIVERABLE_CODES[event.code];
  if (undeliverable !== undefined) {
    return {
      kind: "unsupported",
      reason: `Paka never receives this key: ${undeliverable}.`,
    };
  }

  if (platform !== "mac" && event.metaKey) {
    return {
      kind: "unsupported",
      reason: "The Windows key belongs to the operating system, so the app never receives that combination.",
    };
  }

  if (platform === "mac" && event.metaKey && event.ctrlKey) {
    return {
      kind: "unsupported",
      reason: "Cmd and Ctrl together cannot be delivered as one shortcut.",
    };
  }

  const key = logicalKey(event);
  if (!isBindableKey(key)) {
    return {
      kind: "unsupported",
      reason: "Paka never receives this key, so it cannot be bound to an action.",
    };
  }

  const shortcut = normalizeShortcut({
    key,
    code: event.code,
    mod: platform === "mac" ? event.metaKey : event.ctrlKey,
    ctrl: platform === "mac" ? event.ctrlKey : false,
    shift: event.shiftKey,
    alt: event.altKey,
  });

  const reserved = reservedReason(shortcut, platform);
  if (reserved !== null) {
    return { kind: "reserved", reason: `This combination is not available: ${reserved}.` };
  }

  return { kind: "captured", shortcut };
}
