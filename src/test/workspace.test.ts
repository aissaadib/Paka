/**
 * Workspace tests.
 *
 * The composition model is pure data, so everything here is about the rules
 * the shell relies on: what the shell is made of, how a malformed file is
 * read, how the parts and the panels compose, and that the live store hands
 * the shell a stable answer.
 */

import { describe, expect, it } from "vitest";
import {
  registerPanel,
  resetPanelRegistry,
  type PanelDefinition,
} from "../core/shell/panelRegistry";
import {
  DEFAULT_SHELL_PREFERENCES,
  normalizeShellPreferences,
  type ShellPreferences,
} from "../core/shell/preferences";
import {
  composeWorkspace,
  compositionPanelsInSlot,
  compositionPartsInRegion,
  DEFAULT_WORKSPACE_SETTINGS,
  findWorkspacePart,
  normalizeWorkspaceSettings,
  parseWorkspaceSettings,
  setWorkspacePartOrder,
  setWorkspacePartShown,
  setWorkspacePartSize,
  workspaceGrid,
  workspacePartsInRegion,
  workspaceSettingsDocument,
  workspaceSettingsEqual,
  WORKSPACE_PART_IDS,
  WORKSPACE_VERSION,
} from "../core/workspace/workspaceSettings";
import {
  createWorkspaceSettingsSection,
  WORKSPACE_SETTINGS_KEY,
} from "../core/workspace/workspaceSettingsSection";
import {
  createWorkspacePreferencesSource,
  createWorkspaceStore,
} from "../state/workspaceStore";

function panel(id: string, slot: PanelDefinition["slot"], order: number): PanelDefinition {
  return { id, title: id, slot, order, render: () => null };
}

/** Waits for the registry's batched notification to arrive. */
function flushNotification(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const PANELS: readonly PanelDefinition[] = [
  panel("color", "right", 0),
  panel("layers", "right", 1),
  panel("brushes", "left", 0),
];

function preferences(overrides: Partial<ShellPreferences> = {}): ShellPreferences {
  return { ...DEFAULT_SHELL_PREFERENCES, ...overrides };
}

describe("the workspace defaults", () => {
  it("has every part of the shell", () => {
    expect(DEFAULT_WORKSPACE_SETTINGS.version).toBe(WORKSPACE_VERSION);
    expect(DEFAULT_WORKSPACE_SETTINGS.parts.map((part) => part.id)).toEqual([
      ...WORKSPACE_PART_IDS,
    ]);
  });

  it("shows every part", () => {
    for (const part of DEFAULT_WORKSPACE_SETTINGS.parts) {
      expect(part.shown).toBe(true);
    }
  });

  it("uses the sizes the shell has always used", () => {
    expect(findWorkspacePart(DEFAULT_WORKSPACE_SETTINGS, "menu-bar")?.size).toBe(30);
    expect(findWorkspacePart(DEFAULT_WORKSPACE_SETTINGS, "tool-bar")?.size).toBe("auto");
    expect(findWorkspacePart(DEFAULT_WORKSPACE_SETTINGS, "tool-rail")?.size).toBe(40);
    expect(findWorkspacePart(DEFAULT_WORKSPACE_SETTINGS, "canvas")?.size).toBe("fill");
    expect(findWorkspacePart(DEFAULT_WORKSPACE_SETTINGS, "side-column")?.size).toBe(216);
    expect(findWorkspacePart(DEFAULT_WORKSPACE_SETTINGS, "status-bar")?.size).toBe(22);
  });

  it("lays the shell out as the stylesheet does", () => {
    const grid = workspaceGrid(composeWorkspace(DEFAULT_WORKSPACE_SETTINGS));
    expect(grid.rows).toBe("30px auto 1fr 22px");
    expect(grid.columns).toBe("40px minmax(0, 1fr) 216px");
  });

  it("keeps the parts in their regions, in order", () => {
    expect(
      workspacePartsInRegion(DEFAULT_WORKSPACE_SETTINGS, "top").map((part) => part.id),
    ).toEqual(["menu-bar", "tool-bar"]);
    expect(
      workspacePartsInRegion(DEFAULT_WORKSPACE_SETTINGS, "body").map((part) => part.id),
    ).toEqual(["tool-rail", "canvas", "side-column"]);
    expect(
      workspacePartsInRegion(DEFAULT_WORKSPACE_SETTINGS, "bottom").map((part) => part.id),
    ).toEqual(["status-bar"]);
  });
});

describe("reading an untrusted workspace", () => {
  it("falls back to the defaults for anything that is not a document", () => {
    expect(normalizeWorkspaceSettings(null)).toBe(DEFAULT_WORKSPACE_SETTINGS);
    expect(normalizeWorkspaceSettings(7)).toBe(DEFAULT_WORKSPACE_SETTINGS);
    expect(normalizeWorkspaceSettings("workspace")).toBe(DEFAULT_WORKSPACE_SETTINGS);
    expect(normalizeWorkspaceSettings([])).toBe(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("ignores a document from a newer version", () => {
    const future = { version: WORKSPACE_VERSION + 1, parts: {} };
    expect(normalizeWorkspaceSettings(future)).toBe(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("takes the default for a part the document does not mention", () => {
    const settings = normalizeWorkspaceSettings({
      version: WORKSPACE_VERSION,
      parts: { "menu-bar": { shown: false, order: 3, size: 30 } },
    });
    expect(findWorkspacePart(settings, "menu-bar")?.shown).toBe(false);
    expect(findWorkspacePart(settings, "menu-bar")?.order).toBe(3);
    expect(findWorkspacePart(settings, "tool-rail")?.size).toBe(40);
  });

  it("takes the default for a malformed field", () => {
    const settings = normalizeWorkspaceSettings({
      version: WORKSPACE_VERSION,
      parts: {
        "menu-bar": { shown: "yes", order: "first", size: "wide" },
      },
    });
    const menuBar = findWorkspacePart(settings, "menu-bar");
    expect(menuBar?.shown).toBe(true);
    expect(menuBar?.order).toBe(0);
    expect(menuBar?.size).toBe(30);
  });

  it("clamps a size that is out of range", () => {
    const settings = normalizeWorkspaceSettings({
      version: WORKSPACE_VERSION,
      parts: {
        "side-column": { shown: true, order: 2, size: 5000 },
        "tool-rail": { shown: true, order: 0, size: 1 },
      },
    });
    expect(findWorkspacePart(settings, "side-column")?.size).toBe(480);
    expect(findWorkspacePart(settings, "tool-rail")?.size).toBe(32);
  });

  it("keeps the kind a part always has", () => {
    const settings = normalizeWorkspaceSettings({
      version: WORKSPACE_VERSION,
      parts: {
        canvas: { shown: true, order: 1, size: 400 },
        "tool-bar": { shown: true, order: 1, size: 400 },
      },
    });
    expect(findWorkspacePart(settings, "canvas")?.size).toBe("fill");
    expect(findWorkspacePart(settings, "tool-bar")?.size).toBe("auto");
  });

  it("drops a part this build does not know", () => {
    const settings = normalizeWorkspaceSettings({
      version: WORKSPACE_VERSION,
      parts: { "floating-dock": { shown: true, order: 0, size: 10 } },
    });
    expect(settings.parts.map((part) => part.id)).toEqual([...WORKSPACE_PART_IDS]);
  });

  it("parses a document that is not JSON at all", () => {
    expect(parseWorkspaceSettings("not json")).toBe(DEFAULT_WORKSPACE_SETTINGS);
    expect(parseWorkspaceSettings(null)).toBe(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("round trips through the document", () => {
    const document = workspaceSettingsDocument(DEFAULT_WORKSPACE_SETTINGS);
    const settings = normalizeWorkspaceSettings(document);
    expect(workspaceSettingsEqual(settings, DEFAULT_WORKSPACE_SETTINGS)).toBe(true);
    expect(parseWorkspaceSettings(JSON.stringify(document))).toEqual(
      DEFAULT_WORKSPACE_SETTINGS,
    );
  });

  it("compares two workspaces field by field", () => {
    expect(workspaceSettingsEqual(DEFAULT_WORKSPACE_SETTINGS, DEFAULT_WORKSPACE_SETTINGS)).toBe(
      true,
    );
    expect(
      workspaceSettingsEqual(
        DEFAULT_WORKSPACE_SETTINGS,
        setWorkspacePartShown(DEFAULT_WORKSPACE_SETTINGS, "status-bar", false),
      ),
    ).toBe(false);
  });
});

describe("changing the workspace", () => {
  it("shows and hides a part", () => {
    const hidden = setWorkspacePartShown(DEFAULT_WORKSPACE_SETTINGS, "tool-rail", false);
    expect(findWorkspacePart(hidden, "tool-rail")?.shown).toBe(false);
    expect(findWorkspacePart(DEFAULT_WORKSPACE_SETTINGS, "tool-rail")?.shown).toBe(true);
  });

  it("moves a part inside its region", () => {
    const moved = setWorkspacePartOrder(DEFAULT_WORKSPACE_SETTINGS, "side-column", 0);
    expect(
      workspacePartsInRegion(moved, "body").map((part) => part.id),
    ).toEqual(["side-column", "tool-rail", "canvas"]);
  });

  it("clamps a size that is out of range", () => {
    const wide = setWorkspacePartSize(DEFAULT_WORKSPACE_SETTINGS, "side-column", 900);
    expect(findWorkspacePart(wide, "side-column")?.size).toBe(480);
  });

  it("leaves the workspace alone for a part it does not know", () => {
    const unchanged = setWorkspacePartShown(
      DEFAULT_WORKSPACE_SETTINGS,
      "floating-dock" as never,
      false,
    );
    expect(unchanged).toBe(DEFAULT_WORKSPACE_SETTINGS);
  });
});

describe("the composition", () => {
  it("takes the panels from the registry", () => {
    const composition = composeWorkspace(
      DEFAULT_WORKSPACE_SETTINGS,
      DEFAULT_SHELL_PREFERENCES,
      PANELS,
    );
    expect(composition.panels.map((entry) => entry.id)).toEqual([
      "brushes",
      "color",
      "layers",
    ]);
    expect(compositionPanelsInSlot(composition, "right").map((entry) => entry.id)).toEqual([
      "color",
      "layers",
    ]);
    expect(compositionPanelsInSlot(composition, "left").map((entry) => entry.id)).toEqual([
      "brushes",
    ]);
  });

  it("docks a panel where the preferences say", () => {
    const composition = composeWorkspace(
      DEFAULT_WORKSPACE_SETTINGS,
      preferences({ panelSlots: { layers: "left" } }),
      PANELS,
    );
    expect(compositionPanelsInSlot(composition, "left").map((entry) => entry.id)).toEqual([
      "brushes",
      "layers",
    ]);
    expect(compositionPanelsInSlot(composition, "right").map((entry) => entry.id)).toEqual([
      "color",
    ]);
  });

  it("falls back to the registry's slot when the preferences name an unknown one", () => {
    const composition = composeWorkspace(
      DEFAULT_WORKSPACE_SETTINGS,
      preferences({ panelSlots: { layers: "middle" as never } }),
      PANELS,
    );
    expect(compositionPanelsInSlot(composition, "right").map((entry) => entry.id)).toEqual([
      "color",
      "layers",
    ]);
  });

  it("hides a panel the user hid", () => {
    const composition = composeWorkspace(
      DEFAULT_WORKSPACE_SETTINGS,
      preferences({ hiddenPanels: ["color"] }),
      PANELS,
    );
    expect(compositionPanelsInSlot(composition, "right").map((entry) => entry.id)).toEqual([
      "layers",
    ]);
    expect(composition.panels.find((entry) => entry.id === "color")?.visible).toBe(false);
  });

  it("shows the panels in the order the preferences give", () => {
    const composition = composeWorkspace(
      DEFAULT_WORKSPACE_SETTINGS,
      preferences({ panelOrder: ["layers", "color"] }),
      PANELS,
    );
    expect(compositionPanelsInSlot(composition, "right").map((entry) => entry.id)).toEqual([
      "layers",
      "color",
    ]);
  });

  it("keeps the panels in the shell's own layout", () => {
    const composition = composeWorkspace(
      DEFAULT_WORKSPACE_SETTINGS,
      preferences({ panelSlots: { layers: "left" }, hiddenPanels: ["brushes"] }),
      PANELS,
    );
    expect(composition.layout.placements).toHaveLength(3);
    expect(composition.layout.placements.find((entry) => entry.panelId === "layers")?.slot).toBe(
      "left",
    );
    expect(
      composition.layout.placements.find((entry) => entry.panelId === "brushes")?.slot,
    ).toBe("hidden");
  });

  it("hides the status bar when the preferences say so", () => {
    const composition = composeWorkspace(
      DEFAULT_WORKSPACE_SETTINGS,
      preferences({ showStatusBar: false }),
      PANELS,
    );
    const statusBar = compositionPartsInRegion(composition, "bottom")[0];
    expect(statusBar?.shown).toBe(false);
    expect(workspaceGrid(composition).rows).toBe("30px auto 1fr");
  });

  it("gives the space of a hidden part back to the canvas", () => {
    const settings = setWorkspacePartShown(DEFAULT_WORKSPACE_SETTINGS, "side-column", false);
    const grid = workspaceGrid(composeWorkspace(settings));
    expect(grid.columns).toBe("40px minmax(0, 1fr)");
  });

  it("gives the space of a hidden row back to the canvas", () => {
    const settings = setWorkspacePartShown(DEFAULT_WORKSPACE_SETTINGS, "menu-bar", false);
    const grid = workspaceGrid(composeWorkspace(settings));
    expect(grid.rows).toBe("auto 1fr 22px");
  });
});

describe("the workspace store", () => {
  it("starts from the defaults", () => {
    const store = createWorkspaceStore();
    expect(store.getState()).toBe(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("changes a part and tells the listeners", () => {
    const store = createWorkspaceStore();
    let told = 0;
    const stop = store.subscribe(() => {
      told += 1;
    });
    store.actions.setPartShown("tool-rail", false);
    expect(told).toBe(1);
    expect(findWorkspacePart(store.getState(), "tool-rail")?.shown).toBe(false);
    stop();
  });

  it("says nothing when a change changes nothing", () => {
    const store = createWorkspaceStore();
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });
    store.actions.setPartShown("tool-rail", true);
    expect(told).toBe(0);
  });

  it("hands the shell the same composition until something changes", () => {
    const store = createWorkspaceStore();
    const first = store.getComposition();
    expect(store.getComposition()).toBe(first);
    store.actions.setPartShown("side-column", false);
    expect(store.getComposition()).not.toBe(first);
    expect(store.getComposition().parts.find((part) => part.id === "side-column")?.shown).toBe(
      false,
    );
  });

  it("takes the workspace it is given", () => {
    const store = createWorkspaceStore();
    const next = setWorkspacePartShown(DEFAULT_WORKSPACE_SETTINGS, "status-bar", false);
    store.applySettings(next);
    expect(store.getState()).toBe(next);
  });

  it("restores the defaults", () => {
    const store = createWorkspaceStore();
    store.actions.setPartShown("tool-rail", false);
    store.actions.restoreDefaults();
    expect(store.getState()).toBe(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("builds the composition from the preferences it is given", () => {
    const source = createWorkspacePreferencesSource();
    const store = createWorkspaceStore({ preferences: source, panels: () => PANELS });
    expect(
      compositionPanelsInSlot(store.getComposition(), "right").map((entry) => entry.id),
    ).toEqual(["color", "layers"]);

    source.setPreferences(normalizeShellPreferences({ hiddenPanels: ["color"] }));
    expect(
      compositionPanelsInSlot(store.getComposition(), "right").map((entry) => entry.id),
    ).toEqual(["layers"]);
  });

  it("shows the panels the registry knows about", () => {
    const store = createWorkspaceStore({ panels: () => PANELS });
    expect(store.getComposition().panels.map((entry) => entry.id)).toEqual([
      "brushes",
      "color",
      "layers",
    ]);
  });

  it("picks up a panel that registers after the first read", async () => {
    // A panel registers itself when its module is evaluated, and that can
    // happen after the shell has painted. The store watches the registry, so
    // the composition is read again and the panel is in it.
    resetPanelRegistry();
    const store = createWorkspaceStore();
    let told = 0;
    const stop = store.subscribe(() => {
      told += 1;
    });

    expect(store.getComposition().panels).toEqual([]);

    registerPanel(panel("layers", "right", 0));
    await flushNotification();

    expect(told).toBe(1);
    expect(store.getComposition().panels.map((entry) => entry.id)).toEqual(["layers"]);

    stop();
    resetPanelRegistry();
  });
});

describe("the workspace settings section", () => {
  it("is stored under its own key", () => {
    const store = createWorkspaceStore();
    const section = createWorkspaceSettingsSection(store);
    expect(section.key).toBe(WORKSPACE_SETTINGS_KEY);
    expect(WORKSPACE_SETTINGS_KEY).toBe("workspace");
  });

  it("round trips through the settings document", () => {
    const store = createWorkspaceStore();
    const section = createWorkspaceSettingsSection(store);
    const document: Record<string, unknown> = {};
    section.write(document, store.getState());
    expect(workspaceSettingsEqual(section.read(document), store.getState())).toBe(true);
  });

  it("reads the defaults out of a document without the key", () => {
    const store = createWorkspaceStore();
    const section = createWorkspaceSettingsSection(store);
    expect(section.read({})).toBe(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("reads the defaults out of a malformed value", () => {
    const store = createWorkspaceStore();
    const section = createWorkspaceSettingsSection(store);
    expect(section.read({ workspace: "nonsense" })).toBe(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("hands the owner what was read from the file", () => {
    const store = createWorkspaceStore();
    const section = createWorkspaceSettingsSection(store);
    const next = setWorkspacePartShown(DEFAULT_WORKSPACE_SETTINGS, "tool-rail", false);
    section.apply(next);
    expect(store.getState()).toBe(next);
  });

  it("tells the store when the owner changes", () => {
    const store = createWorkspaceStore();
    const section = createWorkspaceSettingsSection(store);
    let told = 0;
    section.subscribe(() => {
      told += 1;
    });
    store.actions.setPartShown("tool-rail", false);
    expect(told).toBe(1);
  });
});
