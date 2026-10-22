import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingEngine, EditorSnapshot } from "../core/engine/DrawingEngine";
import type { EditorActions } from "../state/editorStore";
import type { ToolId } from "../types/tool";
import type { KeyboardPlatform } from "../core/actions/keyboard";
import {
  ACTION_DEFINITIONS,
  dispatchKeyboardEvent,
  validateRegistry,
} from "../core/actions/registry";
import type { ActionDefinition, FileActionHandlers } from "../core/actions/types";

interface FakeState {
  activeLayerId: string | null;
  selectedStrokes: number;
  selectedGuideId: string | null;
  toolId: ToolId;
  gridVisible: boolean;
  gridSnapping: boolean;
  brushSize: number;
}

let state: FakeState;
let actions: EditorActions;
let engine: DrawingEngine;
let file: FileActionHandlers;

beforeEach(() => {
  state = {
    activeLayerId: "layer-1",
    selectedStrokes: 1,
    selectedGuideId: null,
    toolId: "brush",
    gridVisible: false,
    gridSnapping: false,
    brushSize: 6,
  };
  actions = {
    setTool: vi.fn(),
    setBrush: vi.fn(),
    setSecondaryColor: vi.fn(),
    swapColors: vi.fn(),
    saveBrushPreset: vi.fn(),
    renameBrushPreset: vi.fn(),
    duplicateBrushPreset: vi.fn(),
    deleteBrushPreset: vi.fn(),
    applyBrushPreset: vi.fn(),
    setShapeFill: vi.fn(),
    setShapeSides: vi.fn(),
    setShapeInnerRatio: vi.fn(),
    setShapeRotation: vi.fn(),
    setFillTolerance: vi.fn(),
    setFillMode: vi.fn(),
    setFillSampleScale: vi.fn(),
    setGradientType: vi.fn(),
    setGradientEndColor: vi.fn(),
    setGradientMidStops: vi.fn(),
    setGridVisible: vi.fn(),
    setGridSpacing: vi.fn(),
    setGridSnapping: vi.fn(),
    setRulersVisible: vi.fn(),
    dismissNotice: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomTo: vi.fn(),
    zoomToFit: vi.fn(),
    newDocument: vi.fn(),
    addLayer: vi.fn(),
    duplicateLayer: vi.fn(),
    removeLayer: vi.fn(),
    renameLayer: vi.fn(),
    toggleLayerVisibility: vi.fn(),
    setLayerOpacity: vi.fn(),
    setLayerBlendMode: vi.fn(),
    moveLayer: vi.fn(),
    selectLayer: vi.fn(),
    clearSelection: vi.fn(),
    deleteSelection: vi.fn(),
    deleteSelectedGuide: vi.fn(),
    cancelGuideGesture: vi.fn(),
    nudgeSelection: vi.fn(),
    duplicateSelection: vi.fn(),
    flipSelection: vi.fn(),
    scaleSelection: vi.fn(),
    rotateSelection: vi.fn(),
  };
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
  file = { save: vi.fn(), saveAs: vi.fn(), open: vi.fn() } as unknown as FileActionHandlers;
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

describe("registry shape", () => {
  it("has a unique id and at least one chord per action", () => {
    const ids = ACTION_DEFINITIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const action of ACTION_DEFINITIONS) {
      expect(action.shortcuts.length).toBeGreaterThan(0);
      expect(action.label.length).toBeGreaterThan(0);
    }
  });

  it("refuses an ambiguous chord instead of guessing", () => {
    const base: ActionDefinition = {
      id: "undo",
      label: "Undo",
      shortcuts: [{ key: "z", code: "KeyZ", mod: true }],
      run: () => undefined,
    };
    const clash: ActionDefinition = {
      id: "redo",
      label: "Redo",
      shortcuts: [{ key: "z", code: "KeyZ", mod: true }],
      run: () => undefined,
    };
    expect(() => validateRegistry([base, clash])).toThrow(/Ambiguous shortcut/);
  });

  it("refuses a duplicate action id", () => {
    const action: ActionDefinition = {
      id: "undo",
      label: "Undo",
      shortcuts: [{ key: "z", code: "KeyZ", mod: true }],
      run: () => undefined,
    };
    expect(() => validateRegistry([action, action])).toThrow(/Duplicate action id/);
  });
});

describe("document and view commands", () => {
  it("undoes and redoes", () => {
    expect(press("z")?.action.id).toBe("undo");
    expect(actions.undo).toHaveBeenCalledOnce();

    expect(press("z", { shift: true })?.action.id).toBe("redo");
    expect(press("y")?.action.id).toBe("redo");
    expect(press("y", { shift: true })?.action.id).toBe("redo");
    expect(actions.redo).toHaveBeenCalledTimes(3);
  });

  it("reaches the file handlers", () => {
    press("s");
    expect(file.save).toHaveBeenCalledOnce();
    press("s", { shift: true });
    expect(file.saveAs).toHaveBeenCalledOnce();
    press("o");
    expect(file.open).toHaveBeenCalledOnce();
  });

  it("claims Save even when the workspace supplied no handler", () => {
    const match = dispatchKeyboardEvent(
      { key: "s", code: "KeyS", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
      { engine, actions, file: {} },
      "other",
    );
    expect(match?.action.id).toBe("save");
  });

  it("duplicates the active layer only when there is one", () => {
    press("j");
    expect(actions.duplicateLayer).toHaveBeenCalledWith("layer-1");
    state.activeLayerId = null;
    press("j");
    expect(actions.duplicateLayer).toHaveBeenCalledOnce();
  });

  it("duplicates and flips the selection", () => {
    press("d");
    expect(actions.duplicateSelection).toHaveBeenCalledOnce();
    press("h", { shift: true });
    expect(actions.flipSelection).toHaveBeenCalledWith("horizontal");
    press("v", { shift: true });
    expect(actions.flipSelection).toHaveBeenCalledWith("vertical");
  });

  it("zooms", () => {
    press("=");
    press("=", { shift: true });
    press("-");
    press("1");
    press("0");
    expect(actions.zoomIn).toHaveBeenCalledTimes(2);
    expect(actions.zoomOut).toHaveBeenCalledOnce();
    expect(actions.zoomTo).toHaveBeenCalledWith(1);
    expect(actions.zoomToFit).toHaveBeenCalledOnce();
  });

  it("toggles the grid and snapping", () => {
    press("'", { code: "Quote" });
    expect(actions.setGridVisible).toHaveBeenCalledWith(true);
    press("'", { code: "Quote", shift: true });
    expect(actions.setGridSnapping).toHaveBeenCalledWith(true);
  });

  it("cancels the guide gesture with Escape while the guides tool is active", () => {
    state.toolId = "guides";
    press("escape", { code: "Escape", ctrl: false, meta: false });
    expect(actions.cancelGuideGesture).toHaveBeenCalledOnce();
    expect(actions.clearSelection).not.toHaveBeenCalled();
  });

  it("clears the selection otherwise", () => {
    press("escape", { code: "Escape", ctrl: false, meta: false });
    expect(actions.clearSelection).toHaveBeenCalledOnce();
  });

  it("deletes a selected guide before touching strokes", () => {
    state.toolId = "guides";
    state.selectedGuideId = "guide-1";
    press("delete", { code: "Delete", ctrl: false, meta: false });
    expect(actions.deleteSelectedGuide).toHaveBeenCalledOnce();
    expect(actions.deleteSelection).not.toHaveBeenCalled();
  });

  it("deletes strokes with Delete or Backspace", () => {
    press("delete", { code: "Delete", ctrl: false, meta: false });
    press("backspace", { code: "Backspace", ctrl: false, meta: false });
    expect(actions.deleteSelection).toHaveBeenCalledTimes(2);
  });
});

describe("selection nudging", () => {
  it("nudges by one pixel, or ten with Shift", () => {
    press("arrowleft", { code: "ArrowLeft", ctrl: false, meta: false });
    press("arrowright", { code: "ArrowRight", shift: true, ctrl: false, meta: false });
    press("arrowup", { code: "ArrowUp", ctrl: false, meta: false });
    press("arrowdown", { code: "ArrowDown", shift: true, ctrl: false, meta: false });
    expect(actions.nudgeSelection).toHaveBeenNthCalledWith(1, -1, 0);
    expect(actions.nudgeSelection).toHaveBeenNthCalledWith(2, 10, 0);
    expect(actions.nudgeSelection).toHaveBeenNthCalledWith(3, 0, -1);
    expect(actions.nudgeSelection).toHaveBeenNthCalledWith(4, 0, 10);
  });

  it("leaves arrows alone without a selection", () => {
    state.selectedStrokes = 0;
    expect(press("arrowleft", { code: "ArrowLeft", ctrl: false, meta: false })).toBeNull();
    expect(actions.nudgeSelection).not.toHaveBeenCalled();
  });
});

describe("tools and brush size", () => {
  it("selects every tool from its own definition", () => {
    for (const action of ACTION_DEFINITIONS) {
      if (!action.id.startsWith("tool:")) {
        continue;
      }
      const toolId = action.id.slice("tool:".length) as ToolId;
      const shortcut = action.shortcuts[0];
      expect(press(shortcut.key, { code: shortcut.code, ctrl: false, meta: false })?.action.id).toBe(
        action.id,
      );
      expect(actions.setTool).toHaveBeenCalledWith(toolId);
    }
  });

  it("does not fire a tool shortcut with Shift held", () => {
    expect(press("s", { code: "KeyS", shift: true, ctrl: false, meta: false })).toBeNull();
  });

  it("steps brush size with the bracket keys", () => {
    press("[", { code: "BracketLeft", ctrl: false, meta: false });
    expect(actions.setBrush).toHaveBeenCalledWith({ size: 5 });
    press("]", { code: "BracketRight", ctrl: false, meta: false });
    expect(actions.setBrush).toHaveBeenCalledWith({ size: 7 });
  });
});

describe("platform and layout regressions", () => {
  it("uses Cmd on macOS and refuses Ctrl", () => {
    expect(press("z", { platform: "mac" })?.action.id).toBe("undo");
    expect(
      press("z", { platform: "mac", meta: false, ctrl: true }),
    ).toBeNull();
  });

  it("refuses Cmd on Windows and Linux", () => {
    expect(press("z", { ctrl: false, meta: true })).toBeNull();
  });

  it("reaches a tool through the physical key on a non-Latin layout", () => {
    expect(press("б", { code: "KeyB", ctrl: false, meta: false })?.action.id).toBe("tool:brush");
  });

  it("reaches a punctuation shortcut through the physical key", () => {
    expect(
      press("х", { code: "BracketLeft", ctrl: false, meta: false })?.action.id,
    ).toBe("brushSizeDown");
    expect(press("ю", { code: "Quote", shift: true })?.action.id).toBe("toggleGridSnapping");
  });

  it("leaves unbound keys and bare modifiers alone", () => {
    expect(press("q", { code: "KeyQ", ctrl: false, meta: false })).toBeNull();
    expect(press("Control", { code: "ControlLeft", ctrl: true })).toBeNull();
    expect(press("z", { alt: true })).toBeNull();
  });
});
