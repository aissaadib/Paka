/**
 * The panel layout: which panels are hidden, and which are folded to their
 * header.
 *
 * The layout is **shell state**, not document state. It says what the window
 * looks like, never what the drawing contains: showing or hiding a panel
 * pushes no history entry, bumps no revision and never makes a document
 * dirty. It is the same contract the brush settings have always had.
 *
 * The layout is also the one piece of shell state that is written to disk, so
 * it is stored as a small, versioned document with the same reader rules the
 * settings file uses:
 *
 *  - a **missing** field takes its default;
 *  - a **malformed** value takes its default;
 *  - an **id the registry does not know** is dropped, so a panel that a later
 *    build removed cannot break an old file;
 *  - a document from a **newer version** is ignored wholesale, because its
 *    meaning is unknown rather than merely wrong.
 *
 * Every function here is pure: the same input always gives the same output,
 * which is what makes the layout testable without a browser.
 */

import { sidePanelDefinitions, type PanelDefinition, type PanelId } from "./panelRegistry";

/** The version of the layout document this build reads and writes. */
export const PANEL_LAYOUT_VERSION = 1;

/**
 * The layout of the side panels.
 *
 * Both lists hold registered panel ids only. A panel that is hidden keeps
 * its collapsed state, so hiding a folded panel and showing it again brings
 * back the panel the user left it in.
 */
export interface PanelLayoutState {
  /** The layout-document version. Always {@link PANEL_LAYOUT_VERSION} after loading. */
  readonly version: number;
  /** The panels the user has turned off. */
  readonly hidden: readonly PanelId[];
  /** The panels that are folded to their header. */
  readonly collapsed: readonly PanelId[];
}

/** The layout a fresh installation starts from. */
export const DEFAULT_PANEL_LAYOUT: PanelLayoutState = {
  version: PANEL_LAYOUT_VERSION,
  hidden: [],
  collapsed: [],
};

/** The port a layout owner implements, so the shell can read and drive it. */
export interface PanelLayoutSource {
  /** The layout the owner currently holds. */
  getState(): PanelLayoutState;
  /** Subscribes to the owner's changes. */
  subscribe(listener: () => void): () => void;
  /** Replaces the owner's layout, e.g. with the one read from disk. */
  applyLayout(layout: PanelLayoutState): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The known panel ids of a list, in registry order and without duplicates.
 *
 * Unknown ids are dropped: they name panels this build does not have, and
 * keeping them would grow the file every time a panel was removed.
 */
function knownPanelIds(value: unknown): PanelId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const wanted = new Set(value.filter((entry): entry is string => typeof entry === "string"));
  return sidePanelDefinitions()
    .filter((definition) => wanted.has(definition.id))
    .map((definition) => definition.id);
}

/**
 * Turns whatever was in the file into a usable layout.
 *
 * Never throws and never rejects: a value it cannot make sense of takes its
 * default, and a document from a newer version is ignored entirely.
 */
export function normalizePanelLayoutState(value: unknown): PanelLayoutState {
  if (!isRecord(value)) {
    return DEFAULT_PANEL_LAYOUT;
  }

  const version = value.version;
  if (
    typeof version === "number" &&
    Number.isFinite(version) &&
    version > PANEL_LAYOUT_VERSION
  ) {
    // Written by a newer Paka. Its meaning is unknown rather than wrong, so
    // the whole document is ignored and the defaults are used.
    return DEFAULT_PANEL_LAYOUT;
  }

  return {
    version: PANEL_LAYOUT_VERSION,
    hidden: knownPanelIds(value.hidden),
    collapsed: knownPanelIds(value.collapsed),
  };
}

/**
 * Parses a layout document.
 *
 * `null` - nothing stored yet - and a document that is not valid JSON both
 * yield the defaults: a broken layout must not stop the editor from starting.
 */
export function parsePanelLayoutState(text: string | null): PanelLayoutState {
  if (text === null) {
    return DEFAULT_PANEL_LAYOUT;
  }
  try {
    return normalizePanelLayoutState(JSON.parse(text));
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
}

/** The plain object a layout is written as. */
export function panelLayoutDocument(state: PanelLayoutState): Record<string, unknown> {
  return {
    version: PANEL_LAYOUT_VERSION,
    hidden: [...state.hidden],
    collapsed: [...state.collapsed],
  };
}

/** Serializes a layout, with a stable key order. */
export function serializePanelLayoutState(state: PanelLayoutState): string {
  return `${JSON.stringify(panelLayoutDocument(state), null, 2)}\n`;
}

/** Whether the panel is shown. */
export function isPanelVisible(state: PanelLayoutState, id: PanelId): boolean {
  return !state.hidden.includes(id);
}

/** Whether the panel is folded to its header. */
export function isPanelCollapsed(state: PanelLayoutState, id: PanelId): boolean {
  return state.collapsed.includes(id);
}

/** The panels that are shown, in stack order. */
export function visiblePanelIds(state: PanelLayoutState): PanelId[] {
  return sidePanelDefinitions()
    .filter((definition) => isPanelVisible(state, definition.id))
    .map((definition) => definition.id);
}

/**
 * Whether the panel is mounted.
 *
 * A panel that is mounted always stays mounted, hidden or not, so it cannot
 * lose React state of its own. A panel that is mounted only while it is
 * visible is derived from the document, so unmounting it costs nothing and
 * keeps no state.
 */
export function shouldMountPanel(
  definition: PanelDefinition,
  state: PanelLayoutState,
): boolean {
  return definition.mounting === "always" || isPanelVisible(state, definition.id);
}

/** Shows or hides one panel. */
export function setPanelVisibility(
  state: PanelLayoutState,
  id: PanelId,
  visible: boolean,
): PanelLayoutState {
  const isHidden = state.hidden.includes(id);
  if (visible === !isHidden) {
    return state;
  }
  return {
    ...state,
    hidden: visible
      ? state.hidden.filter((entry) => entry !== id)
      : [...state.hidden, id],
  };
}

/** Shows or hides one panel, whichever it is now. */
export function togglePanelVisibility(state: PanelLayoutState, id: PanelId): PanelLayoutState {
  return setPanelVisibility(state, id, !isPanelVisible(state, id));
}

/** Folds or unfolds one panel. */
export function setPanelCollapsed(
  state: PanelLayoutState,
  id: PanelId,
  collapsed: boolean,
): PanelLayoutState {
  const isCollapsed = state.collapsed.includes(id);
  if (collapsed === isCollapsed) {
    return state;
  }
  return {
    ...state,
    collapsed: collapsed
      ? [...state.collapsed, id]
      : state.collapsed.filter((entry) => entry !== id),
  };
}

/** Shows every registered panel. The folded ones stay folded. */
export function showAllPanels(state: PanelLayoutState): PanelLayoutState {
  if (state.hidden.length === 0) {
    return state;
  }
  return { ...state, hidden: [] };
}

/** Hides every registered panel, so the canvas takes the whole window. */
export function hideAllPanels(state: PanelLayoutState): PanelLayoutState {
  const hidden = sidePanelDefinitions().map((definition) => definition.id);
  if (
    hidden.length === state.hidden.length &&
    hidden.every((entry, index) => entry === state.hidden[index])
  ) {
    return state;
  }
  return { ...state, hidden };
}

/** The layout a fresh installation starts from. */
export function resetPanelLayout(): PanelLayoutState {
  return DEFAULT_PANEL_LAYOUT;
}

/** Whether the layout is the one a fresh installation starts from. */
export function isDefaultPanelLayout(state: PanelLayoutState): boolean {
  return panelLayoutEqual(state, DEFAULT_PANEL_LAYOUT);
}

/** Field-wise comparison, so an unchanged layout is never written again. */
export function panelLayoutEqual(a: PanelLayoutState, b: PanelLayoutState): boolean {
  return (
    a.version === b.version &&
    a.hidden.length === b.hidden.length &&
    a.hidden.every((entry, index) => entry === b.hidden[index]) &&
    a.collapsed.length === b.collapsed.length &&
    a.collapsed.every((entry, index) => entry === b.collapsed[index])
  );
}
