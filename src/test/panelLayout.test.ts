/**
 * Panel manager tests.
 *
 * The panel manager owns three things that a user would notice and that a
 * settings file on disk can break:
 *
 *  - the registry: which panels exist, what they are called and how they are
 *    mounted. A panel that is not registered cannot be shown, so the registry
 *    and the shell can never offer a panel that does not exist.
 *  - the layout: which panels are hidden, which are folded, and what happens
 *    when the layout is reset or read back from a file that has been edited
 *    by hand.
 *  - the store and the settings section: hiding a panel is not an edit, the
 *    layout survives a restart, and a file that cannot be read or written
 *    never stops the editor.
 *
 * Everything runs in Node: the rules are plain modules, and the engine
 * accepts a null renderer, so no canvas is needed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import {
  DEFAULT_PANEL_LAYOUT,
  hideAllPanels,
  isDefaultPanelLayout,
  isPanelCollapsed,
  isPanelVisible,
  normalizePanelLayoutState,
  panelLayoutDocument,
  panelLayoutEqual,
  parsePanelLayoutState,
  resetPanelLayout,
  serializePanelLayoutState,
  setPanelCollapsed,
  setPanelVisibility,
  shouldMountPanel,
  showAllPanels,
  togglePanelVisibility,
  visiblePanelIds,
  type PanelLayoutState,
} from "../core/panels/panelLayout";
import {
  PANEL_LAYOUT_KEY,
  createPanelLayoutSection,
} from "../core/panels/panelLayoutSection";
import {
  defaultVisiblePanelIds,
  findPanelDefinition,
  isPanelId,
  panelDefinitions,
  registerPanel,
  sidePanelDefinitions,
  unregisterPanel,
} from "../core/panels/panelRegistry";
import { SettingsStore } from "../core/settings/settingsStore";
import { createPanelStore } from "../state/panelStore";
import { MemoryProjectGateway } from "./support/memoryGateway";
import { MemorySettingsGateway } from "./support/memorySettingsGateway";
import { createEditor } from "../state/editorStore";

/**
 * The panels the tests work with.
 *
 * The registry is the shell's shared contract and a panel registers itself,
 * so a test registers the panels it needs and takes them away again.
 */
const TEST_PANELS = [
  { id: "color", title: "Colour", order: 0, mounting: "always" },
  { id: "layers", title: "Layers", order: 10, mounting: "when-visible" },
  { id: "navigator", title: "Navigator", order: 20, mounting: "when-visible" },
] as const;

function registerTestPanels(): void {
  for (const panel of TEST_PANELS) {
    registerPanel({
      id: panel.id,
      title: panel.title,
      slot: "right",
      order: panel.order,
      mounting: panel.mounting,
      render: () => null,
    });
  }
}

function unregisterTestPanels(): void {
  for (const panel of TEST_PANELS) {
    unregisterPanel(panel.id);
  }
}

beforeEach(() => {
  registerTestPanels();
});

afterEach(() => {
  unregisterTestPanels();
});

describe("the panel registry", () => {
  it("gives every panel a unique id and a place in the stack", () => {
    const definitions = panelDefinitions();
    const ids = definitions.map((definition) => definition.id);

    expect(new Set(ids).size).toBe(ids.length);
    // The stack order comes from the registry's own order field, not from the
    // order the ids happen to be written in.
    const orders = definitions.map((definition) => definition.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("knows only the panels that exist", () => {
    expect(isPanelId("color")).toBe(true);
    expect(isPanelId("layers")).toBe(true);
    expect(isPanelId("navigator")).toBe(true);
    expect(isPanelId("palette")).toBe(false);
    expect(isPanelId("")).toBe(false);
    expect(isPanelId(null)).toBe(false);
    expect(isPanelId(7)).toBe(false);
    expect(findPanelDefinition("color")?.title).toBe("Colour");
  });

  it("shows every panel in a fresh layout", () => {
    expect(defaultVisiblePanelIds()).toEqual(panelDefinitions().map((definition) => definition.id));
  });

  it("owns the panels that dock in the side column", () => {
    expect(sidePanelDefinitions().map((definition) => definition.id)).toEqual([
      "color",
      "layers",
      "navigator",
    ]);
  });
});

describe("the panel layout", () => {
  it("starts with every panel shown and unfolded", () => {
    expect(DEFAULT_PANEL_LAYOUT.hidden).toEqual([]);
    expect(DEFAULT_PANEL_LAYOUT.collapsed).toEqual([]);
    expect(isDefaultPanelLayout(DEFAULT_PANEL_LAYOUT)).toBe(true);
    expect(visiblePanelIds(DEFAULT_PANEL_LAYOUT)).toEqual(
      panelDefinitions().map((definition) => definition.id),
    );
  });

  it("hides and shows one panel", () => {
    const hidden = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", false);

    expect(isPanelVisible(hidden, "color")).toBe(false);
    expect(isPanelVisible(hidden, "layers")).toBe(true);
    expect(visiblePanelIds(hidden)).not.toContain("color");

    const shown = setPanelVisibility(hidden, "color", true);
    expect(isPanelVisible(shown, "color")).toBe(true);
    expect(panelLayoutEqual(shown, DEFAULT_PANEL_LAYOUT)).toBe(true);
  });

  it("does not change the layout when nothing changes", () => {
    expect(setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", true)).toBe(DEFAULT_PANEL_LAYOUT);
    expect(setPanelCollapsed(DEFAULT_PANEL_LAYOUT, "color", false)).toBe(DEFAULT_PANEL_LAYOUT);
    expect(showAllPanels(DEFAULT_PANEL_LAYOUT)).toBe(DEFAULT_PANEL_LAYOUT);
  });

  it("toggles a panel", () => {
    const hidden = togglePanelVisibility(DEFAULT_PANEL_LAYOUT, "layers");
    expect(isPanelVisible(hidden, "layers")).toBe(false);
    expect(isPanelVisible(togglePanelVisibility(hidden, "layers"), "layers")).toBe(true);
  });

  it("keeps the folded state of a hidden panel", () => {
    const collapsed = setPanelCollapsed(DEFAULT_PANEL_LAYOUT, "color", true);
    const hidden = setPanelVisibility(collapsed, "color", false);
    const shown = setPanelVisibility(hidden, "color", true);

    expect(isPanelCollapsed(hidden, "color")).toBe(true);
    expect(isPanelCollapsed(shown, "color")).toBe(true);
  });

  it("shows every panel again", () => {
    const hidden = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", false);

    expect(isPanelVisible(showAllPanels(hidden), "color")).toBe(true);
    expect(showAllPanels(hidden).collapsed).toEqual([]);
  });

  it("hides every panel, so the canvas takes the window", () => {
    const hidden = hideAllPanels(DEFAULT_PANEL_LAYOUT);

    expect(visiblePanelIds(hidden)).toEqual([]);
    expect(hidden.hidden.length).toBe(panelDefinitions().length);
    expect(hideAllPanels(hidden)).toBe(hidden);
    expect(isPanelVisible(showAllPanels(hidden), "color")).toBe(true);
  });

  it("restores the default layout", () => {
    const changed = setPanelVisibility(
      setPanelCollapsed(DEFAULT_PANEL_LAYOUT, "layers", true),
      "color",
      false,
    );

    const reset = resetPanelLayout();
    expect(isDefaultPanelLayout(reset)).toBe(true);
    expect(reset).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(changed).not.toEqual(reset);
  });

  it("round-trips through the file", () => {
    const state = setPanelVisibility(
      setPanelCollapsed(DEFAULT_PANEL_LAYOUT, "navigator", true),
      "layers",
      false,
    );

    const parsed = parsePanelLayoutState(serializePanelLayoutState(state));
    expect(parsed).toEqual(state);
    expect(parsed.version).toBe(DEFAULT_PANEL_LAYOUT.version);
  });

  it("drops the ids the registry does not know", () => {
    const state = normalizePanelLayoutState({
      version: 1,
      hidden: ["color", "palette", "colour"],
      collapsed: ["layers", "layers"],
    });

    expect(state.hidden).toEqual(["color"]);
    expect(state.collapsed).toEqual(["layers"]);
  });

  it("takes the default for a missing, malformed or future document", () => {
    expect(normalizePanelLayoutState(undefined)).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(normalizePanelLayoutState("nonsense")).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(normalizePanelLayoutState({ version: 99, hidden: ["color"] })).toEqual(
      DEFAULT_PANEL_LAYOUT,
    );
    expect(normalizePanelLayoutState({ hidden: "color" })).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(parsePanelLayoutState(null)).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(parsePanelLayoutState("{not json")).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it("mounts a panel that keeps its state, and unmounts one that does not", () => {
    const definitions = panelDefinitions();
    const colour = definitions.find((definition) => definition.id === "color");
    const layers = definitions.find((definition) => definition.id === "layers");
    expect(colour).toBeDefined();
    expect(layers).toBeDefined();

    const hidden = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", false);
    const hiddenLayers = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "layers", false);

    // The colour panel keeps React state of its own, so it stays mounted.
    expect(shouldMountPanel(colour!, hidden)).toBe(true);
    // The layers panel is derived from the document, so it is unmounted.
    expect(shouldMountPanel(layers!, hiddenLayers)).toBe(false);
    expect(shouldMountPanel(layers!, DEFAULT_PANEL_LAYOUT)).toBe(true);
  });
});

describe("the panel store", () => {
  it("tells its listeners when the layout changes", () => {
    const store = createPanelStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.actions.togglePanel("color");
    expect(notifications).toBe(1);
    expect(isPanelVisible(store.getState(), "color")).toBe(false);

    store.actions.togglePanel("color");
    expect(notifications).toBe(2);
  });

  it("says nothing when the layout does not change", () => {
    const store = createPanelStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.actions.setPanelVisible("color", true);
    store.actions.setPanelCollapsed("color", false);
    store.actions.showAllPanels();
    expect(notifications).toBe(0);
  });

  it("restores a layout", () => {
    const store = createPanelStore();

    store.actions.togglePanel("layers");
    store.actions.setPanelCollapsed("navigator", true);
    const saved = store.getState();

    const other = createPanelStore();
    other.applyLayout(saved);
    expect(other.getState()).toEqual(saved);
    expect(isPanelVisible(other.getState(), "layers")).toBe(false);
    expect(isPanelCollapsed(other.getState(), "navigator")).toBe(true);
  });

  it("resets to the default layout", () => {
    const store = createPanelStore();

    store.actions.togglePanel("color");
    store.actions.setPanelCollapsed("layers", true);
    store.actions.resetLayout();

    expect(store.getState()).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it("is not an edit: the document is untouched", () => {
    const editor = createEditor({ fileGateway: new MemoryProjectGateway() });
    const before = editor.getState();
    const store = createPanelStore();

    store.actions.togglePanel("color");
    store.actions.setPanelCollapsed("layers", true);
    store.actions.resetLayout();

    const after = editor.getState();
    expect(after.file.dirty).toBe(false);
    expect(after.history.depth).toBe(0);
    expect(after.history.canUndo).toBe(false);
    expect(after.document).toBe(before.document);
    editor.engine.destroy();
  });
});

describe("the panel layout as a settings section", () => {
  it("reads and writes its own key", () => {
    const store = createPanelStore();
    const section = createPanelLayoutSection(store);

    store.actions.togglePanel("color");
    const document: Record<string, unknown> = {};
    section.write(document, section.current());

    expect(Object.keys(document)).toEqual([PANEL_LAYOUT_KEY]);
    expect(document[PANEL_LAYOUT_KEY]).toEqual(panelLayoutDocument(store.getState()));

    const other = createPanelStore();
    const readSection = createPanelLayoutSection(other);
    readSection.apply(readSection.read(document));
    expect(other.getState()).toEqual(store.getState());
  });

  it("takes the default for a missing key", () => {
    const store = createPanelStore();
    const section = createPanelLayoutSection(store);

    section.apply(section.read({}));
    expect(store.getState()).toEqual(DEFAULT_PANEL_LAYOUT);
  });
});

describe("the settings store with a panel section", () => {
  it("writes the layout into the settings file and reads it back", async () => {
    const gateway = new MemorySettingsGateway();
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 200, height: 120 }),
    });
    const panels = createPanelStore();
    const store = new SettingsStore({
      engine,
      gateway,
      sections: [createPanelLayoutSection(panels)],
    });

    await store.load();
    panels.actions.togglePanel("layers");
    panels.actions.setPanelCollapsed("navigator", true);
    await store.flush();

    const written = gateway.contents;
    expect(written).not.toBeNull();
    const document = JSON.parse(written as string) as Record<string, unknown>;
    expect(document[PANEL_LAYOUT_KEY]).toEqual({
      version: 1,
      hidden: ["layers"],
      collapsed: ["navigator"],
    });

    // A second start reads the layout back.
    const restored = createPanelStore();
    const second = new SettingsStore({
      engine,
      gateway,
      sections: [createPanelLayoutSection(restored)],
    });
    await second.load();

    expect(restored.getState().hidden).toEqual(["layers"]);
    expect(restored.getState().collapsed).toEqual(["navigator"]);
    store.destroy();
    second.destroy();
    engine.destroy();
  });

  it("starts with the default layout when the file is broken", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = "{not json";
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 200, height: 120 }),
    });
    const panels = createPanelStore();
    const store = new SettingsStore({
      engine,
      gateway,
      sections: [createPanelLayoutSection(panels)],
    });

    await store.load();
    expect(panels.getState()).toEqual(DEFAULT_PANEL_LAYOUT);
    store.destroy();
    engine.destroy();
  });
});

describe("the layout document", () => {
  it("holds only the ids the registry knows", () => {
    const state: PanelLayoutState = {
      version: 1,
      hidden: ["color"],
      collapsed: [],
    };
    expect(panelLayoutDocument(state)).toEqual({
      version: 1,
      hidden: ["color"],
      collapsed: [],
    });
  });
});
