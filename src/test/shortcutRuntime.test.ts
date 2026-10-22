/**
 * The user's chords, from the settings file to the running application.
 *
 * The shortcut editor's model exists and is tested on its own. This file
 * covers the two things that make the chords reach the application:
 *
 *  - the chords live in the **settings file**, under the `shortcuts` key, in a
 *    section the settings store can carry. The round trip is proved through
 *    the file: a chord is written, the file is read by a second run of the
 *    application, and the chord comes back.
 *  - the chords are **dispatched**. A command answers to the key the user
 *    gave it and to nothing else: the key it gave up is free, and a chord
 *    another command holds is reported rather than stolen.
 *
 * The chords are a preference, so the last test pins the rule that matters
 * most about them: changing one adds no history step, dirties nothing and
 * never reaches a project file.
 *
 * Everything runs in Node: the store, the section and the engine are all
 * framework-free.
 */

import { describe, expect, it, vi } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { dispatchKeyboardEvent } from "../core/actions/registry";
import { ShortcutStore } from "../core/actions/shortcutEditor";
import {
  createShortcutSection,
  SHORTCUT_SECTION_KEY,
} from "../core/actions/shortcutSection";
import { SettingsStore } from "../core/settings/settingsStore";
import type { SettingsSection } from "../core/settings/settingsSection";
import type { EditorActions } from "../state/editorStore";
import type { KeyboardEventLike } from "../core/actions/keyboard";
import type { ShortcutSpec } from "../core/actions/types";
import { MemorySettingsGateway } from "./support/memorySettingsGateway";

const CTRL_K: ShortcutSpec = { key: "k", code: "KeyK", mod: true };
const CTRL_Z: ShortcutSpec = { key: "z", code: "KeyZ", mod: true };

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

function createEngine(): DrawingEngine {
  return new DrawingEngine({ document: createDocument({ name: "Test", width: 200, height: 120 }) });
}

interface Harness {
  readonly engine: DrawingEngine;
  /** The settings file. */
  readonly gateway: MemorySettingsGateway;
  readonly timers: ManualTimers;
  /** The chords the application is running with. */
  readonly chords: ShortcutStore;
  /** The store that owns the settings file. */
  readonly settings: SettingsStore;
}

function createHarness(gateway: MemorySettingsGateway = new MemorySettingsGateway()): Harness {
  const engine = createEngine();
  const timers = new ManualTimers();
  const chords = new ShortcutStore({});
  const settings = new SettingsStore({
    engine,
    gateway,
    sections: [createShortcutSection(chords)],
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  return { engine, gateway, timers, chords, settings };
}

/** The document the settings file holds, as a plain object. */
function fileDocument(gateway: MemorySettingsGateway): Record<string, unknown> {
  return JSON.parse(gateway.contents ?? "{}") as Record<string, unknown>;
}

function keyEvent(overrides: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

/** A dispatcher that records what the commands did. */
function dispatcher() {
  const actions = {
    undo: vi.fn(),
    redo: vi.fn(),
    setTool: vi.fn(),
  } as unknown as EditorActions;
  const engine = {
    getState: () =>
      ({
        document: { activeLayerId: null },
        selectedStrokes: 0,
        selectedGuideId: null,
        toolId: "brush",
        gridVisible: false,
        gridSnapping: false,
        brush: { size: 6 },
      }) as unknown as ReturnType<DrawingEngine["getState"]>,
  } as unknown as DrawingEngine;
  return { engine, actions, file: {} };
}

describe("the chords section of the settings file", () => {
  it("is a section the settings store accepts", () => {
    const chords = new ShortcutStore({});
    const section: SettingsSection<unknown> = createShortcutSection(chords);
    expect(section.key).toBe("shortcuts");
    expect(SHORTCUT_SECTION_KEY).toBe("shortcuts");
  });

  it("round-trips the chords through the file on disk", async () => {
    const { gateway, chords, settings, timers } = createHarness();
    await settings.load();
    expect(chords.getSnapshot()).toEqual({});

    await chords.assign("undo", CTRL_K);
    timers.runAll();
    await settings.flush();

    // The file on disk carries the chord, under the section's own key.
    expect(fileDocument(gateway)[SHORTCUT_SECTION_KEY]).toEqual({
      version: 1,
      shortcuts: { undo: { key: "k", code: "KeyK", mod: true } },
    });

    // A second run of the application reads it back.
    const second = createHarness(gateway);
    await second.settings.load();
    expect(second.chords.getSnapshot().undo).toEqual(CTRL_K);
  });

  it("keeps the other preferences in the file", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({ brush: { size: 33 } });
    const { chords, settings } = createHarness(gateway);
    await settings.load();

    await chords.assign("undo", CTRL_K);
    await settings.flush();

    const document = fileDocument(gateway);
    expect((document.brush as { size: number }).size).toBe(33);
    expect(document[SHORTCUT_SECTION_KEY]).toEqual({
      version: 1,
      shortcuts: { undo: { key: "k", code: "KeyK", mod: true } },
    });
  });

  it("takes no chords from a section written by a newer version", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      shortcuts: { version: 99, shortcuts: { undo: CTRL_K } },
    });
    const { chords, settings } = createHarness(gateway);
    await settings.load();
    expect(chords.getSnapshot()).toEqual({});
  });

  it("takes no chords from a malformed section", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({ shortcuts: { undo: "nonsense" } });
    const { chords, settings } = createHarness(gateway);
    await settings.load();
    expect(chords.getSnapshot()).toEqual({});
  });

  it("drops a chord that clashes with a built-in one", async () => {
    // "Redo" claims Ctrl+Z while "Undo" still holds it: the built-in chord
    // wins, and the user's chord is dropped rather than allowed to shadow it.
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      shortcuts: { version: 1, shortcuts: { redo: CTRL_Z } },
    });
    const { chords, settings } = createHarness(gateway);
    await settings.load();
    expect(chords.getSnapshot()).toEqual({});
  });

  it("keeps a chord that took a key a command gave up", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({
      shortcuts: { version: 1, shortcuts: { undo: CTRL_K, redo: CTRL_Z } },
    });
    const { chords, settings } = createHarness(gateway);
    await settings.load();
    expect(chords.getSnapshot().undo).toEqual(CTRL_K);
    expect(chords.getSnapshot().redo).toEqual(CTRL_Z);
  });
});

describe("the chords reach the dispatcher", () => {
  it("runs the command on the user's chord", async () => {
    const { gateway, chords, settings } = createHarness();
    await settings.load();
    await chords.assign("undo", CTRL_K);
    await settings.flush();

    // A second run of the application: the chord comes back from the file.
    const second = createHarness(gateway);
    await second.settings.load();

    const { engine, actions, file } = dispatcher();
    const match = dispatchKeyboardEvent(
      keyEvent({ key: "k", code: "KeyK", ctrlKey: true }),
      { engine, actions, file },
      "other",
      second.chords.getSnapshot(),
    );
    expect(match?.action.id).toBe("undo");
    expect(actions.undo).toHaveBeenCalledOnce();
  });

  it("stops answering on the built-in chord", async () => {
    const { gateway, chords, settings } = createHarness();
    await settings.load();
    await chords.assign("undo", CTRL_K);
    await settings.flush();

    const second = createHarness(gateway);
    await second.settings.load();

    const { engine, actions, file } = dispatcher();
    const match = dispatchKeyboardEvent(
      keyEvent({ key: "z", code: "KeyZ", ctrlKey: true }),
      { engine, actions, file },
      "other",
      second.chords.getSnapshot(),
    );
    expect(match).toBeNull();
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it("matches the chord on a layout that does not produce the Latin key", async () => {
    const { chords, settings } = createHarness();
    await settings.load();
    await chords.assign("undo", CTRL_K);
    await settings.flush();

    const { engine, actions, file } = dispatcher();
    // The Cyrillic "к" sits on the physical K key.
    const match = dispatchKeyboardEvent(
      keyEvent({ key: "к", code: "KeyK", ctrlKey: true }),
      { engine, actions, file },
      "other",
      chords.getSnapshot(),
    );
    expect(match?.action.id).toBe("undo");
  });
});

describe("a chord belongs to one command", () => {
  it("reports the command that holds it, and does not steal it", async () => {
    const { gateway, chords, settings } = createHarness();
    await settings.load();

    const result = await chords.assign("redo", CTRL_Z);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.owner.actionId).toBe("undo");
      expect(result.reason).toContain("Undo");
    }
    expect(chords.getSnapshot()).toEqual({});

    // Nothing was written: the refused chord is not in the file.
    await settings.flush();
    const written = fileDocument(gateway)[SHORTCUT_SECTION_KEY] as
      | { shortcuts: Record<string, unknown> }
      | undefined;
    expect(written?.shortcuts).toEqual({});
  });

  it("frees the built-in chord a command gave up", async () => {
    const { chords, settings } = createHarness();
    await settings.load();

    expect((await chords.assign("undo", CTRL_K)).ok).toBe(true);
    const second = await chords.assign("redo", CTRL_Z);
    expect(second.ok).toBe(true);
  });
});

describe("a shortcut is a preference, not an edit", () => {
  it("leaves the drawing, its history and its dirty flag alone", async () => {
    const { engine, chords, settings } = createHarness();
    await settings.load();
    const before = engine.getState();

    await chords.assign("undo", CTRL_K);
    await settings.flush();
    await chords.reset("undo");

    const after = engine.getState();
    expect(after.history).toEqual(before.history);
    expect(after.file).toEqual(before.file);
    expect(after.document).toEqual(before.document);
  });
});
