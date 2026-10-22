/**
 * The brush preset browser: the search, the orders, the grouping, the
 * selection, the actions and the library file.
 *
 * These are the properties a user would notice. The library is browsed by
 * name and by recency, a built-in brush cannot be renamed or deleted while a
 * saved one can, applying a brush is an editor change and not an edit, and a
 * library file that comes from outside is checked field by field - a brush
 * that goes through a file comes back whole, and a malformed file is refused
 * rather than half-read.
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BRUSH, normalizeBrush } from "../core/brushes/defaults";
import {
  DEFAULT_PRESET_BROWSER_STATE,
  canModifyPreset,
  findPreset,
  filterPresets,
  groupPresets,
  importEntries,
  isBundledPreset,
  markPresetUsed,
  matchesQuery,
  nextSelectionId,
  presetMatchingBrush,
  runPresetAction,
  sortPresets,
  toggleFavorite,
  visiblePresets,
  type PresetBrowserState,
  type PresetLibrary,
  type PresetLibraryPort,
} from "../core/brushes/presetBrowser";
import {
  PresetLibraryFiles,
  type PresetLibraryGateway,
} from "../core/brushes/presetLibraryFiles";
import {
  MAX_PRESET_LIBRARY_BYTES,
  MAX_PRESET_LIBRARY_ENTRIES,
  PRESET_LIBRARY_FORMAT,
  PRESET_LIBRARY_VERSION,
  parsePresetLibrary,
  serializePresetLibrary,
  type PresetLibraryEntry,
} from "../core/brushes/presetTransfer";
import type { BrushPreset } from "../core/brushes/presets";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import type { BrushSettings, PressureCurvePoint } from "../types/brush";

/* -------------------------------------------------------------------------- *
 * Fixtures.
 * ----------------------------------------------------------------------- */

/** A curve that is not the identity. */
const BENT_CURVE: readonly PressureCurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.8 },
  { x: 1, y: 1 },
];

/**
 * A brush with every field set to a value that is not its default.
 *
 * These are the values that must come back unchanged: a field that is dropped
 * on the way into a file and read back out shows up as a difference here,
 * rather than as a brush that quietly reverted to its default.
 */
const BRUSH_WITH_EVERY_FIELD_SET: BrushSettings = {
  size: 23,
  opacity: 0.42,
  color: "#1a2b3c",
  hardness: 0.31,
  pressureSize: 0.77,
  pressureOpacity: 0.66,
  pressureCurve: BENT_CURVE,
  minSizeRatio: 0.55,
  spacing: 0.44,
  stabilizer: 0.33,
  texture: 0.22,
  stamp: true,
  stampSpacing: 0.15,
  stampHardness: 0.85,
  stampTexture: 0.65,
};

/** A value for one field that is not its default. */
function distinctiveValue(
  field: keyof BrushSettings,
): number | string | boolean | readonly PressureCurvePoint[] {
  const fallback = DEFAULT_BRUSH[field];
  if (typeof fallback === "boolean") {
    return !fallback;
  }
  if (typeof fallback === "string") {
    return "#0a1b2c";
  }
  if (Array.isArray(fallback) || typeof fallback === "object") {
    return BENT_CURVE;
  }
  return (fallback + 0.07) % 1;
}

/** The brush with one field changed, clamped the way the reader clamps it. */
function brushWith(
  field: keyof BrushSettings,
  value: number | string | boolean | readonly PressureCurvePoint[],
): BrushSettings {
  return normalizeBrush({ ...DEFAULT_BRUSH, [field]: value } as BrushSettings);
}

/** Every field a brush has, taken from the brush itself. */
function everyBrushField(): (keyof BrushSettings)[] {
  return Object.keys(DEFAULT_BRUSH) as (keyof BrushSettings)[];
}

function preset(id: string, name: string, brush: BrushSettings = DEFAULT_BRUSH): BrushPreset {
  return { id, name, brush };
}

const INK = preset("p-ink", "Ink");
const SOFT = preset("p-soft", "Soft ink");
const MARKER = preset("p-marker", "Marker");
const PENCIL = preset("b-pencil", "Pencil");

/** The library the browser shows: the user's own brushes and the built-in ones. */
const LIBRARY: PresetLibrary = {
  presets: [INK, SOFT, MARKER],
  bundled: [PENCIL],
};

function state(overrides: Partial<PresetBrowserState> = {}): PresetBrowserState {
  return { ...DEFAULT_PRESET_BROWSER_STATE, ...overrides };
}

/** A port that records what the browser asked the editor to do. */
function createPort(overrides: Partial<PresetLibraryPort> = {}): PresetLibraryPort {
  return {
    save: vi.fn((name: string) => preset("p-new", name)),
    rename: vi.fn((id: string, name: string) => preset(id, name)),
    duplicate: vi.fn((id: string) => preset(`${id}-copy`, "Ink (2)")),
    remove: vi.fn(() => true),
    apply: vi.fn(() => true),
    import: vi.fn((added: readonly BrushPreset[]) => added),
    ...overrides,
  };
}

/** A gateway that records what the file service asked for. */
function createGateway(overrides: Partial<PresetLibraryGateway> = {}): PresetLibraryGateway {
  return {
    pickPresetLibraryToOpen: vi.fn(async () => null),
    pickPresetLibraryToSave: vi.fn(async () => null),
    readTextFile: vi.fn(async () => ""),
    writeTextFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- *
 * The search.
 * ----------------------------------------------------------------------- */

describe("searching the library", () => {
  it("matches any part of the name, ignoring case and spaces", () => {
    expect(matchesQuery(INK, "ink")).toBe(true);
    expect(matchesQuery(INK, "  INK  ")).toBe(true);
    expect(matchesQuery(SOFT, "ft i")).toBe(true);
    expect(matchesQuery(INK, "pen")).toBe(false);
  });

  it("shows everything for an empty search", () => {
    expect(filterPresets(LIBRARY, state())).toHaveLength(4);
    expect(filterPresets(LIBRARY, state({ query: "   " }))).toHaveLength(4);
  });

  it("keeps the brushes that match and drops the ones that do not", () => {
    const found = filterPresets(LIBRARY, state({ query: "ink" }));

    expect(found.map((entry) => entry.name)).toEqual(["Ink", "Soft ink"]);
  });

  it("searches the built-in brushes too", () => {
    const found = filterPresets(LIBRARY, state({ query: "pencil" }));

    expect(found.map((entry) => entry.id)).toEqual(["b-pencil"]);
  });

  it("shows only the starred brushes when the filter is on", () => {
    const starred = state({ favoritesOnly: true, favorites: ["p-soft"] });

    expect(filterPresets(LIBRARY, starred).map((entry) => entry.id)).toEqual(["p-soft"]);
  });
});

/* -------------------------------------------------------------------------- *
 * The order.
 * ----------------------------------------------------------------------- */

describe("the order of the list", () => {
  it("orders by name, ignoring case", () => {
    const sorted = sortPresets(LIBRARY.presets, state({ sort: "name" }));

    expect(sorted.map((entry) => entry.name)).toEqual(["Ink", "Marker", "Soft ink"]);
  });

  it("puts the most recently used first and the never used last", () => {
    const used = state({ sort: "recent", recent: ["p-marker", "p-ink"] });

    const sorted = sortPresets(LIBRARY.presets, used);

    expect(sorted.map((entry) => entry.id)).toEqual(["p-marker", "p-ink", "p-soft"]);
  });

  it("puts the starred brushes first", () => {
    const starred = state({ sort: "favorites", favorites: ["p-marker"] });

    const sorted = sortPresets(LIBRARY.presets, starred);

    expect(sorted.map((entry) => entry.id)).toEqual(["p-marker", "p-ink", "p-soft"]);
  });

  it("notes a brush as used, most recent first", () => {
    const once = markPresetUsed(state(), "p-ink");
    const twice = markPresetUsed(once, "p-marker");
    const again = markPresetUsed(twice, "p-ink");

    expect(once.recent).toEqual(["p-ink"]);
    expect(twice.recent).toEqual(["p-marker", "p-ink"]);
    expect(again.recent).toEqual(["p-ink", "p-marker"]);
  });

  it("stars and unstars a brush", () => {
    const starred = toggleFavorite(state(), "p-ink");

    expect(starred.favorites).toEqual(["p-ink"]);
    expect(toggleFavorite(starred, "p-ink").favorites).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * The grouping.
 * ----------------------------------------------------------------------- */

describe("the groups of the list", () => {
  it("keeps the user's own brushes and the built-in ones apart", () => {
    const groups = groupPresets(LIBRARY, state());

    expect(groups.user.map((entry) => entry.id)).toEqual(["p-ink", "p-marker", "p-soft"]);
    expect(groups.builtin.map((entry) => entry.id)).toEqual(["b-pencil"]);
  });

  it("orders each group on its own", () => {
    const groups = groupPresets(LIBRARY, state({ sort: "name" }));

    expect(groups.user.map((entry) => entry.name)).toEqual(["Ink", "Marker", "Soft ink"]);
  });

  it("has no built-in group when the library has no built-in brushes", () => {
    const groups = groupPresets({ presets: LIBRARY.presets, bundled: [] }, state());

    expect(groups.builtin).toEqual([]);
    expect(groups.user).toHaveLength(3);
  });

  it("lists the visible brushes in the order they are shown", () => {
    const visible = visiblePresets(LIBRARY, state());

    expect(visible.map((entry) => entry.id)).toEqual([
      "p-ink",
      "p-marker",
      "p-soft",
      "b-pencil",
    ]);
  });

  it("knows a built-in brush by the list it is given", () => {
    expect(isBundledPreset(PENCIL, LIBRARY.bundled)).toBe(true);
    expect(isBundledPreset(INK, LIBRARY.bundled)).toBe(false);
    expect(isBundledPreset(PENCIL, [])).toBe(false);
  });
});

/* -------------------------------------------------------------------------- *
 * The selection.
 * ----------------------------------------------------------------------- */

describe("the selection", () => {
  const visible = visiblePresets(LIBRARY, state());

  it("starts at the first brush when nothing is selected", () => {
    expect(nextSelectionId(visible, null, 1)).toBe("p-ink");
    expect(nextSelectionId(visible, null, -1)).toBe("b-pencil");
  });

  it("walks the list in the order it is shown", () => {
    expect(nextSelectionId(visible, "p-ink", 1)).toBe("p-marker");
    expect(nextSelectionId(visible, "p-marker", -1)).toBe("p-ink");
  });

  it("stays at the ends of the list", () => {
    expect(nextSelectionId(visible, "p-ink", -1)).toBe("p-ink");
    expect(nextSelectionId(visible, "b-pencil", 1)).toBe("b-pencil");
  });

  it("starts at the first brush when the selected one is gone", () => {
    expect(nextSelectionId(visible, "p-gone", 1)).toBe("p-ink");
  });

  it("has no selection in an empty list", () => {
    expect(nextSelectionId([], null, 1)).toBeNull();
  });

  it("finds a brush by its id, in either group", () => {
    expect(findPreset(LIBRARY, "p-ink")?.name).toBe("Ink");
    expect(findPreset(LIBRARY, "b-pencil")?.name).toBe("Pencil");
    expect(findPreset(LIBRARY, "p-gone")).toBeNull();
    expect(findPreset(LIBRARY, null)).toBeNull();
  });

  it("knows which brush is in effect", () => {
    const brush = { ...DEFAULT_BRUSH, size: 31 };

    expect(presetMatchingBrush(LIBRARY, brush)).toBeNull();
    expect(presetMatchingBrush({ presets: [preset("p-31", "Big", brush)], bundled: [] }, brush)?.id).toBe(
      "p-31",
    );
  });
});

/* -------------------------------------------------------------------------- *
 * The actions.
 * ----------------------------------------------------------------------- */

describe("the actions of the browser", () => {
  it("refuses a name that is not a name", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, { kind: "save", name: "   " });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("A brush needs a name.");
    expect(port.save).not.toHaveBeenCalled();
  });

  it("saves the live brush under the name that was typed", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, { kind: "save", name: "  Ink  " });

    expect(result.ok).toBe(true);
    expect(port.save).toHaveBeenCalledWith("Ink");
    expect(result.selection).toBe("p-new");
  });

  it("renames a brush of the user", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, {
      kind: "rename",
      id: "p-ink",
      name: "Marker pen",
    });

    expect(result.ok).toBe(true);
    expect(port.rename).toHaveBeenCalledWith("p-ink", "Marker pen");
  });

  it("deletes a brush of the user", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, { kind: "delete", id: "p-ink" });

    expect(result.ok).toBe(true);
    expect(port.remove).toHaveBeenCalledWith("p-ink");
  });

  it("applies a brush and notes that it was used", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, { kind: "apply", id: "p-ink" });

    expect(result.ok).toBe(true);
    expect(port.apply).toHaveBeenCalledWith(INK);
    expect(result.state?.recent).toEqual(["p-ink"]);
  });

  it("applies a built-in brush too", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, { kind: "apply", id: "b-pencil" });

    expect(result.ok).toBe(true);
    expect(port.apply).toHaveBeenCalledWith(PENCIL);
  });

  it("stars a brush without asking the editor to do anything", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, { kind: "favorite", id: "p-ink" });

    expect(result.ok).toBe(true);
    expect(result.state?.favorites).toEqual(["p-ink"]);
    expect(port.save).not.toHaveBeenCalled();
  });

  it("reports a brush that is no longer in the library", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, { kind: "apply", id: "p-gone" });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("That brush is no longer in the library.");
    expect(port.apply).not.toHaveBeenCalled();
  });

  it("imports the entries of a file as new brushes", () => {
    const port = createPort();
    const entries: PresetLibraryEntry[] = [
      { name: "Ink", brush: { ...DEFAULT_BRUSH, size: 12 }, favorite: true },
      { name: "Chalk", brush: { ...DEFAULT_BRUSH, size: 40 }, favorite: false },
    ];

    const result = runPresetAction(LIBRARY, state(), port, { kind: "import", entries });

    expect(result.ok).toBe(true);
    const added = (port.import as ReturnType<typeof vi.fn>).mock.calls[0][0] as BrushPreset[];
    expect(added.map((entry) => entry.name)).toEqual(["Ink (2)", "Chalk"]);
    expect(added[0].id).not.toBe("p-ink");
    expect(added[0].brush.size).toBe(12);
    expect(result.state?.favorites).toEqual([added[0].id]);
  });

  it("refuses an import with nothing in it", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, { kind: "import", entries: [] });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Nothing was imported.");
    expect(port.import).not.toHaveBeenCalled();
  });

  it("turns the entries of a file into brushes with fresh ids and free names", () => {
    const imported = importEntries(
      [
        { name: "Ink", brush: DEFAULT_BRUSH, favorite: false },
        { name: "ink", brush: DEFAULT_BRUSH, favorite: true },
      ],
      LIBRARY.presets,
    );

    // The names are compared without case, so "ink" clashes with "Ink" and
    // with the "Ink (2)" the first entry already took.
    expect(imported.presets.map((entry) => entry.name)).toEqual(["Ink (2)", "ink (3)"]);
    expect(imported.presets[0].id).not.toBe(imported.presets[1].id);
    expect(imported.favoriteIds).toEqual([imported.presets[1].id]);
  });
});

/* -------------------------------------------------------------------------- *
 * The built-in brushes are protected.
 * ----------------------------------------------------------------------- */

describe("a built-in brush is protected", () => {
  it("cannot be renamed", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, {
      kind: "rename",
      id: "b-pencil",
      name: "Crayon",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("built-in");
    expect(port.rename).not.toHaveBeenCalled();
  });

  it("cannot be deleted", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, { kind: "delete", id: "b-pencil" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("built-in");
    expect(port.remove).not.toHaveBeenCalled();
  });

  it("can be duplicated, which is how the user gets a copy they can change", () => {
    const port = createPort();

    const result = runPresetAction(LIBRARY, state(), port, {
      kind: "duplicate",
      id: "b-pencil",
    });

    expect(result.ok).toBe(true);
    expect(port.duplicate).toHaveBeenCalledWith("b-pencil");
  });

  it("says so in the model the panel asks", () => {
    expect(canModifyPreset(PENCIL, LIBRARY.bundled)).toBe(false);
    expect(canModifyPreset(INK, LIBRARY.bundled)).toBe(true);
    expect(canModifyPreset(null, LIBRARY.bundled)).toBe(false);
  });

  it("does not make a saved brush built-in because it shares an id", () => {
    // The two lists are separate id spaces, so a saved brush that happens to
    // carry the same id as a built-in one is still the user's own brush.
    const clash = preset("b-pencil", "My pencil");

    expect(isBundledPreset(clash, LIBRARY.bundled)).toBe(false);
    expect(canModifyPreset(clash, LIBRARY.bundled)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- *
 * Applying a brush is not an edit.
 * ----------------------------------------------------------------------- */

describe("applying a brush is not an edit", () => {
  function createEngine(): DrawingEngine {
    return new DrawingEngine({
      document: createDocument({ name: "Test", width: 200, height: 120 }),
    });
  }

  it("changes the brush and nothing else", () => {
    const engine = createEngine();
    engine.setBrush({ size: 40, color: "#112233" });
    const saved = engine.saveBrushPreset("Ink");
    expect(saved).not.toBeNull();
    engine.setBrush({ size: 4 });

    const port: PresetLibraryPort = {
      save: (name) => engine.saveBrushPreset(name),
      rename: (id, name) => engine.renameBrushPreset(id, name),
      duplicate: (id) => engine.duplicateBrushPreset(id),
      remove: (id) => engine.deleteBrushPreset(id),
      apply: (target) => engine.applyBrushPreset(target.id),
      import: (added) => {
        engine.setPresets([...engine.getState().presets, ...added]);
        return added;
      },
    };
    const library: PresetLibrary = { presets: engine.getState().presets, bundled: [] };

    const result = runPresetAction(library, state(), port, {
      kind: "apply",
      id: saved?.id ?? "",
    });

    const after = engine.getState();
    expect(result.ok).toBe(true);
    expect(after.brush.size).toBe(40);
    expect(after.brush.color).toBe("#112233");
    expect(after.history.depth).toBe(0);
    expect(after.file.dirty).toBe(false);
  });
});

/* -------------------------------------------------------------------------- *
 * The library file.
 * ----------------------------------------------------------------------- */

describe("the library file", () => {
  it("carries the brushes it was written with", () => {
    const file = serializePresetLibrary([INK, SOFT]);

    const parsed = parsePresetLibrary(file);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.entries.map((entry) => entry.name)).toEqual(["Ink", "Soft ink"]);
    expect(parsed.entries[0].brush).toEqual(DEFAULT_BRUSH);
    expect(parsed.skipped).toBe(0);
  });

  it("marks the file as a preset library and carries a version", () => {
    const file = serializePresetLibrary([INK]);
    const parsed = JSON.parse(file) as Record<string, unknown>;

    expect(parsed.format).toBe(PRESET_LIBRARY_FORMAT);
    expect(parsed.version).toBe(PRESET_LIBRARY_VERSION);
  });

  it("carries the star of a brush", () => {
    const file = serializePresetLibrary([INK, SOFT], ["p-soft"]);

    const parsed = parsePresetLibrary(file);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.entries.map((entry) => entry.favorite)).toEqual([false, true]);
  });

  it("refuses a file that is not JSON", () => {
    const parsed = parsePresetLibrary("not json at all");

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("not valid JSON");
  });

  it("refuses a file that is not a preset library", () => {
    const parsed = parsePresetLibrary(JSON.stringify({ format: "something-else", presets: [] }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("not a Paka brush library");
  });

  it("refuses a file from a newer version of Paka", () => {
    const parsed = parsePresetLibrary(
      JSON.stringify({
        format: PRESET_LIBRARY_FORMAT,
        version: PRESET_LIBRARY_VERSION + 1,
        presets: [],
      }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("newer version");
  });

  it("refuses a file that is too large", () => {
    const parsed = parsePresetLibrary("x".repeat(MAX_PRESET_LIBRARY_BYTES + 1));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("too large");
  });

  it("refuses a file with more brushes than the browser will take", () => {
    const parsed = parsePresetLibrary(
      JSON.stringify({
        format: PRESET_LIBRARY_FORMAT,
        version: PRESET_LIBRARY_VERSION,
        presets: Array.from({ length: MAX_PRESET_LIBRARY_ENTRIES + 1 }, () => ({
          name: "Ink",
          brush: DEFAULT_BRUSH,
        })),
      }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("more than");
  });

  it("skips a malformed entry without losing the rest of the file", () => {
    const parsed = parsePresetLibrary(
      JSON.stringify({
        format: PRESET_LIBRARY_FORMAT,
        version: PRESET_LIBRARY_VERSION,
        presets: [
          { name: "Ink", brush: DEFAULT_BRUSH },
          { name: "   ", brush: DEFAULT_BRUSH },
          "not an object",
          { name: "Chalk", brush: { size: 30 } },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.entries.map((entry) => entry.name)).toEqual(["Ink", "Chalk"]);
    expect(parsed.skipped).toBe(2);
  });

  it("refuses a file with no usable brush in it", () => {
    const parsed = parsePresetLibrary(
      JSON.stringify({
        format: PRESET_LIBRARY_FORMAT,
        version: PRESET_LIBRARY_VERSION,
        presets: [{ name: "  " }, 3],
      }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("no usable brushes");
  });
});

describe("no brush field is dropped by the library file", () => {
  it("keeps every field of the brush through the file", () => {
    const file = serializePresetLibrary([
      { id: "p-1", name: "Ink", brush: BRUSH_WITH_EVERY_FIELD_SET },
    ]);

    const parsed = parsePresetLibrary(file);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.entries[0].brush).toEqual(BRUSH_WITH_EVERY_FIELD_SET);
  });

  it("reads every field the brush has, one field at a time", () => {
    // The reader is walked field by field here on purpose: a mapping that
    // forgets one field falls back to the default for it, and the default is
    // never the distinctive value below.
    for (const field of everyBrushField()) {
      const raw = distinctiveValue(field);
      const expected = brushWith(field, raw)[field];

      const parsed = parsePresetLibrary(
        serializePresetLibrary([{ id: "p-1", name: "Ink", brush: brushWith(field, raw) }]),
      );

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        return;
      }
      expect(
        parsed.entries[0].brush[field],
        `the library reader dropped "${String(field)}"`,
      ).toEqual(expected);
    }
  });

  it("gives a brush with no brush in it the default brush", () => {
    const parsed = parsePresetLibrary(
      JSON.stringify({
        format: PRESET_LIBRARY_FORMAT,
        version: PRESET_LIBRARY_VERSION,
        presets: [{ name: "Ink" }],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.entries[0].brush).toEqual(DEFAULT_BRUSH);
  });
});

/* -------------------------------------------------------------------------- *
 * The file service.
 * ----------------------------------------------------------------------- */

describe("the library file service", () => {
  it("writes the library to the file the user chose", async () => {
    const gateway = createGateway({
      pickPresetLibraryToSave: vi.fn(async () => "C:/brushes/my-brushes"),
    });
    const files = new PresetLibraryFiles(gateway);

    const outcome = await files.exportLibrary([INK, SOFT], ["p-soft"]);

    expect(outcome.status).toBe("exported");
    if (outcome.status !== "exported") {
      return;
    }
    expect(outcome.path).toBe("C:/brushes/my-brushes.json");
    expect(outcome.count).toBe(2);
    const written = (gateway.writeTextFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(written[0]).toBe("C:/brushes/my-brushes.json");
    const parsed = parsePresetLibrary(written[1] as string);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.entries.map((entry) => entry.name)).toEqual(["Ink", "Soft ink"]);
      expect(parsed.entries[1].favorite).toBe(true);
    }
  });

  it("says nothing happened when the export dialog is cancelled", async () => {
    const files = new PresetLibraryFiles(createGateway());

    expect((await files.exportLibrary([INK])).status).toBe("cancelled");
  });

  it("reports a failed write", async () => {
    const gateway = createGateway({
      pickPresetLibraryToSave: vi.fn(async () => "C:/brushes.json"),
      writeTextFile: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    const files = new PresetLibraryFiles(gateway);

    const outcome = await files.exportLibrary([INK]);

    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") {
      return;
    }
    expect(outcome.message).toContain("disk full");
  });

  it("reads the library the user chose", async () => {
    const gateway = createGateway({
      pickPresetLibraryToOpen: vi.fn(async () => "C:/brushes.json"),
      readTextFile: vi.fn(async () => serializePresetLibrary([INK])),
    });
    const files = new PresetLibraryFiles(gateway);

    const outcome = await files.importLibrary();

    expect(outcome.status).toBe("read");
    if (outcome.status !== "read") {
      return;
    }
    expect(outcome.entries.map((entry) => entry.name)).toEqual(["Ink"]);
    expect(outcome.skipped).toBe(0);
  });

  it("reports a file that is not a brush library", async () => {
    const gateway = createGateway({
      pickPresetLibraryToOpen: vi.fn(async () => "C:/brushes.json"),
      readTextFile: vi.fn(async () => "not json"),
    });
    const files = new PresetLibraryFiles(gateway);

    const outcome = await files.importLibrary();

    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") {
      return;
    }
    expect(outcome.message).toContain("could not be imported");
  });

  it("says nothing happened when the import dialog is cancelled", async () => {
    const files = new PresetLibraryFiles(createGateway());

    expect((await files.importLibrary()).status).toBe("cancelled");
  });

  it("refuses to write a library that is larger than the format allows", async () => {
    const many = Array.from({ length: MAX_PRESET_LIBRARY_ENTRIES + 1 }, (_, index) =>
      preset(`p-${index}`, `Brush ${index}`),
    );
    const files = new PresetLibraryFiles(createGateway());

    const outcome = await files.exportLibrary(many);

    expect(outcome.status).toBe("error");
  });
});
