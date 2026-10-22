/**
 * The brush preset browser's model.
 *
 * The browser is a list of presets with a search box, a sort order and a set
 * of actions. All of that is pure: filtering, sorting, moving the selection
 * and deciding what an action does are ordinary functions over plain data, so
 * they can be exercised in Node without a DOM, a canvas or React.
 *
 * The component in `features/brushes` is an adapter over this module: it holds
 * the little state the browser owns (the query, the sort order, which preset
 * is selected) and calls the editor for the operations that change anything.
 * Nothing here reaches into the engine, so the same rules can be tested
 * against a stub.
 */

import { brushSettingsEqual } from "./defaults";
import {
  MAX_PRESET_NAME_LENGTH,
  isBundledPreset,
  normalizePresetName,
  type BrushPreset,
} from "./presets";
import type { BrushSettings } from "../../types/brush";

/** How the browser orders the presets. */
export type PresetSort = "name" | "recent" | "size";

/** The sort orders the browser offers, in the order it offers them. */
export const PRESET_SORT_OPTIONS: readonly { readonly id: PresetSort; readonly label: string }[] = [
  { id: "name", label: "Name" },
  { id: "recent", label: "Recently used" },
  { id: "size", label: "Size" },
];

/** What the browser shows: a search, an order and a favourites-only filter. */
export interface PresetFilter {
  /** The text typed in the search box. */
  readonly query: string;
  /** The order the list is in. */
  readonly sort: PresetSort;
  /** Whether the list is limited to the starred presets. */
  readonly favoritesOnly: boolean;
}

/** The filter a browser starts with. */
export const DEFAULT_PRESET_FILTER: PresetFilter = {
  query: "",
  sort: "name",
  favoritesOnly: false,
};

/** The two groups the browser lists: the user's own brushes, then the built-in ones. */
export interface PresetGroups {
  readonly user: readonly BrushPreset[];
  readonly builtin: readonly BrushPreset[];
}

/**
 * Whether a preset's name matches the search.
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

/** The presets that pass the search and the favourites filter. */
export function filterPresets(
  presets: readonly BrushPreset[],
  filter: PresetFilter,
): readonly BrushPreset[] {
  return presets.filter((preset) => {
    if (filter.favoritesOnly && !preset.favorite) {
      return false;
    }
    return matchesQuery(preset, filter.query);
  });
}

function byName(a: BrushPreset, b: BrushPreset): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * The order the browser lists presets in.
 *
 * "recent" puts the presets that were used most recently first and the ones
 * that were never used last; "size" orders them by the width they paint, so
 * a list of brushes reads from fine to broad.
 */
export function sortPresets(
  presets: readonly BrushPreset[],
  sort: PresetSort,
): readonly BrushPreset[] {
  const sorted = [...presets];
  if (sort === "size") {
    sorted.sort((a, b) => a.brush.size - b.brush.size || byName(a, b));
    return sorted;
  }
  if (sort === "recent") {
    sorted.sort((a, b) => {
      const left = a.lastUsedAt ?? -1;
      const right = b.lastUsedAt ?? -1;
      if (left !== right) {
        return right - left;
      }
      return byName(a, b);
    });
    return sorted;
  }
  sorted.sort(byName);
  return sorted;
}

/** The presets the browser shows, filtered and ordered. */
export function visiblePresets(
  presets: readonly BrushPreset[],
  filter: PresetFilter,
): readonly BrushPreset[] {
  return sortPresets(filterPresets(presets, filter), filter.sort);
}

/**
 * The visible presets, split into the user's own and the built-in ones.
 *
 * The two groups are ordered independently, so a search that matches only a
 * built-in brush still shows it under "Built-in" rather than hiding it.
 */
export function groupPresets(
  presets: readonly BrushPreset[],
  filter: PresetFilter,
): PresetGroups {
  const visible = visiblePresets(presets, filter);
  return {
    user: visible.filter((preset) => !isBundledPreset(preset)),
    builtin: visible.filter((preset) => isBundledPreset(preset)),
  };
}

/** The preset with this id, or `null`. */
export function findPreset(
  presets: readonly BrushPreset[],
  id: string | null,
): BrushPreset | null {
  if (id === null) {
    return null;
  }
  return presets.find((preset) => preset.id === id) ?? null;
}

/**
 * The preset the live brush matches, or `null` when the brush is the user's
 * own.
 *
 * This is what the browser shows as the active preset before the user has
 * picked one: the brush the settings file restored, after a restart.
 */
export function presetMatchingBrush(
  presets: readonly BrushPreset[],
  brush: BrushSettings,
): BrushPreset | null {
  return presets.find((preset) => brushSettingsEqual(preset.brush, brush)) ?? null;
}

/**
 * The next preset the keyboard moves to.
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

/* -------------------------------------------------------------------------- *
 * The keyboard.
 *
 * The list owns the keys that act on the selection: moving it, applying it
 * and removing it. Delete is among them because the editor has a global
 * Delete shortcut - it deletes the selected strokes - so the list has to
 * claim it before the drawing sees it. A keyboard user browsing the brushes
 * must not lose their work by pressing Delete on a brush.
 * ----------------------------------------------------------------------- */

/** What a key press in the list asks for. */
export type PresetListIntent =
  | { readonly kind: "move"; readonly direction: 1 | -1 }
  | { readonly kind: "first" }
  | { readonly kind: "last" }
  | { readonly kind: "apply" }
  | { readonly kind: "delete" }
  | null;

/**
 * The intent a key press in the list means, or `null` when the key is none of
 * the list's.
 *
 * The keys that need a selection - Enter to apply, Delete to remove - claim
 * nothing without one, so the key keeps its own meaning elsewhere. Every key
 * the list does claim is one the list acts on, and the caller stops the event
 * from travelling further.
 */
export function presetListIntent(key: string, hasSelection: boolean): PresetListIntent {
  switch (key) {
    case "ArrowDown":
      return { kind: "move", direction: 1 };
    case "ArrowUp":
      return { kind: "move", direction: -1 };
    case "Home":
      return { kind: "first" };
    case "End":
      return { kind: "last" };
    case "Enter":
      return hasSelection ? { kind: "apply" } : null;
    case "Delete":
    case "Backspace":
      return hasSelection ? { kind: "delete" } : null;
    default:
      return null;
  }
}

/** How long a preset counts as recent after it was used. */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the preset was used lately.
 *
 * "Lately" is a day: a brush that was picked this morning is still one of the
 * brushes the user reaches for, and one they used last month is not.
 */
export function isRecentlyUsed(preset: BrushPreset, now: number = Date.now()): boolean {
  if (preset.lastUsedAt === null) {
    return false;
  }
  const age = now - preset.lastUsedAt;
  return age >= 0 && age < RECENT_WINDOW_MS;
}

/**
 * A short description of what a preset paints, for the row's tooltip.
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

/** The name a preset would get, or `""` when the name is not usable. */
export function usablePresetName(name: string): string {
  const normalized = normalizePresetName(name);
  return normalized === "" ? "" : normalized.slice(0, MAX_PRESET_NAME_LENGTH);
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
  /** Renames a preset; `null` when the id is unknown or the name is not usable. */
  rename(id: string, name: string): BrushPreset | null;
  /** Duplicates a preset; `null` when the id is unknown. */
  duplicate(id: string): BrushPreset | null;
  /** Stores the live brush in the preset; `null` when the id is unknown. */
  update(id: string): BrushPreset | null;
  /** Deletes a preset; `false` when the id is unknown or the preset is built in. */
  remove(id: string): boolean;
  /** Applies a preset; `false` when the id is unknown. */
  apply(id: string): boolean;
  /** Stars or unstars a preset; `false` when the id is unknown. */
  toggleFavorite(id: string): boolean;
  /** Adds presets to the library; the number that were added. */
  import(entries: readonly BrushPreset[]): number;
  /** Restores the default brush. */
  resetBrush(): void;
}

/** What the browser asks for. */
export type PresetAction =
  | { readonly kind: "save"; readonly name: string }
  | { readonly kind: "rename"; readonly id: string; readonly name: string }
  | { readonly kind: "duplicate"; readonly id: string }
  | { readonly kind: "update"; readonly id: string }
  | { readonly kind: "delete"; readonly id: string }
  | { readonly kind: "apply"; readonly id: string }
  | { readonly kind: "favorite"; readonly id: string }
  | { readonly kind: "import"; readonly entries: readonly BrushPreset[] }
  | { readonly kind: "reset" };

/** What happened. */
export interface PresetActionResult {
  /** Whether the operation did what it was asked to. */
  readonly ok: boolean;
  /** What to tell the user, or `null` when there is nothing to say. */
  readonly message: string | null;
  /** The preset the browser should select afterwards, or `null` for none. */
  readonly selection: string | null;
}

/** A result that reports a refusal. */
function refused(message: string, selection: string | null = null): PresetActionResult {
  return { ok: false, message, selection };
}

/** A result that reports success. */
function done(message: string | null, selection: string | null = null): PresetActionResult {
  return { ok: true, message, selection };
}

/**
 * Runs one browser action.
 *
 * Every button in the browser goes through here, so a button that cannot do
 * what it says says so instead of doing nothing: a built-in brush is
 * protected, an empty name is not a name, and an unknown id is reported.
 */
export function runPresetAction(
  port: PresetLibraryPort,
  action: PresetAction,
): PresetActionResult {
  switch (action.kind) {
    case "save": {
      const name = usablePresetName(action.name);
      if (name === "") {
        return refused("A preset needs a name.");
      }
      const preset = port.save(name);
      if (preset === null) {
        return refused("The preset could not be saved.");
      }
      return done(`Saved "${preset.name}".`, preset.id);
    }
    case "rename": {
      const name = usablePresetName(action.name);
      if (name === "") {
        return refused("A preset needs a name.");
      }
      const preset = port.rename(action.id, name);
      if (preset === null) {
        return refused("The preset could not be renamed.");
      }
      return done(`Renamed to "${preset.name}".`, preset.id);
    }
    case "duplicate": {
      const preset = port.duplicate(action.id);
      if (preset === null) {
        return refused("The preset could not be duplicated.");
      }
      return done(`Duplicated as "${preset.name}".`, preset.id);
    }
    case "update": {
      const preset = port.update(action.id);
      if (preset === null) {
        return refused("The preset could not be updated.");
      }
      return done(`Updated "${preset.name}".`, preset.id);
    }
    case "delete": {
      if (port.remove(action.id)) {
        return done("The preset was deleted.", null);
      }
      return refused("The preset could not be deleted.");
    }
    case "apply": {
      if (port.apply(action.id)) {
        return done(null, action.id);
      }
      return refused("The preset could not be applied.");
    }
    case "favorite": {
      if (port.toggleFavorite(action.id)) {
        return done(null, action.id);
      }
      return refused("The preset could not be starred.");
    }
    case "import": {
      const count = port.import(action.entries);
      if (count === 0) {
        return refused("Nothing was imported.");
      }
      return done(count === 1 ? "Imported 1 preset." : `Imported ${count} presets.`, null);
    }
    case "reset": {
      port.resetBrush();
      return done("The brush was restored to its default.");
    }
  }
}

/**
 * The presets that may be changed or removed.
 *
 * A built-in brush is code: renaming, overwriting or deleting it would take
 * the feature away rather than the user's data, so the browser offers
 * "duplicate" instead.
 */
export function canModifyPreset(preset: BrushPreset | null): boolean {
  return preset !== null && !isBundledPreset(preset);
}

/** The presets the browser can delete, for the confirmation's wording. */
export function deletablePresets(presets: readonly BrushPreset[]): readonly BrushPreset[] {
  return presets.filter((preset) => !isBundledPreset(preset));
}
