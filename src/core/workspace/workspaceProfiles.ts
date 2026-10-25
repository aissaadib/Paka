/**
 * Workspace profiles: the named arrangements of the shell.
 *
 * A profile is a saved answer to "what does this window look like": which
 * panels are up, where each one is docked and in what order they sit. The
 * user saves the arrangement they like, gives it a name, and switches to it
 * later; the shell adopts the layout and the window looks the way it did when
 * the profile was saved.
 *
 * The module is pure. It owns no React state, no DOM and no file system: it
 * is a model of a set of named layouts and the rules for changing that set.
 * The shell reads a profile's layout and adopts it; it never writes into a
 * profile behind the model's back.
 *
 * Four rules shape the model.
 *
 *  1. **A profile is a named layout, and the layout belongs to the shell.**
 *     The layout a profile carries is a `ShellLayout` from `core/shell/slots`
 *     and the rules for placing, moving and hiding a panel are the shell's
 *     rules. The profile keeps no second copy of the arrangement and has no
 *     idea of its own about where a panel goes.
 *  2. **A profile may only place a panel the shell knows.** A layout that
 *     names a slot this build does not have, or a panel that has been
 *     removed, is refused: it would put the shell in an arrangement it cannot
 *     render.
 *  3. **A profile is not an edit.** Switching a profile rearranges the
 *     window; it adds no history step, dirties nothing and never reaches a
 *     project file. The same rule the panels and the tool options follow.
 *  4. **The name is the profile's identity.** Names are unique, compared
 *     without regard to case, and they are what the user picks from a menu.
 *     A profile whose name cannot be read is dropped rather than repaired
 *     into something the user did not save.
 *
 * The persistence boundary is at the bottom of the file: `serializeProfileSet`
 * and `parseProfileSet` are the only functions that know how a set of
 * profiles is written down. The settings file belongs to another module, so
 * the boundary is a pair of functions over plain data rather than a file
 * write; whoever owns the settings file embeds the document it returns.
 */

import {
  DEFAULT_SHELL_LAYOUT,
  findPlacement,
  isShellSlotId,
  normalizeShellLayout,
  placePanel,
  shellLayoutEqual,
  type PanelPlacement,
  type ShellLayout,
} from "../shell/slots";
import { findPanel, listPanels } from "../shell/panelRegistry";

/** The name the profile a fresh set starts with carries. */
export const DEFAULT_PROFILE_NAME = "Default";

/** The longest name a profile may have. */
export const MAX_PROFILE_NAME_LENGTH = 64;

/**
 * The version of the profile document.
 *
 * This is the version of *this* document, not of the settings file the
 * document is embedded in; the settings file carries its own version.
 */
export const WORKSPACE_PROFILE_VERSION = 1;

/** A named arrangement of the shell. */
export interface WorkspaceProfile {
  /** The name the user gave the profile. Unique within a set. */
  readonly name: string;
  /** The arrangement the profile stands for. */
  readonly layout: ShellLayout;
}

/** The saved profiles and the one the shell is currently showing. */
export interface WorkspaceProfileSet {
  /** The saved profiles, in the order the user sees them. */
  readonly profiles: readonly WorkspaceProfile[];
  /**
   * The name of the profile the shell is currently showing.
   *
   * `undefined` means the window is an arrangement of the user's own: no
   * saved profile describes it.
   */
  readonly active: string | undefined;
}

/** Why an operation on the profile set was refused. */
export type ProfileErrorReason =
  | "invalid-name"
  | "duplicate-name"
  | "unknown-profile"
  | "invalid-layout";

/** What an operation on the profile set did. */
export type ProfileOutcome =
  | {
      readonly ok: true;
      /** The set after the operation. */
      readonly set: WorkspaceProfileSet;
      /**
       * The layout the shell should adopt.
       *
       * Present when the operation changes what is on screen; absent when it
       * only changes the saved profiles.
       */
      readonly layout?: ShellLayout;
    }
  | {
      readonly ok: false;
      /** Why the operation was refused. */
      readonly reason: ProfileErrorReason;
      /** A sentence for the message the user reads. */
      readonly detail?: string;
    };

// ---------------------------------------------------------------- the names

/** Whether a name carries a character that must not be written down. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

/**
 * The name as it is stored: trimmed, with runs of whitespace collapsed to
 * one space.
 *
 * Two names that differ only in spacing or in case are the same name; the
 * set keeps one of them.
 */
export function normalizeProfileName(name: string): string {
  if (typeof name !== "string") {
    return "";
  }
  return name.replace(/\s+/g, " ").trim();
}

/** The key two names are compared by: normalized and without regard to case. */
export function profileNameKey(name: string): string {
  return normalizeProfileName(name).toLowerCase();
}

/**
 * Whether a name may be used for a profile.
 *
 * A name must say something, must not be longer than
 * `MAX_PROFILE_NAME_LENGTH`, and must not carry control characters: a name is
 * shown in a menu and written to a file, and a name with a newline in it is
 * neither.
 */
export function isValidProfileName(name: string): boolean {
  if (typeof name !== "string" || hasControlCharacter(name)) {
    return false;
  }
  const normalized = normalizeProfileName(name);
  return normalized !== "" && normalized.length <= MAX_PROFILE_NAME_LENGTH;
}

// ------------------------------------------------------------ the layouts

/**
 * Whether a layout is well formed: every placement names a slot the shell
 * has, names a panel, and names each panel once.
 *
 * This is the shape of the layout alone. Whether the shell knows the panels
 * it names is a separate question, asked by `panelsKnownToShell`.
 */
export function isWellFormedLayout(layout: ShellLayout): boolean {
  return describeShapeProblem(layout) === undefined;
}

/** Why a layout is not well formed, or `undefined` when it is. */
function describeShapeProblem(layout: ShellLayout): string | undefined {
  const placements = readPlacements(layout);
  if (placements === undefined) {
    return "the layout has no list of panels";
  }
  const seen = new Set<string>();
  for (const placement of placements) {
    if (typeof placement !== "object" || placement === null) {
      return "a placement is not a panel";
    }
    const panelId = readPanelId(placement);
    const slot = (placement as { slot?: unknown }).slot;
    if (panelId === undefined || panelId.trim() === "") {
      return "a placement names no panel";
    }
    if (!isShellSlotId(slot)) {
      return `the slot "${String(slot)}" does not exist`;
    }
    if (seen.has(panelId)) {
      return `the panel "${panelId}" is placed twice`;
    }
    seen.add(panelId);
  }
  return undefined;
}

/** The panel a placement names, when it names one. */
function readPanelId(placement: unknown): string | undefined {
  if (typeof placement !== "object" || placement === null) {
    return undefined;
  }
  const panelId = (placement as { panelId?: unknown }).panelId;
  return typeof panelId === "string" ? panelId : undefined;
}

/** The placements of a layout, read defensively. */
function readPlacements(layout: ShellLayout): readonly unknown[] | undefined {
  if (typeof layout !== "object" || layout === null) {
    return undefined;
  }
  const placements = (layout as { placements?: unknown }).placements;
  return Array.isArray(placements) ? placements : undefined;
}

/**
 * Whether the shell knows every panel a layout places.
 *
 * The registry is filled by the panels themselves, so an empty registry means
 * "the shell has not mounted its panels yet", not "the panel does not
 * exist". The check then defers: it neither rejects the layout nor rewrites
 * it, and the shell asks again when it adopts the profile.
 */
export function panelsKnownToShell(layout: ShellLayout): boolean {
  if (listPanels().length === 0) {
    return true;
  }
  const placements = readPlacements(layout);
  if (placements === undefined) {
    return false;
  }
  return placements.every((placement) => {
    const panelId = readPanelId(placement);
    return panelId !== undefined && findPanel(panelId) !== undefined;
  });
}

/**
 * Whether a profile may carry this layout.
 *
 * A profile is an answer about the window, so the answer has to be one the
 * window can show: every panel it places must be a panel the shell knows and
 * every panel it places must sit in a slot the shell has.
 */
export function isValidProfileLayout(layout: ShellLayout): boolean {
  return describeLayoutProblem(layout) === undefined;
}

/** Why a layout may not be carried by a profile, or `undefined` when it may. */
export function describeLayoutProblem(layout: ShellLayout): string | undefined {
  const shape = describeShapeProblem(layout);
  if (shape !== undefined) {
    return shape;
  }
  if (!panelsKnownToShell(layout)) {
    const unknown = layout.placements.find(
      (placement) => findPanel(placement.panelId) === undefined,
    );
    return `the panel "${unknown ? unknown.panelId : ""}" is not one the shell knows`;
  }
  return undefined;
}

/**
 * The layout without the panels the shell does not know.
 *
 * A profile saved before a panel was removed still names it. The panel goes
 * when the profile is adopted rather than taking the whole profile with it.
 * The registry's emptiness defers the same way `panelsKnownToShell` does.
 */
export function knownPanelsOnly(layout: ShellLayout): ShellLayout {
  if (listPanels().length === 0) {
    return layout;
  }
  return {
    placements: layout.placements.filter(
      (placement) => findPanel(placement.panelId) !== undefined,
    ),
  };
}

/**
 * The layout with every panel the shell knows given a slot.
 *
 * A layout that mentions only some of the panels leaves the rest without a
 * place to render in. `completeLayout` puts each panel the layout does not
 * mention in the slot the registry gives it by default, after the panels
 * that are already there, so the arrangement the user made stays first.
 */
export function completeLayout(layout: ShellLayout): ShellLayout {
  let result = layout;
  for (const panel of listPanels()) {
    if (findPlacement(result, panel.id) !== undefined) {
      continue;
    }
    result = placePanel(result, panel.id, panel.slot);
  }
  return result;
}

/** The panels a layout shows: the ones not in the hidden slot. */
export function shownPanelIds(layout: ShellLayout): readonly string[] {
  return layout.placements
    .filter((placement) => placement.slot !== "hidden")
    .map((placement) => placement.panelId);
}

/** The panels a layout hides. */
export function hiddenPanelIds(layout: ShellLayout): readonly string[] {
  return layout.placements
    .filter((placement) => placement.slot === "hidden")
    .map((placement) => placement.panelId);
}

// ------------------------------------------------------------- the profile set

/**
 * The profile a fresh set starts with.
 *
 * Its layout is the layout an installation starts from - nothing is placed
 * yet - and `completeLayout` fills it out with the panels the registry knows
 * when the shell adopts it. The default profile therefore never depends on
 * when the module was read.
 */
export const DEFAULT_WORKSPACE_PROFILE: WorkspaceProfile = Object.freeze({
  name: DEFAULT_PROFILE_NAME,
  layout: DEFAULT_SHELL_LAYOUT,
});

/** The set a fresh installation starts from: the default profile, showing it. */
export function createWorkspaceProfiles(): WorkspaceProfileSet {
  return { profiles: [DEFAULT_WORKSPACE_PROFILE], active: DEFAULT_PROFILE_NAME };
}

/** The profile with this name, compared without regard to case. */
export function findProfile(
  set: WorkspaceProfileSet,
  name: string,
): WorkspaceProfile | undefined {
  const key = profileNameKey(name);
  return set.profiles.find((profile) => profileNameKey(profile.name) === key);
}

/** The profile the shell is showing, if any. */
export function activeProfile(set: WorkspaceProfileSet): WorkspaceProfile | undefined {
  return set.active === undefined ? undefined : findProfile(set, set.active);
}

/**
 * Adds a profile.
 *
 * The name must be a name no other profile has, and the layout must be one
 * the shell can show. A refused operation changes nothing: the set that came
 * in is the set that goes out.
 */
export function addProfile(
  set: WorkspaceProfileSet,
  name: string,
  layout: ShellLayout,
): ProfileOutcome {
  const normalized = normalizeProfileName(name);
  if (!isValidProfileName(normalized)) {
    return {
      ok: false,
      reason: "invalid-name",
      detail: "a profile needs a name that says something and is not too long",
    };
  }
  if (findProfile(set, normalized) !== undefined) {
    return {
      ok: false,
      reason: "duplicate-name",
      detail: `there is already a profile called "${normalized}"`,
    };
  }
  const problem = describeLayoutProblem(layout);
  if (problem !== undefined) {
    return { ok: false, reason: "invalid-layout", detail: problem };
  }
  const profile: WorkspaceProfile = { name: normalized, layout };
  return { ok: true, set: { ...set, profiles: [...set.profiles, profile] } };
}

/**
 * Renames a profile.
 *
 * The profile keeps its place in the list and its layout. When the renamed
 * profile was the one the shell was showing, the shell keeps showing it.
 */
export function renameProfile(
  set: WorkspaceProfileSet,
  from: string,
  to: string,
): ProfileOutcome {
  const source = findProfile(set, from);
  if (source === undefined) {
    return {
      ok: false,
      reason: "unknown-profile",
      detail: `there is no profile called "${normalizeProfileName(from)}"`,
    };
  }
  const normalized = normalizeProfileName(to);
  if (!isValidProfileName(normalized)) {
    return {
      ok: false,
      reason: "invalid-name",
      detail: "a profile needs a name that says something and is not too long",
    };
  }
  const taken = findProfile(set, normalized);
  if (taken !== undefined && taken !== source) {
    return {
      ok: false,
      reason: "duplicate-name",
      detail: `there is already a profile called "${normalized}"`,
    };
  }
  const profiles = set.profiles.map((profile) =>
    profile === source ? { ...profile, name: normalized } : profile,
  );
  const active =
    set.active !== undefined && profileNameKey(set.active) === profileNameKey(source.name)
      ? normalized
      : set.active;
  return { ok: true, set: { profiles, active } };
}

/**
 * Removes a profile.
 *
 * The window does not change: the panels stay where they are. When the
 * removed profile was the one the shell was showing, the shell is showing an
 * arrangement no saved profile describes any more.
 */
export function deleteProfile(
  set: WorkspaceProfileSet,
  name: string,
): ProfileOutcome {
  const source = findProfile(set, name);
  if (source === undefined) {
    return {
      ok: false,
      reason: "unknown-profile",
      detail: `there is no profile called "${normalizeProfileName(name)}"`,
    };
  }
  const profiles = set.profiles.filter((profile) => profile !== source);
  const active =
    set.active !== undefined && profileNameKey(set.active) === profileNameKey(source.name)
      ? undefined
      : set.active;
  return { ok: true, set: { profiles, active } };
}

/**
 * Saves a new arrangement over a profile the user already has.
 *
 * The layout must be one the shell can show, exactly as it must be when a
 * profile is added.
 */
export function updateProfileLayout(
  set: WorkspaceProfileSet,
  name: string,
  layout: ShellLayout,
): ProfileOutcome {
  const source = findProfile(set, name);
  if (source === undefined) {
    return {
      ok: false,
      reason: "unknown-profile",
      detail: `there is no profile called "${normalizeProfileName(name)}"`,
    };
  }
  const problem = describeLayoutProblem(layout);
  if (problem !== undefined) {
    return { ok: false, reason: "invalid-layout", detail: problem };
  }
  const profiles = set.profiles.map((profile) =>
    profile === source ? { ...profile, layout } : profile,
  );
  return { ok: true, set: { profiles, active: set.active } };
}

/**
 * Adopts a profile.
 *
 * The shell takes the profile's layout, completed so that every panel the
 * shell knows has a slot to render in, and the profile becomes the one the
 * shell is showing.
 */
export function switchProfile(
  set: WorkspaceProfileSet,
  name: string,
): ProfileOutcome {
  const profile = findProfile(set, name);
  if (profile === undefined) {
    return {
      ok: false,
      reason: "unknown-profile",
      detail: `there is no profile called "${normalizeProfileName(name)}"`,
    };
  }
  return {
    ok: true,
    set: { ...set, active: profile.name },
    layout: completeLayout(profile.layout),
  };
}

/**
 * Records that the window is the user's own arrangement.
 *
 * The user moved a panel, so the shell is no longer showing the profile it
 * was showing. The saved profiles are untouched.
 */
export function markLayoutCustom(set: WorkspaceProfileSet): WorkspaceProfileSet {
  return { ...set, active: undefined };
}

// ---------------------------------------------------------------- equality

/** Whether two profiles are the same profile: the same name, the same layout. */
export function workspaceProfileEqual(a: WorkspaceProfile, b: WorkspaceProfile): boolean {
  return (
    profileNameKey(a.name) === profileNameKey(b.name) && shellLayoutEqual(a.layout, b.layout)
  );
}

/** Whether two sets hold the same profiles in the same order, showing the same one. */
export function workspaceProfileSetEqual(
  a: WorkspaceProfileSet,
  b: WorkspaceProfileSet,
): boolean {
  if (a.profiles.length !== b.profiles.length) {
    return false;
  }
  if (!a.profiles.every((profile, index) => workspaceProfileEqual(profile, b.profiles[index]))) {
    return false;
  }
  if (a.active === undefined || b.active === undefined) {
    return a.active === b.active;
  }
  return profileNameKey(a.active) === profileNameKey(b.active);
}

// ------------------------------------------------------ the persistence boundary

/** The written-down form of one profile. */
export interface WorkspaceProfileDocument {
  readonly name: string;
  readonly layout: ShellLayout;
}

/** The written-down form of a whole set of profiles. */
export interface WorkspaceProfileSetDocument {
  readonly version: number;
  readonly profiles: readonly WorkspaceProfileDocument[];
  readonly active: string | undefined;
}

/**
 * Writes one profile down.
 *
 * The result is plain data: the settings file may embed it as it is.
 */
export function serializeProfile(profile: WorkspaceProfile): WorkspaceProfileDocument {
  return {
    name: profile.name,
    layout: { placements: profile.layout.placements.map(copyPlacement) },
  };
}

function copyPlacement(placement: PanelPlacement): PanelPlacement {
  return { panelId: placement.panelId, slot: placement.slot, order: placement.order };
}

/**
 * Reads one profile out of an untrusted value.
 *
 * A value that is not a profile at all, or that has no name the user could
 * have typed, is `null`: the caller drops it rather than inventing an
 * arrangement the user did not save. The layout is read with the shell's own
 * reader, so a slot this build does not have is dropped rather than repaired
 * into a place the user never chose.
 */
export function parseProfile(value: unknown): WorkspaceProfile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as { name?: unknown; layout?: unknown };
  if (typeof record.name !== "string" || !isValidProfileName(record.name)) {
    return null;
  }
  const name = normalizeProfileName(record.name);
  const layout = normalizeShellLayout(record.layout);
  return { name, layout };
}

/**
 * Writes a whole set of profiles down.
 *
 * The version travels with the document so a later build can tell an old
 * document from a new one.
 */
export function serializeProfileSet(set: WorkspaceProfileSet): WorkspaceProfileSetDocument {
  return {
    version: WORKSPACE_PROFILE_VERSION,
    profiles: set.profiles.map(serializeProfile),
    active: set.active,
  };
}

/**
 * Reads a whole set of profiles out of an untrusted value.
 *
 * A value that is not a set at all falls back to the default set, so a
 * corrupt file never stops the shell opening. A set from a *newer* version is
 * refused wholesale rather than half-read, for the same reason the settings
 * file refuses one. A profile that cannot be read is dropped and the others
 * are kept, and an active name that names no profile in the set is dropped
 * with it.
 */
export function parseProfileSet(value: unknown): WorkspaceProfileSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return createWorkspaceProfiles();
  }
  const record = value as {
    version?: unknown;
    profiles?: unknown;
    active?: unknown;
  };
  if (typeof record.version === "number" && record.version > WORKSPACE_PROFILE_VERSION) {
    return createWorkspaceProfiles();
  }
  const raw = Array.isArray(record.profiles) ? record.profiles : [];
  const profiles: WorkspaceProfile[] = [];
  for (const entry of raw) {
    const profile = parseProfile(entry);
    if (profile !== null) {
      profiles.push(profile);
    }
  }
  const shown =
    typeof record.active === "string"
      ? findProfile({ profiles, active: undefined }, record.active)
      : undefined;
  return { profiles, active: shown?.name };
}
