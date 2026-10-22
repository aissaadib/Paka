/**
 * The brush preset browser's model.
 *
 * The browser is a list of brushes with a search box, an order, a favourites
 * filter and a set of actions. All of that is pure: filtering, sorting,
 * moving the selection and deciding what an action does are ordinary
 * functions over plain data, so they can be exercised in Node without a DOM,
 * a canvas or React.
 *
 * The component in `features/brushes` is an adapter over this module: it
 * holds the little state the browser owns (the query, the order, which brush
 * is selected, which brushes are starred) and calls the editor for the
 * operations that change anything. Nothing here reaches into the engine, so
 * the same rules can be tested against a stub.
 *
 * Two decisions shape the module:
 *
 *  1. **The built-in brushes are an argument.** `bundledPresets.ts` is code
 *     that belongs to another slice, so the list of built-in brushes is
 *     handed to these functions rather than imported. A built-in brush is
 *     protected: it cannot be renamed or deleted, because that would take the
 *     feature away rather than the user's data. Duplicating it is how the
 *     user gets a copy they can change.
 *  2. **A star and a "recently used" note are the browser's own.** They are
 *     not part of a preset - a preset is an id, a name and a brush, and that
 *     model already exists in `presets.ts` - so they live here, keyed by
 *     preset id, and travel with the library file rather than with the
 *     preset.
 */

import { brushSettingsEqual } from "./defaults";
import {
  createPresetId,
  normalizePresetName,
  uniquePresetName,
  type BrushPreset,
} from "./presets";
import type { PresetLibraryEntry } from "./presetTransfer";
import type { BrushSettings } from "../../types/brush";

/** How the browser orders the brushes. */
export type PresetSort = "name" | "recent" | "favorites";

/** The orders the browser offers, in the order it offers them. */
export const PRESET_SORT_OPTIONS: readonly {
  readonly id: PresetSort;
  readonly label: string;
}[] = [
  { id: "name", label: "Name" },
  { id: "recent", label: "Recently used" },
  { id: "favorites", label: "Starred" },
];

/**
 * How many brushes the "recently used" note remembers.
 *
 * A bounded list: the note is a convenience, not a history, and a library
 * that grows without end would make the order slower for no gain.
 */
export const MAX_RECENT_PRESETS = 20;

/**
 * The library the browser shows.
 *
 * The user's own brushes and the built-in ones are kept apart, because they
 * are protected differently.
 */
export interface PresetLibrary {
  /** The brushes the user has saved. */
  readonly presets: readonly BrushPreset[];
  /** The built-in brushes. The browser cannot rename or delete these. */
  readonly bundled: readonly BrushPreset[];
}

/**
 * The state the browser owns.
 *
 * None of it is an edit: it is how the list is looked at, not what is in it.
 */
export interface PresetBrowserState {
  /** The text typed in the search box. */
  readonly query: string;
  /** The order the list is in. */
  readonly sort: PresetSort;
  /** Whether the list is limited to the starred brushes. */
  readonly favoritesOnly: boolean;
  /** The ids of the starred brushes. */
  readonly favorites: readonly string[];
  /** The ids of the brushes used most recently, newest first. */
  readonly recent: readonly string[];
}

/** The state a browser starts with. */
export const DEFAULT_PRESET_BROWSER_STATE: PresetBrowserState = {
  query: "",
  sort: "name",
  favoritesOnly: false,
  favorites: [],
  recent: [],
};

/** The two groups the browser lists: the user's own brushes, then the built-in ones. */
export interface PresetGroups {
  readonly user: readonly BrushPreset[];
  readonly builtin: readonly BrushPreset[];
}

/**
 * Whether a brush is one of the built-in ones.
 *
 * The two lists are separate id spaces - a saved brush gets an id from the
 * editor's counter, a built-in one from wherever it was written - so an id on
 * its own must not be enough: a saved brush that happens to share an id with
 * a built-in one is still the user's own brush, and must stay editable. The
 * name is part of the test, because a built-in brush cannot be renamed, so
 * its name is fixed for as long as it exists.
 */
export function isBundledPreset(
  preset: BrushPreset,
  bundled: readonly BrushPreset[],
): boolean {
  return bundled.some(
    (candidate) => candidate.id === preset.id && candidate.name === preset.name,
  );
}

/** The brush with this id, or `null`. */
export function findPreset(
  library: PresetLibrary,
  id: string | null,
): BrushPreset | null {
  if (id === null) {
    return null;
  }
  return (
    library.presets.find((preset) => preset.id === id) ??
    library.bundled.find((preset) => preset.id === id) ??
    null
  );
}

/**
 * Whether a brush's name matches the search.
 *
 * The comparison ignores case and surrounding whitespace, and matches on any
 * part of the name, so "ink" finds "Soft Ink" and "INK" finds "ink".
 */
export function matchesQuery(preset: BrushPreset, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  return preset.name.toLowerCase().includes(needle);
}

/** Whether a brush is starred. */
export function isFavorite(state: PresetBrowserState, id: string): boolean {
  return state.favorites.includes(id);
}

/**
 * The brushes that pass the search and the favourites filter.
 *
 * The built-in brushes are searched too: a search that matches only a
 * built-in brush should still find it.
 */
export function filterPresets(
  library: PresetLibrary,
  state: PresetBrowserState,
): readonly BrushPreset[] {
  return [...library.presets, ...library.bundled].filter((preset) => {
    if (state.favoritesOnly && !isFavorite(state, preset.id)) {
      return false;
    }
    return matchesQuery(preset, state.query);
  });
}

function byName(a: BrushPreset, b: BrushPreset): number {
  const compared = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (compared !== 0) {
    return compared;
  }
  // Two brushes may share a name; the id keeps the order total, so the list
  // is the same on every machine and in every run.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The order the browser lists brushes in.
 *
 * "recent" puts the brushes that were used most recently first and the ones
 * that were never used last; "favorites" puts the starred ones first. Within
 * an order the name decides, so the list never depends on the order the
 * library happened to be built in.
 */
export function sortPresets(
  presets: readonly BrushPreset[],
  state: PresetBrowserState,
): readonly BrushPreset[] {
  const sorted = [...presets];
  if (state.sort === "recent") {
    const rank = new Map(state.recent.map((id, index) => [id, index]));
    sorted.sort((a, b) => {
      const left = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const right = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) {
        return left - right;
      }
      return byName(a, b);
    });
    return sorted;
  }
  if (state.sort === "favorites") {
    sorted.sort((a, b) => {
      const left = isFavorite(state, a.id) ? 0 : 1;
      const right = isFavorite(state, b.id) ? 0 : 1;
      if (left !== right) {
        return left - right;
      }
      return byName(a, b);
    });
    return sorted;
  }
  sorted.sort(byName);
  return sorted;
}

/**
 * The visible brushes, split into the user's own and the built-in ones.
 *
 * The two groups are ordered independently, so a search that matches only a
 * built-in brush still shows it under "Built-in" rather than hiding it.
 */
export function groupPresets(
  library: PresetLibrary,
  state: PresetBrowserState,
): PresetGroups {
  const visible = sortPresets(filterPresets(library, state), state);
  return {
    user: visible.filter((preset) => !isBundledPreset(preset, library.bundled)),
    builtin: visible.filter((preset) => isBundledPreset(preset, library.bundled)),
  };
}

/** The visible brushes, in the order they are shown. */
export function visiblePresets(
  library: PresetLibrary,
  state: PresetBrowserState,
): readonly BrushPreset[] {
  const groups = groupPresets(library, state);
  return [...groups.user, ...groups.builtin];
}

/**
 * The brush the live brush matches, or `null` when the brush is the user's
 * own.
 *
 * This is what the browser shows as the brush in effect before the user has
 * picked one: the brush the settings file restored, after a restart.
 */
export function presetMatchingBrush(
  library: PresetLibrary,
  brush: BrushSettings,
): BrushPreset | null {
  return (
    [...library.presets, ...library.bundled].find((preset) =>
      brushSettingsEqual(preset.brush, brush),
    ) ?? null
  );
}

/**
 * The next brush the keyboard moves to.
 *
 * The list is flat, so the arrow keys walk it in the order it is shown. The
 * selection never leaves the list: moving past the end stays at the end.
 */
export function nextSelectionId(
  visible: readonly BrushPreset[],
  currentId: string | null,
  direction: 1 | -1,
): string | null {
  if (visible.length === 0) {
    return null;
  }
  if (currentId === null) {
    return direction === 1 ? visible[0].id : visible[visible.length - 1].id;
  }
  const index = visible.findIndex((preset) => preset.id === currentId);
  if (index === -1) {
    return direction === 1 ? visible[0].id : visible[visible.length - 1].id;
  }
  const next = Math.min(Math.max(index + direction, 0), visible.length - 1);
  return visible[next].id;
}

/**
 * A short description of what a brush paints, for the row's tooltip.
 *
 * "14 px, soft, textured" reads faster than the four sliders it came from.
 */
export function describePreset(preset: BrushPreset): string {
  const parts: string[] = [`${Math.round(preset.brush.size)} px`];
  if (preset.brush.stamp) {
    parts.push("stamp");
  }
  if (preset.brush.hardness < 0.5) {
    parts.push("soft");
  } else if (preset.brush.hardness < 1) {
    parts.push("semi-hard");
  }
  if (preset.brush.texture > 0) {
    parts.push("textured");
  }
  if (preset.brush.opacity < 1) {
    parts.push(`${Math.round(preset.brush.opacity * 100)}% opaque`);
  }
  if (preset.brush.stabilizer > 0) {
    parts.push("stabilised");
  }
  return parts.join(", ");
}

/**
 * The brushes that may be renamed or deleted.
 *
 * A built-in brush is code: renaming or deleting it would take the feature
 * away rather than the user's data, so the browser offers "duplicate"
 * instead.
 */
export function canModifyPreset(
  preset: BrushPreset | null,
  bundled: readonly BrushPreset[],
): boolean {
  return preset !== null && !isBundledPreset(preset, bundled);
}

/** Stars a brush, or unstars it when it is already starred. */
export function toggleFavorite(
  state: PresetBrowserState,
  id: string,
): PresetBrowserState {
  const favorites = state.favorites.includes(id)
    ? state.favorites.filter((favorite) => favorite !== id)
    : [...state.favorites, id];
  return { ...state, favorites };
}

/**
 * Notes that a brush was just used.
 *
 * The note is a bounded list of ids, newest first, so the "recently used"
 * order is a pure function of what happened - no clock, no stored timestamps.
 */
export function markPresetUsed(
  state: PresetBrowserState,
  id: string,
): PresetBrowserState {
  const recent = [id, ...state.recent.filter((entry) => entry !== id)].slice(
    0,
    MAX_RECENT_PRESETS,
  );
  return { ...state, recent };
}

/** The brushes an imported file brings in, and the ones it stars. */
export interface PresetImport {
  /** The presets to add to the library. */
  readonly presets: readonly BrushPreset[];
  /** The ids of the presets the file starred. */
  readonly favoriteIds: readonly string[];
}

/**
 * Turns the entries of an imported file into presets for this library.
 *
 * Every entry gets a fresh id, so the same file can be imported twice
 * without the second copy replacing the first, and a name that does not
 * clash with the ones already in the library. The brush is the one the file
 * held, read field by field, so nothing is dropped on the way in.
 */
export function importEntries(
  entries: readonly PresetLibraryEntry[],
  existing: readonly BrushPreset[],
): PresetImport {
  const presets: BrushPreset[] = [];
  const favoriteIds: string[] = [];
  for (const entry of entries) {
    const id = createPresetId();
    presets.push({
      id,
      name: uniquePresetName(entry.name, [...existing, ...presets]),
      brush: { ...entry.brush },
    });
    if (entry.favorite) {
      favoriteIds.push(id);
    }
  }
  return { presets, favoriteIds };
}

/* -------------------------------------------------------------------------- *
 * The actions.
 *
 * The browser's buttons all end up here. Each action is a small intent, the
 * port is what the editor offers, and the result says what happened, so the
 * component can report a refusal ("a built-in brush cannot be deleted")
 * instead of silently doing nothing.
 * ----------------------------------------------------------------------- */

/** What the browser can ask the editor to do. */
export interface PresetLibraryPort {
  /** Saves the live brush under a name; `null` when the name is not usable. */
  save(name: string): BrushPreset | null;
  /** Renames a brush; `null` when the id is unknown or the name is not usable. */
  rename(id: string, name: string): BrushPreset | null;
  /** Duplicates a brush; `null` when the id is unknown. */
  duplicate(id: string): BrushPreset | null;
  /** Deletes a brush; `false` when the id is unknown. */
  remove(id: string): boolean;
  /** Applies a brush to the live brush; `false` when it could not be applied. */
  apply(preset: BrushPreset): boolean;
  /** Adds brushes to the library; the ones that were added. */
  import(presets: readonly BrushPreset[]): readonly BrushPreset[];
}

/** What the browser asks for. */
export type PresetAction =
  | { readonly kind: "save"; readonly name: string }
  | { readonly kind: "rename"; readonly id: string; readonly name: string }
  | { readonly kind: "duplicate"; readonly id: string }
  | { readonly kind: "delete"; readonly id: string }
  | { readonly kind: "apply"; readonly id: string }
  | { readonly kind: "favorite"; readonly id: string }
  | { readonly kind: "import"; readonly entries: readonly PresetLibraryEntry[] };

/** What happened. */
export interface PresetActionResult {
  /** Whether the operation did what it was asked to. */
  readonly ok: boolean;
  /** What to tell the user, or `null` when there is nothing to say. */
  readonly message: string | null;
  /** The brush the browser should select afterwards, or `null` for no change. */
  readonly selection: string | null;
  /** The browser's state after the action, or `null` when it did not change. */
  readonly state: PresetBrowserState | null;
}

/** A result that reports a refusal. */
function refused(message: string): PresetActionResult {
  return { ok: false, message, selection: null, state: null };
}

/** A result that reports success. */
function done(
  message: string | null,
  selection: string | null = null,
  state: PresetBrowserState | null = null,
): PresetActionResult {
  return { ok: true, message, selection, state };
}

/**
 * Runs one browser action.
 *
 * Every button in the browser goes through here, so a button that cannot do
 * what it says says so instead of doing nothing: a built-in brush is
 * protected, an empty name is not a name, and an unknown id is reported.
 *
 * Nothing here touches the document. Applying a brush goes through the
 * editor's normal brush setter, so it adds no history step and dirties
 * nothing.
 */
export function runPresetAction(
  library: PresetLibrary,
  state: PresetBrowserState,
  port: PresetLibraryPort,
  action: PresetAction,
): PresetActionResult {
  switch (action.kind) {
    case "save": {
      const name = normalizePresetName(action.name);
      if (name === "") {
        return refused("A brush needs a name.");
      }
      const preset = port.save(name);
      if (preset === null) {
        return refused("The brush could not be saved.");
      }
      return done(`Saved "${preset.name}".`, preset.id);
    }
    case "rename": {
      const target = findPreset(library, action.id);
      if (target === null) {
        return refused("That brush is no longer in the library.");
      }
      if (isBundledPreset(target, library.bundled)) {
        return refused(`"${target.name}" is a built-in brush - duplicate it to change it.`);
      }
      const name = normalizePresetName(action.name);
      if (name === "") {
        return refused("A brush needs a name.");
      }
      const renamed = port.rename(action.id, name);
      if (renamed === null) {
        return refused("The brush could not be renamed.");
      }
      return done(`Renamed to "${renamed.name}".`, renamed.id);
    }
    case "duplicate": {
      const target = findPreset(library, action.id);
      if (target === null) {
        return refused("That brush is no longer in the library.");
      }
      const copy = port.duplicate(action.id);
      if (copy === null) {
        return refused("The brush could not be duplicated.");
      }
      return done(`Duplicated as "${copy.name}".`, copy.id);
    }
    case "delete": {
      const target = findPreset(library, action.id);
      if (target === null) {
        return refused("That brush is no longer in the library.");
      }
      if (isBundledPreset(target, library.bundled)) {
        return refused(`"${target.name}" is a built-in brush - it cannot be deleted.`);
      }
      if (!port.remove(action.id)) {
        return refused("The brush could not be deleted.");
      }
      return done(`Deleted "${target.name}".`);
    }
    case "apply": {
      const target = findPreset(library, action.id);
      if (target === null) {
        return refused("That brush is no longer in the library.");
      }
      if (!port.apply(target)) {
        return refused("The brush could not be applied.");
      }
      // The brush in effect is now this one, so the "recently used" order
      // moves it to the front.
      return done(null, target.id, markPresetUsed(state, target.id));
    }
    case "favorite": {
      return done(null, action.id, toggleFavorite(state, action.id));
    }
    case "import": {
      const imported = importEntries(action.entries, library.presets);
      if (imported.presets.length === 0) {
        return refused("Nothing was imported.");
      }
      const added = port.import(imported.presets);
      if (added.length === 0) {
        return refused("Nothing was imported.");
      }
      const addedIds = new Set(added.map((preset) => preset.id));
      const favorites = [
        ...state.favorites,
        ...imported.favoriteIds.filter((id) => addedIds.has(id)),
      ];
      return done(
        added.length === 1 ? "Imported 1 brush." : `Imported ${added.length} brushes.`,
        null,
        { ...state, favorites },
      );
    }
  }
}
