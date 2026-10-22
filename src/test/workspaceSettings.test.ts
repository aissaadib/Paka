/**
 * Workspace preferences tests.
 *
 * The workspace is the part of Paka that remembers how the window was
 * arranged. The properties being pinned down are the ones a user would
 * notice and the ones a file on disk can break:
 *
 *  - the arrangement survives a restart;
 *  - a profile changes the real shell - the panels, the rows, the scale - and
 *    not merely a label;
 *  - a missing, corrupt or future-versioned workspace starts the app with the
 *    defaults and no error;
 *  - an out-of-range value is clamped, not rejected;
 *  - rearranging the window is never an edit - no history step, no dirty
 *    flag, nothing to undo;
 *  - the workspace and the drawing stay apart: neither file holds the other.
 *
 * Everything runs in Node: the rules are plain modules, the stores are
 * framework-free, and the engine accepts a null renderer, so no canvas is
 * needed.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createDocument } from "../core/document/document";
import type { StrokeSource } from "../core/document/types";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { DEFAULT_PANEL_LAYOUT } from "../core/panels/panelLayout";
import { createPanelLayoutSection } from "../core/panels/panelLayoutSection";
import {
  registerPanel,
  sidePanelDefinitions,
  unregisterPanel,
} from "../core/panels/panelRegistry";
import { serializeProject } from "../core/project/projectFormat";
import { SettingsStore } from "../core/settings/settingsStore";
import {
  WORKSPACE_PROFILES,
  findWorkspaceProfile,
  profilePanelLayout,
  profileWorkspaceSettings,
  resolveWorkspaceProfile,
} from "../core/workspace/workspaceProfiles";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  MAX_UI_SCALE,
  MIN_UI_SCALE,
  WORKSPACE_VERSION,
  normalizeUiScale,
  normalizeWorkspaceSettings,
  parseWorkspaceSettings,
  workspaceSettingsDocument,
  workspaceSettingsEqual,
} from "../core/workspace/workspaceSettings";
import {
  WORKSPACE_SETTINGS_KEY,
  createWorkspaceSettingsSection,
} from "../core/workspace/workspaceSettingsSection";
import { createEditor } from "../state/editorStore";
import { createPanelStore } from "../state/panelStore";
import { createWorkspaceStore } from "../state/workspaceStore";
import { MemoryProjectGateway } from "./support/memoryGateway";
import { MemorySettingsGateway } from "./support/memorySettingsGateway";

/**
 * The panels the tests work with.
 *
 * The registry is the shell's shared contract and a panel registers itself,
 * so a test registers the panels it needs and takes them away again.
 */
const TEST_PANELS = [
  { id: "color", title: "Colour", order: 0 },
  { id: "layers", title: "Layers", order: 10 },
  { id: "navigator", title: "Navigator", order: 20 },
] as const;

function registerTestPanels(): void {
  for (const panel of TEST_PANELS) {
    registerPanel({
      id: panel.id,
      title: panel.title,
      slot: "right",
      order: panel.order,
      mounting: "when-visible",
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

function createEngine(): DrawingEngine {
  return new DrawingEngine({ document: createDocument({ name: "Test", width: 200, height: 120 }) });
}

/** A workspace store wired to a panel store, the way the shell wires them. */
function createHarness() {
  const panels = createPanelStore();
  const workspace = createWorkspaceStore({ panels });
  return { panels, workspace };
}

describe("the workspace schema", () => {
  it("starts from the defaults", () => {
    expect(DEFAULT_WORKSPACE_SETTINGS.version).toBe(WORKSPACE_VERSION);
    expect(DEFAULT_WORKSPACE_SETTINGS.theme).toBe("dark");
    expect(DEFAULT_WORKSPACE_SETTINGS.uiScale).toBe(1);
    expect(DEFAULT_WORKSPACE_SETTINGS.brushPanel).toEqual({ advanced: true, presets: true });
    expect(DEFAULT_WORKSPACE_SETTINGS.shell).toEqual({ toolRail: true });
  });

  it("takes the default for a missing, malformed or future document", () => {
    expect(normalizeWorkspaceSettings(undefined)).toEqual(DEFAULT_WORKSPACE_SETTINGS);
    expect(normalizeWorkspaceSettings("nonsense")).toEqual(DEFAULT_WORKSPACE_SETTINGS);
    expect(normalizeWorkspaceSettings({ version: 99, theme: "light" })).toEqual(
      DEFAULT_WORKSPACE_SETTINGS,
    );
    expect(normalizeWorkspaceSettings({ brushPanel: "everything" }).brushPanel).toEqual(
      DEFAULT_WORKSPACE_SETTINGS.brushPanel,
    );
    expect(parseWorkspaceSettings(null)).toEqual(DEFAULT_WORKSPACE_SETTINGS);
    expect(parseWorkspaceSettings("{not json")).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("clamps the interface scale instead of rejecting it", () => {
    expect(normalizeUiScale(99)).toBe(MAX_UI_SCALE);
    expect(normalizeUiScale(0.1)).toBe(MIN_UI_SCALE);
    expect(normalizeUiScale("big")).toBe(1);
    expect(normalizeUiScale(Number.NaN, 1.25)).toBe(1.25);
  });

  it("falls back for a colour scheme and a profile it does not know", () => {
    const settings = normalizeWorkspaceSettings({ theme: "neon", profile: "cinema" });

    expect(settings.theme).toBe("dark");
    // An unknown profile is honestly called `custom` rather than a preset that
    // does not exist.
    expect(settings.profile).toBe("custom");
  });

  it("round-trips through the file", () => {
    const settings = normalizeWorkspaceSettings({
      version: 1,
      profile: "custom",
      theme: "light",
      uiScale: 1.25,
      brushPanel: { advanced: false, presets: false },
      shell: { toolRail: false },
    });

    const parsed = parseWorkspaceSettings(JSON.stringify(workspaceSettingsDocument(settings)));
    expect(parsed).toEqual(settings);
  });

  it("compares field by field, so an unchanged workspace is never written again", () => {
    expect(
      workspaceSettingsEqual(DEFAULT_WORKSPACE_SETTINGS, { ...DEFAULT_WORKSPACE_SETTINGS }),
    ).toBe(true);
    expect(
      workspaceSettingsEqual(DEFAULT_WORKSPACE_SETTINGS, {
        ...DEFAULT_WORKSPACE_SETTINGS,
        theme: "light",
      }),
    ).toBe(false);
    expect(
      workspaceSettingsEqual(DEFAULT_WORKSPACE_SETTINGS, {
        ...DEFAULT_WORKSPACE_SETTINGS,
        brushPanel: { advanced: false, presets: true },
      }),
    ).toBe(false);
  });
});

describe("the workspace profiles", () => {
  it("offers at least two presets, each with a name and an explanation", () => {
    expect(WORKSPACE_PROFILES.length).toBeGreaterThanOrEqual(2);
    for (const profile of WORKSPACE_PROFILES) {
      expect(profile.label.length).toBeGreaterThan(0);
      expect(profile.description.length).toBeGreaterThan(0);
      expect(profile.id).not.toBe("custom");
    }
    expect(new Set(WORKSPACE_PROFILES.map((profile) => profile.id)).size).toBe(
      WORKSPACE_PROFILES.length,
    );
  });

  it("has a painting profile that shows everything and a compact one that does not", () => {
    const painting = findWorkspaceProfile("painting");
    const compact = findWorkspaceProfile("compact");
    expect(painting).not.toBeNull();
    expect(compact).not.toBeNull();

    // The painting profile shows every registered panel.
    expect(profilePanelLayout(painting!).hidden).toEqual([]);
    expect(painting!.state.uiScale).toBe(1);
    expect(painting!.state.brushPanel.advanced).toBe(true);

    // The compact one hides every registered panel and gives the canvas the
    // room the panels were taking.
    expect(profilePanelLayout(compact!).hidden).toEqual(
      sidePanelDefinitions().map((definition) => definition.id),
    );
    expect(compact!.state.uiScale).toBeLessThan(1);
    expect(compact!.state.shell.toolRail).toBe(false);
    expect(compact!.state.brushPanel.advanced).toBe(false);
  });

  it("never touches the colour scheme, so a profile cannot throw it away", () => {
    const compact = findWorkspaceProfile("compact")!;

    expect(profileWorkspaceSettings(compact, "light").theme).toBe("light");
    expect(profileWorkspaceSettings(compact, "light").profile).toBe("compact");
  });

  it("names the profile a workspace matches, and calls a hand-made one custom", () => {
    const painting = findWorkspaceProfile("painting")!;
    const paintingSettings = profileWorkspaceSettings(painting);

    expect(resolveWorkspaceProfile(paintingSettings, profilePanelLayout(painting))).toBe(
      "painting",
    );

    // One row hidden is no longer the painting profile.
    const tweaked = { ...paintingSettings, shell: { ...paintingSettings.shell, toolRail: false } };
    expect(resolveWorkspaceProfile(tweaked, profilePanelLayout(painting))).toBe("custom");

    // Neither is a workspace whose panels were rearranged.
    const rearranged = { ...paintingSettings, hidden: [] };
    expect(
      resolveWorkspaceProfile(paintingSettings, { ...DEFAULT_PANEL_LAYOUT, hidden: ["color"] }),
    ).toBe("custom");
    expect(rearranged.profile).toBe("painting");
  });
});

describe("the workspace store", () => {
  it("tells its listeners when the workspace changes, and only then", () => {
    const { workspace } = createHarness();
    let notifications = 0;
    workspace.subscribe(() => {
      notifications += 1;
    });

    workspace.actions.setTheme("light");
    expect(notifications).toBe(1);
    expect(workspace.getState().theme).toBe("light");

    // The same value again is not a change.
    workspace.actions.setTheme("light");
    expect(notifications).toBe(1);
  });

  it("applies a profile to the real shell, not to a label", () => {
    const { panels, workspace } = createHarness();

    workspace.actions.applyProfile("compact");

    // The side panels really are hidden.
    expect(panels.getState().hidden).toEqual(
      sidePanelDefinitions().map((definition) => definition.id),
    );
    // The shell's own row is down and the interface is smaller.
    expect(workspace.getState().shell.toolRail).toBe(false);
    expect(workspace.getState().uiScale).toBeLessThan(1);
    // And the workspace says so honestly.
    expect(workspace.getState().profile).toBe("compact");

    workspace.actions.applyProfile("painting");

    expect(panels.getState().hidden).toEqual([]);
    expect(workspace.getState().shell.toolRail).toBe(true);
    expect(workspace.getState().uiScale).toBe(1);
    expect(workspace.getState().profile).toBe("painting");
  });

  it("leaves the colour scheme alone when a profile is applied", () => {
    const { workspace } = createHarness();

    workspace.actions.setTheme("light");
    workspace.actions.applyProfile("compact");

    expect(workspace.getState().theme).toBe("light");
  });

  it("calls a hand-made workspace custom", () => {
    const { workspace } = createHarness();

    expect(workspace.getState().profile).toBe("painting");

    workspace.actions.setToolRailVisible(false);
    expect(workspace.getState().profile).toBe("custom");

    // The panel manager's own menu can change the layout too, and the
    // workspace has to notice.
    workspace.actions.applyProfile("painting");
    expect(workspace.getState().profile).toBe("painting");
  });

  it("restores the defaults, the colour scheme included", () => {
    const { panels, workspace } = createHarness();

    workspace.actions.setTheme("light");
    workspace.actions.setUiScale(1.5);
    workspace.actions.setAdvancedBrushControls(false);
    workspace.actions.setBrushPresetRow(false);
    workspace.actions.setToolRailVisible(false);
    workspace.actions.applyProfile("compact");
    panels.actions.togglePanel("color");

    workspace.actions.restoreDefaults();

    expect(workspace.getState()).toEqual(DEFAULT_WORKSPACE_SETTINGS);
    expect(panels.getState()).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it("is not an edit: the document is untouched", () => {
    const editor = createEditor({ fileGateway: new MemoryProjectGateway() });
    const before = editor.getState();
    const { workspace } = createHarness();

    workspace.actions.applyProfile("compact");
    workspace.actions.setTheme("light");
    workspace.actions.restoreDefaults();

    const after = editor.getState();
    expect(after.file.dirty).toBe(false);
    expect(after.history.depth).toBe(0);
    expect(after.history.canUndo).toBe(false);
    expect(after.document).toBe(before.document);
    editor.engine.destroy();
  });
});

describe("the workspace as a settings section", () => {
  it("reads and writes its own key", () => {
    const { workspace } = createHarness();
    const section = createWorkspaceSettingsSection(workspace);

    workspace.actions.setTheme("light");
    const document: Record<string, unknown> = {};
    section.write(document, section.current());

    expect(Object.keys(document)).toEqual([WORKSPACE_SETTINGS_KEY]);
    expect(document[WORKSPACE_SETTINGS_KEY]).toEqual(
      workspaceSettingsDocument(workspace.getState()),
    );

    const other = createHarness();
    const readSection = createWorkspaceSettingsSection(other.workspace);
    readSection.apply(readSection.read(document));
    expect(other.workspace.getState().theme).toBe("light");
  });

  it("takes the default for a missing key", () => {
    const { workspace } = createHarness();
    const section = createWorkspaceSettingsSection(workspace);

    section.apply(section.read({}));
    expect(workspace.getState()).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  });
});

describe("the settings store with a workspace section", () => {
  it("writes the workspace into the settings file and reads it back", async () => {
    const gateway = new MemorySettingsGateway();
    const engine = createEngine();
    const panels = createPanelStore();
    const workspace = createWorkspaceStore({ panels });
    const store = new SettingsStore({
      engine,
      gateway,
      // The panels come first: the workspace reads the layout it is applied
      // against, so it has to be in place before the workspace is read.
      sections: [createPanelLayoutSection(panels), createWorkspaceSettingsSection(workspace)],
    });

    await store.load();
    workspace.actions.applyProfile("compact");
    await store.flush();

    const written = gateway.contents;
    expect(written).not.toBeNull();
    const document = JSON.parse(written as string) as Record<string, unknown>;
    expect(document[WORKSPACE_SETTINGS_KEY]).toEqual({
      version: 1,
      profile: "compact",
      theme: "dark",
      uiScale: 0.9,
      brushPanel: { advanced: false, presets: false },
      shell: { toolRail: false },
    });
    store.destroy();

    // A second start reads the workspace back, panels and all.
    const restoredPanels = createPanelStore();
    const restoredWorkspace = createWorkspaceStore({ panels: restoredPanels });
    const second = new SettingsStore({
      engine,
      gateway,
      sections: [
        createPanelLayoutSection(restoredPanels),
        createWorkspaceSettingsSection(restoredWorkspace),
      ],
    });
    await second.load();

    expect(restoredWorkspace.getState().uiScale).toBe(0.9);
    expect(restoredWorkspace.getState().shell.toolRail).toBe(false);
    expect(restoredWorkspace.getState().profile).toBe("compact");
    expect(restoredPanels.getState().hidden).toEqual(
      sidePanelDefinitions().map((definition) => definition.id),
    );

    second.destroy();
    engine.destroy();
  });

  it("starts with the defaults when the file is broken", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = "{not json";
    const engine = createEngine();
    const panels = createPanelStore();
    const workspace = createWorkspaceStore({ panels });
    const store = new SettingsStore({
      engine,
      gateway,
      sections: [createPanelLayoutSection(panels), createWorkspaceSettingsSection(workspace)],
    });

    await store.load();

    expect(workspace.getState()).toEqual(DEFAULT_WORKSPACE_SETTINGS);
    expect(panels.getState()).toEqual(DEFAULT_PANEL_LAYOUT);
    store.destroy();
    engine.destroy();
  });

  it("keeps the drawing out of the settings file", async () => {
    const gateway = new MemorySettingsGateway();
    const engine = createEngine();
    const panels = createPanelStore();
    const workspace = createWorkspaceStore({ panels });
    const store = new SettingsStore({
      engine,
      gateway,
      sections: [createPanelLayoutSection(panels), createWorkspaceSettingsSection(workspace)],
    });

    await store.load();
    await store.flush();

    const document = JSON.parse(gateway.contents as string) as Record<string, unknown>;
    // The settings file holds preferences and shell state, never a drawing.
    expect(document.layers).toBeUndefined();
    expect(document.elements).toBeUndefined();
    expect(document.guides).toBeUndefined();

    store.destroy();
    engine.destroy();
  });
});

describe("the workspace and the document", () => {
  it("keeps the workspace out of the project file", () => {
    const document = createDocument({ name: "Study", width: 64, height: 48 });
    const source: StrokeSource = {
      listStrokes: () => [],
      listElements: () => [],
    };

    const project = JSON.parse(serializeProject(document, source)) as Record<string, unknown>;

    // A `.paka` file describes the artwork. The window it was drawn in is
    // not part of it.
    expect(project[WORKSPACE_SETTINGS_KEY]).toBeUndefined();
    expect(project.panels).toBeUndefined();
    expect(project.uiScale).toBeUndefined();
  });
});
