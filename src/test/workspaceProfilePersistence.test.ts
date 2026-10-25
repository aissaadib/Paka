/**
 * The workspace profiles in the settings file.
 *
 * The model in `core/workspace/workspaceProfiles.ts` knows how to name a
 * profile, which layout it may carry and how a set of them changes. What it
 * does not know is where the set is kept and how the shell adopts one. That
 * is what this file pins down:
 *
 *  - the profiles live in the settings file, under one key, and survive a
 *    restart;
 *  - a file that cannot be read costs the user the broken profile and
 *    nothing else;
 *  - switching to a profile rearranges the window;
 *  - rearranging the window by hand means the arrangement is the user's own;
 *  - a profile is editor state: no history step, no dirty flag, and nothing
 *    in a project file.
 *
 * Everything runs in Node: the stores are framework-free, and the engine
 * accepts a null renderer, so no canvas is needed.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { PROJECT_VERSION, serializeProject } from "../core/project/projectFormat";
import { SettingsStore } from "../core/settings/settingsStore";
import {
  registerPanel,
  resetPanelRegistry,
  type PanelDefinition,
} from "../core/shell/panelRegistry";
import {
  DEFAULT_SHELL_LAYOUT,
  placePanel,
  type ShellLayout,
  type ShellSlotId,
} from "../core/shell/slots";
import {
  createShellPreferencesLayoutPort,
  layoutOfPreferences,
  preferencesOfLayout,
} from "../core/workspace/shellLayoutPort";
import {
  addProfile,
  DEFAULT_PROFILE_NAME,
  completeLayout,
  createWorkspaceProfiles,
  serializeProfileSet,
  type WorkspaceProfileSet,
} from "../core/workspace/workspaceProfiles";
import {
  createWorkspaceProfileSection,
  WORKSPACE_PROFILE_SECTION_KEY,
} from "../core/workspace/workspaceProfileSection";
import {
  createWorkspaceProfileStore,
  sameArrangement,
  type WorkspaceLayoutPort,
} from "../core/workspace/workspaceProfileStore";
import { DEFAULT_SHELL_PREFERENCES, type ShellPreferences } from "../core/shell/preferences";
import { MemorySettingsGateway } from "./support/memorySettingsGateway";

/** A scheduler the test drives by hand, so no test waits in real time. */
class ManualTimers {
  private next = 1;
  private readonly pending = new Map<number, () => void>();

  readonly schedule = (callback: () => void): unknown => {
    const id = this.next++;
    this.pending.set(id, callback);
    return id;
  };

  readonly cancel = (handle: unknown): void => {
    this.pending.delete(handle as number);
  };

  /** Runs everything that is waiting, in order. */
  runAll(): void {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) {
      callback();
    }
  }
}

/** Lets every pending microtask finish. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The live layout, as a port.
 *
 * It is the panel manager's side of the meeting point: it holds the
 * arrangement, it adopts the one it is given and it says when the user has
 * moved a panel.
 */
class FakeLayoutPort implements WorkspaceLayoutPort {
  private layout: ShellLayout;
  private readonly listeners = new Set<() => void>();

  constructor(initial: ShellLayout = DEFAULT_SHELL_LAYOUT) {
    this.layout = initial;
  }

  getLayout(): ShellLayout {
    return this.layout;
  }

  applyLayout(layout: ShellLayout): void {
    this.layout = layout;
    this.announce();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The user moved a panel. */
  move(panelId: string, slot: ShellSlotId): void {
    this.layout = placePanel(this.layout, panelId, slot);
    this.announce();
  }

  private announce(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

function panel(id: string, slot: PanelDefinition["slot"], order: number): PanelDefinition {
  return { id, title: id, slot, order, render: () => null };
}

beforeEach(() => {
  resetPanelRegistry();
  registerPanel(panel("color", "right", 0));
  registerPanel(panel("layers", "right", 1));
  registerPanel(panel("brushes", "left", 0));
});

function createEngine(): DrawingEngine {
  return new DrawingEngine({ document: createDocument({ name: "Test", width: 200, height: 120 }) });
}

interface Harness {
  readonly engine: DrawingEngine;
  readonly gateway: MemorySettingsGateway;
  readonly timers: ManualTimers;
  readonly store: SettingsStore;
  readonly profiles: ReturnType<typeof createWorkspaceProfileStore>;
  readonly layout: FakeLayoutPort;
}

/** A settings store with the profiles as one of its sections. */
function createHarness(gateway: MemorySettingsGateway = new MemorySettingsGateway()): Harness {
  const engine = createEngine();
  const timers = new ManualTimers();
  const layout = new FakeLayoutPort();
  const profiles = createWorkspaceProfileStore({ layout });
  const store = new SettingsStore({
    engine,
    gateway,
    sections: [createWorkspaceProfileSection(profiles)],
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  return { engine, gateway, timers, store, profiles, layout };
}

/** The profiles as the file holds them. */
function writtenProfiles(gateway: MemorySettingsGateway): unknown {
  return JSON.parse(gateway.contents as string)[WORKSPACE_PROFILE_SECTION_KEY];
}

describe("the profiles in the settings file", () => {
  it("writes the profiles under their own key", async () => {
    const { gateway, profiles, store, timers } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(1);
    expect(writtenProfiles(gateway)).toEqual(serializeProfileSet(profiles.getState()));
  });

  it("keeps the rest of the file", async () => {
    const { gateway, profiles, store, timers } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    timers.runAll();
    await settle();

    const written = JSON.parse(gateway.contents as string);
    expect(written.version).toBeDefined();
    expect(written.toolId).toBeDefined();
  });

  it("reads the profiles back after a restart", async () => {
    const gateway = new MemorySettingsGateway();

    const first = createHarness(gateway);
    await first.store.load();
    first.profiles.actions.add("Painting");
    first.profiles.actions.switchTo("Painting");
    first.timers.runAll();
    await settle();

    expect(gateway.writes.length).toBeGreaterThan(0);

    // A restart: a new engine, a new store, the same file.
    const second = createHarness(gateway);
    await second.store.load();

    expect(second.profiles.getState().profiles.map((entry) => entry.name)).toEqual([
      DEFAULT_PROFILE_NAME,
      "Painting",
    ]);
    expect(second.profiles.getState().active).toBe("Painting");
  });

  it("does not write the file again when nothing changed", async () => {
    const { gateway, store, timers } = createHarness();
    await store.load();

    timers.runAll();
    await settle();

    expect(gateway.writes).toHaveLength(0);
  });

  it("takes the default set when the value is not a set", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: 1,
      [WORKSPACE_PROFILE_SECTION_KEY]: "nonsense",
    });
    const { store, profiles } = createHarness(gateway);

    await store.load();

    expect(profiles.getState().profiles).toHaveLength(1);
    expect(profiles.getState().profiles[0].name).toBe(DEFAULT_PROFILE_NAME);
    expect(profiles.getState().active).toBe(DEFAULT_PROFILE_NAME);
  });

  it("refuses a document from a newer version wholesale", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: 1,
      [WORKSPACE_PROFILE_SECTION_KEY]: {
        version: 99,
        profiles: [{ name: "Painting", layout: { placements: [] } }],
        active: "Painting",
      },
    });
    const { store, profiles } = createHarness(gateway);

    await store.load();

    expect(profiles.getState().profiles).toHaveLength(1);
    expect(profiles.getState().profiles[0].name).toBe(DEFAULT_PROFILE_NAME);
    expect(profiles.getState().active).toBe(DEFAULT_PROFILE_NAME);
  });

  it("drops a profile it cannot read and keeps the others", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: 1,
      [WORKSPACE_PROFILE_SECTION_KEY]: {
        version: 1,
        profiles: [
          { name: "Painting", layout: { placements: [] } },
          { name: "   ", layout: { placements: [] } },
          "not a profile",
        ],
        active: "Painting",
      },
    });
    const { store, profiles } = createHarness(gateway);

    await store.load();

    expect(profiles.getState().profiles.map((entry) => entry.name)).toEqual(["Painting"]);
    expect(profiles.getState().active).toBe("Painting");
  });

  it("drops an active name that names no profile", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      version: 1,
      [WORKSPACE_PROFILE_SECTION_KEY]: {
        version: 1,
        profiles: [{ name: "Painting", layout: { placements: [] } }],
        active: "Missing",
      },
    });
    const { store, profiles } = createHarness(gateway);

    await store.load();

    expect(profiles.getState().active).toBeUndefined();
  });
});

describe("switching to a profile", () => {
  it("adopts the layout of the profile", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    const outcome = profiles.actions.switchTo("Painting");

    expect(outcome.ok).toBe(true);
    expect(layout.getLayout().placements.map((entry) => entry.panelId).sort()).toEqual([
      "brushes",
      "color",
      "layers",
    ]);
  });

  it("completes the layout so that every panel has a slot", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    profiles.actions.switchTo("Painting");

    expect(layout.getLayout().placements).toHaveLength(3);
    expect(layout.getLayout().placements.every((entry) => entry.slot !== undefined)).toBe(true);
  });

  it("completes the default profile when it is adopted", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    // The default profile carries the empty layout; the panels the registry
    // knows are filled in when the profile is adopted.
    expect(completeLayout(DEFAULT_SHELL_LAYOUT).placements).toHaveLength(3);

    const outcome = profiles.actions.switchTo(DEFAULT_PROFILE_NAME);

    expect(outcome.ok).toBe(true);
    expect(layout.getLayout().placements).toHaveLength(3);
  });

  it("refuses a profile that is not there", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    const outcome = profiles.actions.switchTo("Missing");

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("unknown-profile");
    expect(layout.getLayout().placements).toHaveLength(0);
  });

  it("keeps showing the profile it adopted", async () => {
    const { profiles, store } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    profiles.actions.switchTo("Painting");

    expect(profiles.getState().active).toBe("Painting");
  });

  it("says the window is the user's own once a panel is moved", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    profiles.actions.switchTo("Painting");
    expect(profiles.getState().active).toBe("Painting");

    layout.move("layers", "left");

    expect(profiles.getState().active).toBeUndefined();
  });

  it("keeps the saved profiles when the window is rearranged", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    profiles.actions.switchTo("Painting");
    layout.move("layers", "left");

    expect(profiles.getState().profiles.map((entry) => entry.name)).toEqual([
      DEFAULT_PROFILE_NAME,
      "Painting",
    ]);
  });

  it("does not change the window when the profile is not there", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    profiles.actions.switchTo("Missing");

    expect(layout.getLayout().placements).toHaveLength(0);
  });
});

describe("saving a profile", () => {
  it("saves the arrangement on screen under a new name", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    layout.applyLayout(placePanel(DEFAULT_SHELL_LAYOUT, "layers", "left"));
    const outcome = profiles.actions.add("Painting");

    expect(outcome.ok).toBe(true);
    const saved = profiles.getState().profiles.find((entry) => entry.name === "Painting");
    expect(saved?.layout.placements.map((entry) => entry.panelId)).toEqual(["layers"]);
  });

  it("saves the arrangement over a profile the user already has", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    layout.applyLayout(placePanel(DEFAULT_SHELL_LAYOUT, "layers", "left"));
    const outcome = profiles.actions.save("Painting");

    expect(outcome.ok).toBe(true);
    const saved = profiles.getState().profiles.find((entry) => entry.name === "Painting");
    expect(saved?.layout.placements.map((entry) => entry.panelId)).toEqual(["layers"]);
  });

  it("refuses a layout the shell cannot show", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    // A panel the registry does not know: the shell could not mount it.
    layout.applyLayout(placePanel(DEFAULT_SHELL_LAYOUT, "ghost", "right"));
    const outcome = profiles.actions.add("Painting");

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("invalid-layout");
    expect(profiles.getState().profiles).toHaveLength(1);
  });

  it("refuses a layout that names a slot the shell does not have", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    layout.applyLayout({
      placements: [{ panelId: "layers", slot: "middle" as ShellSlotId, order: 0 }],
    });
    const outcome = profiles.actions.add("Painting");

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("invalid-layout");
    expect(outcome.detail).toMatch(/slot "middle" does not exist/);
  });

  it("refuses a layout that places a panel twice", async () => {
    const { layout, profiles, store } = createHarness();
    await store.load();

    layout.applyLayout({
      placements: [
        { panelId: "layers", slot: "right", order: 0 },
        { panelId: "layers", slot: "left", order: 1 },
      ],
    });
    const outcome = profiles.actions.add("Painting");

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("invalid-layout");
    expect(outcome.detail).toMatch(/placed twice/);
  });

  it("renames and removes a profile", async () => {
    const { profiles, store } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    expect(profiles.actions.rename("Painting", "Sketching").ok).toBe(true);
    expect(profiles.getState().profiles.map((entry) => entry.name)).toEqual([
      DEFAULT_PROFILE_NAME,
      "Sketching",
    ]);

    expect(profiles.actions.remove("Sketching").ok).toBe(true);
    expect(profiles.getState().profiles.map((entry) => entry.name)).toEqual([DEFAULT_PROFILE_NAME]);
  });
});

describe("a profile is editor state", () => {
  it("does not dirty the document or add a history step", async () => {
    const { engine, layout, profiles, store } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    profiles.actions.switchTo("Painting");
    layout.move("layers", "left");

    const state = engine.getState();
    expect(state.file.dirty).toBe(false);
    expect(state.history.depth).toBe(0);
  });

  it("never reaches a project file", async () => {
    const { profiles, store } = createHarness();
    await store.load();

    profiles.actions.add("Painting");
    profiles.actions.switchTo("Painting");

    const document = createDocument({ name: "Test", width: 100, height: 100 });
    const project = JSON.parse(
      serializeProject(document, { listStrokes: () => [], listElements: () => [] }),
    ) as Record<string, unknown>;

    expect(project[WORKSPACE_PROFILE_SECTION_KEY]).toBeUndefined();
    expect(project.version).toBe(PROJECT_VERSION);
  });
});

describe("the live layout as a port", () => {
  /** The preferences the shell would show, with the panels in their slots. */
  function preferencesWith(slots: Record<string, ShellSlotId>): ShellPreferences {
    return { ...DEFAULT_SHELL_PREFERENCES, panelSlots: slots };
  }

  it("reads the arrangement out of the preferences", () => {
    const layout = layoutOfPreferences(preferencesWith({ layers: "left" }));

    expect(layout.placements.find((entry) => entry.panelId === "layers")?.slot).toBe("left");
    expect(layout.placements.map((entry) => entry.panelId).sort()).toEqual([
      "brushes",
      "color",
      "layers",
    ]);
  });

  it("writes an arrangement back into the preferences", () => {
    const preferences = preferencesOfLayout(
      DEFAULT_SHELL_PREFERENCES,
      placePanel(DEFAULT_SHELL_LAYOUT, "layers", "left"),
    );

    expect(preferences.panelSlots.layers).toBe("left");
    expect(preferences.hiddenPanels).toEqual([]);
  });

  it("round trips an arrangement through the preferences", () => {
    const layout = placePanel(placePanel(DEFAULT_SHELL_LAYOUT, "layers", "left"), "color", "bottom");
    const preferences = preferencesOfLayout(DEFAULT_SHELL_PREFERENCES, layout);

    expect(sameArrangement(layout, layoutOfPreferences(preferences))).toBe(true);
  });

  it("adopts an arrangement through the port", () => {
    let preferences = DEFAULT_SHELL_PREFERENCES;
    const listeners = new Set<() => void>();
    const port = createShellPreferencesLayoutPort({
      getPreferences: () => preferences,
      setPreferences: (next) => {
        preferences = next;
        for (const listener of [...listeners]) {
          listener();
        }
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    });

    port.applyLayout(placePanel(DEFAULT_SHELL_LAYOUT, "layers", "left"));

    expect(preferences.panelSlots.layers).toBe("left");
    expect(port.getLayout().placements.find((entry) => entry.panelId === "layers")?.slot).toBe(
      "left",
    );
  });
});

describe("the store and the file", () => {
  it("takes the set the file holds when it is applied", async () => {
    const { store, profiles } = createHarness();
    await store.load();

    const set: WorkspaceProfileSet = createWorkspaceProfiles();
    profiles.applyProfiles(set);

    expect(profiles.getState()).toEqual(set);
  });

  it("writes the set the store holds back into the file", async () => {
    const { gateway, profiles, store, timers } = createHarness();
    await store.load();

    const added = addProfile(createWorkspaceProfiles(), "Painting", DEFAULT_SHELL_LAYOUT);
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    profiles.applyProfiles(added.set);
    timers.runAll();
    await settle();

    expect(writtenProfiles(gateway)).toEqual(serializeProfileSet(added.set));
  });
});
