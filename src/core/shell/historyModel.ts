/**
 * History model: what the undo stack means, in words a person can read.
 *
 * The command stack knows *that* a step can be undone and *what* it is called
 * (`"Add stroke"`, `"Delete layer"`). It does not know how to group the steps
 * or describe them, and it must not: the stack is the engine's, and the
 * engine's history is a list of commands.
 *
 * This module is the shell's read-only view of that list. It turns commands
 * into entries a panel can render, classifies them into a small closed set of
 * kinds, and answers "can I undo?" from the same data. It is pure: it never
 * runs a command, never mutates the stack and never touches the document.
 */

import type { Command } from "../commands/types";

/** The closed set of kinds a history entry can have. */
export type HistoryKind =
  | "stroke"
  | "fill"
  | "gradient"
  | "layer"
  | "selection"
  | "document"
  | "other";

/** One undoable step, as the shell shows it. */
export interface HistoryEntry {
  /** The command's id, stable for the life of the command. */
  readonly id: string;
  /** The command's label, shown verbatim. */
  readonly label: string;
  /** The kind the command was classified as. */
  readonly kind: HistoryKind;
  /** True when the step has been undone and can be redone. */
  readonly undone: boolean;
}

/** The whole history: the steps and how far along the user is. */
export interface HistoryState {
  readonly entries: readonly HistoryEntry[];
  /** How many entries are currently applied. */
  readonly cursor: number;
}

/** The empty history. */
export const EMPTY_HISTORY: HistoryState = Object.freeze({
  entries: [],
  cursor: 0,
});

/**
 * Decides what kind a command is.
 *
 * A classifier is a function from a command to a kind, so a feature that
 * adds a new kind of step can say so without changing this module.
 */
export type HistoryClassifier = (command: Command) => HistoryKind;

const KIND_KEYWORDS: readonly (readonly [HistoryKind, readonly string[]])[] = [
  ["fill", ["fill", "bucket"]],
  ["gradient", ["gradient"]],
  ["layer", ["layer"]],
  ["selection", ["select", "move", "flip", "scale", "rotate", "nudge", "duplicate"]],
  ["stroke", ["stroke", "draw", "erase", "shape", "rectangle", "ellipse", "polygon", "star", "line"]],
  ["document", ["new document", "resize", "crop"]],
];

/**
 * The default classifier.
 *
 * It reads the command's label, which is the only text a command carries, and
 * matches the first keyword that appears in it. A command whose label matches
 * nothing is `"other"`: an unknown step is still a step, and hiding it would
 * be worse than saying so.
 */
export function defaultHistoryClassifier(command: Command): HistoryKind {
  const label = command.label.toLowerCase();
  for (const [kind, keywords] of KIND_KEYWORDS) {
    if (keywords.some((keyword) => label.includes(keyword))) {
      return kind;
    }
  }
  return "other";
}

let classifier: HistoryClassifier = defaultHistoryClassifier;

/** Replaces the classifier. */
export function setHistoryClassifier(next: HistoryClassifier): void {
  classifier = next;
}

/** Restores the default classifier. */
export function resetHistoryClassifier(): void {
  classifier = defaultHistoryClassifier;
}

/**
 * Builds the shell's view of a list of commands.
 *
 * `cursor` is how many of the commands are currently applied; the rest have
 * been undone and can be redone. A cursor outside the list is clamped, so a
 * caller that is slightly out of step cannot produce a nonsensical state.
 */
export function describeHistory(
  commands: readonly Command[],
  cursor: number = commands.length,
): HistoryState {
  const bounded = Math.max(0, Math.min(commands.length, Math.trunc(cursor)));
  const entries: HistoryEntry[] = commands.map((command, index) => ({
    id: command.id,
    label: command.label,
    kind: classifier(command),
    undone: index >= bounded,
  }));
  return { entries, cursor: bounded };
}

/** Whether there is a step to undo. */
export function canUndo(history: HistoryState): boolean {
  return history.cursor > 0;
}

/** Whether there is a step to redo. */
export function canRedo(history: HistoryState): boolean {
  return history.cursor < history.entries.length;
}

/** The label of the step undo would reverse, or `null`. */
export function undoLabel(history: HistoryState): string | null {
  if (!canUndo(history)) {
    return null;
  }
  return history.entries[history.cursor - 1]?.label ?? null;
}

/** The label of the step redo would reapply, or `null`. */
export function redoLabel(history: HistoryState): string | null {
  if (!canRedo(history)) {
    return null;
  }
  return history.entries[history.cursor]?.label ?? null;
}

/** One entry by index, or `undefined`. */
export function historyEntryAt(
  history: HistoryState,
  index: number,
): HistoryEntry | undefined {
  return history.entries[index];
}

/** The entries that are currently applied, oldest first. */
export function appliedEntries(history: HistoryState): readonly HistoryEntry[] {
  return history.entries.slice(0, history.cursor);
}

/** The entries that have been undone, oldest first. */
export function undoneEntries(history: HistoryState): readonly HistoryEntry[] {
  return history.entries.slice(history.cursor);
}
