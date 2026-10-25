import { describe, expect, it, vi } from "vitest";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { createDocument } from "../core/document/document";
import type { EditorActions } from "../state/editorStore";
import {
  captureChord,
  findChordOwner,
  normalizeUserShortcuts,
  parseUserShortcuts,
  resetShortcut,
  sanitizeUserShortcuts,
  serializeUserShortcuts,
  shortcutEntries,
  userShortcutsEqual,
  ShortcutStore,
  assignShortcut,
  type ShortcutGateway,
} from "../core/actions/shortcutEditor";
import { ACTION_DEFINITIONS, dispatchKeyboardEvent, validateRegistry } from "../core/actions/registry";
import type { KeyboardEventLike, KeyboardPlatform } from "../core/actions/keyboard";
import type { ShortcutOverrides, ShortcutSpec } from "../core/actions/types";

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

function context(): {
  engine: DrawingEngine;
  actions: EditorActions;
  file: { save?: () => void; saveAs?: () => void; open?: () => void };
} {
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

function press(
  event: KeyboardEventLike,
  platform: KeyboardPlatform,
  overrides?: ShortcutOverrides,
) {
  const { engine, actions, file } = context();
  const match = dispatchKeyboardEvent(event, { engine, actions, file }, platform, overrides);
  return { match, actions };
}

const CTRL_K: ShortcutSpec = { key: "k", code: "KeyK", mod: true };
const CTRL_Z: ShortcutSpec = { key: "z", code: "KeyZ", mod: true };

describe("capturing a chord", () => {
  it("keeps the logical key and the physical code", () => {
    const result = captureChord(keyEvent({ key: "k", code: "KeyK" }), "other");
    expect(result).toEqual({ ok: true, shortcut: { key: "k", code: "KeyK" } });
  });

  it("uses Ctrl as the primary modifier and Cmd on macOS", () => {
    const onWindows = captureChord(keyEvent({ key: "k", code: "KeyK", ctrlKey: true }), "other");
    expect(onWindows).toEqual({ ok: true, shortcut: CTRL_K });

    const onMac = captureChord(keyEvent({ key: "k", code: "KeyK", metaKey: true }), "mac");
    expect(onMac).toEqual({ ok: true, shortcut: CTRL_K });
  });

  it("refuses the modifier Paka does not bind, and says why", () => {
    const onMac = captureChord(keyEvent({ key: "k", code: "KeyK", ctrlKey: true }), "mac");
    expect(onMac.ok).toBe(false);
    if (!onMac.ok) {
      expect(onMac.reason).toContain("Cmd");
    }

    const onWindows = captureChord(keyEvent({ key: "k", code: "KeyK", metaKey: true }), "other");
    expect(onWindows.ok).toBe(false);
    if (!onWindows.ok) {
      expect(onWindows.reason).toContain("Ctrl");
    }
  });

  it("refuses a modifier pressed on its own", () => {
    const result = captureChord(keyEvent({ key: "Control", code: "ControlLeft", ctrlKey: true }), "other");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("modifier");
    }
  });

  it("falls back to the physical key on a layout that does not produce the Latin key", () => {
    // The Cyrillic "б" sits on the physical B key.
    const result = captureChord(keyEvent({ key: "б", code: "KeyB" }), "other");
    expect(result).toEqual({ ok: true, shortcut: { key: "b", code: "KeyB" } });
  });

  it("keeps a character Paka does not bind, beside its physical key", () => {
    const result = captureChord(keyEvent({ key: "§", code: "Backslash" }), "other");
    expect(result).toEqual({ ok: true, shortcut: { key: "§", code: "Backslash" } });
  });
});

describe("a user's chord answers for its command", () => {
  it("runs the command on the user's chord", () => {
    const { match, actions } = press(
      keyEvent({ key: "k", code: "KeyK", ctrlKey: true }),
      "other",
      { undo: CTRL_K },
    );
    expect(match?.action.id).toBe("undo");
    expect(actions.undo).toHaveBeenCalledOnce();
  });

  it("stops answering on the built-in chord", () => {
    const { match, actions } = press(
      keyEvent({ key: "z", code: "KeyZ", ctrlKey: true }),
      "other",
      { undo: CTRL_K },
    );
    expect(match).toBeNull();
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it("matches the chord on a layout that does not produce the Latin key", () => {
    const { match } = press(
      keyEvent({ key: "к", code: "KeyK", ctrlKey: true }),
      "other",
      { undo: CTRL_K },
    );
    expect(match?.action.id).toBe("undo");
  });

  it("matches the chord through the physical code on another layout", () => {
    // The chord was recorded where the key produced "§"; on a US layout the
    // same physical key produces "\".
    const { match } = press(
      keyEvent({ key: "\\", code: "Backslash", ctrlKey: true }),
      "other",
      { undo: { key: "§", code: "Backslash", mod: true } },
    );
    expect(match?.action.id).toBe("undo");
  });

  it("leaves the other commands' chords alone", () => {
    const { match } = press(
      keyEvent({ key: "y", code: "KeyY", ctrlKey: true }),
      "other",
      { undo: CTRL_K },
    );
    expect(match?.action.id).toBe("redo");
  });
});

describe("a chord belongs to one command", () => {
  it("reports a chord another command already holds", () => {
    const result = assignShortcut({}, "redo", CTRL_Z);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.owner.actionId).toBe("undo");
      expect(result.reason).toContain("Undo");
    }
  });

  it("does not steal the chord", () => {
    const shortcuts: ShortcutOverrides = { undo: CTRL_K };
    const result = assignShortcut(shortcuts, "redo", CTRL_K);
    expect(result.ok).toBe(false);
    // Nothing changed: the chord stayed with the command that had it.
    expect(shortcuts).toEqual({ undo: CTRL_K });
  });

  it("allows a command to keep a chord it already holds", () => {
    const result = assignShortcut({}, "undo", CTRL_Z);
    expect(result.ok).toBe(true);
  });

  it("frees the built-in chord a command gave up", () => {
    const first = assignShortcut({}, "undo", CTRL_K);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = assignShortcut(first.shortcuts, "redo", CTRL_Z);
    expect(second.ok).toBe(true);
  });

  it("refuses two user chords that clash", () => {
    expect(() =>
      validateRegistry(ACTION_DEFINITIONS, { undo: CTRL_K, redo: CTRL_K }),
    ).toThrow(/Ambiguous shortcut/);
  });

  it("validates a user's chord the way the registry validates its own", () => {
    // "Redo" claims Ctrl+Z while "Undo" still holds it.
    expect(() => validateRegistry(ACTION_DEFINITIONS, { redo: CTRL_Z })).toThrow(
      /Ambiguous shortcut/,
    );
    // A chord nobody holds is fine.
    expect(() => validateRegistry(ACTION_DEFINITIONS, { undo: CTRL_K })).not.toThrow();
  });

  it("names the command that holds a chord", () => {
    const owner = findChordOwner(CTRL_Z, {}, "other");
    expect(owner?.actionId).toBe("undo");
    expect(findChordOwner({ key: "q", code: "KeyQ", mod: true }, {}, "other")).toBeNull();
  });
});

describe("the chords the editor shows", () => {
  it("lists every command with the chord it answers to", () => {
    const entries = shortcutEntries();
    expect(entries.length).toBe(ACTION_DEFINITIONS.length);
    const undo = entries.find((entry) => entry.actionId === "undo");
    expect(undo?.shortcuts).toEqual([{ key: "z", code: "KeyZ", mod: true }]);
    expect(undo?.customized).toBe(false);
  });

  it("shows the user's chord and the built-in one it replaced", () => {
    const entries = shortcutEntries({ undo: CTRL_K });
    const undo = entries.find((entry) => entry.actionId === "undo");
    expect(undo?.shortcuts).toEqual([CTRL_K]);
    expect(undo?.defaults).toEqual([{ key: "z", code: "KeyZ", mod: true }]);
    expect(undo?.customized).toBe(true);
  });

  it("gives the built-in chords back when the command is reset", () => {
    const shortcuts = resetShortcut({ undo: CTRL_K }, "undo");
    expect(shortcuts).toEqual({});
    expect(shortcutEntries(shortcuts).find((entry) => entry.actionId === "undo")?.shortcuts).toEqual([
      { key: "z", code: "KeyZ", mod: true },
    ]);
  });
});

describe("the chords document", () => {
  it("round-trips", () => {
    const shortcuts: ShortcutOverrides = { undo: CTRL_K, toolBrush: { key: "1", code: "Digit1" } };
    const text = serializeUserShortcuts(shortcuts);
    expect(parseUserShortcuts(text)).toEqual(shortcuts);
    expect(userShortcutsEqual(parseUserShortcuts(text), shortcuts)).toBe(true);
  });

  it("reads a malformed file as no chords at all", () => {
    expect(parseUserShortcuts("not json at all")).toEqual({});
    expect(parseUserShortcuts("[]")).toEqual({});
    expect(parseUserShortcuts("{}")).toEqual({});
    expect(parseUserShortcuts(null)).toEqual({});
  });

  it("ignores a document from a newer version", () => {
    expect(parseUserShortcuts('{"version":99,"shortcuts":{"undo":{"key":"k","code":"KeyK"}}}'))
      .toEqual({});
  });

  it("skips a malformed chord and keeps the rest", () => {
    const shortcuts = normalizeUserShortcuts({
      undo: { key: "k", code: "KeyK", mod: true },
      redo: { key: "" },
      save: "nonsense",
    });
    expect(shortcuts).toEqual({ undo: CTRL_K });
  });

  it("drops a chord that clashes with a built-in one", () => {
    // "Redo" claims Ctrl+Z while "Undo" still holds it.
    expect(sanitizeUserShortcuts({ redo: CTRL_Z })).toEqual({});
  });

  it("keeps a chord that took a key a command gave up", () => {
    // "Undo" gave Ctrl+Z up when the user gave it Ctrl+K.
    const shortcuts = sanitizeUserShortcuts({ undo: CTRL_K, redo: CTRL_Z });
    expect(shortcuts).toEqual({ undo: CTRL_K, redo: CTRL_Z });
  });
});

describe("the store", () => {
  class MemoryGateway implements ShortcutGateway {
    text: string | null = null;
    writes = 0;
    failWrite = false;

    async read(): Promise<string | null> {
      return this.text;
    }

    async write(contents: string): Promise<void> {
      if (this.failWrite) {
        throw new Error("the disk is full");
      }
      this.writes += 1;
      this.text = contents;
    }
  }

  function scheduler() {
    const pending: Array<() => void> = [];
    return {
      schedule(callback: () => void): unknown {
        pending.push(callback);
        return pending.length;
      },
      cancel(): void {
        pending.length = 0;
      },
      run(): void {
        for (const callback of pending.splice(0)) {
          callback();
        }
      },
    };
  }

  it("keeps the user's chord across a restart", async () => {
    const gateway = new MemoryGateway();
    const first = new ShortcutStore({ gateway, ...scheduler() });
    await first.load();
    const result = await first.assign("undo", CTRL_K);
    expect(result.ok).toBe(true);
    await first.flush();
    first.destroy();

    const second = new ShortcutStore({ gateway, ...scheduler() });
    const loaded = await second.load();
    expect(loaded.undo).toEqual(CTRL_K);
    // The chord answers for the command after the restart.
    const { match } = press(
      keyEvent({ key: "k", code: "KeyK", ctrlKey: true }),
      "other",
      loaded,
    );
    expect(match?.action.id).toBe("undo");
  });

  it("writes nothing when the chord is refused", async () => {
    const gateway = new MemoryGateway();
    const store = new ShortcutStore({ gateway, ...scheduler() });
    await store.load();
    const result = await store.assign("redo", CTRL_Z);
    expect(result.ok).toBe(false);
    await store.flush();
    expect(gateway.writes).toBe(0);
    expect(store.current).toEqual({});
  });

  it("records a failed write without raising", async () => {
    const gateway = new MemoryGateway();
    gateway.failWrite = true;
    const store = new ShortcutStore({ gateway, ...scheduler() });
    await store.load();
    await store.assign("undo", CTRL_K);
    await store.flush();
    expect(store.lastError).toContain("disk is full");
    // The chord is still in memory: the editor carries on with it.
    expect(store.current.undo).toEqual(CTRL_K);
  });

  it("tells its watchers when a chord changes", async () => {
    const gateway = new MemoryGateway();
    const store = new ShortcutStore({ gateway, ...scheduler() });
    const seen: ShortcutOverrides[] = [];
    const stop = store.subscribe((shortcuts) => seen.push(shortcuts));
    await store.load();
    await store.assign("undo", CTRL_K);
    await store.reset("undo");
    stop();
    await store.assign("undo", CTRL_K);
    expect(seen.length).toBe(3);
    expect(seen[1].undo).toEqual(CTRL_K);
    expect(seen[2]).toEqual({});
  });
});

describe("a shortcut is a preference, not an edit", () => {
  it("leaves the drawing, its history and its dirty flag alone", async () => {
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 200, height: 120 }),
    });
    const before = engine.getState();

    const gateway = {
      read: async () => null,
      write: async () => undefined,
    } satisfies ShortcutGateway;
    const store = new ShortcutStore({ gateway });
    await store.load();
    await store.assign("undo", CTRL_K);
    await store.reset("undo");

    const after = engine.getState();
    expect(after.history).toEqual(before.history);
    expect(after.file).toEqual(before.file);
    expect(after.document).toEqual(before.document);
    engine.destroy();
  });
});
