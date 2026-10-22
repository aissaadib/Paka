/**
 * Command palette search tests.
 *
 * The palette filters the registry, so the search is the only thing that
 * decides which command the user finds. The rules are pure, so they are
 * tested here rather than in the browser.
 */

import { describe, expect, it } from "vitest";
import {
  MATCH_RANKS,
  matchChord,
  matchLabel,
  searchCommands,
} from "../core/actions/commandSearch";
import { ACTION_DEFINITIONS } from "../core/actions/registry";
import type { ActionDefinition } from "../core/actions/types";

function command(
  id: string,
  label: string,
  shortcuts: ActionDefinition["shortcuts"] = [],
): ActionDefinition {
  return {
    id: id as ActionDefinition["id"],
    label,
    shortcuts,
    run: () => undefined,
  };
}

const COMMANDS: readonly ActionDefinition[] = [
  command("undo", "Undo", [{ key: "z", code: "KeyZ", mod: true }]),
  command("redo", "Redo", [{ key: "z", code: "KeyZ", mod: true, shift: true }]),
  command("duplicateSelection", "Duplicate Selection", [
    { key: "d", code: "KeyD", mod: true },
  ]),
  command("zoomFit", "Fit to Window", [{ key: "0", code: "Digit0", mod: true }]),
  command("toggleGrid", "Grid"),
  command("brush", "Brush", [{ key: "b", code: "KeyB" }]),
];

describe("label matching", () => {
  it("ranks a prefix above a word and a word above a substring", () => {
    expect(matchLabel("Duplicate Selection", "dup")).toBe(MATCH_RANKS.prefix);
    expect(matchLabel("Duplicate Selection", "sel")).toBe(MATCH_RANKS.word);
    expect(matchLabel("Duplicate Selection", "cate")).toBe(MATCH_RANKS.contains);
  });

  it("finds a label with the letters in order", () => {
    expect(matchLabel("Brush", "brsh")).toBe(MATCH_RANKS.fuzzy);
  });

  it("does not match an unrelated word", () => {
    expect(matchLabel("Brush", "zzz")).toBeNull();
  });

  it("matches the chord the way the user reads it", () => {
    const undo = COMMANDS[0];
    expect(matchChord(undo, "ctrl+z", "other")).toBe(MATCH_RANKS.chord);
    expect(matchChord(undo, "cmd+z", "mac")).toBe(MATCH_RANKS.chord);
    expect(matchChord(undo, "ctrl+q", "other")).toBeNull();
  });
});

describe("searching the commands", () => {
  it("returns every command for an empty query, in the registry's order", () => {
    const results = searchCommands("", COMMANDS, "other");
    expect(results.map((result) => result.action.id)).toEqual([
      "undo",
      "redo",
      "duplicateSelection",
      "zoomFit",
      "toggleGrid",
      "brush",
    ]);
  });

  it("finds a command by the beginning of its name", () => {
    const results = searchCommands("dup", COMMANDS, "other");
    expect(results[0]?.action.id).toBe("duplicateSelection");
  });

  it("finds a command by its chord", () => {
    // "Ctrl+Z" is Undo and "Ctrl+Shift+Z" is Redo; a query that names fewer
    // modifiers than the chord has still finds it, and equally matched
    // commands are ordered by name.
    const results = searchCommands("ctrl+z", COMMANDS, "other");
    expect(results.map((result) => result.action.id)).toEqual(["redo", "undo"]);
  });

  it("puts the closer match first", () => {
    const results = searchCommands("fit", COMMANDS, "other");
    expect(results[0]?.action.id).toBe("zoomFit");
  });

  it("needs every word of the query to match", () => {
    expect(searchCommands("grid", COMMANDS, "other").map((r) => r.action.id)).toEqual([
      "toggleGrid",
    ]);
    expect(searchCommands("grid dup", COMMANDS, "other")).toHaveLength(0);
  });

  it("shows the chord of the command it found", () => {
    const results = searchCommands("undo", COMMANDS, "other");
    expect(results[0]?.shortcut).toBe("Ctrl+Z");
  });

  it("shows no chord for a command without one", () => {
    const results = searchCommands("grid", COMMANDS, "other");
    expect(results[0]?.shortcut).toBeNull();
  });
});

describe("the registry the palette reads", () => {
  it("holds every command of the keyboard table and the menus", () => {
    const ids = ACTION_DEFINITIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("commandPalette");
    expect(ids).toContain("selectAll");
    expect(ids).toContain("deselect");
  });

  it("holds the tool commands too, so a tool can be found by name", () => {
    expect(ACTION_DEFINITIONS.some((action) => action.id.startsWith("tool:"))).toBe(true);
  });

  it("gives every command a name", () => {
    for (const action of ACTION_DEFINITIONS) {
      expect(action.label.length).toBeGreaterThan(0);
    }
  });

  it("finds every command of the palette in the registry", () => {
    const results = searchCommands("command", ACTION_DEFINITIONS, "other");
    expect(results.some((result) => result.action.id === "commandPalette")).toBe(true);
  });
});
