/**
 * Moving panels between the shell's slots.
 *
 * The rules are pure, so these tests read like the user's intent: put this
 * panel here, at this position, and check the preferences say exactly that -
 * without React, a browser or a settings file.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  movePanelInPreferences,
  panelSlotOf,
  resetPanelPlacement,
} from "../core/shell/panelMovement";
import {
  registerPanel,
  resetPanelRegistry,
} from "../core/shell/panelRegistry";
import {
  DEFAULT_SHELL_PREFERENCES,
  type ShellPreferences,
} from "../core/shell/preferences";
import {
  applyPersistedPanelLayout,
  createPanelLayoutSection,
  persistedPanelLayoutOf,
} from "../core/panels/panelLayoutSection";
import { compositionPanelsInSlot } from "../core/workspace/workspaceSettings";
import {
  createWorkspacePreferencesSource,
  createWorkspaceStore,
  type WorkspaceStore,
} from "../state/workspaceStore";

function panelSectionFor(store: WorkspaceStore) {
  return createPanelLayoutSection({
    getState: () => {
      const preferences = store.getPreferences();
      return persistedPanelLayoutOf(preferences, preferences.foldedPanels);
    },
    subscribe: (listener) => store.subscribe(listener),
    applyLayout: (layout) => {
      const preferences = store.getPreferences();
      store.applyPreferences({
        ...applyPersistedPanelLayout(preferences, layout),
        foldedPanels: layout.foldedPanels,
      });
    },
  });
}

beforeEach(() => {
  resetPanelRegistry();
  registerPanel({
    id: "color",
    title: "Color",
    slot: "right",
    order: 0,
    render: () => null,
  });
  registerPanel({
    id: "layers",
    title: "Layers",
    slot: "right",
    order: 1,
    render: () => null,
  });
  registerPanel({
    id: "brushes",
    title: "Brushes",
    slot: "right",
    order: 10,
    render: () => null,
  });
  registerPanel({
    id: "navigator",
    title: "Navigator",
    slot: "right",
    order: 20,
    render: () => null,
  });
  registerPanel({
    id: "shortcuts",
    title: "Shortcuts",
    slot: "right",
    order: 30,
    render: () => null,
  });
});

describe("panel movement", () => {
  it("moves a panel to the front of its slot", () => {
    const next = movePanelInPreferences(DEFAULT_SHELL_PREFERENCES, {
      panelId: "brushes",
      slot: "right",
      index: 0,
    });

    expect(next.panelOrder).toEqual([
      "brushes",
      "color",
      "layers",
      "navigator",
      "shortcuts",
    ]);
    expect(next.panelSlots.brushes).toBe("right");
  });

  it("moves a panel to a floating slot and out of the hidden list", () => {
    const hidden = movePanelInPreferences(DEFAULT_SHELL_PREFERENCES, {
      panelId: "color",
      slot: "hidden",
    });
    expect(hidden.hiddenPanels).toContain("color");

    const floating = movePanelInPreferences(hidden, {
      panelId: "color",
      slot: "floating",
    });

    expect(floating.panelSlots.color).toBe("floating");
    expect(floating.hiddenPanels).not.toContain("color");
    expect(floating.panelOrder).toEqual([
      "layers",
      "brushes",
      "navigator",
      "shortcuts",
      "color",
    ]);
  });

  it("docks a floating panel at the end of the right slot", () => {
    const floating = movePanelInPreferences(DEFAULT_SHELL_PREFERENCES, {
      panelId: "navigator",
      slot: "floating",
    });

    const docked = movePanelInPreferences(floating, {
      panelId: "navigator",
      slot: "right",
    });

    expect(docked.panelSlots.navigator).toBe("right");
    expect(docked.panelOrder.slice(-1)).toEqual(["navigator"]);
  });

  it("clamps a drop index past either end", () => {
    const front = movePanelInPreferences(DEFAULT_SHELL_PREFERENCES, {
      panelId: "shortcuts",
      slot: "right",
      index: -10,
    });
    expect(front.panelOrder[0]).toBe("shortcuts");

    const back = movePanelInPreferences(DEFAULT_SHELL_PREFERENCES, {
      panelId: "color",
      slot: "right",
      index: 99,
    });
    expect(back.panelOrder.slice(-1)).toEqual(["color"]);
  });

  it("returns the same preferences when the panel is unknown", () => {
    const next = movePanelInPreferences(DEFAULT_SHELL_PREFERENCES, {
      panelId: "ghost",
      slot: "right",
    });
    expect(next).toBe(DEFAULT_SHELL_PREFERENCES);
  });

  it("returns the same preferences when the slot is unknown", () => {
    const next = movePanelInPreferences(DEFAULT_SHELL_PREFERENCES, {
      panelId: "color",
      slot: "middle" as never,
    });
    expect(next).toBe(DEFAULT_SHELL_PREFERENCES);
  });

  it("keeps ids this build does not know", () => {
    const preferences: ShellPreferences = {
      ...DEFAULT_SHELL_PREFERENCES,
      panelOrder: ["ghost", "color"],
    };

    const next = movePanelInPreferences(preferences, {
      panelId: "brushes",
      slot: "right",
      index: 0,
    });

    expect(next.panelOrder).toContain("ghost");
    expect(next.panelOrder[0]).toBe("brushes");
  });

  it("is idempotent once the move has been written", () => {
    const once = movePanelInPreferences(DEFAULT_SHELL_PREFERENCES, {
      panelId: "color",
      slot: "right",
      index: 0,
    });
    const twice = movePanelInPreferences(once, {
      panelId: "color",
      slot: "right",
      index: 0,
    });

    expect(twice).toBe(once);
  });

  it("resets the arrangement but not the rest of the preferences", () => {
    const moved = movePanelInPreferences(
      { ...DEFAULT_SHELL_PREFERENCES, foldedPanels: ["color"], theme: "dark" },
      { panelId: "color", slot: "floating" },
    );

    const reset = resetPanelPlacement(moved);

    expect(reset.hiddenPanels).toEqual([]);
    expect(reset.panelOrder).toEqual([]);
    expect(reset.panelSlots).toEqual({});
    expect(reset.foldedPanels).toEqual([]);
    expect(reset.theme).toBe("dark");
  });

  it("reports a panel's slot, falling back to the registry", () => {
    expect(panelSlotOf(DEFAULT_SHELL_PREFERENCES, "color")).toBe("right");
    expect(panelSlotOf(DEFAULT_SHELL_PREFERENCES, "ghost")).toBeNull();
    expect(
      panelSlotOf(
        { ...DEFAULT_SHELL_PREFERENCES, panelSlots: { color: "bottom" } },
        "color",
      ),
    ).toBe("bottom");
  });

  it("moves a panel through the workspace store", () => {
    const source = createWorkspacePreferencesSource();
    const store = createWorkspaceStore({ preferences: source });

    store.actions.movePanel("brushes", "right", 0);
    expect(
      compositionPanelsInSlot(store.getComposition(), "right").map(
        (panel) => panel.id,
      ),
    ).toEqual(["brushes", "color", "layers", "navigator", "shortcuts"]);

    store.actions.movePanel("color", "floating");
    expect(
      compositionPanelsInSlot(store.getComposition(), "floating").map(
        (panel) => panel.id,
      ),
    ).toEqual(["color"]);

    store.actions.resetPanels();
    expect(store.getPreferences()).toEqual(DEFAULT_SHELL_PREFERENCES);
  });

  it("round trips a move through the panel layout section", () => {
    const store = createWorkspaceStore({
      preferences: createWorkspacePreferencesSource(),
    });
    const section = panelSectionFor(store);

    store.actions.movePanel("color", "floating");
    const document: Record<string, unknown> = {};
    section.write(document, section.current());

    const restored = createWorkspaceStore({
      preferences: createWorkspacePreferencesSource(),
    });
    const restoredSection = panelSectionFor(restored);
    restoredSection.apply(restoredSection.read(document));

    expect(
      compositionPanelsInSlot(restored.getComposition(), "floating").map(
        (panel) => panel.id,
      ),
    ).toEqual(["color"]);
  });
});
