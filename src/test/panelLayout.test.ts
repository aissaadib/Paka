/**
 * The panel manager's tests.
 *
 * The panel catalogue, the layout rules, the settings section and the store
 * are plain modules, so the whole of the panel manager can be exercised in
 * Node. What matters:
 *
 *  - the catalogue is a closed, stable list: the ids are the ones the
 *    settings file stores, and a renamed panel keeps its id;
 *  - the layout rules never throw on an untrusted document, and drop what
 *    they do not understand;
 *  - the store is the only thing that changes the layout, and it tells
 *    nobody about a change that did not happen.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_VERSION,
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
  DEFAULT_PERSISTED_PANEL_LAYOUT,
  PANEL_LAYOUT_KEY,
  applyPersistedPanelLayout,
  createPanelLayoutSection,
  normalizePersistedPanelLayout,
  persistedPanelLayoutDocument,
  persistedPanelLayoutOf,
  type PersistedPanelLayout,
} from "../core/panels/panelLayoutSection";
import {
  createPanelLayoutSource,
  panelLayoutStateOfPersisted,
  persistedLayoutOfState,
} from "../core/panels/panelLayoutBridge";
import {
  PANEL_SIDE_SLOT,
  defaultVisiblePanelIds,
  findPanelDefinition,
  isPanelId,
  knownPanelIds,
  panelDefinitions,
  registerCataloguePanel,
  sidePanelDefinitions,
  toShellPanelDefinition,
  type PanelId,
} from "../core/panels/panelRegistry";
import {
  findPanel,
  listPanels,
  resetPanelRegistry,
} from "../core/shell/panelRegistry";
import { DEFAULT_SHELL_PREFERENCES } from "../core/shell/preferences";
import { createPanelStore } from "../state/panelStore";

beforeEach(() => {
  resetPanelRegistry();
});

describe("the panel catalogue", () => {
  it("lists the panels the shell knows, in stack order", () => {
    const ids = knownPanelIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    const orders = panelDefinitions().map((definition) => definition.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("gives every panel a label, an icon and a description", () => {
    for (const definition of panelDefinitions()) {
      expect(definition.label.trim()).not.toBe("");
      expect(definition.icon.trim()).not.toBe("");
      expect(definition.description.trim()).not.toBe("");
    }
  });

  it("keeps the panels of the side column", () => {
    const side = sidePanelDefinitions();
    expect(side.length).toBeGreaterThan(0);
    expect(side.every((definition) => definition.slot === PANEL_SIDE_SLOT)).toBe(true);
  });

  it("recognises a catalogued id and refuses the rest", () => {
    expect(isPanelId("color")).toBe(true);
    expect(isPanelId("history")).toBe(false);
    expect(isPanelId(3)).toBe(false);
    expect(isPanelId(null)).toBe(false);
  });

  it("finds a panel by its id", () => {
    const id = knownPanelIds()[0];
    expect(findPanelDefinition(id)?.id).toBe(id);
    expect(findPanelDefinition("history" as PanelId)).toBeUndefined();
  });

  it("shows the panels that are visible by default", () => {
    const visible = defaultVisiblePanelIds();
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((id) => isPanelId(id))).toBe(true);
  });

  it("maps a catalogue entry onto the shell's mount-registry contract", () => {
    const definition = findPanelDefinition("layers");
    expect(definition).toBeDefined();
    const shellDefinition = toShellPanelDefinition(definition!, () => null);
    expect(shellDefinition.id).toBe(definition!.id);
    expect(shellDefinition.title).toBe(definition!.label);
    expect(shellDefinition.slot).toBe(definition!.slot);
    expect(shellDefinition.order).toBe(definition!.order);
    expect(shellDefinition.collapsible).toBe(definition!.collapsible);
    expect(shellDefinition.grow).toBe(definition!.grow);
    expect(shellDefinition.mounting).toBe(definition!.mounting);
  });

  it("registers a catalogue entry in the shell's mount registry", () => {
    const definition = findPanelDefinition("color");
    expect(definition).toBeDefined();
    registerCataloguePanel(definition!, () => null);
    expect(findPanel("color")?.slot).toBe(PANEL_SIDE_SLOT);
    expect(listPanels().map((entry) => entry.id)).toContain("color");
  });
});

describe("the panel layout", () => {
  it("starts with the panels the catalogue shows by default", () => {
    const defaultHidden = panelDefinitions()
      .filter((definition) => !definition.defaultVisible)
      .map((definition) => definition.id);
    expect([...DEFAULT_PANEL_LAYOUT.hidden]).toEqual(defaultHidden);
    expect(DEFAULT_PANEL_LAYOUT.version).toBe(PANEL_LAYOUT_VERSION);
  });

  it("says which panel is shown and which is folded", () => {
    const state = setPanelVisibility(
      setPanelCollapsed(DEFAULT_PANEL_LAYOUT, "color", true),
      "layers",
      false,
    );
    expect(isPanelVisible(state, "layers")).toBe(false);
    expect(isPanelVisible(state, "color")).toBe(true);
    expect(isPanelCollapsed(state, "color")).toBe(true);
    expect(isPanelCollapsed(state, "layers")).toBe(false);
  });

  it("lists the visible panels in stack order", () => {
    const state = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "layers", false);
    const visible = visiblePanelIds(state);
    expect(visible).not.toContain("layers");
    expect(visible).toEqual(
      knownPanelIds().filter((id) => id !== "layers" && isPanelVisible(state, id)),
    );
  });

  it("shows and hides one panel", () => {
    const hidden = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", false);
    expect(hidden.hidden).toContain("color");
    const shown = setPanelVisibility(hidden, "color", true);
    expect(shown.hidden).not.toContain("color");
  });

  it("does not change the layout when nothing changes", () => {
    expect(setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", true)).toBe(
      DEFAULT_PANEL_LAYOUT,
    );
    expect(setPanelCollapsed(DEFAULT_PANEL_LAYOUT, "color", false)).toBe(
      DEFAULT_PANEL_LAYOUT,
    );
  });

  it("toggles a panel", () => {
    const toggled = togglePanelVisibility(DEFAULT_PANEL_LAYOUT, "color");
    expect(isPanelVisible(toggled, "color")).toBe(false);
    expect(isPanelVisible(togglePanelVisibility(toggled, "color"), "color")).toBe(true);
  });

  it("keeps a hidden panel's folded state", () => {
    const folded = setPanelCollapsed(DEFAULT_PANEL_LAYOUT, "color", true);
    const hidden = setPanelVisibility(folded, "color", false);
    expect(isPanelCollapsed(hidden, "color")).toBe(true);
  });

  it("shows every panel and hides every panel", () => {
    const hidden = hideAllPanels(DEFAULT_PANEL_LAYOUT);
    expect(hidden.hidden.length).toBe(knownPanelIds().length);
    expect(visiblePanelIds(hidden)).toEqual([]);
    const shown = showAllPanels(hidden);
    expect(shown.hidden).toEqual([]);
  });

  it("restores the layout a fresh installation starts from", () => {
    const changed = hideAllPanels(setPanelCollapsed(DEFAULT_PANEL_LAYOUT, "color", true));
    expect(isDefaultPanelLayout(changed)).toBe(false);
    const reset = resetPanelLayout();
    expect(isDefaultPanelLayout(reset)).toBe(true);
    expect(reset).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it("mounts a panel that keeps its state, and unmounts one that does not", () => {
    const stateful = findPanelDefinition("color");
    const derived = findPanelDefinition("layers");
    expect(stateful).toBeDefined();
    expect(derived).toBeDefined();
    expect(stateful!.mounting).toBe("always");
    expect(derived!.mounting).toBe("when-visible");

    // A panel that keeps React state of its own stays mounted while it is
    // hidden, so it cannot lose that state.
    const hiddenStateful = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", false);
    expect(shouldMountPanel(stateful!, hiddenStateful)).toBe(true);

    // A panel derived from the document has nothing to lose, so it is
    // unmounted while it is hidden.
    const hiddenDerived = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "layers", false);
    expect(shouldMountPanel(derived!, hiddenDerived)).toBe(false);
  });

  it("sees two layouts with the same panels as equal", () => {
    expect(panelLayoutEqual(DEFAULT_PANEL_LAYOUT, { ...DEFAULT_PANEL_LAYOUT })).toBe(true);
    expect(
      panelLayoutEqual(DEFAULT_PANEL_LAYOUT, setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", false)),
    ).toBe(false);
  });
});

describe("reading an untrusted layout", () => {
  it("drops an id the catalogue does not know", () => {
    const state = normalizePanelLayoutState({ hidden: ["color", "history"], collapsed: ["nope"] });
    expect(state.hidden).toEqual(["color"]);
    expect(state.collapsed).toEqual([]);
  });

  it("ignores a document from a newer version", () => {
    const state = normalizePanelLayoutState({
      version: PANEL_LAYOUT_VERSION + 1,
      hidden: ["color"],
    });
    expect(state).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it("falls back to the defaults for anything that is not a layout", () => {
    for (const value of [null, undefined, 3, "layout", []]) {
      expect(normalizePanelLayoutState(value)).toEqual(DEFAULT_PANEL_LAYOUT);
    }
  });

  it("falls back to the defaults for a file that is not JSON", () => {
    expect(parsePanelLayoutState(null)).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(parsePanelLayoutState("not json at all")).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(parsePanelLayoutState("[]")).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it("round-trips through the file", () => {
    const state = setPanelVisibility(setPanelCollapsed(DEFAULT_PANEL_LAYOUT, "color", true), "layers", false);
    const text = serializePanelLayoutState(state);
    expect(parsePanelLayoutState(text)).toEqual(state);
    expect(JSON.parse(text).version).toBe(PANEL_LAYOUT_VERSION);
  });

  it("writes the layout as a plain document", () => {
    const document = panelLayoutDocument(DEFAULT_PANEL_LAYOUT);
    expect(document.version).toBe(PANEL_LAYOUT_VERSION);
    expect(document.hidden).toEqual([]);
    expect(document.collapsed).toEqual([]);
  });
});

describe("the layout section", () => {
  it("carries the layout under one key", () => {
    expect(PANEL_LAYOUT_KEY).toBe("panels");
  });

  it("reads and writes the layout in a preferences document", () => {
    const document: Record<string, unknown> = {};
    const layout = persistedLayoutOfState(
      setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", false),
      DEFAULT_SHELL_PREFERENCES,
    );
    const section = createPanelLayoutSection({
      getState: () => layout,
      subscribe: () => () => undefined,
      applyLayout: () => undefined,
    });
    section.write(document, layout);
    expect(document[PANEL_LAYOUT_KEY]).toEqual(persistedPanelLayoutDocument(layout));
    expect(section.read(document)).toEqual(layout);
  });

  it("leaves the rest of the document alone", () => {
    const document: Record<string, unknown> = { theme: "dark" };
    const section = createPanelLayoutSection({
      getState: () => DEFAULT_PERSISTED_PANEL_LAYOUT,
      subscribe: () => () => undefined,
      applyLayout: () => undefined,
    });
    section.write(document, DEFAULT_PERSISTED_PANEL_LAYOUT);
    expect(document.theme).toBe("dark");
  });

  it("reads the layout the shell's own preferences imply", () => {
    const preferences = { ...DEFAULT_SHELL_PREFERENCES, hiddenPanels: ["layers", "history"] };
    expect(persistedPanelLayoutOf(preferences).hiddenPanels).toEqual(["layers", "history"]);
  });

  it("writes the layout back into the preferences", () => {
    const preferences = { ...DEFAULT_SHELL_PREFERENCES, hiddenPanels: ["history"] };
    const layout: PersistedPanelLayout = {
      ...persistedPanelLayoutOf(preferences),
      hiddenPanels: [...preferences.hiddenPanels, "color"],
    };
    const written = applyPersistedPanelLayout(preferences, layout);
    expect(written.hiddenPanels).toContain("color");
    // A panel the shell hides that the catalogue does not know is kept.
    expect(written.hiddenPanels).toContain("history");
  });

  it("drops a panel the catalogue does not know, when the caller says which it knows", () => {
    // With no known-id list the reader keeps what it finds: throwing the
    // user's layout away over a registration order would be worse than
    // keeping an id this build cannot show.
    const kept = normalizePersistedPanelLayout({
      hiddenPanels: ["color", "not-a-panel"],
      foldedPanels: ["layers", "not-a-panel"],
    });
    expect(kept.hiddenPanels).toEqual(["color", "not-a-panel"]);
    expect(kept.foldedPanels).toEqual(["layers", "not-a-panel"]);

    const dropped = normalizePersistedPanelLayout(
      {
        hiddenPanels: ["color", "not-a-panel"],
        foldedPanels: ["layers", "not-a-panel"],
      },
      { knownPanelIds: ["color", "layers"] },
    );
    expect(dropped.hiddenPanels).toEqual(["color"]);
    expect(dropped.foldedPanels).toEqual(["layers"]);
  });

  it("crosses the bridge between the live layout and the persisted one", () => {
    const live = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", false);
    const persisted = persistedLayoutOfState(live, DEFAULT_SHELL_PREFERENCES);
    expect(persisted.hiddenPanels).toEqual(["color"]);
    expect(panelLayoutStateOfPersisted(persisted)).toEqual(live);
  });

  it("drives the store it was made for", () => {
    const store = createPanelStore();
    const source = createPanelLayoutSource(store, () => DEFAULT_SHELL_PREFERENCES);
    const section = createPanelLayoutSection(source);
    expect(section.key).toBe(PANEL_LAYOUT_KEY);
    expect(section.current()).toEqual(DEFAULT_PERSISTED_PANEL_LAYOUT);

    let notified = 0;
    const stop = section.subscribe(() => {
      notified += 1;
    });

    const live = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "color", false);
    section.apply(persistedLayoutOfState(live, DEFAULT_SHELL_PREFERENCES));
    expect(store.getState().hidden).toContain("color");
    expect(notified).toBe(1);

    stop();
  });
});

describe("the panel store", () => {
  it("starts from the default layout", () => {
    const store = createPanelStore();
    expect(store.getState()).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it("changes the layout and tells its listeners", () => {
    const store = createPanelStore();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.actions.setPanelVisible("color", false);
    expect(isPanelVisible(store.getState(), "color")).toBe(false);
    expect(notified).toBe(1);
  });

  it("says nothing when the layout did not change", () => {
    const store = createPanelStore();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.actions.setPanelVisible("color", true);
    store.actions.setPanelCollapsed("color", false);
    expect(notified).toBe(0);
  });

  it("folds, shows, hides and resets", () => {
    const store = createPanelStore();
    store.actions.setPanelCollapsed("color", true);
    expect(isPanelCollapsed(store.getState(), "color")).toBe(true);
    store.actions.togglePanel("color");
    expect(isPanelVisible(store.getState(), "color")).toBe(false);
    store.actions.showAllPanels();
    expect(store.getState().hidden).toEqual([]);
    store.actions.hideAllPanels();
    expect(store.getState().hidden.length).toBe(knownPanelIds().length);
    store.actions.resetLayout();
    expect(store.getState()).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it("takes a layout from the settings file", () => {
    const store = createPanelStore();
    const stored: PanelLayoutState = setPanelVisibility(DEFAULT_PANEL_LAYOUT, "layers", false);
    store.applyLayout(stored);
    expect(store.getState()).toEqual(stored);
  });

  it("stops telling a listener that unsubscribed", () => {
    const store = createPanelStore();
    let notified = 0;
    const stop = store.subscribe(() => {
      notified += 1;
    });
    stop();
    store.actions.togglePanel("color");
    expect(notified).toBe(0);
  });
});
