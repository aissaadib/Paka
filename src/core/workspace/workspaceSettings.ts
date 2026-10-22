/**
 * The workspace preferences: how the shell is arranged and how it looks.
 *
 * These are **workspace** settings, not editor settings and not document
 * state. The editor settings (the brush, the tool, the fill tolerance) live in
 * the settings file next to them and describe the *next gesture*; the
 * workspace settings describe the *window*: which panels are up, how big the
 * interface is, which colour scheme it wears and how dense the brush panel is.
 *
 * Nothing here belongs to a document. Changing a workspace preference never
 * pushes a history entry, bumps a revision, marks the drawing unsaved or
 * reaches a `.paka` file: the artwork and the window are two different
 * things, and only the artwork is saved with the drawing.
 *
 * The file is small, explicit and versioned, and it is read with the same
 * rules the rest of the settings file uses, because it is on disk and a user
 * (or a bad upgrade, or a half-written file) can put anything in it:
 *
 *  - a **missing** field takes its default;
 *  - an **out-of-range** value is clamped into range, not rejected;
 *  - a **malformed** value takes its default;
 *  - a document from a **newer version** is ignored wholesale, because its
 *    meaning is unknown rather than merely wrong;
 *  - a file that is not valid JSON at all yields the defaults.
 *
 * A corrupt settings file must never stop the editor from starting, so every
 * one of those paths ends in a usable workspace rather than an error.
 */

import { clamp } from "../../utils/math";
import { asRecord } from "../../utils/record";

/** The version of the workspace document this build reads and writes. */
export const WORKSPACE_VERSION = 1;

/**
 * The workspace profiles.
 *
 * `custom` is not a preset: it is the honest name for a workspace the user
 * has arranged themselves, so the menu can say "Custom" rather than claim a
 * preset that does not match what is on screen.
 */
export type WorkspaceProfileId = "painting" | "compact" | "custom";

/** Every profile id, in a stable order. */
export const WORKSPACE_PROFILE_IDS: readonly WorkspaceProfileId[] = [
  "painting",
  "compact",
  "custom",
];

/** The colour schemes the shell has. */
export type WorkspaceTheme = "dark" | "light";

/** Every colour scheme, in a stable order. */
export const WORKSPACE_THEMES: readonly WorkspaceTheme[] = ["dark", "light"];

/** The smallest interface scale the shell offers. */
export const MIN_UI_SCALE = 0.8;

/** The largest interface scale the shell offers. */
export const MAX_UI_SCALE = 1.5;

/**
 * The scale factors the menu offers.
 *
 * They are fixed steps rather than a free slider: a scale of 1.03 is not a
 * thing anybody asks for, and a menu of named sizes is one click instead of a
 * drag that has to land somewhere.
 */
export const UI_SCALE_STEPS: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

/**
 * What the brush panel shows.
 *
 * The brush panel is the toolbar's brush row. A painter who only wants a size
 * and an opacity does not want to look at the sampling, the stabilizer, the
 * grain and the dab spacing every time, and the workspace remembers that
 * choice between sessions.
 */
export interface WorkspaceBrushPanel {
  /**
   * Whether the advanced controls are shown.
   *
   * Off means the panel keeps only the size and the opacity - the two
   * properties a brush is judged by - and hides the sampling, the stabilizer,
   * the grain, the dab settings and the pressure mapping.
   */
  readonly advanced: boolean;
  /** Whether the preset library row is shown. */
  readonly presets: boolean;
}

/**
 * The shell chrome that is not a side panel.
 *
 * The side panels are the panel manager's business (they are registered
 * panels, and the panel manager owns their visibility); the tool rail is the
 * shell's own column, so the workspace owns it.
 *
 * The status bar is deliberately **not** here. It carries the outcome of the
 * last file operation - a save that failed is reported nowhere else - so it
 * is always up: a preference that could swallow an error is not a
 * preference, it is a lost message.
 */
export interface WorkspaceShell {
  /** The tool rail down the left of the canvas. */
  readonly toolRail: boolean;
}

/**
 * The part of the workspace a profile decides.
 *
 * The colour scheme is deliberately **not** in here: a profile says how the
 * workspace is arranged, and applying one must not silently throw away a
 * colour scheme the user chose on purpose.
 */
export interface WorkspaceProfileState {
  /** The scale of the interface, as a factor of the designed size. */
  readonly uiScale: number;
  /** What the brush panel shows. */
  readonly brushPanel: WorkspaceBrushPanel;
  /** Which shell rows are up. */
  readonly shell: WorkspaceShell;
}

/** The persisted workspace preferences. */
export interface WorkspaceSettings extends WorkspaceProfileState {
  /** The document version. Always {@link WORKSPACE_VERSION} after loading. */
  readonly version: number;
  /**
   * The profile the workspace matches.
   *
   * It is *derived* from the state rather than trusted: the store recomputes
   * it whenever anything changes, so the menu can never claim a preset that
   * does not match what is on screen.
   */
  readonly profile: WorkspaceProfileId;
  /** The colour scheme. */
  readonly theme: WorkspaceTheme;
}

/** The workspace a fresh installation starts from. */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  version: WORKSPACE_VERSION,
  profile: "painting",
  theme: "dark",
  uiScale: 1,
  brushPanel: { advanced: true, presets: true },
  shell: { toolRail: true },
};

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function profileIdOr(value: unknown): WorkspaceProfileId {
  return typeof value === "string" && WORKSPACE_PROFILE_IDS.includes(value as WorkspaceProfileId)
    ? (value as WorkspaceProfileId)
    : "custom";
}

function themeOr(value: unknown): WorkspaceTheme {
  return value === "light" ? "light" : "dark";
}

/**
 * The scale, clamped into the range the shell supports.
 *
 * A scale outside the range is clamped rather than rejected: the file was
 * probably written by a build with a wider range, and a slightly wrong
 * interface size is a much smaller problem than a failed start.
 */
export function normalizeUiScale(value: unknown, fallback = 1): number {
  return Math.round(clamp(numberOr(value, fallback), MIN_UI_SCALE, MAX_UI_SCALE) * 100) / 100;
}

/**
 * Turns whatever was in the file into a usable workspace.
 *
 * Never throws and never rejects: a value it cannot make sense of takes its
 * default, and a document from a newer version is ignored entirely.
 */
export function normalizeWorkspaceSettings(value: unknown): WorkspaceSettings {
  const record = asRecord(value);
  if (record === null) {
    return DEFAULT_WORKSPACE_SETTINGS;
  }

  const version = record.version;
  if (
    typeof version === "number" &&
    Number.isFinite(version) &&
    version > WORKSPACE_VERSION
  ) {
    // Written by a newer Paka. Its meaning is unknown rather than wrong, so
    // the whole document is ignored and the defaults are used.
    return DEFAULT_WORKSPACE_SETTINGS;
  }

  const brushPanel = asRecord(record.brushPanel);
  const shell = asRecord(record.shell);

  return {
    version: WORKSPACE_VERSION,
    profile: profileIdOr(record.profile),
    theme: themeOr(record.theme),
    uiScale: normalizeUiScale(record.uiScale, DEFAULT_WORKSPACE_SETTINGS.uiScale),
    brushPanel: {
      advanced: booleanOr(
        brushPanel?.advanced,
        DEFAULT_WORKSPACE_SETTINGS.brushPanel.advanced,
      ),
      presets: booleanOr(
        brushPanel?.presets,
        DEFAULT_WORKSPACE_SETTINGS.brushPanel.presets,
      ),
    },
    shell: {
      toolRail: booleanOr(shell?.toolRail, DEFAULT_WORKSPACE_SETTINGS.shell.toolRail),
    },
  };
}

/**
 * Parses a workspace document.
 *
 * `null` - nothing stored yet - and a document that is not valid JSON both
 * yield the defaults: a broken workspace must not stop the editor from
 * starting.
 */
export function parseWorkspaceSettings(text: string | null): WorkspaceSettings {
  if (text === null) {
    return DEFAULT_WORKSPACE_SETTINGS;
  }
  try {
    return normalizeWorkspaceSettings(JSON.parse(text));
  } catch {
    return DEFAULT_WORKSPACE_SETTINGS;
  }
}

/** The plain object a workspace is written as. */
export function workspaceSettingsDocument(settings: WorkspaceSettings): Record<string, unknown> {
  return {
    version: WORKSPACE_VERSION,
    profile: settings.profile,
    theme: settings.theme,
    uiScale: settings.uiScale,
    brushPanel: { ...settings.brushPanel },
    shell: { ...settings.shell },
  };
}

/** The part of the workspace a profile decides, taken out of a full state. */
export function workspaceProfileState(settings: WorkspaceSettings): WorkspaceProfileState {
  return {
    uiScale: settings.uiScale,
    brushPanel: settings.brushPanel,
    shell: settings.shell,
  };
}

/** Field-wise comparison of the profile state. */
export function workspaceProfileStateEqual(
  a: WorkspaceProfileState,
  b: WorkspaceProfileState,
): boolean {
  return (
    a.uiScale === b.uiScale &&
    a.brushPanel.advanced === b.brushPanel.advanced &&
    a.brushPanel.presets === b.brushPanel.presets &&
    a.shell.toolRail === b.shell.toolRail
  );
}

/** Field-wise comparison, so an unchanged workspace is never written again. */
export function workspaceSettingsEqual(a: WorkspaceSettings, b: WorkspaceSettings): boolean {
  return (
    a.version === b.version &&
    a.profile === b.profile &&
    a.theme === b.theme &&
    workspaceProfileStateEqual(workspaceProfileState(a), workspaceProfileState(b))
  );
}
