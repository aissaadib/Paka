import { describe, expect, it } from "vitest";
import {
  chordId,
  currentPlatform,
  formatShortcut,
  isTextEntryTarget,
  keyFromCode,
  logicalKey,
  matchesShortcut,
  type KeyboardEventLike,
} from "../core/actions/keyboard";

function event(overrides: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
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

describe("logical keys", () => {
  it("maps the physical codes Paka binds", () => {
    expect(keyFromCode("KeyB")).toBe("b");
    expect(keyFromCode("BracketLeft")).toBe("[");
    expect(keyFromCode("Quote")).toBe("'");
    expect(keyFromCode("ArrowLeft")).toBe("arrowleft");
    expect(keyFromCode("F13")).toBeNull();
  });

  it("prefers a Latin key and falls back to the physical code otherwise", () => {
    expect(logicalKey(event({ key: "B", code: "KeyB" }))).toBe("b");
    // Cyrillic "б" sits on the physical B key.
    expect(logicalKey(event({ key: "б", code: "KeyB" }))).toBe("b");
    expect(logicalKey(event({ key: "х", code: "BracketLeft" }))).toBe("[");
  });

  it("normalises the shifted punctuation forms", () => {
    expect(logicalKey(event({ key: "+", code: "Equal", shiftKey: true }))).toBe("=");
    expect(logicalKey(event({ key: '"', code: "Quote", shiftKey: true }))).toBe("'");
  });
});

describe("modifier semantics", () => {
  const undo = { key: "z", code: "KeyZ", mod: true };

  it("uses Ctrl as the primary modifier outside macOS", () => {
    expect(matchesShortcut(event({ key: "z", code: "KeyZ", ctrlKey: true }), undo, "other")).toBe(
      true,
    );
    expect(matchesShortcut(event({ key: "z", code: "KeyZ", metaKey: true }), undo, "other")).toBe(
      false,
    );
  });

  it("uses Cmd as the primary modifier on macOS", () => {
    expect(matchesShortcut(event({ key: "z", code: "KeyZ", metaKey: true }), undo, "mac")).toBe(
      true,
    );
    expect(matchesShortcut(event({ key: "z", code: "KeyZ", ctrlKey: true }), undo, "mac")).toBe(
      false,
    );
  });

  it("requires an exact Shift state", () => {
    const redo = { key: "z", code: "KeyZ", mod: true, shift: true };
    expect(
      matchesShortcut(event({ key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true }), redo, "other"),
    ).toBe(true);
    expect(matchesShortcut(event({ key: "z", code: "KeyZ", ctrlKey: true }), redo, "other")).toBe(
      false,
    );
    expect(
      matchesShortcut(event({ key: "z", code: "KeyZ", ctrlKey: true }), undo, "other"),
    ).toBe(true);
    expect(
      matchesShortcut(
        event({ key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true }),
        undo,
        "other",
      ),
    ).toBe(false);
  });

  it("never claims a chord while Alt is held", () => {
    expect(
      matchesShortcut(event({ key: "z", code: "KeyZ", ctrlKey: true, altKey: true }), undo, "other"),
    ).toBe(false);
  });

  it("does not claim a bare modified key", () => {
    const tool = { key: "b", code: "KeyB" };
    expect(matchesShortcut(event({ key: "b", code: "KeyB", ctrlKey: true }), tool, "other")).toBe(
      false,
    );
    expect(matchesShortcut(event({ key: "Control", code: "ControlLeft" }), tool, "other")).toBe(
      false,
    );
  });

  it("uses the physical code when the layout key is not Latin", () => {
    const tool = { key: "b", code: "KeyB" };
    expect(matchesShortcut(event({ key: "б", code: "KeyB" }), tool, "other")).toBe(true);
  });
});

describe("chord identity and labels", () => {
  it("separates platforms and shift states", () => {
    const undo = { key: "z", mod: true };
    expect(chordId(undo, "mac")).not.toBe(chordId(undo, "other"));
    expect(chordId(undo, "other")).not.toBe(chordId({ key: "z", mod: true, shift: true }, "other"));
    expect(chordId(undo, "other")).toBe(chordId({ key: "Z", mod: true }, "other"));
  });

  it("formats shortcuts for the platform", () => {
    expect(formatShortcut({ key: "z", mod: true, shift: true }, "other")).toBe("Ctrl+Shift+Z");
    expect(formatShortcut({ key: "z", mod: true, shift: true }, "mac")).toBe("Cmd+Shift+Z");
    expect(formatShortcut({ key: "arrowleft" }, "other")).toBe("←");
  });

  it("reports the current platform safely outside a browser", () => {
    expect(currentPlatform()).toBe("other");
  });
});

describe("text-entry guard", () => {
  it("recognises fields and editable content", () => {
    expect(isTextEntryTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "textarea" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("lets the canvas and plain elements through", () => {
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget({})).toBe(false);
    expect(isTextEntryTarget({ tagName: "CANVAS" })).toBe(false);
    expect(isTextEntryTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
  });
});
