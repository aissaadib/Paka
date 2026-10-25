/**
 * Panel layout state tests.
 *
 * The layout is written to disk, so it is untrusted like any other file: a
 * truncated, hand-edited or newer file must still open the editor. What
 * matters is that a valid layout survives a restart unchanged, and that a
 * broken one loses only the broken part - a panel this build does not have,
 * a slot this build does not have - and nothing else.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PERSISTED_PANEL_LAYOUT,
  PANEL_LAYOUT_KEY,
  PANEL_LAYOUT_SECTION_VERSION,
  applyPersistedPanelLayout,
  createPanelLayoutSection,
  normalizePersistedPanelLayout,
  parsePersistedPanelLayout,
  persistedPanelLayoutDocument,
  persistedPanelLayoutEqual,
  persistedPanelLayoutOf,
  serializePersistedPanelLayout,
  type PanelLayoutSectionSource,
  type PersistedPanelLayout,
} from "../core/panels/panelLayoutSection";
import {
  registerPanel,
  resetPanelRegistry,
  type PanelDefinition,
} from "../core/shell/panelRegistry";
import { DEFAULT_SHELL_PREFERENCES, type ShellPreferences } from "../core/shell/preferences";

function panel(id: string, slot: PanelDefinition["slot"] = "right"): PanelDefinition {
  return { id, title: id, slot, order: 0, render: () => null };
}

/** An owner of the layout: the thing the settings store hands the state to. */
function fakeOwner(initial: PersistedPanelLayout = DEFAULT_PERSISTED_PANEL_LAYOUT) {
  let state = initial;
  const listeners = new Set<() => void>();
  const owner: PanelLayoutSectionSource & { listenerCount: () => number } = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyLayout: (layout) => {
      state = layout;
    },
    listenerCount: () => listeners.size,
  };
  return owner;
}

beforeEach(() => {
  resetPanelRegistry();
});

describe("the panel layout", () => {
  it("starts with nothing hidden, nothing folded and nothing docked", () => {
    expect(DEFAULT_PERSISTED_PANEL_LAYOUT.hiddenPanels).toEqual([]);
    expect(DEFAULT_PERSISTED_PANEL_LAYOUT.foldedPanels).toEqual([]);
    expect(DEFAULT_PERSISTED_PANEL_LAYOUT.panelOrder).toEqual([]);
    expect(DEFAULT_PERSISTED_PANEL_LAYOUT.panelSlots).toEqual({});
    expect(DEFAULT_PERSISTED_PANEL_LAYOUT.version).toBe(PANEL_LAYOUT_SECTION_VERSION);
  });

  it("reads the fields it can read", () => {
    const layout = normalizePersistedPanelLayout({
      hiddenPanels: ["history"],
      foldedPanels: ["colour"],
      panelOrder: ["layers", "colour"],
      panelSlots: { layers: "left" },
    });
    expect(layout.hiddenPanels).toEqual(["history"]);
    expect(layout.foldedPanels).toEqual(["colour"]);
    expect(layout.panelOrder).toEqual(["layers", "colour"]);
    expect(layout.panelSlots).toEqual({ layers: "left" });
    expect(layout.version).toBe(PANEL_LAYOUT_SECTION_VERSION);
  });

  it("falls back to the defaults for anything that is not a document", () => {
    for (const value of [null, undefined, 3, "panels", []]) {
      expect(normalizePersistedPanelLayout(value)).toEqual(DEFAULT_PERSISTED_PANEL_LAYOUT);
    }
  });

  it("falls back to the defaults for a malformed field", () => {
    const layout = normalizePersistedPanelLayout({
      hiddenPanels: "layers",
      foldedPanels: 7,
      panelOrder: { layers: 0 },
      panelSlots: "right",
    });
    expect(layout).toEqual(DEFAULT_PERSISTED_PANEL_LAYOUT);
  });
});

describe("reading an untrusted layout", () => {
  it("drops a slot this build does not have", () => {
    const layout = normalizePersistedPanelLayout({
      panelSlots: { layers: "middle", colour: "right" },
    });
    expect(layout.panelSlots).toEqual({ colour: "right" });
  });

  it("drops a panel id this build does not know", () => {
    registerPanel(panel("layers"));
    registerPanel(panel("colour"));
    const layout = normalizePersistedPanelLayout({
      hiddenPanels: ["layers", "legacy"],
      foldedPanels: ["legacy"],
      panelOrder: ["colour", "legacy"],
      panelSlots: { layers: "left", legacy: "right" },
    });
    expect(layout.hiddenPanels).toEqual(["layers"]);
    expect(layout.foldedPanels).toEqual([]);
    expect(layout.panelOrder).toEqual(["colour"]);
    expect(layout.panelSlots).toEqual({ layers: "left" });
  });

  it("keeps the ids when no panel has registered yet", () => {
    const layout = normalizePersistedPanelLayout({
      hiddenPanels: ["layers"],
      panelOrder: ["colour"],
      panelSlots: { layers: "left" },
    });
    expect(layout.hiddenPanels).toEqual(["layers"]);
    expect(layout.panelOrder).toEqual(["colour"]);
    expect(layout.panelSlots).toEqual({ layers: "left" });
  });

  it("drops a blank panel id", () => {
    const layout = normalizePersistedPanelLayout({
      hiddenPanels: ["layers", "  "],
      foldedPanels: ["", "colour"],
    });
    expect(layout.hiddenPanels).toEqual(["layers"]);
    expect(layout.foldedPanels).toEqual(["colour"]);
  });

  it("drops a duplicate panel id", () => {
    const layout = normalizePersistedPanelLayout({
      hiddenPanels: ["layers", "layers"],
      foldedPanels: ["colour", "colour"],
      panelOrder: ["layers", "layers", "colour"],
    });
    expect(layout.hiddenPanels).toEqual(["layers"]);
    expect(layout.foldedPanels).toEqual(["colour"]);
    expect(layout.panelOrder).toEqual(["layers", "colour"]);
  });

  it("ignores a field this build does not know", () => {
    const layout = normalizePersistedPanelLayout({
      hiddenPanels: ["layers"],
      somethingNew: { nested: true },
    });
    expect(layout.hiddenPanels).toEqual(["layers"]);
  });

  it("takes the known ids from the caller when it is given them", () => {
    const layout = normalizePersistedPanelLayout(
      {
        hiddenPanels: ["layers", "colour"],
        foldedPanels: ["colour"],
        panelSlots: { layers: "left", colour: "right" },
      },
      { knownPanelIds: ["layers"] },
    );
    expect(layout.hiddenPanels).toEqual(["layers"]);
    expect(layout.foldedPanels).toEqual([]);
    expect(layout.panelSlots).toEqual({ layers: "left" });
  });

  it("drops every id when the build knows no panels", () => {
    const layout = normalizePersistedPanelLayout(
      { hiddenPanels: ["layers"], panelOrder: ["layers"] },
      { knownPanelIds: [] },
    );
    expect(layout.hiddenPanels).toEqual([]);
    expect(layout.panelOrder).toEqual([]);
  });
});

describe("the layout file", () => {
  it("round-trips without changing the layout", () => {
    registerPanel(panel("layers"));
    registerPanel(panel("colour"));
    registerPanel(panel("history"));
    const layout: PersistedPanelLayout = {
      version: PANEL_LAYOUT_SECTION_VERSION,
      hiddenPanels: ["history"],
      foldedPanels: ["colour"],
      panelOrder: ["layers", "colour"],
      panelSlots: { layers: "left", colour: "right" },
    };
    const text = serializePersistedPanelLayout(layout);
    expect(parsePersistedPanelLayout(text)).toEqual(layout);
  });

  it("loads a file the current build wrote", () => {
    registerPanel(panel("layers"));
    const layout = persistedPanelLayoutOf(
      { ...DEFAULT_SHELL_PREFERENCES, hiddenPanels: ["layers"], panelSlots: { layers: "left" } },
      ["layers"],
    );
    const text = serializePersistedPanelLayout(layout);
    expect(parsePersistedPanelLayout(text)).toEqual(layout);
  });

  it("loads a file with fields this build does not know", () => {
    registerPanel(panel("layers"));
    const text = JSON.stringify({
      version: PANEL_LAYOUT_SECTION_VERSION,
      hiddenPanels: ["layers"],
      foldedPanels: ["layers"],
      panelOrder: ["layers"],
      panelSlots: { layers: "left" },
      somethingNew: { nested: true },
    });
    expect(parsePersistedPanelLayout(text)).toEqual({
      version: PANEL_LAYOUT_SECTION_VERSION,
      hiddenPanels: ["layers"],
      foldedPanels: ["layers"],
      panelOrder: ["layers"],
      panelSlots: { layers: "left" },
    });
  });

  it("reads the fields it shares from a file a newer build wrote", () => {
    registerPanel(panel("layers"));
    const text = JSON.stringify({
      version: PANEL_LAYOUT_SECTION_VERSION + 1,
      hiddenPanels: ["layers"],
      somethingNew: true,
    });
    expect(parsePersistedPanelLayout(text).hiddenPanels).toEqual(["layers"]);
  });

  it("falls back to the defaults for a file that is not JSON", () => {
    expect(parsePersistedPanelLayout("not json at all")).toEqual(
      DEFAULT_PERSISTED_PANEL_LAYOUT,
    );
    expect(parsePersistedPanelLayout("")).toEqual(DEFAULT_PERSISTED_PANEL_LAYOUT);
    expect(parsePersistedPanelLayout(null)).toEqual(DEFAULT_PERSISTED_PANEL_LAYOUT);
  });

  it("carries the version in the file", () => {
    const text = serializePersistedPanelLayout(DEFAULT_PERSISTED_PANEL_LAYOUT);
    expect(JSON.parse(text).version).toBe(PANEL_LAYOUT_SECTION_VERSION);
  });
});

describe("the settings section", () => {
  it("is stored under the panels key", () => {
    expect(createPanelLayoutSection(fakeOwner()).key).toBe(PANEL_LAYOUT_KEY);
  });

  it("carries its own version", () => {
    expect(createPanelLayoutSection(fakeOwner()).version).toBe(PANEL_LAYOUT_SECTION_VERSION);
  });

  it("reads its own key out of a settings document", () => {
    registerPanel(panel("layers"));
    const document: Record<string, unknown> = {
      version: 1,
      brush: { size: 12 },
      panels: { hiddenPanels: ["layers"], panelSlots: { layers: "left" } },
    };
    const section = createPanelLayoutSection(fakeOwner());
    expect(section.read(document).hiddenPanels).toEqual(["layers"]);
    expect(section.read(document).panelSlots).toEqual({ layers: "left" });
  });

  it("falls back to the defaults when the document has no panels key", () => {
    const section = createPanelLayoutSection(fakeOwner());
    expect(section.read({ version: 1 })).toEqual(DEFAULT_PERSISTED_PANEL_LAYOUT);
  });

  it("writes its own key and leaves the rest of the document alone", () => {
    const document: Record<string, unknown> = { version: 1, brush: { size: 12 } };
    const layout: PersistedPanelLayout = {
      version: PANEL_LAYOUT_SECTION_VERSION,
      hiddenPanels: ["history"],
      foldedPanels: [],
      panelOrder: [],
      panelSlots: {},
    };
    createPanelLayoutSection(fakeOwner()).write(document, layout);
    expect(document.brush).toEqual({ size: 12 });
    expect(document.version).toBe(1);
    expect(document[PANEL_LAYOUT_KEY]).toEqual(persistedPanelLayoutDocument(layout));
  });

  it("hands the layout to its owner and tells it about changes", () => {
    const owner = fakeOwner();
    const section = createPanelLayoutSection(owner);
    const layout: PersistedPanelLayout = {
      version: PANEL_LAYOUT_SECTION_VERSION,
      hiddenPanels: ["history"],
      foldedPanels: [],
      panelOrder: [],
      panelSlots: {},
    };
    section.apply(layout);
    expect(owner.getState()).toEqual(layout);
    expect(section.current()).toEqual(layout);
    const unsubscribe = section.subscribe(() => {});
    expect(owner.listenerCount()).toBe(1);
    unsubscribe();
    expect(owner.listenerCount()).toBe(0);
  });

  it("survives a restart", () => {
    registerPanel(panel("layers"));
    const layout: PersistedPanelLayout = {
      version: PANEL_LAYOUT_SECTION_VERSION,
      hiddenPanels: ["layers"],
      foldedPanels: ["layers"],
      panelOrder: ["layers"],
      panelSlots: { layers: "left" },
    };

    const before = fakeOwner(layout);
    const document: Record<string, unknown> = {};
    createPanelLayoutSection(before).write(document, layout);

    const after = fakeOwner();
    const section = createPanelLayoutSection(after);
    section.apply(section.read(document));
    expect(after.getState()).toEqual(layout);
  });

  it("writes a layout it read back unchanged", () => {
    registerPanel(panel("layers"));
    registerPanel(panel("colour"));
    const section = createPanelLayoutSection(fakeOwner());
    const text = JSON.stringify({
      version: PANEL_LAYOUT_SECTION_VERSION,
      hiddenPanels: ["colour"],
      foldedPanels: ["layers"],
      panelOrder: ["layers", "colour"],
      panelSlots: { colour: "right", layers: "left" },
    });
    const layout = parsePersistedPanelLayout(text);
    const document: Record<string, unknown> = {};
    section.write(document, layout);
    expect(section.read(document)).toEqual(layout);
    expect(parsePersistedPanelLayout(JSON.stringify(document[PANEL_LAYOUT_KEY]))).toEqual(
      layout,
    );
  });
});

describe("comparing layouts", () => {
  it("sees a different folded panel as different", () => {
    const a = DEFAULT_PERSISTED_PANEL_LAYOUT;
    const b: PersistedPanelLayout = { ...a, foldedPanels: ["colour"] };
    expect(persistedPanelLayoutEqual(a, b)).toBe(false);
  });

  it("sees a different slot as different", () => {
    const a = DEFAULT_PERSISTED_PANEL_LAYOUT;
    const b: PersistedPanelLayout = { ...a, panelSlots: { layers: "left" } };
    expect(persistedPanelLayoutEqual(a, b)).toBe(false);
  });

  it("sees the same layout as equal", () => {
    const layout: PersistedPanelLayout = {
      version: PANEL_LAYOUT_SECTION_VERSION,
      hiddenPanels: ["layers"],
      foldedPanels: ["colour"],
      panelOrder: ["layers"],
      panelSlots: { layers: "left" },
    };
    expect(persistedPanelLayoutEqual(layout, { ...layout })).toBe(true);
  });
});

describe("the shell preferences", () => {
  it("carries the panel part of the preferences", () => {
    const preferences: ShellPreferences = {
      ...DEFAULT_SHELL_PREFERENCES,
      hiddenPanels: ["layers"],
      panelOrder: ["colour"],
      panelSlots: { layers: "left" },
    };
    const layout = persistedPanelLayoutOf(preferences, ["colour"]);
    expect(layout.hiddenPanels).toEqual(["layers"]);
    expect(layout.panelOrder).toEqual(["colour"]);
    expect(layout.panelSlots).toEqual({ layers: "left" });
    expect(layout.foldedPanels).toEqual(["colour"]);
  });

  it("gets the panel part back", () => {
    const preferences = { ...DEFAULT_SHELL_PREFERENCES, theme: "dark" as const };
    const layout = persistedPanelLayoutOf(preferences, ["colour"]);
    const restored = applyPersistedPanelLayout(preferences, layout);
    expect(restored).toEqual(preferences);
    expect(restored.theme).toBe("dark");
  });
});
