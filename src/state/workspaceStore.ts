/**
 * The workspace store: the shell's live view of how the window is arranged.
 *
 * The store is deliberately separate from the editor. The engine owns the
 * drawing and knows nothing about windows, panels or menus, and the
 * workspace must never reach the document: rearranging the window is not an
 * edit, so it pushes no history entry, bumps no revision and never makes a
 * document dirty.
 *
 * It is framework-free, exactly like the panel store, so the whole "hide a
 * part, resize the column, restore the defaults" cycle can be exercised in
 * Node. React reads it through `useSyncExternalStore`.
 *
 * The store composes three things, and owns only the first:
 *
 *  - the **parts** - the shell's own rows - which it owns and persists;
 *  - the **preferences** - which panels are shown, where they are docked -
 *    which the shell's preferences document owns, and which the store reads;
 *  - the **panels** - which come from the registry, and which the store
 *    reads as well.
 *
 * The preferences are read through a port, so the panel manager can hand the
 * store its own preferences instead of the two of them each keeping a copy.
 */

import { listPanels, type PanelDefinition } from "../core/shell/panelRegistry";
import {
  DEFAULT_SHELL_PREFERENCES,
  shellPreferencesEqual,
  type ShellPreferences,
} from "../core/shell/preferences";
import {
  composeWorkspace,
  DEFAULT_WORKSPACE_SETTINGS,
  setWorkspacePartOrder,
  setWorkspacePartShown,
  setWorkspacePartSize,
  workspaceSettingsEqual,
  type WorkspaceComposition,
  type WorkspacePartId,
  type WorkspacePartSize,
  type WorkspaceSettings,
} from "../core/workspace/workspaceSettings";
import type { WorkspaceSettingsSource } from "../core/workspace/workspaceSettingsSection";
import type { Listener } from "../utils/store";

/**
 * Where the shell preferences come from.
 *
 * The port is read-only as far as the composition is concerned: the store
 * asks for the preferences and is told when they change. Whoever owns the
 * preferences decides what they say.
 */
export interface WorkspacePreferencesSource {
  /** The preferences the composition is built from. */
  getPreferences(): ShellPreferences;
  /** Subscribes to the preferences' changes. */
  subscribe(listener: () => void): () => void;
}

/** A preferences source the store keeps for itself. */
export interface MutableWorkspacePreferencesSource extends WorkspacePreferencesSource {
  /** Replaces the preferences and tells the listeners. */
  setPreferences(preferences: ShellPreferences): void;
}

/**
 * The preferences a store keeps when nobody else owns them.
 *
 * They start at the shell's defaults - nothing hidden, the registry's order -
 * and can be replaced wholesale.
 */
export function createWorkspacePreferencesSource(
  initial: ShellPreferences = DEFAULT_SHELL_PREFERENCES,
): MutableWorkspacePreferencesSource {
  let preferences = initial;
  const listeners = new Set<Listener>();
  return {
    getPreferences: () => preferences,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPreferences: (next) => {
      if (shellPreferencesEqual(preferences, next)) {
        return;
      }
      preferences = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/** The intents the shell offers for the workspace. */
export interface WorkspaceActions {
  /** Shows or hides one of the shell's parts. */
  setPartShown(id: WorkspacePartId, shown: boolean): void;
  /** Moves a part inside its region. */
  setPartOrder(id: WorkspacePartId, order: number): void;
  /** Sets how big a part is. The size is clamped into the part's range. */
  setPartSize(id: WorkspacePartId, size: WorkspacePartSize): void;
  /** Restores the parts a fresh installation starts from. */
  restoreDefaults(): void;
}

export interface WorkspaceStore extends WorkspaceSettingsSource {
  /** The workspace the shell is showing. */
  getState(): WorkspaceSettings;
  /** Subscribes to workspace changes. */
  subscribe(listener: Listener): () => void;
  /** Replaces the workspace, e.g. with the one read from the settings file. */
  applySettings(settings: WorkspaceSettings): void;
  /**
   * The composition: the parts, the panels and where the panels are docked.
   *
   * The same object is returned until something changes, so React can rely
   * on its identity.
   */
  getComposition(): WorkspaceComposition;
  /** The shell preferences the composition is built from. */
  getPreferences(): ShellPreferences;
  /** The intents the shell offers. */
  readonly actions: WorkspaceActions;
}

export interface WorkspaceStoreOptions {
  /** The workspace the store starts with. */
  readonly initial?: WorkspaceSettings;
  /**
   * Where the shell preferences come from.
   *
   * The store keeps its own when none is given, so the shell works before
   * anything else has been wired up.
   */
  readonly preferences?: WorkspacePreferencesSource;
  /** The registered panels. Defaults to the shell's own registry. */
  readonly panels?: () => readonly PanelDefinition[];
}

/** A signature of the panel list, so a new list is noticed. */
function panelSignature(panels: readonly PanelDefinition[]): string {
  return panels.map((panel) => `${panel.id}:${panel.slot}:${panel.order}`).join("|");
}

export function createWorkspaceStore(
  options: WorkspaceStoreOptions = {},
): WorkspaceStore {
  const preferencesSource = options.preferences ?? createWorkspacePreferencesSource();
  const listRegisteredPanels = options.panels ?? listPanels;

  let settings = options.initial ?? DEFAULT_WORKSPACE_SETTINGS;
  let preferences = preferencesSource.getPreferences();
  let composition: WorkspaceComposition | null = null;
  let signature = "";

  const listeners = new Set<Listener>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  /** Replaces the workspace, but only when it really changed. */
  const commit = (next: WorkspaceSettings): void => {
    if (workspaceSettingsEqual(settings, next)) {
      return;
    }
    settings = next;
    composition = null;
    notify();
  };

  /** The composition, rebuilt only when something it depends on changed. */
  const currentComposition = (): WorkspaceComposition => {
    const next = preferencesSource.getPreferences();
    if (!shellPreferencesEqual(preferences, next)) {
      preferences = next;
      composition = null;
    }
    const panels = listRegisteredPanels();
    const nextSignature = panelSignature(panels);
    if (composition !== null && nextSignature === signature) {
      return composition;
    }
    signature = nextSignature;
    composition = composeWorkspace(settings, preferences, panels);
    return composition;
  };

  const actions: WorkspaceActions = {
    setPartShown: (id, shown) => {
      commit(setWorkspacePartShown(settings, id, shown));
    },
    setPartOrder: (id, order) => {
      commit(setWorkspacePartOrder(settings, id, order));
    },
    setPartSize: (id, size) => {
      commit(setWorkspacePartSize(settings, id, size));
    },
    restoreDefaults: () => {
      commit(DEFAULT_WORKSPACE_SETTINGS);
    },
  };

  // The preferences are somebody else's state, so the store watches them and
  // rebuilds the composition when they change.
  preferencesSource.subscribe(() => {
    composition = null;
    notify();
  });

  return {
    getState: () => settings,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applySettings: (next) => {
      commit(next);
    },
    getComposition: currentComposition,
    getPreferences: () => preferencesSource.getPreferences(),
    actions,
  };
}
