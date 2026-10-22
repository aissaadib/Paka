/**
 * The shortcut editor's tests.
 *
 * The properties that matter are the ones a user would notice:
 *
 *  - a combination the app cannot deliver is **refused**, with a reason, and
 *    nothing is stored;
 *  - a combination another action already claims is a **conflict**, and the
 *    editor names the action that holds it;
 *  - a rebound shortcut really **runs the command** - the new chord fires the
 *    action and the old chord does not;
 *  - a **reset** puts the default back, and a **swap** exchanges the two
 *    chords without leaving either action without one;
 *  - the overrides **survive a restart**, and a file that cannot be honoured
 *    loses the offending entry rather than the whole file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shortcutBindings } from "../core/actions/bindingStore";
import {
  currentPlatform,
  type KeyboardEventLike,
  type KeyboardPlatform,
} from "../core/actions/keyboard";
import {
  ACTION_DEFINITIONS,
  actionCatalog,
  applyShortcutOverrides,
  dispatchKeyboardEvent,
  effectiveShortcutsFor,
  findBindingConflict,
  normalizeShortcutOverrides,
  resetActionShortcuts,
  resetAllShortcuts,
  setActionChord,
  shortcutLabel,
  swapActionChords,
} from "../core/actions/registry";
import { captureShortcut, normalizeShortcut, reservedReason } from "../core/actions/shortcuts";
import { filterActions, groupActions } from "../features/shortcuts/shortcutEditorModel";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { SettingsStore } from "../core/settings/settingsStore";
import { createShortcutOverridesSection } from "../core/settings/shortcutsSection";
import { MemorySettingsGateway } from "./support/memorySettingsGateway";
import type { EditorSnapshot } from "../core/engine/DrawingEngine";
import type { FileActionHandlers } from "../core/actions/types";
import type { EditorActions } from "../state/editorStore";

interface FakeState {
  activeLayerId: string | null;
  selectedStrokes: number;
  selectedGuideId: string | null;
  toolId: string;
  gridVisible: boolean;
  gridSnapping: boolean;
  brushSize: number;
}

let state: FakeState;
let actions: EditorActions;
let engine: DrawingEngine;
let file: FileActionHandlers;

beforeEach(() => {
  shortcutBindings.clear();
  state = {
    activeLayerId: "layer-1",
    selectedStrokes: 1,
    selectedGuideId: null,
    toolId: "brush",
    gridVisible: false,
    gridSnapping: false,
    brushSize: 6,
  };
  actions = new Proxy(
    {},
    {
      get: (_target, property) => (...args: unknown[]) => {
        calls.push(String(property));
        return args;
      },
    },
  ) as unknown as EditorActions;
  engine = {
    getState: () =>
      ({
        document: { activeLayerId: state.activeLayerId },
        selectedStrokes: state.selectedStrokes,
        selectedGuideId: state.selectedGuideId,
        toolId: state.toolId,
        gridVisible: state.gridVisible,
        gridSnapping: state.gridSnapping,
        brush: { size: state.brushSize },
      }) as unknown as EditorSnapshot,
  } as unknown as DrawingEngine;
  file = { save: vi.fn(), saveAs: vi.fn(), open: vi.fn() };
});

afterEach(() => {
  shortcutBindings.clear();
});

/** The names of the editor actions the harness was asked to run. */
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
});

function press(
  key: string,
  options: {
    code?: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
    platform?: KeyboardPlatform;
  } = {},
) {
  const platform = options.platform ?? "other";
  return dispatchKeyboardEvent(
    {
      key,
      code: options.code ?? `Key${key.toUpperCase()}`,
      ctrlKey: options.ctrl ?? platform === "other",
      metaKey: options.meta ?? platform === "mac",
      shiftKey: options.shift ?? false,
      altKey: options.alt ?? false,
    },
    { engine, actions, file },
    platform,
  );
}

function keyEvent(
  key: string,
  options: {
    code?: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
  } = {},
): KeyboardEventLike {
  return {
    key,
    code: options.code ?? `Key${key.toUpperCase()}`,
    ctrlKey: options.ctrl ?? false,
    metaKey: options.meta ?? false,
    shiftKey: options.shift ?? false,
    altKey: options.alt ?? false,
  };
}

describe("capturing a key press", () => {
  it("waits while only a modifier is held", () => {
    const result = captureShortcut(
      { key: "Control", code: "ControlLeft", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
      "other",
    );
    expect(result.kind).toBe("waiting");
  });

  it("turns the platform's primary modifier into the mod flag", () => {
    const windows = captureShortcut(keyEvent("k", { ctrl: true }), "other");
    expect(windows.kind).toBe("captured");
    if (windows.kind !== "captured") {
      return;
    }
    expect(windows.shortcut).toEqual({ key: "k", code: "KeyK", mod: true });

    const mac = captureShortcut(keyEvent("k", { meta: true }), "mac");
    expect(mac.kind).toBe("captured");
    if (mac.kind !== "captured") {
      return;
    }
    expect(mac.shortcut).toEqual({ key: "k", code: "KeyK", mod: true });
  });

  it("keeps the physical Control key apart on macOS", () => {
    const result = captureShortcut(keyEvent("k", { ctrl: true }), "mac");
    expect(result.kind).toBe("captured");
    if (result.kind !== "captured") {
      return;
    }
    expect(result.shortcut).toEqual({ key: "k", code: "KeyK", ctrl: true });
    expect(result.shortcut.mod).toBeUndefined();
  });

  it("normalises the shifted forms of a key", () => {
    const result = captureShortcut(
      keyEvent("!", { code: "Digit1", shift: true }),
      "other",
    );
    expect(result.kind).toBe("captured");
    if (result.kind !== "captured") {
      return;
    }
    expect(result.shortcut.key).toBe("1");
    expect(result.shortcut.shift).toBe(true);
  });

  it("refuses a chord the operating system owns", () => {
    const result = captureShortcut(keyEvent("w", { ctrl: true }), "other");
    expect(result.kind).toBe("reserved");
    if (result.kind !== "reserved") {
      return;
    }
    expect(result.reason).toMatch(/closes the window/);
  });

  it("refuses a chord the app never receives", () => {
    const windows = captureShortcut(keyEvent("k", { meta: true }), "other");
    expect(windows.kind).toBe("unsupported");

    const printScreen = captureShortcut(
      { key: "PrintScreen", code: "PrintScreen", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false },
      "other",
    );
    expect(printScreen.kind).toBe("unsupported");
    if (printScreen.kind !== "unsupported") {
      return;
    }
    expect(printScreen.reason).toMatch(/screenshot/);
  });

  it("refuses Cmd and Ctrl together, which cannot be delivered as one chord", () => {
    const result = captureShortcut(keyEvent("k", { ctrl: true, meta: true }), "mac");
    expect(result.kind).toBe("unsupported");
  });

  it("stores the canonical code, so the chord reads the same on every layout", () => {
    expect(normalizeShortcut({ key: "Z", code: "KeyZ" })).toEqual({ key: "z", code: "KeyZ" });
    expect(normalizeShortcut({ key: "[", code: "whatever" })).toEqual({
      key: "[",
      code: "BracketLeft",
    });
  });

  it("knows which chords are reserved", () => {
    expect(reservedReason({ key: "w", code: "KeyW", mod: true }, "other")).toMatch(/window/);
    expect(reservedReason({ key: "k", code: "KeyK", mod: true }, "other")).toBeNull();
  });
});

describe("conflicts", () => {
  it("finds the action that already claims a chord", () => {
    const conflict = findBindingConflict(
      "save",
      0,
      { key: "j", code: "KeyJ", mod: true },
      "other",
    );
    expect(conflict?.actionId).toBe("duplicateLayer");
    expect(conflict?.label).toBe("Duplicate Layer");
  });

  it("finds nothing for a free chord", () => {
    expect(
      findBindingConflict("save", 0, { key: "k", code: "KeyK", mod: true }, "other"),
    ).toBeNull();
  });

  it("does not treat the chord being replaced as a conflict", () => {
    expect(
      findBindingConflict("save", 0, { key: "s", code: "KeyS", mod: true }, "other"),
    ).toBeNull();
  });

  it("sees a conflict with another chord of the same action", () => {
    const conflict = findBindingConflict(
      "redo",
      0,
      { key: "y", code: "KeyY", mod: true },
      "other",
    );
    expect(conflict?.actionId).toBe("redo");
  });

  it("sees a conflict on the other platform too", () => {
    // Ctrl is the primary modifier outside macOS, so a chord written with the
    // physical Control key collides with a mod chord there.
    const conflict = findBindingConflict(
      "save",
      0,
      { key: "z", code: "KeyZ", ctrl: true },
      "mac",
    );
    expect(conflict?.actionId).toBe("undo");
  });
});

describe("rebinding", () => {
  it("routes the new chord to the real action and drops the old one", () => {
    setActionChord("save", 0, { key: "k", code: "KeyK", mod: true });

    expect(press("k")?.action.id).toBe("save");
    expect(file.save).toHaveBeenCalledOnce();
    expect(press("s")).toBeNull();
    expect(file.save).toHaveBeenCalledOnce();
  });

  it("routes a rebound tool to the tool it names", () => {
    setActionChord("tool:brush", 0, { key: "v", code: "KeyV" });

    expect(press("v", { ctrl: false, meta: false })?.action.id).toBe("tool:brush");
    expect(calls).toContain("setTool");
    expect(press("b", { ctrl: false, meta: false })).toBeNull();
  });

  it("keeps the other chords of the action", () => {
    expect(effectiveShortcutsFor("redo")).toHaveLength(3);
    setActionChord("redo", 0, { key: "y", code: "KeyY", mod: true });
    expect(effectiveShortcutsFor("redo")).toHaveLength(3);
    expect(press("y")?.action.id).toBe("redo");
  });

  it("shows the rebound shortcut as the shortcut the app answers to", () => {
    expect(shortcutLabel("save", "other")).toBe("Ctrl+S");
    setActionChord("save", 0, { key: "k", code: "KeyK", mod: true });
    expect(shortcutLabel("save", "other")).toBe("Ctrl+K");
  });

  it("lists the action as changed in the catalogue", () => {
    const before = actionCatalog().find((entry) => entry.id === "save");
    expect(before?.changed).toBe(false);
    setActionChord("save", 0, { key: "k", code: "KeyK", mod: true });
    const after = actionCatalog().find((entry) => entry.id === "save");
    expect(after?.changed).toBe(true);
    expect(after?.shortcuts[0].key).toBe("k");
  });
});

describe("swapping", () => {
  it("exchanges the two chords and leaves both actions working", () => {
    // The user wants Ctrl+J for Save; Duplicate Layer already claims it.
    const conflict = findBindingConflict(
      "save",
      0,
      { key: "j", code: "KeyJ", mod: true },
      "other",
    );
    expect(conflict?.actionId).toBe("duplicateLayer");

    // The answer to the conflict: Save takes Ctrl+J and Duplicate Layer
    // takes the chord Save had.
    swapActionChords(
      { actionId: "save", index: 0 },
      { actionId: "duplicateLayer", index: 0 },
    );

    expect(press("j")?.action.id).toBe("save");
    expect(press("s")?.action.id).toBe("duplicateLayer");
  });
});

describe("resetting", () => {
  it("puts one action back to its default", () => {
    setActionChord("save", 0, { key: "k", code: "KeyK", mod: true });
    expect(press("k")?.action.id).toBe("save");

    resetActionShortcuts("save");

    expect(press("s")?.action.id).toBe("save");
    expect(press("k")).toBeNull();
    expect(shortcutLabel("save", "other")).toBe("Ctrl+S");
  });

  it("puts every action back to its default", () => {
    setActionChord("save", 0, { key: "k", code: "KeyK", mod: true });
    setActionChord("tool:brush", 0, { key: "v", code: "KeyV" });

    resetAllShortcuts();

    expect(press("s")?.action.id).toBe("save");
    expect(press("b", { ctrl: false, meta: false })?.action.id).toBe("tool:brush");
    expect(shortcutBindings.entries()).toHaveLength(0);
  });
});

describe("persistence", () => {
  it("survives a restart", () => {
    setActionChord("save", 0, { key: "k", code: "KeyK", mod: true });
    const written = JSON.parse(JSON.stringify(shortcutBindings.toJSON()));

    shortcutBindings.clear();
    expect(press("k")).toBeNull();

    applyShortcutOverrides(written);
    expect(press("k")?.action.id).toBe("save");
  });

  it("ignores a file that names an action that does not exist", () => {
    const normalized = normalizeShortcutOverrides({
      "tool:brush": [{ key: "v", code: "KeyV" }],
      "tool:pen": [{ key: "p", code: "KeyP" }],
    });
    expect(Object.keys(normalized)).toEqual(["tool:brush"]);
  });

  it("ignores a malformed chord", () => {
    const normalized = normalizeShortcutOverrides({
      save: [{ key: "k" }, { code: "KeyK" }, null, { key: "k", code: "KeyK" }],
    });
    expect(normalized.save).toEqual([{ key: "k", code: "KeyK" }]);
  });

  it("drops a chord that another action already claims", () => {
    const normalized = normalizeShortcutOverrides({
      save: [{ key: "j", code: "KeyJ", mod: true }],
    });
    expect(normalized.save).toBeUndefined();
  });

  it("keeps a swap, because neither action claims the other's chord any more", () => {
    const normalized = normalizeShortcutOverrides({
      undo: [{ key: "z", code: "KeyZ", mod: true, shift: true }],
      redo: [{ key: "z", code: "KeyZ", mod: true }],
    });
    expect(normalized.undo).toHaveLength(1);
    expect(normalized.redo).toHaveLength(1);
  });

  it("ignores a file that is not a record at all", () => {
    expect(normalizeShortcutOverrides("nonsense")).toEqual({});
    expect(normalizeShortcutOverrides(null)).toEqual({});
  });
});

describe("the settings file", () => {
  /** The settings store writes to a real engine, so the test needs one. */
  function createRealEngine(): DrawingEngine {
    return new DrawingEngine({
      document: createDocument({ name: "Test", width: 200, height: 120 }),
    });
  }

  it("carries the overrides and restores them on the next start", async () => {
    const gateway = new MemorySettingsGateway();
    const store = new SettingsStore({
      engine: createRealEngine(),
      gateway,
      sections: [createShortcutOverridesSection()],
    });
    await store.load();

    setActionChord("save", 0, { key: "k", code: "KeyK", mod: true });
    await store.flush();

    const written = JSON.parse(gateway.contents ?? "{}") as {
      shortcuts?: Record<string, unknown>;
    };
    expect(written.shortcuts?.save).toEqual([{ key: "k", code: "KeyK", mod: true }]);

    // The next start reads the file and the shortcut is there again.
    shortcutBindings.clear();
    const next = new SettingsStore({
      engine: createRealEngine(),
      gateway,
      sections: [createShortcutOverridesSection()],
    });
    await next.load();
    expect(press("k")?.action.id).toBe("save");
    expect(press("s")).toBeNull();

    next.destroy();
    store.destroy();
  });

  it("starts with the defaults when the file has no shortcuts in it", async () => {
    const gateway = new MemorySettingsGateway();
    gateway.contents = JSON.stringify({ version: 1, toolId: "brush" });
    const store = new SettingsStore({
      engine: createRealEngine(),
      gateway,
      sections: [createShortcutOverridesSection()],
    });
    await store.load();

    expect(shortcutBindings.entries()).toHaveLength(0);
    expect(press("s")?.action.id).toBe("save");

    store.destroy();
  });
});

describe("the editor's list", () => {
  it("groups the actions by category", () => {
    const groups = groupActions(actionCatalog());
    expect(groups.length).toBeGreaterThan(0);
    const labels = groups.map((group) => group.label);
    expect(labels).toContain("Tools");
    expect(labels).toContain("File");
    const tools = groups.find((group) => group.label === "Tools");
    expect(tools?.rows.some((row) => row.entry.id === "tool:brush")).toBe(true);
  });

  it("finds an action by its name", () => {
    const found = filterActions(actionCatalog(), "save", currentPlatform());
    expect(found.map((entry) => entry.id)).toContain("save");
  });

  it("finds an action by the shortcut it is bound to", () => {
    const found = filterActions(actionCatalog(), "ctrl+s", "other");
    expect(found.map((entry) => entry.id)).toContain("save");
  });

  it("finds every action of a category", () => {
    const found = filterActions(actionCatalog(), "tools", "other");
    expect(found.length).toBe(ACTION_DEFINITIONS.filter((a) => a.id.startsWith("tool:")).length);
  });

  it("leaves everything in when the search is empty", () => {
    expect(filterActions(actionCatalog(), "   ", "other")).toHaveLength(
      ACTION_DEFINITIONS.length,
    );
  });
});
