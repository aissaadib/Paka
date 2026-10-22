/**
 * The workspace profiles: the ready-made arrangements of the shell.
 *
 * A profile is not a label. It is a complete answer to "what does the window
 * look like": which side panels are up, which shell rows are up, how big the
 * interface is and how dense the brush panel is. Applying one puts the shell
 * into that arrangement - it changes what is on screen, not what is written
 * down about it - and the settings file keeps the arrangement, so the window
 * comes back the way the user left it.
 *
 * Two rules shape the profiles:
 *
 *  1. **A profile touches the whole shell.** It sets the panel layout as well
 *     as the workspace's own rows, because a "compact canvas" that left the
 *     panels up would not be compact. The panel layout belongs to the panel
 *     manager, so the profile computes the layout it wants and hands it
 *     over; it never keeps a second copy of it.
 *  2. **A profile never touches the colour scheme.** The scheme is a
 *     preference the user chose on purpose, so applying a profile leaves it
 *     alone. Restore Defaults is the one action that does change it, and the
 *     user asked for that explicitly.
 *
 * The module is DOM-free and React-free, so the whole "apply a profile, read
 * the layout back" cycle is unit tested without a browser.
 */

import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_VERSION,
  panelLayoutEqual,
  type PanelLayoutState,
} from "../panels/panelLayout";
import { sidePanelDefinitions, type PanelId } from "../panels/panelRegistry";
import {
  workspaceProfileState,
  workspaceProfileStateEqual,
  WORKSPACE_VERSION,
  type WorkspaceProfileId,
  type WorkspaceProfileState,
  type WorkspaceSettings,
} from "./workspaceSettings";

/** A ready-made arrangement of the shell. */
export interface WorkspaceProfile {
  /** The profile's id. Never `custom`: that one is not a preset. */
  readonly id: Exclude<WorkspaceProfileId, "custom">;
  /** The name shown in the menu. */
  readonly label: string;
  /** One line on what the profile is for. */
  readonly description: string;
  /**
   * The side panels the profile shows.
   *
   * `"all"` means every panel the registry knows, so a panel added later is
   * part of the profile without the profile having to be edited. A list means
   * exactly those panels, and every other registered panel is hidden.
   */
  readonly panels: "all" | readonly PanelId[];
  /** The part of the workspace the profile decides. */
  readonly state: WorkspaceProfileState;
}

/** Every profile, in menu order. */
export const WORKSPACE_PROFILES: readonly WorkspaceProfile[] = [
  {
    id: "painting",
    label: "Painting",
    description:
      "Every panel is up, the brush panel shows all of its controls and the interface is at its designed size.",
    panels: "all",
    state: {
      uiScale: 1,
      brushPanel: { advanced: true, presets: true },
      shell: { toolRail: true },
    },
  },
  {
    id: "compact",
    label: "Compact Canvas",
    description:
      "The side panels and the tool rail are hidden and the interface is smaller, so the canvas fills the window.",
    panels: [],
    state: {
      uiScale: 0.9,
      brushPanel: { advanced: false, presets: false },
      shell: { toolRail: false },
    },
  },
];

/** The profile with the given id, or `null` when there is none. */
export function findWorkspaceProfile(id: string): WorkspaceProfile | null {
  return WORKSPACE_PROFILES.find((profile) => profile.id === id) ?? null;
}

/**
 * The panel layout a profile implies.
 *
 * The hidden list is the *side* panels the profile does not show, computed
 * against the registry, so a profile that shows every panel stays "every
 * panel" when a panel is added later, and a profile that shows none hides
 * whatever exists now. The panels that are not in the side column are not the
 * panel manager's business, so the profile leaves them alone.
 */
export function profilePanelLayout(profile: WorkspaceProfile): PanelLayoutState {
  if (profile.panels === "all") {
    return { ...DEFAULT_PANEL_LAYOUT };
  }
  const shown = new Set<PanelId>(profile.panels);
  const hidden = sidePanelDefinitions()
    .filter((definition) => !shown.has(definition.id))
    .map((definition) => definition.id);
  return { version: PANEL_LAYOUT_VERSION, hidden, collapsed: [] };
}

/** The workspace state a profile implies, with the profile's own id on it. */
export function profileWorkspaceSettings(
  profile: WorkspaceProfile,
  theme: WorkspaceSettings["theme"] = "dark",
): WorkspaceSettings {
  return {
    version: WORKSPACE_VERSION,
    profile: profile.id,
    theme,
    uiScale: profile.state.uiScale,
    brushPanel: profile.state.brushPanel,
    shell: profile.state.shell,
  };
}

/**
 * The profile a workspace matches, or `custom`.
 *
 * The answer is computed, never stored: the shell is compared against every
 * profile, and the one it matches is the one it is in. A workspace the user
 * has arranged themselves matches none of them and is honestly called
 * `custom`.
 */
export function resolveWorkspaceProfile(
  settings: WorkspaceSettings,
  layout: PanelLayoutState,
): WorkspaceProfileId {
  for (const profile of WORKSPACE_PROFILES) {
    if (
      workspaceProfileStateEqual(workspaceProfileState(settings), profile.state) &&
      panelLayoutEqual(layout, profilePanelLayout(profile))
    ) {
      return profile.id;
    }
  }
  return "custom";
}
