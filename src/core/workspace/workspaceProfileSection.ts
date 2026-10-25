/**
 * The workspace profiles as a section of the settings file.
 *
 * The settings store owns the settings file, so the profiles cannot write a
 * file of their own: they hand their state to the store, which keeps it under
 * the `workspaceProfiles` key and writes it back with everything else. That is
 * the whole persistence contract for the profiles - one key in the settings
 * document, and no second store.
 *
 * The section is **additive**: a settings file written before the profiles
 * existed has no `workspaceProfiles` key, and the profiles then start from
 * their defaults - the default profile, showing it.
 *
 * The value under the key is exactly what `serializeProfileSet` writes and
 * exactly what `parseProfileSet` reads, so the profiles' own persistence
 * boundary stays where it was written down and the settings file only carries
 * it:
 *
 *  - a **missing** key takes the default set;
 *  - a **malformed** value takes the default set, because a value that is not
 *    a set at all says nothing about the profiles;
 *  - a document from a **newer** version is refused wholesale, because its
 *    meaning is unknown rather than merely wrong;
 *  - a **profile** that cannot be read is dropped and the rest of the set is
 *    kept, because one broken profile must not cost the user the others.
 *
 * A profile is **editor state**, not an edit: the section's state says what
 * the window looks like, never what the drawing holds. It adds no history
 * step, dirties nothing and never reaches a project file.
 */

import {
  createSettingsSection,
  type SettingsSection,
  type SettingsSectionSpec,
} from "../settings/settingsSection";
import {
  parseProfileSet,
  serializeProfileSet,
  WORKSPACE_PROFILE_VERSION,
  type WorkspaceProfileSet,
} from "./workspaceProfiles";
import type { WorkspaceProfileStore } from "./workspaceProfileStore";

/** The key the profiles are stored under in the settings document. */
export const WORKSPACE_PROFILE_SECTION_KEY = "workspaceProfiles";

/**
 * How the section's value is shaped.
 *
 * The version is the profiles' own: `WORKSPACE_PROFILE_VERSION` is the
 * version of the profile document, and the section refuses a document from a
 * newer build of it. The codec is the profiles' own persistence boundary, so
 * the two cannot drift apart.
 */
export const WORKSPACE_PROFILE_SECTION_SPEC: SettingsSectionSpec<WorkspaceProfileSet> = {
  key: WORKSPACE_PROFILE_SECTION_KEY,
  version: WORKSPACE_PROFILE_VERSION,
  codec: {
    read: (value) => parseProfileSet(value),
    write: (state) => serializeProfileSet(state),
  },
};

/**
 * The profiles, wired into the settings file.
 *
 * The section is shaped like the settings store's section contract, so it
 * drops straight into the store's `sections` option. The owner is the
 * profile store: the store reads the section out of the file, hands it to the
 * owner, and writes the owner's state back whenever it changes.
 */
export function createWorkspaceProfileSection(
  store: WorkspaceProfileStore,
): SettingsSection<WorkspaceProfileSet> {
  return createSettingsSection(WORKSPACE_PROFILE_SECTION_SPEC, {
    current: () => store.getState(),
    apply: (state) => store.applyProfiles(state),
    subscribe: (listener) => store.subscribe(listener),
  });
}
