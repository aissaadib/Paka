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
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions";
import type { ToolId } from "../../types/tool";
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
} from "./types";

function key(key: string, code: string): ShortcutSpec {
  return { key, code };
}

function mod(keyValue: string, code: string, shift = false): ShortcutSpec {
  return shift
    ? { key: keyValue, code, mod: true, shift: true }
    : { key: keyValue, code, mod: true };
}

/** Arrow-key nudge distances, in document pixels. */
const NUDGE_STEP = 1;
const NUDGE_LARGE_STEP = 10;

const GLOBAL_ACTIONS: readonly ActionDefinition[] = [
  {
    id: "undo",
    label: "Undo",
    shortcuts: [mod("z", "KeyZ")],
    run: ({ actions }) => actions.undo(),
  },
  {
    id: "redo",
    label: "Redo",
    shortcuts: [mod("z", "KeyZ", true), mod("y", "KeyY"), mod("y", "KeyY", true)],
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
    run: ({ actions }) => actions.duplicateSelection(),
  },
  {
    id: "flipHorizontal",
    label: "Flip Selection Horizontally",
    shortcuts: [mod("h", "KeyH", true)],
    run: ({ actions }) => actions.flipSelection("horizontal"),
  },
  {
    id: "flipVertical",
    label: "Flip Selection Vertically",
    shortcuts: [mod("v", "KeyV", true)],
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
    id: "toggleGrid",
    label: "Show Grid",
    shortcuts: [mod("'", "Quote")],
    run: ({ actions, engine }) => actions.setGridVisible(!engine.getState().gridVisible),
  },
  {
    id: "toggleGridSnapping",
    label: "Snap to Guides and Grid",
    shortcuts: [mod("'", "Quote", true)],
    run: ({ actions, engine }) => actions.setGridSnapping(!engine.getState().gridSnapping),
  },
  {
    id: "nudgeLeft",
    label: "Nudge Left",
    shortcuts: [key("arrowleft", "ArrowLeft"), { ...key("arrowleft", "ArrowLeft"), shift: true }],
    // Without a selection the arrow keys keep their scrolling behaviour.
    when: ({ engine }) => engine.getState().selectedStrokes > 0,
    run: ({ actions, shift }) => actions.nudgeSelection(shift ? -NUDGE_LARGE_STEP : -NUDGE_STEP, 0),
  },
  {
    id: "nudgeRight",
    label: "Nudge Right",
    shortcuts: [key("arrowright", "ArrowRight"), { ...key("arrowright", "ArrowRight"), shift: true }],
    when: ({ engine }) => engine.getState().selectedStrokes > 0,
    run: ({ actions, shift }) => actions.nudgeSelection(shift ? NUDGE_LARGE_STEP : NUDGE_STEP, 0),
  },
  {
    id: "nudgeUp",
    label: "Nudge Up",
    shortcuts: [key("arrowup", "ArrowUp"), { ...key("arrowup", "ArrowUp"), shift: true }],
    when: ({ engine }) => engine.getState().selectedStrokes > 0,
    run: ({ actions, shift }) => actions.nudgeSelection(0, shift ? -NUDGE_LARGE_STEP : -NUDGE_STEP),
  },
  {
    id: "nudgeDown",
    label: "Nudge Down",
    shortcuts: [key("arrowdown", "ArrowDown"), { ...key("arrowdown", "ArrowDown"), shift: true }],
    when: ({ engine }) => engine.getState().selectedStrokes > 0,
    run: ({ actions, shift }) => actions.nudgeSelection(0, shift ? NUDGE_LARGE_STEP : NUDGE_STEP),
  },
  {
    id: "escape",
    label: "Escape",
    shortcuts: [key("escape", "Escape")],
    run: ({ actions, engine }) => {
      // The guides tool owns Escape while it is active: it cancels the drag in
      // flight and clears the guide selection.
      if (engine.getState().toolId === "guides") {
        actions.cancelGuideGesture();
        return;
      }
      // A gesture in flight owns content that is not in the document yet, so
      // Escape throws it away rather than committing it: the preview goes and
      // nothing is recorded.
      if (actions.cancelActiveGesture()) {
        return;
      }
      actions.clearSelection();
    },
  },
  {
    id: "finishShape",
    label: "Finish Path",
    shortcuts: [key("enter", "Enter")],
    // Only the polyline holds a path that outlives a pointer gesture, so the
    // command claims the key only while there is one to finish.
    when: ({ engine }) => engine.canFinishShapeGesture(),
    run: ({ actions }) => actions.finishShapeGesture(),
  },
  {
    id: "delete",
    label: "Delete Selected",
    // Backspace is also the browser's "go back" gesture; the editor owns it.
    shortcuts: [key("delete", "Delete"), key("backspace", "Backspace")],
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
];

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
    if (action.shortcuts.length === 0) {
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
): ActionContext {
  return { engine, actions, file, shift: false };
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
    baseContext(context.engine, context.actions, context.file),
  );
  if (!match) {
    return null;
  }
  match.action.run({
    ...baseContext(context.engine, context.actions, context.file),
    shift: match.shortcut.shift === true,
  });
  return match;
}
