/**
 * Shell preferences: the parts of the editor's setup that are about the
 * application rather than about the drawing.
 *
 * The settings file already holds the editor's preferences - the brush, the
 * tool, the shape options, the grid. This module holds the *shell*'s
 * preferences: which panels are shown, where they are docked, the theme and
 * the remembered viewport.
 *
 * None of this is part of a drawing. Changing a panel's position is not an
 * edit: it adds no history step, dirties nothing and never reaches a project
 * file. The same rule the brush and the grid follow.
 *
 * The document is versioned on its own so a preferences file can be read
 * without knowing the rest of the settings format.
 */

import { isShellSlotId, type ShellSlotId } from "./slots";
import {
  DEFAULT_VIEWPORT_STATE,
  normalizeViewportState,
  viewportStateEqual,
  type ViewportState,
} from "./viewportState";

/** The preferences document's version. */
export const SHELL_PREFERENCES_VERSION = 1;

/** The theme the shell follows. */
export type ThemePreference = "system" | "light" | "dark";

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];

/** The shell's preferences. */
export interface ShellPreferences {
  readonly version: typeof SHELL_PREFERENCES_VERSION;
  /** Panels the user hid. A panel that is not listed is shown. */
  readonly hiddenPanels: readonly string[];
  /** Panels in the order the shell shows them. */
  readonly panelOrder: readonly string[];
  /** Panel id to the slot it is docked in. */
  readonly panelSlots: Readonly<Record<string, ShellSlotId>>;
  /** The theme the shell follows. */
  readonly theme: ThemePreference;
  /** Whether the status bar is shown. */
  readonly showStatusBar: boolean;
  /** Where the user was looking. */
  readonly viewport: ViewportState;
}

/** The preferences a fresh installation starts from. */
export const DEFAULT_SHELL_PREFERENCES: ShellPreferences = Object.freeze({
  version: SHELL_PREFERENCES_VERSION,
  hiddenPanels: [],
  panelOrder: [],
  panelSlots: {},
  theme: "system",
  showStatusBar: true,
  viewport: DEFAULT_VIEWPORT_STATE,
});

/**
 * Reads the preferences out of an untrusted value.
 *
 * Every field falls back to its default when it is missing or malformed. A
 * preferences file that has been truncated, hand-edited or written by a newer
 * build must still open the editor.
 */
export function normalizeShellPreferences(value: unknown): ShellPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_SHELL_PREFERENCES;
  }
  const record = value as {
    hiddenPanels?: unknown;
    panelOrder?: unknown;
    panelSlots?: unknown;
    theme?: unknown;
    showStatusBar?: unknown;
    viewport?: unknown;
  };

  const hiddenPanels = readStringList(record.hiddenPanels);
  const panelOrder = readStringList(record.panelOrder);
  const panelSlots = readSlotMap(record.panelSlots);
  const theme: ThemePreference =
    typeof record.theme === "string" && (THEMES as readonly string[]).includes(record.theme)
      ? (record.theme as ThemePreference)
      : DEFAULT_SHELL_PREFERENCES.theme;
  const showStatusBar =
    typeof record.showStatusBar === "boolean"
      ? record.showStatusBar
      : DEFAULT_SHELL_PREFERENCES.showStatusBar;

  return {
    version: SHELL_PREFERENCES_VERSION,
    hiddenPanels,
    panelOrder,
    panelSlots,
    theme,
    showStatusBar,
    viewport: normalizeViewportState(record.viewport),
  };
}

function readStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "" || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function readSlotMap(value: unknown): Readonly<Record<string, ShellSlotId>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, ShellSlotId> = {};
  for (const [panelId, slot] of Object.entries(value as Record<string, unknown>)) {
    if (panelId.trim() === "" || !isShellSlotId(slot)) {
      continue;
    }
    result[panelId] = slot;
  }
  return result;
}

/**
 * Writes the preferences out.
 *
 * The version travels with the document so a future build can tell an old
 * file from a new one.
 */
export function serializeShellPreferences(preferences: ShellPreferences): string {
  return JSON.stringify({
    version: SHELL_PREFERENCES_VERSION,
    hiddenPanels: preferences.hiddenPanels,
    panelOrder: preferences.panelOrder,
    panelSlots: preferences.panelSlots,
    theme: preferences.theme,
    showStatusBar: preferences.showStatusBar,
    viewport: preferences.viewport,
  });
}

/**
 * Reads the preferences out of a file's text.
 *
 * A file that is not JSON at all, or is JSON but not an object, yields the
 * defaults: a corrupt preferences file must never stop the editor opening.
 */
export function parseShellPreferences(text: string): ShellPreferences {
  try {
    return normalizeShellPreferences(JSON.parse(text) as unknown);
  } catch {
    return DEFAULT_SHELL_PREFERENCES;
  }
}

/** Whether two preference documents say the same thing. */
export function shellPreferencesEqual(
  a: ShellPreferences,
  b: ShellPreferences,
): boolean {
  if (
    a.theme !== b.theme ||
    a.showStatusBar !== b.showStatusBar ||
    a.hiddenPanels.length !== b.hiddenPanels.length ||
    a.panelOrder.length !== b.panelOrder.length
  ) {
    return false;
  }
  if (!a.hiddenPanels.every((id, index) => b.hiddenPanels[index] === id)) {
    return false;
  }
  if (!a.panelOrder.every((id, index) => b.panelOrder[index] === id)) {
    return false;
  }
  const slotIds = new Set([...Object.keys(a.panelSlots), ...Object.keys(b.panelSlots)]);
  for (const panelId of slotIds) {
    if (a.panelSlots[panelId] !== b.panelSlots[panelId]) {
      return false;
    }
  }
  return viewportStateEqual(a.viewport, b.viewport);
}
