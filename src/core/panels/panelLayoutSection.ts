/**
 * The panel layout as a section of the preferences document.
 *
 * The layout is the one piece of shell state that reaches the disk, so it
 * needs a home. This module is that home: a *section* - one value inside the
 * preferences document, with the store that owns it.
 *
 * ## Which document the section is defined against
 *
 * The settings store's own section contract (`src/core/settings/settingsSection.ts`)
 * does not exist in this build yet, so the section is defined against the
 * shell's preferences document (`src/core/shell/preferences.ts`) instead, and
 * it is shaped like the section contract the settings store will use: a
 * `key`, a `read` and a `write` over a document, and the `current` / `apply` /
 * `subscribe` pair that lets the store drive the owner. When the settings
 * section contract lands, this section can be handed to it as it stands.
 *
 * The section is additive: a preferences document written before the panel
 * manager existed has no `panels` key, and the layout then starts from its
 * defaults. A document that has one but was written by a newer build is
 * ignored wholesale, because its meaning is unknown rather than merely wrong.
 *
 * The section does not write a file of its own: the settings store owns the
 * file, and the layout is written back with everything else. That is the whole
 * persistence contract for the panel manager - one key in the preferences
 * document, and no second store.
 */

import type { ShellPreferences } from "../shell/preferences";
import {
  PANEL_LAYOUT_VERSION,
  normalizePanelLayoutState,
  panelLayoutDocument,
  type PanelLayoutSource,
  type PanelLayoutState,
} from "./panelLayout";
import { isPanelId, panelDefinitions } from "./panelRegistry";

/** The key the layout is carried under in the preferences document. */
export const PANEL_LAYOUT_KEY = "panels";

/**
 * The document a section reads and writes.
 *
 * A plain record: the section owns one key in it and touches nothing else.
 */
export type PreferencesDocument = Record<string, unknown>;

/**
 * One value inside the preferences document, with the store that owns it.
 *
 * The shape matches the settings store's section contract, so the settings
 * store can take this section as it stands.
 */
export interface PanelLayoutSection {
  /** The key the value is stored under. */
  readonly key: string;
  /** Reads the value out of a document. */
  read(document: PreferencesDocument): PanelLayoutState;
  /** Writes the value into a document. */
  write(document: PreferencesDocument, state: PanelLayoutState): void;
  /** The value the owner currently holds. */
  current(): PanelLayoutState;
  /** Replaces the owner's value. */
  apply(state: PanelLayoutState): void;
  /** Subscribes to the owner's changes. */
  subscribe(listener: () => void): () => void;
}

/**
 * Reads the layout out of a preferences document.
 *
 * A document with no `panels` key is a document written before the panel
 * manager existed, so the shell's own list of hidden panels is used instead:
 * the panels the user had turned off are still turned off.
 */
export function readPanelLayoutDocument(document: PreferencesDocument): PanelLayoutState {
  const stored = document[PANEL_LAYOUT_KEY];
  if (stored !== undefined) {
    return normalizePanelLayoutState(stored);
  }
  return {
    version: PANEL_LAYOUT_VERSION,
    hidden: knownHiddenIds(document.hiddenPanels),
    collapsed: [],
  };
}

/** Writes the layout into a preferences document. */
export function writePanelLayoutDocument(
  document: PreferencesDocument,
  state: PanelLayoutState,
): void {
  document[PANEL_LAYOUT_KEY] = panelLayoutDocument(state);
}

/**
 * The layout a preferences document's own fields imply.
 *
 * The shell's preferences carry the panels the user hid, but not the panels
 * that are folded to their header, so the folded list starts empty.
 */
export function panelLayoutFromPreferences(preferences: ShellPreferences): PanelLayoutState {
  return {
    version: PANEL_LAYOUT_VERSION,
    hidden: knownHiddenIds(preferences.hiddenPanels),
    collapsed: [],
  };
}

/**
 * The preferences that carry a layout.
 *
 * The shell's own list of hidden panels is updated to the layout's, and the
 * panels the shell hides that the catalogue does not know are kept: the
 * catalogue owns its ids, the shell owns the rest.
 */
export function preferencesWithPanelLayout(
  preferences: ShellPreferences,
  layout: PanelLayoutState,
): ShellPreferences {
  const others = preferences.hiddenPanels.filter((id) => !isPanelId(id));
  return {
    ...preferences,
    hiddenPanels: [...others, ...layout.hidden],
  };
}

/** The catalogued ids of a list of ids, in catalogue order. */
function knownHiddenIds(value: unknown): PanelLayoutState["hidden"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const wanted = new Set(
    value.filter((entry): entry is string => typeof entry === "string" && isPanelId(entry)),
  );
  return panelDefinitions()
    .filter((definition) => wanted.has(definition.id))
    .map((definition) => definition.id);
}

/**
 * The panel layout, wired into the preferences document.
 *
 * `read` is tolerant: a missing key, a malformed value or a document from a
 * newer version all yield the defaults, so a broken layout never stops the
 * editor from starting.
 */
export function createPanelLayoutSection(source: PanelLayoutSource): PanelLayoutSection {
  return {
    key: PANEL_LAYOUT_KEY,
    read: (document) => readPanelLayoutDocument(document),
    write: (document, state) => {
      writePanelLayoutDocument(document, state);
    },
    current: () => source.getState(),
    apply: (state) => source.applyLayout(state),
    subscribe: (listener) => source.subscribe(listener),
  };
}
