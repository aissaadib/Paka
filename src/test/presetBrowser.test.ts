/**
 * The brush preset browser: the model, the actions, the library file and the
 * engine's preset operations.
 *
 * The properties pinned down here are the ones a user would notice:
 *
 *  - the built-in brushes are always there, and they cannot be renamed,
 *    overwritten or deleted;
 *  - applying a preset changes the brush the next stroke is drawn with, and
 *    leaves the stored copy alone;
 *  - the search, the order and the favourites filter show what they say;
 *  - a library file that is not a library is refused with a message, and one
 *    that is imported twice gives two libraries;
 *  - the library survives a restart through the settings file.
 *
 * Everything here is DOM-free: the browser's rules are plain functions, so
 * they can be exercised in Node.
 */

import { describe, expect, it } from "vitest";
import { BUNDLED_PRESETS } from "../core/brushes/bundledPresets";
import { DEFAULT_BRUSH, normalizeBrush } from "../core/brushes/defaults";
import {
  DEFAULT_PRESET_FILTER,
  canModifyPreset,
  describePreset,
  filterPresets,
  groupPresets,
  isRecentlyUsed,
  matchesQuery,
  nextSelectionId,
  presetListIntent,
  presetMatchingBrush,
  runPresetAction,
  sortPresets,
  visiblePresets,
  type PresetAction,
  type PresetLibraryPort,
} from "../core/brushes/presetBrowser";
import { PresetLibraryFiles } from "../core/brushes/presetLibraryFiles";
import {
  MAX_PRESET_LIBRARY_ENTRIES,
  parsePresetLibrary,
  serializePresetLibrary,
} from "../core/brushes/presetTransfer";
import {
  isBundledPreset,
  mergeBundledPresets,
  normalizeBrushPresets,
  type BrushPreset,
} from "../core/brushes/presets";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { SettingsStore } from "../core/settings/settingsStore";
import type { BrushSettings } from "../types/brush";
import type { PointerSample } from "../types/pointer";
import { MemoryProjectGateway } from "./support/memoryGateway";
import { MemorySettingsGateway } from "./support/memorySettingsGateway";

/** A preset as a test writes it. */
function aPreset(
  id: string,
  name: string,
  brush: BrushSettings = DEFAULT_BRUSH,
  extra: Partial<BrushPreset> = {},
): BrushPreset {
  return {
    id,
    name,
    brush,
    favorite: false,
    builtin: false,
    lastUsedAt: null,
    ...extra,
  };
}

/** The user's own presets: the built-in ones are always in the library. */
function userPresets(presets: readonly BrushPreset[]): BrushPreset[] {
  return presets.filter((preset) => !isBundledPreset(preset));
}

function createEngine(): DrawingEngine {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 200, height: 120 }),
  });
}

function createSample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    phase: "move",
    pointerId: 1,
    kind: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: 0,
    docY: 0,
    screenX: 0,
    screenY: 0,
    pressure: 0.7,
    hasPressure: true,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    ...overrides,
  };
}

/** A port that records what the browser asked for. */
function recordingPort(): PresetLibraryPort & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    save: (name) => {
      calls.push(`save:${name}`);
      return aPreset("new", name);
    },
    rename: (id, name) => {
      calls.push(`rename:${id}:${name}`);
      return aPreset(id, name);
    },
    duplicate: (id) => {
      calls.push(`duplicate:${id}`);
      return aPreset("copy", "Copy");
    },
    update: (id) => {
      calls.push(`update:${id}`);
      return aPreset(id, "Updated");
    },
    remove: (id) => {
      calls.push(`remove:${id}`);
      return true;
    },
    apply: (id) => {
      calls.push(`apply:${id}`);
      return id !== "missing";
    },
    toggleFavorite: (id) => {
      calls.push(`favorite:${id}`);
      return true;
    },
    import: (entries) => {
      calls.push(`import:${entries.length}`);
      return entries.length;
    },
    resetBrush: () => {
      calls.push("reset");
    },
  };
}

/** The action the browser runs, as a plain object. */
function action(kind: PresetAction["kind"], extra: Record<string, unknown> = {}): PresetAction {
  return { kind, ...extra } as PresetAction;
}

describe("the built-in brushes", () => {
  it("are in the library from the start", () => {
    const engine = createEngine();
    const names = engine.getState().presets.map((preset) => preset.name);

    expect(names).toEqual(BUNDLED_PRESETS.map((preset) => preset.name));
    expect(userPresets(engine.getState().presets)).toHaveLength(0);
  });

  it("cannot be renamed, overwritten or deleted", () => {
    const engine = createEngine();
    const builtin = engine.getState().presets[0];

    expect(engine.renameBrushPreset(builtin.id, "Mine")).toBeNull();
    expect(engine.updateBrushPreset(builtin.id)).toBeNull();
    expect(engine.deleteBrushPreset(builtin.id)).toBe(false);
    expect(engine.getState().presets).toHaveLength(BUNDLED_PRESETS.length);
  });

  it("can be duplicated into a brush the user owns", () => {
    const engine = createEngine();
    const builtin = engine.getState().presets[0];

    const copy = engine.duplicateBrushPreset(builtin.id);

    expect(copy).not.toBeNull();
    expect(copy?.builtin).toBe(false);
    expect(copy?.brush).toEqual(builtin.brush);
    expect(userPresets(engine.getState().presets)).toHaveLength(1);
  });

  it("can be starred, because the star is the user's own note", () => {
    const engine = createEngine();
    const builtin = engine.getState().presets[0];

    expect(engine.toggleBrushPresetFavorite(builtin.id)).toBe(true);

    const starred = engine.getState().presets.find((preset) => preset.id === builtin.id);
    expect(starred?.favorite).toBe(true);
  });

  it("keep their brush from the code, not from the file", () => {
    const engine = createEngine();
    const builtin = engine.getState().presets[0];
    const tampered = { ...builtin, brush: { ...builtin.brush, size: 400 } };

    engine.setPresets([tampered]);

    const stored = engine.getState().presets.find((preset) => preset.id === builtin.id);
    expect(stored?.brush.size).toBe(builtin.brush.size);
  });

  it("cannot be made protected by hand in the settings file", () => {
    const parsed = normalizeBrushPresets([
      { id: "mine", name: "Mine", brush: DEFAULT_BRUSH, builtin: true },
    ]);

    expect(parsed[0].builtin).toBe(false);
  });
});

describe("the browser's view of the library", () => {
  const library: BrushPreset[] = [
    aPreset("a", "Airbrush", { ...DEFAULT_BRUSH, size: 40 }),
    aPreset("b", "Ink", { ...DEFAULT_BRUSH, size: 3 }),
    aPreset("c", "Soft round", { ...DEFAULT_BRUSH, size: 24 }, { favorite: true }),
    aPreset("d", "Marker", { ...DEFAULT_BRUSH, size: 14 }, { lastUsedAt: 1_700_000_000_000 }),
  ];

  it("finds a preset by any part of its name, whatever the case", () => {
    expect(matchesQuery(library[0], "air")).toBe(true);
    expect(matchesQuery(library[0], "AIRBRUSH")).toBe(true);
    expect(matchesQuery(library[0], "  air  ")).toBe(true);
    expect(matchesQuery(library[0], "ink")).toBe(false);
    expect(matchesQuery(library[0], "")).toBe(true);
  });

  it("orders the list by name, by recency and by size", () => {
    expect(sortPresets(library, "name").map((preset) => preset.name)).toEqual([
      "Airbrush",
      "Ink",
      "Marker",
      "Soft round",
    ]);
    expect(sortPresets(library, "recent").map((preset) => preset.name)).toEqual([
      "Marker",
      "Airbrush",
      "Ink",
      "Soft round",
    ]);
    expect(sortPresets(library, "size").map((preset) => preset.name)).toEqual([
      "Ink",
      "Marker",
      "Soft round",
      "Airbrush",
    ]);
  });

  it("shows only the starred brushes when the filter is on", () => {
    const starred = filterPresets(library, { ...DEFAULT_PRESET_FILTER, favoritesOnly: true });
    expect(starred.map((preset) => preset.name)).toEqual(["Soft round"]);
  });

  it("shows nothing when the search matches nothing", () => {
    expect(visiblePresets(library, { ...DEFAULT_PRESET_FILTER, query: "chalk" })).toEqual([]);
  });

  it("keeps the user's brushes and the built-in ones apart", () => {
    const groups = groupPresets([...BUNDLED_PRESETS, ...library], DEFAULT_PRESET_FILTER);

    // Each group is ordered on its own, so the built-in ones are in the order
    // the sort gives them rather than in the order the code lists them.
    expect(groups.builtin.map((preset) => preset.name)).toEqual([
      "Airbrush",
      "Charcoal",
      "Marker",
      "Pen",
      "Soft Round",
      "Stamp Dots",
    ]);
    expect(groups.user.map((preset) => preset.name)).toEqual([
      "Airbrush",
      "Ink",
      "Marker",
      "Soft round",
    ]);
  });

  it("moves the selection with the keyboard and stops at the ends", () => {
    const visible = visiblePresets(library, DEFAULT_PRESET_FILTER);

    expect(nextSelectionId(visible, null, 1)).toBe("a");
    expect(nextSelectionId(visible, "a", 1)).toBe("b");
    expect(nextSelectionId(visible, "a", -1)).toBe("a");
    expect(nextSelectionId(visible, "c", 1)).toBe("c");
    expect(nextSelectionId(visible, "c", -1)).toBe("d");
    expect(nextSelectionId([], "a", 1)).toBeNull();
  });

  it("knows which preset the live brush is", () => {
    expect(presetMatchingBrush(library, library[1].brush)?.id).toBe("b");
    expect(presetMatchingBrush(library, normalizeBrush({ ...DEFAULT_BRUSH, size: 77 }))).toBeNull();
  });

  it("calls a preset recent for a day after it was used", () => {
    const now = 1_700_000_000_000;
    const used = aPreset("u", "Used", DEFAULT_BRUSH, { lastUsedAt: now - 1_000 });
    const old = aPreset("o", "Old", DEFAULT_BRUSH, { lastUsedAt: now - 100_000_000 });
    const never = aPreset("n", "Never", DEFAULT_BRUSH);

    expect(isRecentlyUsed(used, now)).toBe(true);
    expect(isRecentlyUsed(old, now)).toBe(false);
    expect(isRecentlyUsed(never, now)).toBe(false);
  });

  it("describes a preset in words", () => {
    const soft = aPreset("s", "Soft", { ...DEFAULT_BRUSH, size: 40, hardness: 0.2 });
    expect(describePreset(library[0])).toContain("40 px");
    expect(describePreset(soft)).toContain("soft");
    expect(canModifyPreset(library[0])).toBe(true);
    expect(canModifyPreset(BUNDLED_PRESETS[0])).toBe(false);
  });
});

describe("the browser's actions", () => {
  it("reports a refusal instead of doing nothing", () => {
    const port = recordingPort();

    const empty = runPresetAction(port, action("save", { name: "   " }));
    expect(empty.ok).toBe(false);
    expect(empty.message).not.toBeNull();

    const unknown = runPresetAction(port, action("apply", { id: "missing" }));
    expect(unknown.ok).toBe(false);
    expect(port.calls).toEqual(["apply:missing"]);
  });

  it("creates, renames, duplicates, updates and deletes", () => {
    const port = recordingPort();

    expect(runPresetAction(port, action("save", { name: "Ink" })).ok).toBe(true);
    expect(runPresetAction(port, action("rename", { id: "a", name: "Marker" })).ok).toBe(true);
    expect(runPresetAction(port, action("duplicate", { id: "a" })).ok).toBe(true);
    expect(runPresetAction(port, action("update", { id: "a" })).ok).toBe(true);
    expect(runPresetAction(port, action("delete", { id: "a" })).ok).toBe(true);

    expect(port.calls).toEqual([
      "save:Ink",
      "rename:a:Marker",
      "duplicate:a",
      "update:a",
      "remove:a",
    ]);
  });

  it("selects what it created, duplicated or applied", () => {
    const port = recordingPort();

    expect(runPresetAction(port, action("save", { name: "Ink" })).selection).toBe("new");
    expect(runPresetAction(port, action("duplicate", { id: "a" })).selection).toBe("copy");
    expect(runPresetAction(port, action("apply", { id: "a" })).selection).toBe("a");
    expect(runPresetAction(port, action("delete", { id: "a" })).selection).toBeNull();
  });

  it("imports a library and says how many arrived", () => {
    const port = recordingPort();
    const entries = [aPreset("a", "Ink"), aPreset("b", "Marker")];

    const result = runPresetAction(port, action("import", { entries }));

    expect(result.ok).toBe(true);
    expect(result.message).toContain("2");
    expect(port.calls).toEqual(["import:2"]);
  });

  it("restores the brush to the preset it came from", () => {
    const port = recordingPort();

    expect(runPresetAction(port, action("reset")).ok).toBe(true);
    expect(port.calls).toEqual(["reset"]);
  });
});

describe("the engine's preset operations", () => {
  it("applies a preset to the brush the next stroke is drawn with", () => {
    const engine = createEngine();
    engine.setBrush({ size: 30, color: "#ff0000", stamp: true, stampTexture: 0.6 });
    const preset = engine.saveBrushPreset("Ink");
    expect(preset).not.toBeNull();

    engine.setBrush({ size: 2, color: "#00ff00" });
    expect(engine.applyBrushPreset(preset?.id ?? "")).toBe(true);

    const layerId = engine.getState().document.activeLayerId as string;
    engine.beginStroke(createSample({ docX: 10, docY: 10 }));
    engine.extendStroke(createSample({ docX: 60, docY: 40, timeStamp: 16 }));
    engine.finishStroke();

    const stroke = engine.listStrokes(layerId)[0];
    expect(stroke.brush).toEqual(preset?.brush);
    expect(stroke.brush.stampTexture).toBe(0.6);
  });

  it("leaves the stored copy alone when the brush is edited", () => {
    const engine = createEngine();
    engine.setBrush({ size: 30 });
    const preset = engine.saveBrushPreset("Ink");

    engine.setBrush({ size: 4 });
    const stored = engine.getState().presets.find((entry) => entry.id === preset?.id);

    expect(stored?.brush.size).toBe(30);
    expect(engine.getState().brush.size).toBe(4);
    expect(engine.getState().activePresetId).toBe(preset?.id ?? null);
  });

  it("stores the live brush in the preset when it is updated", () => {
    const engine = createEngine();
    engine.setBrush({ size: 30 });
    const preset = engine.saveBrushPreset("Ink");

    engine.setBrush({ size: 4, color: "#123456" });
    const updated = engine.updateBrushPreset(preset?.id ?? "");

    expect(updated?.brush.size).toBe(4);
    expect(updated?.brush.color).toBe("#123456");
    expect(engine.getState().brush.size).toBe(4);
  });

  it("stamps a preset as used when it is applied", () => {
    const engine = createEngine();
    const preset = engine.saveBrushPreset("Ink");
    expect(preset?.lastUsedAt).toBeNull();

    engine.applyBrushPreset(preset?.id ?? "");

    const used = engine.getState().presets.find((entry) => entry.id === preset?.id);
    expect(used?.lastUsedAt).not.toBeNull();
  });

  it("does not dirty the drawing or touch the history", () => {
    const engine = createEngine();
    const preset = engine.saveBrushPreset("Ink");
    const before = engine.getState();

    engine.applyBrushPreset(preset?.id ?? "");
    engine.toggleBrushPresetFavorite(preset?.id ?? "");
    engine.deleteBrushPreset(preset?.id ?? "");

    expect(engine.getState().file.dirty).toBe(false);
    expect(engine.getState().history.depth).toBe(before.history.depth);
  });

  it("imports a library under fresh names", () => {
    const engine = createEngine();
    engine.saveBrushPreset("Ink");

    const count = engine.importBrushPresets([
      aPreset("a", "Ink"),
      aPreset("b", "Marker"),
    ]);

    expect(count).toBe(2);
    const names = userPresets(engine.getState().presets).map((preset) => preset.name);
    // "Ink" is taken by the preset that was already there, and "Marker" is
    // taken by a built-in brush: a name is unique among *all* the presets.
    expect(names).toEqual(["Ink", "Ink (2)", "Marker (2)"]);
  });

  it("gives an imported preset a fresh id, so the same file can come twice", () => {
    const engine = createEngine();
    const first = engine.importBrushPresets([aPreset("a", "Ink")]);
    const second = engine.importBrushPresets([aPreset("a", "Ink")]);

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(userPresets(engine.getState().presets)).toHaveLength(2);
    const ids = userPresets(engine.getState().presets).map((preset) => preset.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("the library file", () => {
  it("round-trips the user's brushes", () => {
    const engine = createEngine();
    engine.setBrush({ size: 12, stamp: true });
    engine.saveBrushPreset("Ink");

    const text = serializePresetLibrary(engine.getState().presets);
    const parsed = parsePresetLibrary(text);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.presets).toHaveLength(1);
    expect(parsed.presets[0].name).toBe("Ink");
    expect(parsed.presets[0].brush.size).toBe(12);
    expect(parsed.presets[0].brush.stamp).toBe(true);
  });

  it("does not write the built-in brushes", () => {
    const text = serializePresetLibrary(BUNDLED_PRESETS);
    const parsed = parsePresetLibrary(text);

    expect(parsed.ok).toBe(false);
  });

  it("refuses a file that is not JSON", () => {
    const parsed = parsePresetLibrary("not json at all");

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("JSON");
  });

  it("refuses a file that is not a brush library", () => {
    const parsed = parsePresetLibrary(JSON.stringify({ format: "something-else" }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("brush library");
  });

  it("refuses a file from a newer version", () => {
    const parsed = parsePresetLibrary(
      JSON.stringify({ format: "paka-preset-library", version: 99, presets: [] }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("newer version");
  });

  it("refuses a file that is too large", () => {
    const huge = JSON.stringify({
      format: "paka-preset-library",
      version: 1,
      presets: [{ name: "x".repeat(300_000), brush: DEFAULT_BRUSH }],
    });

    const parsed = parsePresetLibrary(huge);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("too large");
  });

  it("refuses a file that holds more presets than the browser takes", () => {
    const many = Array.from({ length: MAX_PRESET_LIBRARY_ENTRIES + 1 }, (_value, index) => ({
      name: `Brush ${index}`,
      brush: DEFAULT_BRUSH,
    }));
    const parsed = parsePresetLibrary(
      JSON.stringify({ format: "paka-preset-library", version: 1, presets: many }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("more than");
  });

  it("skips a malformed entry and keeps the rest", () => {
    const parsed = parsePresetLibrary(
      JSON.stringify({
        format: "paka-preset-library",
        version: 1,
        presets: [
          { name: "Ink", brush: { size: 30 } },
          { name: 42, brush: {} },
          null,
          { name: "Marker", brush: { size: "big" } },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.skipped).toBe(2);
    expect(parsed.presets.map((preset) => preset.name)).toEqual(["Ink", "Marker"]);
    expect(parsed.presets[1].brush.size).toBe(DEFAULT_BRUSH.size);
  });

  it("writes the file the user chose and reads it back", async () => {
    const gateway = new MemoryProjectGateway();
    gateway.presetLibrarySavePath = "C:\\art\\brushes.json";
    const engine = createEngine();
    engine.saveBrushPreset("Ink");
    const service = new PresetLibraryFiles(gateway);

    const exported = await service.exportLibrary(engine.getState().presets);
    expect(exported.status).toBe("exported");
    expect(gateway.files.has("C:\\art\\brushes.json")).toBe(true);

    gateway.presetLibraryOpenPath = "C:\\art\\brushes.json";
    const read = await service.importLibrary();
    expect(read.status).toBe("read");
    if (read.status !== "read") {
      return;
    }
    expect(read.presets.map((preset) => preset.name)).toEqual(["Ink"]);
  });

  it("reports a file that is not a library instead of importing nothing", async () => {
    const gateway = new MemoryProjectGateway();
    gateway.presetLibraryOpenPath = "C:\\art\\notes.json";
    gateway.files.set("C:\\art\\notes.json", "hello");
    const service = new PresetLibraryFiles(gateway);

    const outcome = await service.importLibrary();

    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") {
      return;
    }
    expect(outcome.message).toContain("notes.json");
  });

  it("does nothing when the user cancels the dialog", async () => {
    const gateway = new MemoryProjectGateway();
    const service = new PresetLibraryFiles(gateway);

    expect((await service.exportLibrary([])).status).toBe("cancelled");
    expect((await service.importLibrary()).status).toBe("cancelled");
  });
});

describe("the library survives a restart", () => {
  it("keeps the user's brushes, their stars and their recency", async () => {
    const gateway = new MemorySettingsGateway();
    const engine = createEngine();
    const store = new SettingsStore({ engine, gateway });
    await store.load();

    const preset = engine.saveBrushPreset("Ink");
    engine.applyBrushPreset(preset?.id ?? "");
    engine.toggleBrushPresetFavorite(preset?.id ?? "");
    await store.flush();

    const second = createEngine();
    const secondStore = new SettingsStore({ engine: second, gateway });
    await secondStore.load();

    const reloaded = userPresets(second.getState().presets);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].name).toBe("Ink");
    expect(reloaded[0].favorite).toBe(true);
    expect(reloaded[0].lastUsedAt).not.toBeNull();

    // The built-in brushes are there as well, and they are still code.
    expect(second.getState().presets.length).toBe(BUNDLED_PRESETS.length + 1);
    const builtin = second.getState().presets.find((entry) => entry.id === BUNDLED_PRESETS[0].id);
    expect(builtin?.brush).toEqual(BUNDLED_PRESETS[0].brush);

    store.destroy();
    secondStore.destroy();
  });

  it("keeps a star on a built-in brush", async () => {
    const gateway = new MemorySettingsGateway();
    const engine = createEngine();
    const store = new SettingsStore({ engine, gateway });
    await store.load();

    const builtin = BUNDLED_PRESETS[0];
    engine.toggleBrushPresetFavorite(builtin.id);
    await store.flush();

    const second = createEngine();
    const secondStore = new SettingsStore({ engine: second, gateway });
    await secondStore.load();

    const starred = second.getState().presets.find((entry) => entry.id === builtin.id);
    expect(starred?.favorite).toBe(true);
    expect(starred?.brush).toEqual(builtin.brush);

    store.destroy();
    secondStore.destroy();
  });
});

describe("the merge that joins the code and the file", () => {
  it("puts the built-in brushes first and the user's after them", () => {
    const merged = mergeBundledPresets([aPreset("mine", "Mine")]);

    expect(merged.map((preset) => preset.id)).toEqual([
      ...BUNDLED_PRESETS.map((preset) => preset.id),
      "mine",
    ]);
  });

  it("keeps the user's own state for a built-in brush", () => {
    const builtin = BUNDLED_PRESETS[0];
    const merged = mergeBundledPresets([
      { ...builtin, favorite: true, lastUsedAt: 42, brush: { ...builtin.brush, size: 999 } },
    ]);

    const stored = merged.find((preset) => preset.id === builtin.id);
    expect(stored?.favorite).toBe(true);
    expect(stored?.lastUsedAt).toBe(42);
    expect(stored?.brush.size).toBe(builtin.brush.size);
  });
});

describe("the keys the list owns", () => {
  it("moves the selection, applies it and asks for its removal", () => {
    expect(presetListIntent("ArrowDown", true)).toEqual({ kind: "move", direction: 1 });
    expect(presetListIntent("ArrowUp", true)).toEqual({ kind: "move", direction: -1 });
    expect(presetListIntent("Home", true)).toEqual({ kind: "first" });
    expect(presetListIntent("End", true)).toEqual({ kind: "last" });
    expect(presetListIntent("Enter", true)).toEqual({ kind: "apply" });
    expect(presetListIntent("Delete", true)).toEqual({ kind: "delete" });
    expect(presetListIntent("Backspace", true)).toEqual({ kind: "delete" });
  });

  it("claims the keys that need a selection only when there is one", () => {
    // Without a selection there is nothing to apply or to remove, and the keys
    // keep their own meaning elsewhere.
    expect(presetListIntent("Enter", false)).toBeNull();
    expect(presetListIntent("Delete", false)).toBeNull();
    expect(presetListIntent("Backspace", false)).toBeNull();
  });

  it("leaves every other key to the browser and to the editor", () => {
    expect(presetListIntent("a", true)).toBeNull();
    expect(presetListIntent("Tab", true)).toBeNull();
    expect(presetListIntent("Escape", true)).toBeNull();
    expect(presetListIntent("z", true)).toBeNull();
  });
});
