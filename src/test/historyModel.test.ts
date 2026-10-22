/**
 * History model tests.
 *
 * The history model is the shell's read-only view of the command stack. It
 * never runs a command and never mutates the document, so everything here is
 * about the description: the labels, the kinds and the cursor.
 */

import { describe, expect, it, afterEach } from "vitest";
import {
  EMPTY_HISTORY,
  appliedEntries,
  canRedo,
  canUndo,
  defaultHistoryClassifier,
  describeHistory,
  historyEntryAt,
  redoLabel,
  resetHistoryClassifier,
  setHistoryClassifier,
  undoLabel,
  undoneEntries,
} from "../core/shell/historyModel";
import type { Command } from "../core/commands/types";

function command(id: string, label: string): Command {
  return {
    id,
    label,
    apply: () => undefined,
    revert: () => undefined,
  };
}

afterEach(() => {
  resetHistoryClassifier();
});

describe("describing a history", () => {
  it("describes an empty stack", () => {
    const history = describeHistory([]);
    expect(history.entries).toEqual([]);
    expect(history.cursor).toBe(0);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undoLabel(history)).toBeNull();
    expect(redoLabel(history)).toBeNull();
  });

  it("keeps each command's own label", () => {
    const history = describeHistory([command("a", "Add stroke"), command("b", "Delete layer")]);
    expect(history.entries.map((entry) => entry.label)).toEqual([
      "Add stroke",
      "Delete layer",
    ]);
    expect(history.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("marks the steps after the cursor as undone", () => {
    const history = describeHistory(
      [command("a", "Add stroke"), command("b", "Add stroke"), command("c", "Add stroke")],
      2,
    );
    expect(history.entries.map((entry) => entry.undone)).toEqual([false, false, true]);
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(true);
    expect(undoLabel(history)).toBe("Add stroke");
    expect(redoLabel(history)).toBe("Add stroke");
  });

  it("clamps a cursor outside the list", () => {
    const commands = [command("a", "Add stroke")];
    expect(describeHistory(commands, -5).cursor).toBe(0);
    expect(describeHistory(commands, 99).cursor).toBe(1);
  });

  it("splits the entries into applied and undone", () => {
    const history = describeHistory(
      [command("a", "Add stroke"), command("b", "Add stroke")],
      1,
    );
    expect(appliedEntries(history).map((entry) => entry.id)).toEqual(["a"]);
    expect(undoneEntries(history).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("finds one entry by index", () => {
    const history = describeHistory([command("a", "Add stroke")]);
    expect(historyEntryAt(history, 0)?.id).toBe("a");
    expect(historyEntryAt(history, 5)).toBeUndefined();
  });

  it("starts from the empty history", () => {
    expect(EMPTY_HISTORY.entries).toEqual([]);
    expect(EMPTY_HISTORY.cursor).toBe(0);
  });
});

describe("classifying a command", () => {
  it("classifies the kinds the editor produces", () => {
    expect(defaultHistoryClassifier(command("a", "Add stroke"))).toBe("stroke");
    expect(defaultHistoryClassifier(command("a", "Bucket fill"))).toBe("fill");
    expect(defaultHistoryClassifier(command("a", "Add gradient"))).toBe("gradient");
    expect(defaultHistoryClassifier(command("a", "Add layer"))).toBe("layer");
    expect(defaultHistoryClassifier(command("a", "Move selection"))).toBe("selection");
  });

  it("calls an unknown step other rather than hiding it", () => {
    expect(defaultHistoryClassifier(command("a", "Do the thing"))).toBe("other");
  });

  it("uses a replacement classifier when one is set", () => {
    setHistoryClassifier(() => "other");
    const history = describeHistory([command("a", "Add stroke")]);
    expect(history.entries[0].kind).toBe("other");
  });

  it("restores the default classifier", () => {
    setHistoryClassifier(() => "other");
    resetHistoryClassifier();
    const history = describeHistory([command("a", "Add stroke")]);
    expect(history.entries[0].kind).toBe("stroke");
  });
});
