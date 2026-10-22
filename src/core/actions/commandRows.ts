/**
 * A command, resolved against the editor's state.
 *
 * Both the canvas menu and the command palette show commands, and both show
 * the same things about them: the registry's label, the registry's chord and
 * whether the command can run right now. The row is built here so the two
 * surfaces cannot drift apart.
 */

import { formatShortcut, type KeyboardPlatform } from "./keyboard";
import { actionAvailability } from "./availability";
import type { ActionContext, ActionDefinition } from "./types";

export interface CommandRow {
  readonly action: ActionDefinition;
  /** False when the command cannot run right now. */
  readonly enabled: boolean;
  /** Why the command cannot run, or `null` when it can. */
  readonly reason: string | null;
  /** True when the command is a toggle that is currently on. */
  readonly checked: boolean;
  /** The chord to show, or `null` when the command has none. */
  readonly shortcut: string | null;
}

/**
 * The chord a command shows.
 *
 * The first chord is the one the user is most likely to press; a command with
 * no chord shows nothing rather than a placeholder.
 */
export function shortcutLabel(
  action: ActionDefinition,
  platform: KeyboardPlatform,
): string | null {
  const shortcut = action.shortcuts[0];
  return shortcut === undefined ? null : formatShortcut(shortcut, platform);
}

/** Resolves a command against the editor's state. */
export function commandRow(
  action: ActionDefinition,
  context: ActionContext,
  platform: KeyboardPlatform,
): CommandRow {
  const { enabled, reason } = actionAvailability(action, context);
  return {
    action,
    enabled,
    reason,
    checked: action.checked ? action.checked(context) : false,
    shortcut: shortcutLabel(action, platform),
  };
}
