/**
 * Pure keyboard-chord matching.
 *
 * Two defects motivated this module:
 *  - the old handler treated Ctrl and Cmd as the same modifier on every
 *    platform, so a macOS Ctrl+Z fired undo instead of the system's text
 *    binding;
 *  - shortcuts were matched only on `event.key`, so a non-Latin layout could
 *    not reach a tool shortcut at all.
 *
 * Matching is exact: a chord claims a key only when every modifier agrees.
 * There is no guessing and no fallback to a different action.
 */

export type KeyboardPlatform = "mac" | "other";

export interface KeyboardEventLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Physical key to logical key.
 *
 * Only the keys Paka binds are listed. `event.code` is layout-independent, so
 * this is the fallback when `event.key` is a Cyrillic/Greek/other character.
 */
const PHYSICAL_KEYS: Readonly<Record<string, string>> = {
  KeyA: "a",
  KeyB: "b",
  KeyC: "c",
  KeyD: "d",
  KeyE: "e",
  KeyF: "f",
  KeyG: "g",
  KeyH: "h",
  KeyI: "i",
  KeyJ: "j",
  KeyK: "k",
  KeyL: "l",
  KeyM: "m",
  KeyN: "n",
  KeyO: "o",
  KeyP: "p",
  KeyQ: "q",
  KeyR: "r",
  KeyS: "s",
  KeyT: "t",
  KeyU: "u",
  KeyV: "v",
  KeyW: "w",
  KeyX: "x",
  KeyY: "y",
  KeyZ: "z",
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  BracketLeft: "[",
  BracketRight: "]",
  Equal: "=",
  Minus: "-",
  Quote: "'",
  Semicolon: ";",
  Backspace: "backspace",
  Delete: "delete",
  Escape: "escape",
  Enter: "enter",
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
};

const LOGICAL_KEYS = new Set(Object.values(PHYSICAL_KEYS));

/** The physical key a code stands for, or `null` when Paka does not bind it. */
export function keyFromCode(code: string): string | null {
  return PHYSICAL_KEYS[code] ?? null;
}

/** True when a `KeyboardEvent.key` value is one Paka can write a chord with. */
function isLogicalKey(key: string): boolean {
  return LOGICAL_KEYS.has(key);
}

/**
 * The logical key an event represents.
 *
 * `event.key` wins when it is a key Paka binds; otherwise the physical code is
 * used. The shifted forms `+` and `"` normalise to the unshifted key so a
 * chord can list them explicitly instead of relying on the layout.
 */
export function logicalKey(event: KeyboardEventLike): string {
  let key = event.key.toLowerCase();
  if (key === "+") {
    key = "=";
  } else if (key === '"') {
    key = "'";
  }
  if (isLogicalKey(key)) {
    return key;
  }
  return keyFromCode(event.code) ?? key;
}

/** The platform a matcher runs on. Browser detection, with a safe default. */
export function currentPlatform(): KeyboardPlatform {
  if (typeof navigator === "undefined") {
    return "other";
  }
  const platform = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac|iphone|ipad|ipod/i.test(platform) ? "mac" : "other";
}

/** True when the event is the exact chord described by `shortcut`. */
export function matchesShortcut(
  event: KeyboardEventLike,
  shortcut: { readonly key: string; readonly mod?: boolean; readonly shift?: boolean; readonly alt?: boolean },
  platform: KeyboardPlatform,
): boolean {
  if (logicalKey(event) !== shortcut.key.toLowerCase()) {
    return false;
  }

  const wantsMod = shortcut.mod === true;
  const primary = platform === "mac" ? event.metaKey : event.ctrlKey;
  const secondary = platform === "mac" ? event.ctrlKey : event.metaKey;
  if (wantsMod) {
    if (!primary || secondary) {
      return false;
    }
  } else if (event.ctrlKey || event.metaKey) {
    return false;
  }

  if (event.altKey !== (shortcut.alt === true)) {
    return false;
  }
  return event.shiftKey === (shortcut.shift === true);
}

/**
 * A stable identity for a chord on one platform.
 *
 * Used to refuse two actions that claim the same key instead of letting array
 * order decide, which is how a shortcut silently stops working.
 */
export function chordId(
  shortcut: { readonly key: string; readonly mod?: boolean; readonly shift?: boolean; readonly alt?: boolean },
  platform: KeyboardPlatform,
): string {
  return [
    platform,
    shortcut.mod === true ? "mod" : "",
    shortcut.shift === true ? "shift" : "",
    shortcut.alt === true ? "alt" : "",
    shortcut.key.toLowerCase(),
  ].join(":");
}

/** Human-readable chord, e.g. `Ctrl+Shift+Z` or `Cmd+Z`. */
export function formatShortcut(
  shortcut: { readonly key: string; readonly mod?: boolean; readonly shift?: boolean; readonly alt?: boolean },
  platform: KeyboardPlatform,
): string {
  const parts: string[] = [];
  if (shortcut.mod === true) {
    parts.push(platform === "mac" ? "Cmd" : "Ctrl");
  }
  if (shortcut.shift === true) {
    parts.push("Shift");
  }
  if (shortcut.alt === true) {
    parts.push("Alt");
  }
  parts.push(keyLabel(shortcut.key));
  return parts.join("+");
}

function keyLabel(key: string): string {
  switch (key.toLowerCase()) {
    case "arrowleft":
      return "←";
    case "arrowright":
      return "→";
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    case "escape":
      return "Esc";
    case "enter":
      return "Enter";
    case "delete":
      return "Delete";
    case "backspace":
      return "Backspace";
    default:
      return key.toUpperCase();
  }
}

/** Structural text-entry test, kept pure so it can be tested without a DOM. */
export interface TextEntryTargetLike {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
}

/** True when a key event target is a field where typing must win. */
export function isTextEntryTarget(target: TextEntryTargetLike | null | undefined): boolean {
  if (!target) {
    return false;
  }
  const tag = (target.tagName ?? "").toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable === true
  );
}
