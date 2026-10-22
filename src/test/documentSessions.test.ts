/**
 * The document sessions: the open documents, the tabs, and the recent list.
 *
 * No canvas and no React: the registry is the state machine, and the
 * workspace is the file workflow on top of it. The rules under test are the
 * ones that keep work from being lost - an independent history per document,
 * a duplicate path that does not become two editors on one file, and a
 * missing file that says so.
 */

import { describe, expect, it } from "vitest";
import { DocumentSessionRegistry, samePath, tabCloseDecision } from "../core/documents/sessionRegistry";
import { DocumentWorkspace } from "../core/documents/documentWorkspace";
import {
  RecentFilesStore,
  createRecentFilesSection,
  normalizeRecentFiles,
  recentFilesWith,
} from "../core/documents/recentFiles";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { parseProject, serializeProject } from "../core/project/projectFormat";
import { SettingsStore } from "../core/settings/settingsStore";
import { MemoryProjectGateway } from "./support/memoryGateway";
import { MemorySettingsGateway } from "./support/memorySettingsGateway";
import type { PointerSample } from "../types/pointer";

function sample(
  x: number,
  y: number,
  phase: PointerSample["phase"] = "move",
): PointerSample {
  return {
    phase,
    pointerId: 1,
    kind: "pen",
    isPrimary: true,
    button: 0,
    buttons: 0,
    docX: x,
    docY: y,
    screenX: x,
    screenY: y,
    pressure: 0.5,
    hasPressure: true,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

function paintStroke(engine: DrawingEngine, offset = 0): void {
  engine.beginStroke(sample(offset, offset));
  engine.extendStroke(sample(offset + 6, offset + 3));
  engine.finishStroke();
}

/** Drags a marquee over everything, which selects the strokes it covers. */
function selectEverything(engine: DrawingEngine): void {
  engine.setTool("select");
  engine.handlePointerSample(sample(20, 20, "down"));
  engine.handlePointerSample(sample(280, 280, "move"));
  engine.handlePointerSample(sample(280, 280, "up"));
}

function createRegistry(): DocumentSessionRegistry {
  const registry = new DocumentSessionRegistry({
    createEngine: () => new DrawingEngine(),
    preferencesEngine: new DrawingEngine(),
  });
  registry.create();
  return registry;
}

function projectText(engine: DrawingEngine): string {
  return serializeProject(engine.getState().document, engine);
}

describe("the document session registry", () => {
  it("starts with one open document", () => {
    const registry = createRegistry();

    const state = registry.getState();

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.active).toBe(true);
    expect(state.activeId).toBe(registry.active.id);
  });

  it("gives every document its own history", () => {
    const registry = createRegistry();
    const first = registry.active;
    paintStroke(first.engine);

    const second = registry.create();
    expect(second.engine.getState().history.depth).toBe(0);

    paintStroke(second.engine);
    paintStroke(second.engine, 20);
    expect(second.engine.getState().history.depth).toBe(2);

    // The first document kept its own single step: the two never share a
    // command stack.
    expect(first.engine.getState().history.depth).toBe(1);
  });

  it("gives every document its own viewport", () => {
    const registry = createRegistry();
    const first = registry.active;
    first.engine.setViewport({ zoom: 2, offsetX: 40, offsetY: 60 });

    const second = registry.create();

    expect(second.engine.getState().viewport.zoom).toBe(1);
    expect(second.engine.getState().viewport.offsetX).toBe(0);

    // Switching back brings the document's own view with it.
    registry.activate(first.id);
    expect(registry.active.engine.getState().viewport.zoom).toBe(2);
    expect(registry.active.engine.getState().viewport.offsetX).toBe(40);
  });

  it("gives every document its own selection", () => {
    const registry = createRegistry();
    const first = registry.active;
    paintStroke(first.engine, 100);
    selectEverything(first.engine);
    expect(first.engine.getState().selectedStrokes).toBe(1);

    const second = registry.create();

    expect(second.engine.getState().selectedStrokes).toBe(0);
    expect(first.engine.getState().selectedStrokes).toBe(1);
  });

  it("marks a tab dirty when its document changes, and only that one", () => {
    const registry = createRegistry();
    const first = registry.active;
    const second = registry.create();

    paintStroke(first.engine);

    const sessions = registry.getState().sessions;
    expect(sessions.find((session) => session.id === first.id)?.dirty).toBe(true);
    expect(sessions.find((session) => session.id === second.id)?.dirty).toBe(false);
  });

  it("closes a tab and activates a neighbour", () => {
    const registry = createRegistry();
    const first = registry.active;
    const second = registry.create();

    expect(registry.close(second.id)).toBe(true);

    expect(registry.getState().sessions).toHaveLength(1);
    expect(registry.active.id).toBe(first.id);
  });

  it("leaves a fresh empty page when the last tab is closed", () => {
    const registry = createRegistry();
    paintStroke(registry.active.engine);
    const id = registry.active.id;

    expect(registry.close(id)).toBe(true);

    // The editor always has a document to draw on.
    expect(registry.getState().sessions).toHaveLength(1);
    expect(registry.active.engine.getState().history.depth).toBe(0);
    expect(registry.active.engine.getState().file.dirty).toBe(false);
  });

  it("keeps the tab strip's view stable when nothing changed", () => {
    const registry = createRegistry();
    const before = registry.getState();

    // A publish that changes nothing must not hand React a new object: the
    // tab strip would re-render for no reason.
    registry.active.engine.getState();

    expect(registry.getState()).toBe(before);
  });

  it("shares the brush between the documents", () => {
    const registry = createRegistry();
    registry.active.engine.setBrush({ size: 42 });

    const second = registry.create();

    expect(second.engine.getState().brush.size).toBe(42);
  });
});

describe("closing a tab", () => {
  it("closes a clean document without asking", () => {
    const registry = createRegistry();

    expect(tabCloseDecision(registry.active)).toBe("close");
  });

  it("asks before a document with unsaved changes is thrown away", () => {
    const registry = createRegistry();
    paintStroke(registry.active.engine);

    expect(tabCloseDecision(registry.active)).toBe("confirm");
  });

  it("does not ask again once the document has been saved", () => {
    const registry = createRegistry();
    paintStroke(registry.active.engine);
    registry.active.engine.markSaved("/art/cat.paka");

    expect(tabCloseDecision(registry.active)).toBe("close");
  });
});

describe("path comparison", () => {
  it("treats a Windows path as the same file whatever its case", () => {
    expect(samePath("C:\\Art\\Cat.paka", "c:\\art\\cat.paka")).toBe(true);
  });

  it("treats a POSIX path as exact", () => {
    expect(samePath("/home/art/Cat.paka", "/home/art/cat.paka")).toBe(false);
    expect(samePath("/home/art/Cat.paka", "/home/art/Cat.paka")).toBe(true);
  });

  it("ignores a trailing separator", () => {
    expect(samePath("/home/art/", "/home/art")).toBe(true);
  });
});

describe("the document workspace", () => {
  function createWorkspace(): {
    readonly workspace: DocumentWorkspace;
    readonly registry: DocumentSessionRegistry;
    readonly gateway: MemoryProjectGateway;
    readonly recentFiles: RecentFilesStore;
  } {
    const registry = createRegistry();
    const gateway = new MemoryProjectGateway();
    const recentFiles = new RecentFilesStore();
    const workspace = new DocumentWorkspace(registry, gateway, recentFiles);
    return { workspace, registry, gateway, recentFiles };
  }

  it("opens a file as a new tab and leaves the drawing on screen alone", async () => {
    const { workspace, registry, gateway } = createWorkspace();
    const source = new DrawingEngine();
    paintStroke(source);
    gateway.files.set("/art/cat.paka", projectText(source));
    // The document that is on screen has a stroke of its own.
    paintStroke(registry.active.engine);

    const outcome = await workspace.openPath("/art/cat.paka");

    expect(outcome.status).toBe("opened");
    expect(registry.getState().sessions).toHaveLength(2);
    // The first document still holds its own stroke: opening a file adds a
    // tab rather than replacing the drawing.
    expect(registry.list[0]?.engine.getState().history.depth).toBe(1);
  });

  it("refuses a file that is not there, and says which one", async () => {
    const { workspace, registry } = createWorkspace();

    const outcome = await workspace.openPath("/art/missing.paka");

    expect(outcome.status).toBe("error");
    expect(registry.getState().sessions).toHaveLength(1);
    if (outcome.status === "error") {
      expect(outcome.message).toContain("missing.paka");
    }
  });

  it("refuses a file that is not a project", async () => {
    const { workspace, registry, gateway } = createWorkspace();
    gateway.files.set("/art/broken.paka", "{ not a project");

    const outcome = await workspace.openPath("/art/broken.paka");

    expect(outcome.status).toBe("error");
    expect(registry.getState().sessions).toHaveLength(1);
  });

  it("focuses the tab of a file that is already open", async () => {
    const { workspace, registry, gateway } = createWorkspace();
    const source = new DrawingEngine();
    gateway.files.set("/art/cat.paka", projectText(source));
    await workspace.openPath("/art/cat.paka");
    const opened = registry.active.id;

    const second = registry.create();
    expect(registry.active.id).toBe(second.id);

    const outcome = await workspace.openPath("/art/cat.paka");

    expect(outcome.status).toBe("opened");
    // The same file must not become a second editor: the tab that holds it
    // is simply brought forward.
    expect(registry.getState().sessions).toHaveLength(3);
    expect(registry.active.id).toBe(opened);
  });

  it("saves the active document", async () => {
    const { workspace, registry, gateway } = createWorkspace();
    paintStroke(registry.active.engine);
    gateway.savePath = "/art/saved.paka";

    const outcome = await workspace.save();

    expect(outcome.status).toBe("saved");
    expect(gateway.files.has("/art/saved.paka")).toBe(true);
    expect(registry.active.engine.getState().file.dirty).toBe(false);
  });

  it("saves a document that is not the one on screen", async () => {
    const { workspace, registry, gateway } = createWorkspace();
    const first = registry.active;
    paintStroke(first.engine);
    first.engine.markSaved("/art/first.paka");

    const second = registry.create();
    paintStroke(second.engine);
    second.engine.markSaved("/art/second.paka");

    const outcome = await workspace.saveSession(first.id);

    expect(outcome.status).toBe("saved");
    expect(gateway.files.has("/art/first.paka")).toBe(true);
    // The document on screen was not written.
    expect(gateway.files.has("/art/second.paka")).toBe(false);
  });

  it("refuses to save over a file another tab holds", async () => {
    const { workspace, registry, gateway } = createWorkspace();
    const first = registry.active;
    paintStroke(first.engine);
    first.engine.markSaved("/art/shared.paka");

    const second = registry.create();
    paintStroke(second.engine);
    gateway.savePath = "/art/shared.paka";

    const outcome = await workspace.saveAs();

    expect(outcome.status).toBe("error");
    expect(gateway.writes).toHaveLength(0);
  });

  it("reports a document with unsaved changes", () => {
    const { workspace, registry } = createWorkspace();
    expect(workspace.hasUnsavedChanges).toBe(false);

    paintStroke(registry.active.engine);

    expect(workspace.hasUnsavedChanges).toBe(true);
  });
});

describe("the recent files", () => {
  it("records the most recent first, without duplicates", () => {
    expect(recentFilesWith("/a.paka", [])).toEqual(["/a.paka"]);
    expect(recentFilesWith("/b.paka", ["/a.paka"])).toEqual(["/b.paka", "/a.paka"]);
    expect(recentFilesWith("/a.paka", ["/b.paka", "/a.paka"])).toEqual(["/a.paka", "/b.paka"]);
  });

  it("keeps at most ten entries", () => {
    let paths: readonly string[] = [];
    for (let index = 0; index < 14; index += 1) {
      paths = recentFilesWith(`/art/${index}.paka`, paths);
    }

    expect(paths).toHaveLength(10);
    expect(paths[0]).toBe("/art/13.paka");
  });

  it("skips what it cannot use", () => {
    expect(normalizeRecentFiles(undefined)).toEqual([]);
    expect(normalizeRecentFiles("not a list")).toEqual([]);
    expect(normalizeRecentFiles([1, "", "  ", "/art/cat.paka"])).toEqual(["/art/cat.paka"]);
  });

  it("survives a round trip through the settings document", () => {
    const store = new RecentFilesStore();
    store.note("/art/cat.paka");
    const section = createRecentFilesSection(store);

    const document: Record<string, unknown> = {};
    section.write(document, section.current());
    expect(document.recentFiles).toEqual(["/art/cat.paka"]);

    const restored = new RecentFilesStore();
    const restoredSection = createRecentFilesSection(restored);
    restoredSection.apply(restoredSection.read(document));
    expect(restored.getState()).toEqual(["/art/cat.paka"]);
  });

  it("is still there after the application restarts", async () => {
    const gateway = new MemorySettingsGateway();
    const engine = new DrawingEngine();

    // The first run: the list is empty, the user opens a file, and the list
    // is written to the settings file.
    const first = new RecentFilesStore();
    const firstStore = new SettingsStore({
      engine,
      gateway,
      sections: [createRecentFilesSection(first)],
      debounceMs: 0,
    });
    await firstStore.load();
    first.note("/art/cat.paka");
    await firstStore.flush();
    firstStore.destroy();

    // The second run: the list comes back from the file.
    const second = new RecentFilesStore();
    const secondStore = new SettingsStore({
      engine,
      gateway,
      sections: [createRecentFilesSection(second)],
      debounceMs: 0,
    });
    await secondStore.load();

    expect(second.getState()).toEqual(["/art/cat.paka"]);
    secondStore.destroy();
  });
});

describe("the project format round trip", () => {
  it("reads back what it wrote", () => {
    const engine = new DrawingEngine();
    paintStroke(engine);
    const parsed = parseProject(projectText(engine));

    expect(parsed.ok).toBe(true);
  });
});
