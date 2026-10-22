/**
 * The panel layout as a section of the settings file.
 *
 * The panel layout is **editor state**, not a drawing: which panels are
 * shown, which are folded to their header and where each one is docked say
 * what the window looks like, never what the document holds. Folding a panel
 * adds no history step, dirties nothing and never reaches a project file -
 * the same contract the brush settings have always had.
 *
 * The layout is the one piece of shell state that is written to disk, so it
 * is stored as a small, versioned document with the same reader rules the
 * settings file uses:
 *
 *  - a **missing** field takes its default;
 *  - a **malformed** value takes its default;
 *  - a **field this build does not know** is ignored, so a file written by a
 *    newer build still opens the editor;
 *  - a **panel id this build does not know** is dropped, so a panel that a
 *    later build removed cannot leave a broken entry behind;
 *  - a **slot this build does not know** is dropped, by the shell's own slot
 *    rules.
 *
 * The three panel fields are the shell's own. `hiddenPanels`, `panelOrder`
 * and `panelSlots` are read with {@link normalizeShellPreferences} - the
 * reader the shell's preferences use - so the two cannot drift apart, and a
 * slot this build does not have is dropped by the same rule that drops it
 * from the preferences. The folded panels are the one addition: a panel can
 * be shown and folded at the same time, and the shell's preferences do not
 * say so.
 *
 * The section is additive: a settings file written before the panel manager
 * existed has no `panels` key, and the layout then starts from its defaults.
 * The settings store owns the settings file, so the layout does not write a
 * file of its own - it hands its state to the store, which keeps it under
 * the `panels` key and writes it back with everything else. That is the
 * whole persistence contract for the panel manager: one key in the settings
 * document, and no second store.
 */

import { listPanels } from "../shell/panelRegistry";
import {
  DEFAULT_SHELL_PREFERENCES,
  normalizeShellPreferences,
} from "../shell/preferences";
import type { ShellPreferences } from "../shell/preferences";
import type { ShellSlotId } from "../shell/slots";
import { asRecord } from "../../utils/record";

/** The key the layout is stored under in the settings document. */
export const PANEL_LAYOUT_KEY = "panels";

/**
 * The version of the layout document this build reads and writes.
 *
 * The section is versioned on its own, so a layout can be read without
 * knowing the rest of the settings format.
 */
export const PANEL_LAYOUT_SECTION_VERSION = 1;

/**
 * The persisted panel layout.
 *
 * The three panel fields are the shell's own - the same names and the same
 * types as {@link ShellPreferences} carries them - so the layout can be
 * handed to the shell without a translation. `foldedPanels` is the one field
 * the shell's preferences do not have.
 */
export type PersistedPanelLayout = Pick<
  ShellPreferences,
  "hiddenPanels" | "panelOrder" | "panelSlots"
> & {
  /** The layout-document version. Always {@link PANEL_LAYOUT_SECTION_VERSION}. */
  readonly version: typeof PANEL_LAYOUT_SECTION_VERSION;
  /** The panels that are folded to their header. */
  readonly foldedPanels: readonly string[];
};

/** The layout a fresh installation starts from. */
export const DEFAULT_PERSISTED_PANEL_LAYOUT: PersistedPanelLayout = Object.freeze({
  version: PANEL_LAYOUT_SECTION_VERSION,
  hiddenPanels: DEFAULT_SHELL_PREFERENCES.hiddenPanels,
  panelOrder: DEFAULT_SHELL_PREFERENCES.panelOrder,
  panelSlots: DEFAULT_SHELL_PREFERENCES.panelSlots,
  foldedPanels: Object.freeze([]) as readonly string[],
});

/**
 * How the reader decides which panel ids this build knows.
 *
 * The shell's registry is the default, because the registry is the one list
 * of panels the shell has. A caller that knows better - the panel manager's
 * own adapter, or a test - can pass the ids explicitly.
 */
export interface PanelLayoutReadOptions {
  /**
   * The panel ids this build knows.
   *
   * An id that is not in the list is dropped rather than kept as a broken
   * entry. An empty list means "this build knows no panels", so every id is
   * dropped.
   */
  readonly knownPanelIds?: readonly string[];
}

/**
 * The panel part of a shell preferences document.
 *
 * The shell holds the whole preferences document; the layout is the part of
 * it that says which panels are shown and where they are docked, plus the
 * folded panels, which the preferences do not carry.
 */
export function persistedPanelLayoutOf(
  preferences: ShellPreferences,
  foldedPanels: readonly string[] = [],
): PersistedPanelLayout {
  return {
    version: PANEL_LAYOUT_SECTION_VERSION,
    hiddenPanels: preferences.hiddenPanels,
    panelOrder: preferences.panelOrder,
    panelSlots: preferences.panelSlots,
    foldedPanels,
  };
}

/**
 * The shell preferences with the panel layout put back in.
 *
 * The inverse of {@link persistedPanelLayoutOf}: the shell reads its
 * preferences, the layout section persists the panel part of them, and this
 * puts the panel part back after a restart.
 */
export function applyPersistedPanelLayout(
  preferences: ShellPreferences,
  layout: PersistedPanelLayout,
): ShellPreferences {
  return {
    ...preferences,
    hiddenPanels: layout.hiddenPanels,
    panelOrder: layout.panelOrder,
    panelSlots: layout.panelSlots,
  };
}

/**
 * Turns whatever was in the file into a usable layout.
 *
 * Never throws and never rejects: a value it cannot make sense of takes its
 * default. A document from a newer build is read for the fields it shares
 * rather than thrown away, because every field here is read defensively -
 * an unknown field is ignored, an unknown panel id is dropped and an unknown
 * slot is dropped - so nothing in it can be *wrong*, only unknown.
 */
export function normalizePersistedPanelLayout(
  value: unknown,
  options?: PanelLayoutReadOptions,
): PersistedPanelLayout {
  const preferences = normalizeShellPreferences(value);
  const known = resolveKnownPanelIds(options);
  const record = asRecord(value);
  return {
    version: PANEL_LAYOUT_SECTION_VERSION,
    hiddenPanels: keepKnownIds(preferences.hiddenPanels, known),
    panelOrder: keepKnownIds(preferences.panelOrder, known),
    panelSlots: keepKnownSlots(preferences.panelSlots, known),
    foldedPanels: keepKnownIds(readIdList(record?.foldedPanels), known),
  };
}

/**
 * Parses a layout document.
 *
 * `null` - nothing stored yet - and a document that is not valid JSON both
 * yield the defaults: a broken layout must not stop the editor from
 * starting.
 */
export function parsePersistedPanelLayout(
  text: string | null,
  options?: PanelLayoutReadOptions,
): PersistedPanelLayout {
  if (text === null) {
    return DEFAULT_PERSISTED_PANEL_LAYOUT;
  }
  try {
    return normalizePersistedPanelLayout(JSON.parse(text) as unknown, options);
  } catch {
    return DEFAULT_PERSISTED_PANEL_LAYOUT;
  }
}

/** The plain object a layout is written as. */
export function persistedPanelLayoutDocument(
  layout: PersistedPanelLayout,
): Record<string, unknown> {
  return {
    version: PANEL_LAYOUT_SECTION_VERSION,
    hiddenPanels: [...layout.hiddenPanels],
    panelOrder: [...layout.panelOrder],
    panelSlots: { ...layout.panelSlots },
    foldedPanels: [...layout.foldedPanels],
  };
}

/** Serializes a layout, with a stable key order. */
export function serializePersistedPanelLayout(layout: PersistedPanelLayout): string {
  return `${JSON.stringify(persistedPanelLayoutDocument(layout), null, 2)}\n`;
}

/** Field-wise comparison, so an unchanged layout is never written again. */
export function persistedPanelLayoutEqual(
  a: PersistedPanelLayout,
  b: PersistedPanelLayout,
): boolean {
  if (
    a.version !== b.version ||
    a.hiddenPanels.length !== b.hiddenPanels.length ||
    a.panelOrder.length !== b.panelOrder.length ||
    a.foldedPanels.length !== b.foldedPanels.length
  ) {
    return false;
  }
  if (!a.hiddenPanels.every((id, index) => b.hiddenPanels[index] === id)) {
    return false;
  }
  if (!a.panelOrder.every((id, index) => b.panelOrder[index] === id)) {
    return false;
  }
  if (!a.foldedPanels.every((id, index) => b.foldedPanels[index] === id)) {
    return false;
  }
  const slotIds = new Set([...Object.keys(a.panelSlots), ...Object.keys(b.panelSlots)]);
  for (const panelId of slotIds) {
    if (a.panelSlots[panelId] !== b.panelSlots[panelId]) {
      return false;
    }
  }
  return true;
}

/**
 * The port the layout's owner implements.
 *
 * The settings store owns the settings file, so the layout cannot write to
 * it directly without two writers racing for the same document. The owner
 * holds the live layout and this is the hand-off: the store reads the
 * section out of the file, gives it to the owner, and writes the owner's
 * state back into the document whenever it changes.
 */
export interface PanelLayoutSectionSource {
  /** The layout the owner currently holds. */
  getState(): PersistedPanelLayout;
  /** Subscribes to the owner's changes. */
  subscribe(listener: () => void): () => void;
  /** Hands the owner the layout that was read from the file. */
  applyLayout(layout: PersistedPanelLayout): void;
}

/**
 * The section, shaped like the settings store's section contract.
 *
 * The members are the ones the store needs: the key the state is stored
 * under, how to read it out of a settings document, how to write it back,
 * and how to be told that the owner's state changed.
 */
export interface PanelLayoutSection {
  /** The key the section's state is stored under in the settings document. */
  readonly key: string;
  /** The version of the layout document the section reads and writes. */
  readonly version: typeof PANEL_LAYOUT_SECTION_VERSION;
  /** Reads the section's state out of a settings document. */
  read(document: Record<string, unknown>): PersistedPanelLayout;
  /** Writes the section's state into a settings document. */
  write(document: Record<string, unknown>, layout: PersistedPanelLayout): void;
  /** The state the section's owner currently holds. */
  current(): PersistedPanelLayout;
  /** Hands the owner the state that was read from the file. */
  apply(layout: PersistedPanelLayout): void;
  /** Subscribes to the owner's changes. */
  subscribe(listener: () => void): () => void;
}

/**
 * The panel layout, wired into the settings file.
 *
 * `read` is tolerant: a missing key, a malformed value or a document from a
 * newer version all yield a usable layout, so a broken layout never stops
 * the editor from starting.
 *
 * `write` touches its own key and nothing else. The settings document holds
 * the other preferences too, and the panel layout is not allowed to disturb
 * them.
 */
export function createPanelLayoutSection(
  source: PanelLayoutSectionSource,
  options?: PanelLayoutReadOptions,
): PanelLayoutSection {
  return {
    key: PANEL_LAYOUT_KEY,
    version: PANEL_LAYOUT_SECTION_VERSION,
    read: (document) => {
      // The store hands the section the whole settings document, and the
      // section takes its own key out of it. A store that hands the section
      // its own value instead is read too: the layout document is then the
      // value itself.
      const raw = PANEL_LAYOUT_KEY in document ? document[PANEL_LAYOUT_KEY] : document;
      return normalizePersistedPanelLayout(raw, options);
    },
    write: (document, layout) => {
      document[PANEL_LAYOUT_KEY] = persistedPanelLayoutDocument(layout);
    },
    current: () => source.getState(),
    apply: (layout) => source.applyLayout(layout),
    subscribe: (listener) => source.subscribe(listener),
  };
}

/**
 * The panel ids this build knows.
 *
 * `null` means "cannot tell": nothing has registered itself yet, which
 * happens in a test and in the moment before the shell's panels have
 * registered. Dropping every id then would throw the user's layout away
 * over a registration order, so the ids are kept as they are and only the
 * broken ones - blanks, duplicates - are dropped.
 */
function resolveKnownPanelIds(
  options?: PanelLayoutReadOptions,
): ReadonlySet<string> | null {
  if (options?.knownPanelIds !== undefined) {
    return new Set(options.knownPanelIds);
  }
  const registered = listPanels().map((panel) => panel.id);
  if (registered.length === 0) {
    return null;
  }
  return new Set(registered);
}

/**
 * A list of panel ids, read with the shell preferences' own list rules.
 *
 * The rules - drop blanks, drop non-strings, drop duplicates, keep the
 * order - belong to the shared reader, so the folded list is read through it
 * and the two cannot drift apart.
 */
function readIdList(value: unknown): readonly string[] {
  return normalizeShellPreferences({ hiddenPanels: value }).hiddenPanels;
}

/** The ids this build knows, in the order they were read. */
function keepKnownIds(
  ids: readonly string[],
  known: ReadonlySet<string> | null,
): readonly string[] {
  if (known === null) {
    return [...ids];
  }
  return ids.filter((id) => known.has(id));
}

/** The slots of the panels this build knows. */
function keepKnownSlots(
  slots: Readonly<Record<string, ShellSlotId>>,
  known: ReadonlySet<string> | null,
): Record<string, ShellSlotId> {
  const result: Record<string, ShellSlotId> = {};
  for (const [panelId, slot] of Object.entries(slots)) {
    if (known === null || known.has(panelId)) {
      result[panelId] = slot;
    }
  }
  return result;
}
