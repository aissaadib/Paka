/**
 * The action registry.
 *
 * One readonly table is the single source of truth for the global commands and
 * for tool selection. Tool entries are derived from `TOOL_DEFINITIONS`, so a
 * tool's shortcut is written once.
 *
 * The registry refuses an ambiguous chord at load time. Guessing between two
 * actions is how a shortcut silently stops working, so a duplicate is a
 * programming error, not a runtime tie-break.
 */

import { stepBrushSize } from "../brushes/defaults";
import type { DrawingEngine, EditorSnapshot } from "../engine/DrawingEngine";
import { VIEW_ROTATION_DEGREES } from "../rendering/viewport";
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions";
import type { EditorActions } from "../../state/editorStore";
import type { ToolId } from "../../types/tool";
import {
  activeLayerAvailable,
  deleteAvailable,
  redoAvailable,
  selectionAvailable,
  undoAvailable,
} from "./availability";
import { COMMAND_ACTIONS } from "./commands";
import {
  chordId,
  matchesShortcut,
  type KeyboardEventLike,
  type KeyboardPlatform,
} from "./keyboard";
import type {
  ActionContext,
  ActionDefinition,
  ActionId,
  FileActionHandlers,
  ShortcutSpec,
  UiActionHandlers,
} from "./types";

function key(key: string, code: string): ShortcutSpec {
  return { key, code };
}

function mod(keyValue: string, code: string, shift = false): ShortcutSpec {
  return shift
    ? { key: keyValue, code, mod: true, shift: true }
    : { key: keyValue, code, mod: true };
}

/**
 * A chord with the platform's primary modifier *and* Alt.
 *
 * Used for the view aids whose letter is already taken by a browser chord:
 * `Ctrl+R` reloads the page, so the rulers take `Ctrl+Alt+R` instead.
 */
function modAlt(keyValue: string, code: string): ShortcutSpec {
  return { key: keyValue, code, mod: true, alt: true };
}

/** Arrow-key nudge distances, in document pixels. */
const NUDGE_STEP = 1;
const NUDGE_LARGE_STEP = 10;

/**
 * True when the arrow keys have something to move.
 *
 * Either the stroke selection holds strokes, or the gradient tool has a
 * gradient with a focused handle. Without either, the arrow keys keep their
 * scrolling behaviour.
 */
function canNudge(engine: DrawingEngine): boolean {
  const state = engine.getState();
  if (state.selectedStrokes > 0) {
    return true;
  }
  return hasFocusedGradientHandle(state);
}

/**
 * True when the gradient tool has a gradient with a focused handle.
 *
 * The handle is the one the user last grabbed, so the arrow keys have
 * something precise to move.
 */
function hasFocusedGradientHandle(state: EditorSnapshot): boolean {
  return state.selectedGradient != null && state.selectedGradient.handle != null;
}

/**
 * Moves whatever the arrow keys own.
 *
 * The gradient handle wins when it is focused: the gradient tool drops the
 * stroke selection, so the two never compete, and a focused handle is the
 * more precise target.
 */
function nudge(
  actions: EditorActions,
  engine: DrawingEngine,
  dx: number,
  dy: number,
): void {
  if (hasFocusedGradientHandle(engine.getState())) {
    actions.nudgeGradientHandle(dx, dy);
    return;
  }
  actions.nudgeSelection(dx, dy);
}

const GLOBAL_ACTIONS: readonly ActionDefinition[] = [
  {
    id: "undo",
    label: "Undo",
    shortcuts: [mod("z", "KeyZ")],
    available: undoAvailable,
    run: ({ actions }) => actions.undo(),
  },
  {
    id: "redo",
    label: "Redo",
    shortcuts: [mod("z", "KeyZ", true), mod("y", "KeyY"), mod("y", "KeyY", true)],
    available: redoAvailable,
    run: ({ actions }) => actions.redo(),
  },
  {
    id: "save",
    label: "Save",
    shortcuts: [mod("s", "KeyS")],
    run: ({ file }) => file.save?.(),
  },
  {
    id: "saveAs",
    label: "Save As",
    shortcuts: [mod("s", "KeyS", true)],
    run: ({ file }) => file.saveAs?.(),
  },
  {
    id: "open",
    label: "Open",
    shortcuts: [mod("o", "KeyO")],
    run: ({ file }) => file.open?.(),
  },
  {
    id: "duplicateLayer",
    label: "Duplicate Layer",
    shortcuts: [mod("j", "KeyJ")],
    available: activeLayerAvailable,
    run: ({ actions, engine }) => {
      const activeLayerId = engine.getState().document.activeLayerId;
      if (activeLayerId !== null) {
        actions.duplicateLayer(activeLayerId);
      }
    },
  },
  {
    id: "duplicateSelection",
    label: "Duplicate Selection",
    shortcuts: [mod("d", "KeyD")],
    available: selectionAvailable,
    run: ({ actions }) => actions.duplicateSelection(),
  },
  {
    id: "flipHorizontal",
    label: "Flip Selection Horizontally",
    shortcuts: [mod("h", "KeyH", true)],
    available: selectionAvailable,
    run: ({ actions }) => actions.flipSelection("horizontal"),
  },
  {
    id: "flipVertical",
    label: "Flip Selection Vertically",
    shortcuts: [mod("v", "KeyV", true)],
    available: selectionAvailable,
    run: ({ actions }) => actions.flipSelection("vertical"),
  },
  {
    id: "zoomIn",
    label: "Zoom In",
    // Both Ctrl+= and the shifted Ctrl++ (which arrives as `=`) zoom in.
    shortcuts: [mod("=", "Equal"), mod("=", "Equal", true)],
    run: ({ actions }) => actions.zoomIn(),
  },
  {
    id: "zoomOut",
    label: "Zoom Out",
    shortcuts: [mod("-", "Minus")],
    run: ({ actions }) => actions.zoomOut(),
  },
  {
    id: "zoomActual",
    label: "Actual Size",
    shortcuts: [mod("1", "Digit1")],
    run: ({ actions }) => actions.zoomTo(1),
  },
  {
    id: "zoomFit",
    label: "Fit to Window",
    shortcuts: [mod("0", "Digit0")],
    run: ({ actions }) => actions.zoomToFit(),
  },
  {
    id: "viewRotate",
    label: "Rotate View 90° Clockwise",
    // Shift keeps it away from the rectangle tool's own key.
    shortcuts: [{ key: "r", code: "KeyR", shift: true }],
    run: ({ actions }) => actions.rotateView(VIEW_ROTATION_DEGREES),
  },
  {
    id: "viewMirror",
    label: "Mirror View Horizontally",
    shortcuts: [{ key: "m", code: "KeyM", shift: true }],
    run: ({ actions }) => actions.toggleViewMirror(),
  },
  {
    id: "viewReset",
    label: "Reset View",
    shortcuts: [mod("0", "Digit0", true)],
    run: ({ actions }) => actions.resetView(),
  },
  {
    id: "toggleGrid",
    label: "Grid",
    shortcuts: [mod("'", "Quote")],
    checked: ({ engine }) => engine.getState().gridVisible,
    run: ({ actions, engine }) => actions.setGridVisible(!engine.getState().gridVisible),
  },
  {
    id: "toggleGridSnapping",
    label: "Snap to Guides and Grid",
    shortcuts: [mod("'", "Quote", true)],
    checked: ({ engine }) => engine.getState().gridSnapping,
    run: ({ actions, engine }) => actions.setGridSnapping(!engine.getState().gridSnapping),
  },
  {
    id: "toggleRulers",
    label: "Show Rulers",
    shortcuts: [modAlt("r", "KeyR")],
    run: ({ actions, engine }) => actions.setRulersVisible(!engine.getState().rulersVisible),
  },
  {
    id: "toggleSymmetry",
    label: "Symmetry",
    shortcuts: [modAlt("m", "KeyM")],
    run: ({ actions, engine }) => actions.setSymmetryEnabled(!engine.getState().symmetryEnabled),
  },
  {
    id: "nudgeLeft",
    label: "Nudge Left",
    shortcuts: [key("arrowleft", "ArrowLeft"), { ...key("arrowleft", "ArrowLeft"), shift: true }],
    // Without a selection the arrow keys keep their scrolling behaviour.
    when: ({ engine }) => canNudge(engine),
    run: ({ actions, engine, shift }) =>
      nudge(actions, engine, shift ? -NUDGE_LARGE_STEP : -NUDGE_STEP, 0),
  },
  {
    id: "nudgeRight",
    label: "Nudge Right",
    shortcuts: [key("arrowright", "ArrowRight"), { ...key("arrowright", "ArrowRight"), shift: true }],
    when: ({ engine }) => canNudge(engine),
    run: ({ actions, engine, shift }) =>
      nudge(actions, engine, shift ? NUDGE_LARGE_STEP : NUDGE_STEP, 0),
  },
  {
    id: "nudgeUp",
    label: "Nudge Up",
    shortcuts: [key("arrowup", "ArrowUp"), { ...key("arrowup", "ArrowUp"), shift: true }],
    when: ({ engine }) => canNudge(engine),
    run: ({ actions, engine, shift }) =>
      nudge(actions, engine, 0, shift ? -NUDGE_LARGE_STEP : -NUDGE_STEP),
  },
  {
    id: "nudgeDown",
    label: "Nudge Down",
    shortcuts: [key("arrowdown", "ArrowDown"), { ...key("arrowdown", "ArrowDown"), shift: true }],
    when: ({ engine }) => canNudge(engine),
    run: ({ actions, engine, shift }) =>
      nudge(actions, engine, 0, shift ? NUDGE_LARGE_STEP : NUDGE_STEP),
  },
  {
    id: "escape",
    label: "Escape",
    shortcuts: [key("escape", "Escape")],
    run: ({ actions, engine }) => {
      // A symmetry centre being dragged owns the escape key: the drag is
      // abandoned and the centre goes back where it was.
      if (engine.getState().symmetryDragging) {
        engine.cancelSymmetryCenterDrag();
        return;
      }
      // The guides tool owns Escape while it is active: it cancels the drag in
      // flight and clears the guide selection.
      if (engine.getState().toolId === "guides") {
        actions.cancelGuideGesture();
        return;
      }
      // The gradient tool owns Escape the same way: it abandons a handle drag
      // in flight, restoring the gradient exactly, and clears the selection.
      if (engine.getState().toolId === "gradient") {
        actions.cancelGradientGesture();
        return;
      }
      actions.clearSelection();
    },
  },
  {
    id: "delete",
    label: "Delete Selected",
    // Backspace is also the browser's "go back" gesture; the editor owns it.
    shortcuts: [key("delete", "Delete"), key("backspace", "Backspace")],
    // The key is always claimed, so the availability rule is what the menus
    // read: the command is offered only when there is something to delete.
    available: deleteAvailable,
    run: ({ actions, engine }) => {
      // A selected guide is the guides tool's selection, so Delete removes that
      // first; the stroke selection is untouched by it.
      if (engine.getState().toolId === "guides" && engine.getState().selectedGuideId !== null) {
        actions.deleteSelectedGuide();
        return;
      }
      actions.deleteSelection();
    },
  },
  {
    id: "brushSizeDown",
    label: "Decrease Brush Size",
    shortcuts: [key("[", "BracketLeft")],
    run: ({ actions, engine }) => {
      actions.setBrush({ size: stepBrushSize(engine.getState().brush.size, -1) });
    },
  },
  {
    id: "brushSizeUp",
    label: "Increase Brush Size",
    shortcuts: [key("]", "BracketRight")],
    run: ({ actions, engine }) => {
      actions.setBrush({ size: stepBrushSize(engine.getState().brush.size, 1) });
    },
  },
];

/** One tool-select action per tool, derived from the tool's own definition. */
const TOOL_ACTIONS: readonly ActionDefinition[] = TOOL_DEFINITIONS.map((tool) => ({
  id: `tool:${tool.id}` as ActionId,
  label: tool.label,
  shortcuts: [{ key: tool.shortcut.toLowerCase(), code: `Key${tool.shortcut.toUpperCase()}` }],
  run: ({ actions }) => actions.setTool(tool.id as ToolId),
}));

export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  ...GLOBAL_ACTIONS,
  ...TOOL_ACTIONS,
  ...COMMAND_ACTIONS,
];

/**
 * The action with an id, or `undefined` when there is none.
 *
 * The menus address the commands by id, so they never carry a command of
 * their own.
 */
export function findActionById(id: ActionId): ActionDefinition | undefined {
  return ACTION_DEFINITIONS.find((action) => action.id === id);
}

/**
 * Refuses duplicate action ids and chords.
 *
 * Exported for tests: a synthetic registry with a clash must throw rather than
 * let one action shadow another.
 */
export function validateRegistry(actions: readonly ActionDefinition[]): void {
  const ids = new Set<string>();
  const chords = new Map<string, string>();
  const platforms: readonly KeyboardPlatform[] = ["mac", "other"];

  for (const action of actions) {
    if (ids.has(action.id)) {
      throw new Error(`Duplicate action id "${action.id}".`);
    }
    ids.add(action.id);
    // A command-only action is reached by name - from the canvas menu or the
    // command palette - and claims no key. Every other action must be
    // reachable from the keyboard.
    if (action.shortcuts.length === 0 && action.commandOnly !== true) {
      throw new Error(`Action "${action.id}" has no shortcut.`);
    }
    for (const shortcut of action.shortcuts) {
      for (const platform of platforms) {
        const chord = chordId(shortcut, platform);
        const existing = chords.get(chord);
        if (existing !== undefined) {
          throw new Error(
            `Ambiguous shortcut ${chord}: claimed by "${existing}" and "${action.id}".`,
          );
        }
        chords.set(chord, action.id);
      }
    }
  }
}

validateRegistry(ACTION_DEFINITIONS);

export interface ActionMatch {
  readonly action: ActionDefinition;
  readonly shortcut: ShortcutSpec;
}

function baseContext(
  engine: ActionContext["engine"],
  actions: ActionContext["actions"],
  file: FileActionHandlers,
  ui?: UiActionHandlers,
): ActionContext {
  return { engine, actions, file, ui, shift: false };
}

/**
 * The action an event resolves to, or `null` when it claims no key.
 *
 * An action whose `when` guard is false claims nothing, so the key keeps its
 * default behaviour (arrows scroll, for example) instead of being swallowed.
 */
export function findActionForEvent(
  event: KeyboardEventLike,
  platform: KeyboardPlatform,
  context: ActionContext,
): ActionMatch | null {
  for (const action of ACTION_DEFINITIONS) {
    for (const shortcut of action.shortcuts) {
      if (!matchesShortcut(event, shortcut, platform)) {
        continue;
      }
      if (action.when && !action.when(context)) {
        return null;
      }
      return { action, shortcut };
    }
  }
  return null;
}

export interface DispatchContext {
  readonly engine: ActionContext["engine"];
  readonly actions: ActionContext["actions"];
  readonly file: FileActionHandlers;
  /** Shell commands, such as opening the command palette. */
  readonly ui?: UiActionHandlers;
}

/**
 * Runs the action an event resolves to.
 *
 * Returns the match when an action ran, or `null` when the key was left alone.
 * The caller decides whether to call `preventDefault`, so unmatched keys keep
 * their native behaviour.
 */
export function dispatchKeyboardEvent(
  event: KeyboardEventLike,
  context: DispatchContext,
  platform: KeyboardPlatform,
): ActionMatch | null {
  const match = findActionForEvent(
    event,
    platform,
    baseContext(context.engine, context.actions, context.file, context.ui),
  );
  if (!match) {
    return null;
  }
  match.action.run({
    ...baseContext(context.engine, context.actions, context.file, context.ui),
    shift: match.shortcut.shift === true,
  });
  return match;
}
