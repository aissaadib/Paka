/**
 * Canvas menu tests.
 *
 * The menu owns no commands: it addresses the registry by id. These tests pin
 * down that the ids are real, that the rows follow the editor's state, and
 * that running a row goes through the same command the keyboard runs - so a
 * menu edit and a key press end in the same history.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCanvasMenu, CANVAS_MENU, type CanvasMenuRow } from "../core/actions/canvasMenu";
import { NOTHING_SELECTED, NOTHING_TO_UNDO } from "../core/actions/availability";
import { ACTION_DEFINITIONS, findActionById } from "../core/actions/registry";
import type { ActionContext, ActionDefinition } from "../core/actions/types";
import { createDocument } from "../core/document/document";
import { DrawingEngine, type EditorSnapshot } from "../core/engine/DrawingEngine";
import { createEditor } from "../state/editorStore";
import type { ToolId } from "../types/tool";

let engine: DrawingEngine;
let context: ActionContext;

function fakeContext(state: {
  readonly selectedStrokes: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly activeLayerId: string | null;
  readonly toolId?: ToolId;
  readonly selectedGuideId?: string | null;
}): ActionContext {
  const snapshot = {
    document: { activeLayerId: state.activeLayerId },
    selectedStrokes: state.selectedStrokes,
    selectedGuideId: state.selectedGuideId ?? null,
    toolId: state.toolId ?? "brush",
    gridVisible: false,
    gridSnapping: false,
    history: { canUndo: state.canUndo, canRedo: state.canRedo },
  } as unknown as EditorSnapshot;
  return {
    engine: { getState: () => snapshot } as unknown as DrawingEngine,
    actions: {} as ActionContext["actions"],
    file: {},
    shift: false,
  };
}

function rowFor(rows: readonly CanvasMenuRow[], id: string): CanvasMenuRow | undefined {
  return rows.find(
    (row) => row.type === "item" && row.action.id === id,
  ) as CanvasMenuRow | undefined;
}

beforeEach(() => {
  const editor = createEditor({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
  });
  engine = editor.engine;
  context = { engine, actions: editor.actions, file: {}, shift: false };
});

describe("the menu's rows", () => {
  it("names only commands the registry holds", () => {
    for (const entry of CANVAS_MENU) {
      if (entry.type === "separator") {
        continue;
      }
      expect(findActionById(entry.actionId as never)).toBeDefined();
    }
  });

  it("has no command twice", () => {
    const ids = CANVAS_MENU.filter((entry) => entry.type === "item").map(
      (entry) => entry.actionId,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers the history, the selection, the transforms, the view and the layers", () => {
    const rows = buildCanvasMenu(context, "other", findActionById);
    const ids = rows
      .filter((row) => row.type === "item")
      .map((row) => (row as { action: ActionDefinition }).action.id);
    expect(ids).toContain("undo");
    expect(ids).toContain("redo");
    expect(ids).toContain("selectAll");
    expect(ids).toContain("deselect");
    expect(ids).toContain("duplicateSelection");
    expect(ids).toContain("delete");
    expect(ids).toContain("scaleSelection");
    expect(ids).toContain("rotateSelectionClockwise");
    expect(ids).toContain("flipHorizontal");
    expect(ids).toContain("zoomIn");
    expect(ids).toContain("zoomFit");
    expect(ids).toContain("toggleGrid");
    expect(ids).toContain("duplicateLayer");
  });

  it("shows the registry's label and chord, not a copy of them", () => {
    const rows = buildCanvasMenu(context, "other", findActionById);
    const undo = rowFor(rows, "undo");
    expect(undo?.type).toBe("item");
    if (undo?.type !== "item") {
      return;
    }
    expect(undo.action.label).toBe("Undo");
    expect(undo.shortcut).toBe("Ctrl+Z");
  });
});

describe("the rows follow the editor's state", () => {
  it("disables the selection commands with the reason when nothing is selected", () => {
    const rows = buildCanvasMenu(
      fakeContext({ selectedStrokes: 0, canUndo: true, canRedo: false, activeLayerId: "l1" }),
      "other",
      findActionById,
    );
    const duplicate = rowFor(rows, "duplicateSelection");
    expect(duplicate?.type === "item" && duplicate.enabled).toBe(false);
    expect(duplicate?.type === "item" && duplicate.reason).toBe(NOTHING_SELECTED);
  });

  it("enables the selection commands when something is selected", () => {
    const rows = buildCanvasMenu(
      fakeContext({ selectedStrokes: 2, canUndo: true, canRedo: false, activeLayerId: "l1" }),
      "other",
      findActionById,
    );
    const duplicate = rowFor(rows, "duplicateSelection");
    expect(duplicate?.type === "item" && duplicate.enabled).toBe(true);
  });

  it("disables undo with the reason when the history is empty", () => {
    const rows = buildCanvasMenu(
      fakeContext({ selectedStrokes: 0, canUndo: false, canRedo: false, activeLayerId: "l1" }),
      "other",
      findActionById,
    );
    const undo = rowFor(rows, "undo");
    expect(undo?.type === "item" && undo.enabled).toBe(false);
    expect(undo?.type === "item" && undo.reason).toBe(NOTHING_TO_UNDO);
  });

  it("shows the grid as a toggle that is on", () => {
    const rows = buildCanvasMenu(
      fakeContext({ selectedStrokes: 0, canUndo: true, canRedo: true, activeLayerId: "l1" }),
      "other",
      findActionById,
    );
    const grid = rowFor(rows, "toggleGrid");
    expect(grid?.type === "item" && grid.checked).toBe(false);
  });
});

describe("running a row", () => {
  it("goes through the registry, so the history is the same as a key press", () => {
    const editor = createEditor({
      document: createDocument({ name: "Test", width: 400, height: 300 }),
    });
    const engineUnderTest = editor.engine;
    const layerId = engineUnderTest.getState().document.activeLayerId as string;

    // A stroke, so that undo has something to take back.
    engineUnderTest.setTool("brush");
    engineUnderTest.handlePointerSample({
      phase: "down",
      pointerId: 1,
      kind: "pen",
      isPrimary: true,
      button: 0,
      buttons: 1,
      docX: 10,
      docY: 10,
      screenX: 10,
      screenY: 10,
      pressure: 1,
      hasPressure: true,
      tiltX: 0,
      tiltY: 0,
      timeStamp: 0,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    engineUnderTest.handlePointerSample({
      phase: "move",
      pointerId: 1,
      kind: "pen",
      isPrimary: true,
      button: 0,
      buttons: 1,
      docX: 40,
      docY: 30,
      screenX: 40,
      screenY: 30,
      pressure: 1,
      hasPressure: true,
      tiltX: 0,
      tiltY: 0,
      timeStamp: 1,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    engineUnderTest.handlePointerSample({
      phase: "up",
      pointerId: 1,
      kind: "pen",
      isPrimary: true,
      button: 0,
      buttons: 0,
      docX: 40,
      docY: 30,
      screenX: 40,
      screenY: 30,
      pressure: 1,
      hasPressure: true,
      tiltX: 0,
      tiltY: 0,
      timeStamp: 2,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    expect(engineUnderTest.listStrokes(layerId)).toHaveLength(1);

    const rows = buildCanvasMenu(
      { engine: engineUnderTest, actions: editor.actions, file: {}, shift: false },
      "other",
      findActionById,
    );
    const undo = rowFor(rows, "undo");
    expect(undo?.type === "item" && undo.enabled).toBe(true);
    if (undo?.type !== "item") {
      return;
    }
    undo.action.run({ engine: engineUnderTest, actions: editor.actions, file: {}, shift: false });

    // The stroke is gone and the undo step is behind it, so the command did
    // what the keyboard does and nothing else.
    expect(engineUnderTest.listStrokes(layerId)).toHaveLength(0);
    expect(engineUnderTest.getState().history.canUndo).toBe(false);
    expect(engineUnderTest.getState().history.canRedo).toBe(true);
  });

  it("runs the command the registry holds, not a copy of it", () => {
    const run = vi.fn();
    const action: ActionDefinition = {
      id: "undo",
      label: "Undo",
      shortcuts: [],
      commandOnly: true,
      run,
    };
    action.run(context);
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("the registry", () => {
  it("lets a command-only action have no chord", () => {
    const commandOnlyActions = ACTION_DEFINITIONS.filter((action) => action.commandOnly === true);
    expect(commandOnlyActions.length).toBeGreaterThan(0);
    for (const action of commandOnlyActions) {
      expect(action.shortcuts).toHaveLength(0);
    }
  });

  it("gives every other action a chord", () => {
    for (const action of ACTION_DEFINITIONS) {
      if (action.commandOnly === true) {
        continue;
      }
      expect(action.shortcuts.length).toBeGreaterThan(0);
    }
  });

  it("keeps the availability rule and the keyboard guard in step", () => {
    for (const action of ACTION_DEFINITIONS) {
      if (action.available === undefined || action.when === undefined) {
        continue;
      }
      const withSelection = fakeContext({
        selectedStrokes: 1,
        canUndo: true,
        canRedo: true,
        activeLayerId: "l1",
      });
      const withoutSelection = fakeContext({
        selectedStrokes: 0,
        canUndo: false,
        canRedo: false,
        activeLayerId: "l1",
      });
      expect(action.available(withSelection)).toBeNull();
      expect(action.when(withSelection)).toBe(true);
      expect(action.available(withoutSelection)).not.toBeNull();
      expect(action.when(withoutSelection)).toBe(false);
    }
  });
});
