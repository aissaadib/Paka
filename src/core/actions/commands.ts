/**
 * The commands the menus and the palette add to the keyboard table.
 *
 * They live in their own module for readability, but the registry composes
 * them into `ACTION_DEFINITIONS`, so there is still exactly one list of
 * commands: the keyboard, the canvas menu and the command palette all read
 * the same names, the same labels and the same availability rules.
 *
 * A command without a chord is a *command-only* action: "rotate 15 degrees
 * clockwise" has no natural key, so it is reached by name. It claims no key
 * and can therefore never shadow another command.
 */

import { FIXED_ROTATION_DEGREES, FIXED_SCALE_FACTOR } from "../document/selectionTransform";
import { selectionAvailable } from "./availability";
import type { ActionDefinition, ActionContext } from "./types";

/** The shortcut of the command palette: the platform's modifier plus K. */
const PALETTE_CHORD = { key: "k", code: "KeyK", mod: true } as const;

/**
 * Builds a command that is reached by name rather than by a key.
 *
 * The `when` guard and the availability rule come from one function, so the
 * keyboard and the menus can never disagree about whether the command can
 * run.
 */
function commandOnly(
  definition: Omit<ActionDefinition, "shortcuts" | "commandOnly">,
): ActionDefinition {
  return { ...definition, shortcuts: [], commandOnly: true };
}

/**
 * A command that needs something the editor may not have.
 *
 * The keyboard guard and the availability rule are the same answer, derived
 * once: a command that declines the key also shows as disabled in a menu.
 */
function requires(
  available: (context: ActionContext) => string | null,
): Pick<ActionDefinition, "when" | "available"> {
  return { when: (context) => available(context) === null, available };
}

export const COMMAND_ACTIONS: readonly ActionDefinition[] = [
  commandOnly({
    id: "selectAll",
    label: "Select All",
    run: ({ actions }) => actions.selectAll(),
  }),
  commandOnly({
    id: "deselect",
    label: "Deselect",
    ...requires(selectionAvailable),
    run: ({ actions }) => actions.clearSelection(),
  }),
  commandOnly({
    id: "scaleSelection",
    label: "Scale by 150%",
    ...requires(selectionAvailable),
    run: ({ actions }) => actions.scaleSelection(FIXED_SCALE_FACTOR),
  }),
  commandOnly({
    id: "rotateSelectionClockwise",
    label: "Rotate 15° Clockwise",
    ...requires(selectionAvailable),
    run: ({ actions }) => actions.rotateSelection(FIXED_ROTATION_DEGREES),
  }),
  commandOnly({
    id: "rotateSelectionCounterClockwise",
    label: "Rotate 15° Counter-Clockwise",
    ...requires(selectionAvailable),
    run: ({ actions }) => actions.rotateSelection(-FIXED_ROTATION_DEGREES),
  }),
  commandOnly({
    id: "addLayer",
    label: "Add Layer",
    run: ({ actions }) => actions.addLayer(),
  }),
  {
    id: "commandPalette",
    label: "Command Palette",
    shortcuts: [PALETTE_CHORD],
    run: ({ ui }) => ui?.openCommandPalette?.(),
  },
];
