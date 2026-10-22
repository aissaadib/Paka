/**
 * The workspace store: the shell's view of how the window is arranged.
 *
 * The store is deliberately separate from the editor. The engine owns the
 * drawing and knows nothing about windows, panels or menus, and the
 * workspace must never reach the document: rearranging the window is not an
 * edit, so it pushes no history entry, bumps no revision and never makes a
 * document dirty.
 *
 * It is separate from the panel store too, but not from it in a rival way: the
 * side panels belong to the panel manager, and the workspace only *computes*
 * a panel layout when a profile is applied and hands it over. The workspace
 * keeps its own rows - the tool rail and the status bar - and the colour
 * scheme, the interface scale and the brush panel's density.
 *
 * The store is framework-free, exactly like the panel store, so the whole
 * "apply a profile, toggle a row, restore the defaults" cycle can be
 * exercised in Node. React reads it through `useSyncExternalStore`.
 */

import {
  DEFAULT_PANEL_LAYOUT,
  type PanelLayoutSource,
} from "../core/panels/panelLayout";
import {
  findWorkspaceProfile,
  profilePanelLayout,
  profileWorkspaceSettings,
  resolveWorkspaceProfile,
} from "../core/workspace/workspaceProfiles";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  normalizeUiScale,
  workspaceSettingsEqual,
  type WorkspaceProfileId,
  type WorkspaceSettings,
  type WorkspaceTheme,
} from "../core/workspace/workspaceSettings";
import type { WorkspaceSettingsSource } from "../core/workspace/workspaceSettingsSection";
import type { Listener } from "../utils/store";

export interface WorkspaceActions {
  /** Chooses the colour scheme. */
  setTheme(theme: WorkspaceTheme): void;
  /** Sets the interface scale, clamped into the range the shell supports. */
  setUiScale(scale: number): void;
  /** Shows or hides the advanced brush controls. */
  setAdvancedBrushControls(advanced: boolean): void;
  /** Shows or hides the brush preset library row. */
  setBrushPresetRow(presets: boolean): void;
  /** Shows or hides the tool rail. */
  setToolRailVisible(visible: boolean): void;
  /**
   * Applies a workspace profile.
   *
   * The profile sets the whole shell - the side panels included - and the
   * colour scheme is left alone.
   */
  applyProfile(id: WorkspaceProfileId): void;
  /**
   * Restores the workspace a fresh installation starts from.
   *
   * This is the one action that also resets the colour scheme, because it
   * means "as if nothing had been changed".
   */
  restoreDefaults(): void;
}

export interface WorkspaceStore extends WorkspaceSettingsSource {
  /** The workspace the shell is showing. */
  getState(): WorkspaceSettings;
  /** Subscribes to workspace changes. */
  subscribe(listener: Listener): () => void;
  /** Replaces the workspace, e.g. with the one read from the settings file. */
  applySettings(settings: WorkspaceSettings): void;
  /** The intents the shell offers. */
  readonly actions: WorkspaceActions;
}

export interface WorkspaceStoreOptions {
  /** The workspace the store starts with. */
  readonly initial?: WorkspaceSettings;
  /**
   * The panel manager's layout.
   *
   * The workspace needs it for two things: applying a profile has to put the
   * side panels into the profile's arrangement, and the profile the menu
   * offers has to be honest about a layout the user changed by hand.
   */
  readonly panels?: PanelLayoutSource;
}

export function createWorkspaceStore(options: WorkspaceStoreOptions = {}): WorkspaceStore {
  const panels = options.panels ?? null;
  let state = options.initial ?? DEFAULT_WORKSPACE_SETTINGS;
  const listeners = new Set<Listener>();
  /** True while the store is applying something, so its own echoes are ignored. */
  let applying = false;

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  /** The profile the current arrangement matches. */
  const currentProfile = (candidate: WorkspaceSettings): WorkspaceProfileId => {
    if (panels === null) {
      return candidate.profile;
    }
    return resolveWorkspaceProfile(candidate, panels.getState());
  };

  /**
   * Replaces the workspace, but only when it really changed.
   *
   * The profile is always recomputed here, so the store can never claim a
   * preset that does not match what is on screen.
   */
  const commit = (next: WorkspaceSettings): void => {
    const resolved: WorkspaceSettings = { ...next, profile: currentProfile(next) };
    if (workspaceSettingsEqual(state, resolved)) {
      return;
    }
    state = resolved;
    notify();
  };

  /** Changes one part of the workspace. */
  const update = (change: (previous: WorkspaceSettings) => WorkspaceSettings): void => {
    commit(change(state));
  };

  const actions: WorkspaceActions = {
    setTheme: (theme) => {
      update((previous) => ({ ...previous, theme }));
    },
    setUiScale: (scale) => {
      update((previous) => ({ ...previous, uiScale: normalizeUiScale(scale, previous.uiScale) }));
    },
    setAdvancedBrushControls: (advanced) => {
      update((previous) => ({
        ...previous,
        brushPanel: { ...previous.brushPanel, advanced },
      }));
    },
    setBrushPresetRow: (presets) => {
      update((previous) => ({
        ...previous,
        brushPanel: { ...previous.brushPanel, presets },
      }));
    },
    setToolRailVisible: (visible) => {
      update((previous) => ({ ...previous, shell: { ...previous.shell, toolRail: visible } }));
    },
    applyProfile: (id) => {
      const profile = findWorkspaceProfile(id);
      if (profile === null) {
        // `custom` is not a preset, so there is nothing to apply.
        return;
      }
      applying = true;
      try {
        panels?.applyLayout(profilePanelLayout(profile));
        commit({
          ...state,
          ...profileWorkspaceSettings(profile, state.theme),
        });
      } finally {
        applying = false;
      }
    },
    restoreDefaults: () => {
      applying = true;
      try {
        panels?.applyLayout(DEFAULT_PANEL_LAYOUT);
        commit({ ...DEFAULT_WORKSPACE_SETTINGS });
      } finally {
        applying = false;
      }
    },
  };

  // The user may rearrange the side panels from the panel manager's own menu,
  // and then the workspace is no longer the profile it claimed to be.
  if (panels !== null) {
    panels.subscribe(() => {
      if (applying) {
        return;
      }
      commit(state);
    });
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applySettings: (settings) => {
      applying = true;
      try {
        commit(settings);
      } finally {
        applying = false;
      }
    },
    actions,
  };
}
