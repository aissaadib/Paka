/**
 * The command palette's search.
 *
 * Pure: the palette filters the registry and nothing else, so the names, the
 * labels and the chords it shows are the registry's own. There is no second
 * list of commands to keep in step with the first.
 *
 * The query is matched loosely on purpose. A user who types "dup" wants
 * "Duplicate Selection", and a user who types "ctrl+z" wants "Undo"; both are
 * found without a prefix index or a fuzzy-matching dependency.
 */

import { formatShortcut, type KeyboardPlatform } from "./keyboard";
import type { ActionDefinition } from "./types";

/**
 * How well a query matched a command.
 *
 * Lower sorts first. The order is the order a reader would expect: a command
 * whose name starts with the query comes before one that merely contains it,
 * and a command that only matches on its chord comes last.
 */
export const MATCH_RANKS = {
  prefix: 0,
  word: 1,
  contains: 2,
  chord: 3,
  fuzzy: 4,
} as const;

export type MatchRank = (typeof MATCH_RANKS)[keyof typeof MATCH_RANKS];

export interface CommandSearchResult {
  readonly action: ActionDefinition;
  /** The chord to show, or `null` when the command has none. */
  readonly shortcut: string | null;
  /** How well the query matched; lower sorts first. */
  readonly rank: MatchRank;
}

/** The words of a label, lowercased. */
function wordsOf(label: string): readonly string[] {
  return label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 0);
}

/**
 * True when the needle's letters appear in the haystack in order.
 *
 * "brsh" matches "Brush", so a user who mistypes still finds the command.
 */
function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }
  return false;
}

/**
 * How well a token matches a label.
 *
 * `null` means it does not match at all.
 */
export function matchLabel(label: string, token: string): MatchRank | null {
  const lower = label.toLowerCase();
  const needle = token.toLowerCase();
  if (needle.length === 0) {
    return MATCH_RANKS.prefix;
  }
  if (lower.startsWith(needle)) {
    return MATCH_RANKS.prefix;
  }
  if (wordsOf(label).some((word) => word.startsWith(needle))) {
    return MATCH_RANKS.word;
  }
  if (lower.includes(needle)) {
    return MATCH_RANKS.contains;
  }
  if (isSubsequence(needle, lower)) {
    return MATCH_RANKS.fuzzy;
  }
  return null;
}

/**
 * How well a token matches a chord.
 *
 * The chord is written the way the user sees it ("Ctrl+Shift+Z"), so typing
 * "ctrl+z" finds the command that chord belongs to. A query that names fewer
 * modifiers than the chord has still matches it: "ctrl+z" finds both Undo and
 * Redo, because "Ctrl+Shift+Z" has a Ctrl and a Z.
 */
export function matchChord(
  action: ActionDefinition,
  token: string,
  platform: KeyboardPlatform,
): MatchRank | null {
  const needle = token.toLowerCase();
  if (needle.length === 0) {
    return null;
  }
  const parts = needle
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (const shortcut of action.shortcuts) {
    const label = formatShortcut(shortcut, platform).toLowerCase();
    if (label.includes(needle)) {
      return MATCH_RANKS.chord;
    }
    const chordParts = label.split("+");
    if (parts.length > 0 && parts.every((part) => chordParts.includes(part))) {
      return MATCH_RANKS.chord;
    }
  }
  return null;
}

/**
 * The best rank a token found for a command, or `null` when it did not match.
 */
function matchAction(
  action: ActionDefinition,
  token: string,
  platform: KeyboardPlatform,
): MatchRank | null {
  const byLabel = matchLabel(action.label, token);
  const byChord = matchChord(action, token, platform);
  if (byLabel === null) {
    return byChord;
  }
  if (byChord === null) {
    return byLabel;
  }
  return Math.max(byLabel, byChord) as MatchRank;
}

/**
 * Filters the commands by a query.
 *
 * Every word of the query has to match, so "grid snap" finds the snapping
 * command and not every command with a "grid" somewhere. An empty query
 * returns the commands in the registry's own order, which is the order the
 * keyboard table was written in.
 */
export function searchCommands(
  query: string,
  actions: readonly ActionDefinition[],
  platform: KeyboardPlatform,
): readonly CommandSearchResult[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
  const results: CommandSearchResult[] = [];

  for (const action of actions) {
    let rank: MatchRank = MATCH_RANKS.prefix;
    let matched = true;
    for (const token of tokens) {
      const tokenRank = matchAction(action, token, platform);
      if (tokenRank === null) {
        matched = false;
        break;
      }
      rank = Math.max(rank, tokenRank) as MatchRank;
    }
    if (!matched) {
      continue;
    }
    const shortcut = action.shortcuts[0];
    results.push({
      action,
      shortcut: shortcut === undefined ? null : formatShortcut(shortcut, platform),
      rank,
    });
  }

  if (tokens.length === 0) {
    return results;
  }

  return [...results].sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }
    return left.action.label.localeCompare(right.action.label);
  });
}
