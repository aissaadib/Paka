/**
 * The workspace preferences as a section of the settings file.
 *
 * The settings store owns the settings file, so the workspace does not write
 * a file of its own: it hands its state to the store, which keeps it under
 * the `workspace` key and writes it back with everything else. That is the
 * whole persistence contract for the workspace - one key in the settings
 * document, and no second store.
 *
 * The section is additive: a settings file written before the workspace
 * existed has no `workspace` key, and the workspace then starts from its
 * defaults.
 *
 * The side panels are **not** in this section. They belong to the panel
 * manager, which keeps them under the `panels` key; the workspace profile
 * computes the layout it wants and hands it over, but it does not keep a
 * second copy of it.
 */

import type { SettingsSection } from "../settings/settingsSection";
import {
  normalizeWorkspaceSettings,
  workspaceSettingsDocument,
  type WorkspaceSettings,
} from "./workspaceSettings";

/** The key the workspace is stored under in the settings document. */
export const WORKSPACE_SETTINGS_KEY = "workspace";

/** The port the workspace owner implements, so the shell can read and drive it. */
export interface WorkspaceSettingsSource {
  /** The workspace the owner currently holds. */
  getState(): WorkspaceSettings;
  /** Subscribes to the owner's changes. */
  subscribe(listener: () => void): () => void;
  /** Replaces the owner's workspace, e.g. with the one read from the file. */
  applySettings(settings: WorkspaceSettings): void;
}

/**
 * The workspace, wired into the settings file.
 *
 * `read` is tolerant: a missing key, a malformed value or a document from a
 * newer version all yield the defaults, so a broken workspace never stops
 * the editor from starting.
 */
export function createWorkspaceSettingsSection(
  source: WorkspaceSettingsSource,
): SettingsSection<WorkspaceSettings> {
  return {
    key: WORKSPACE_SETTINGS_KEY,
    read: (document) => normalizeWorkspaceSettings(document[WORKSPACE_SETTINGS_KEY]),
    write: (document, state) => {
      document[WORKSPACE_SETTINGS_KEY] = workspaceSettingsDocument(state);
    },
    current: () => source.getState(),
    apply: (state) => source.applySettings(state),
    subscribe: (listener) => source.subscribe(listener),
  };
}
