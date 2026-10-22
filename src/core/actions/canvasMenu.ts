/**
 * The canvas context menu.
 *
 * The rows are registry actions: the menu owns no commands of its own, so a
 * label, a chord and an availability rule can never drift from the command
 * the row runs. A row that does not apply is shown disabled with the reason,
 * rather than silently vanishing - the menu keeps its shape, so the user can
 * learn where a command lives.
 */

import { commandRow, type CommandRow } from "./commandRows";
import type { KeyboardPlatform } from "./keyboard";
import type { ActionContext, ActionDefinition, ActionId } from "./types";

export type CanvasMenuRow =
  | { readonly type: "separator" }
  | ({ readonly type: "item" } & CommandRow);

/** One row of the menu: a command, or a gap between groups of commands. */
export interface CanvasMenuEntry {
  readonly type: "item" | "separator";
  /** The command the row runs. Absent on a separator. */
  readonly actionId?: ActionId;
}

/**
 * The canvas menu, in order.
 *
 * The groups are history, the selection, the transforms, the view and the
 * layers - the same order the top menu bar uses, so the two menus read the
 * same way.
 */
export const CANVAS_MENU: readonly CanvasMenuEntry[] = [
  { type: "item", actionId: "undo" },
  { type: "item", actionId: "redo" },
  { type: "separator" },
  { type: "item", actionId: "selectAll" },
  { type: "item", actionId: "deselect" },
  { type: "separator" },
  { type: "item", actionId: "duplicateSelection" },
  { type: "item", actionId: "delete" },
  { type: "separator" },
  { type: "item", actionId: "scaleSelection" },
  { type: "item", actionId: "rotateSelectionClockwise" },
  { type: "item", actionId: "rotateSelectionCounterClockwise" },
  { type: "item", actionId: "flipHorizontal" },
  { type: "item", actionId: "flipVertical" },
  { type: "separator" },
  { type: "item", actionId: "zoomIn" },
  { type: "item", actionId: "zoomOut" },
  { type: "item", actionId: "zoomActual" },
  { type: "item", actionId: "zoomFit" },
  { type: "separator" },
  { type: "item", actionId: "toggleGrid" },
  { type: "item", actionId: "toggleGridSnapping" },
  { type: "separator" },
  { type: "item", actionId: "addLayer" },
  { type: "item", actionId: "duplicateLayer" },
];

/**
 * Builds the menu for the editor's current state.
 *
 * A row whose command is not in the registry is dropped: a menu row that
 * cannot run is a dead row, and the registry is the only list of commands
 * there is.
 */
export function buildCanvasMenu(
  context: ActionContext,
  platform: KeyboardPlatform,
  findAction: (id: ActionId) => ActionDefinition | undefined,
): readonly CanvasMenuRow[] {
  const rows: CanvasMenuRow[] = [];
  for (const entry of CANVAS_MENU) {
    if (entry.type === "separator") {
      rows.push({ type: "separator" });
      continue;
    }
    const action = entry.actionId === undefined ? undefined : findAction(entry.actionId);
    if (action === undefined) {
      continue;
    }
    rows.push({ type: "item", ...commandRow(action, context, platform) });
  }
  return rows;
}
