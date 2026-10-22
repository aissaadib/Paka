/**
 * Why a command cannot run right now.
 *
 * The rules live in one place so the keyboard, the canvas menu and the command
 * palette read the same answer: a command that says "nothing is selected" in a
 * menu also declines the key, and a command that runs from the palette runs
 * from the menu.
 *
 * An availability rule returns `null` when the command can run and the reason
 * it cannot when it cannot. The reason is shown next to the disabled row, so
 * the user is told what is missing instead of being left with a greyed-out
 * command and no explanation.
 */

import type { ActionContext, ActionDefinition } from "./types";

/** The reason a command gives when the selection is empty. */
export const NOTHING_SELECTED = "Nothing is selected.";

/** The reason a command gives when the history has nothing to step back to. */
export const NOTHING_TO_UNDO = "There is nothing to undo.";

/** The reason a command gives when the history has nothing to step forward to. */
export const NOTHING_TO_REDO = "There is nothing to redo.";

/** The reason a command gives when the document has no active layer. */
export const NO_ACTIVE_LAYER = "There is no active layer.";

/** True when the selection holds at least one stroke. */
export function hasSelection(context: ActionContext): boolean {
  return context.engine.getState().selectedStrokes > 0;
}

/** The selection commands need something selected to work on. */
export function selectionAvailable(context: ActionContext): string | null {
  return hasSelection(context) ? null : NOTHING_SELECTED;
}

/** Undo needs a history step to take back. */
export function undoAvailable(context: ActionContext): string | null {
  return context.engine.getState().history.canUndo ? null : NOTHING_TO_UNDO;
}

/** Redo needs a history step to put back. */
export function redoAvailable(context: ActionContext): string | null {
  return context.engine.getState().history.canRedo ? null : NOTHING_TO_REDO;
}

/** The layer commands need an active layer to act on. */
export function activeLayerAvailable(context: ActionContext): string | null {
  return context.engine.getState().document.activeLayerId !== null ? null : NO_ACTIVE_LAYER;
}

/**
 * What Delete would remove.
 *
 * A selected guide belongs to the guides tool and is removed before the
 * strokes, so the command is available whenever either of them is selected.
 */
export function deleteAvailable(context: ActionContext): string | null {
  const state = context.engine.getState();
  if (state.toolId === "guides" && state.selectedGuideId !== null) {
    return null;
  }
  return state.selectedStrokes > 0 ? null : NOTHING_SELECTED;
}

/**
 * Whether an action can run right now, and why not.
 *
 * The availability rule decides. The keyboard guard (`when`) is a separate
 * concern - a key can be claimed even when the command behind it has nothing
 * to do, so that Backspace never falls through to the browser - which is why
 * the rule is the one the menus read.
 */
export function actionAvailability(
  action: ActionDefinition,
  context: ActionContext,
): { readonly enabled: boolean; readonly reason: string | null } {
  if (action.available) {
    const reason = action.available(context);
    return { enabled: reason === null, reason };
  }
  if (action.when && !action.when(context)) {
    return { enabled: false, reason: null };
  }
  return { enabled: true, reason: null };
}
