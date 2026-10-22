/**
 * A command that runs several commands as one history step.
 *
 * Some gestures change the document in more than one element at a time: a
 * symmetric stroke paints the stroke the user drew *and* its copies, and the
 * user thinks of that as one action. The group runs its parts in order when it
 * is applied and in reverse when it is reverted, so the document returns to
 * exactly the state it was in.
 *
 * The group owns no state of its own: it is the parts that know how to apply
 * and revert themselves, which is what keeps undo exact and redo idempotent.
 */

import { createId } from "../../utils/id";
import type { Command } from "./types";

/**
 * Bundles commands into one undoable step.
 *
 * The label is the one the history shows, so it names the gesture rather than
 * the parts: a symmetric stroke reads as "Symmetric Stroke", not as six
 * separate strokes.
 */
export function createGroupCommand(label: string, commands: readonly Command[]): Command {
  return {
    id: createId("cmd"),
    label,
    apply(): void {
      for (const command of commands) {
        command.apply();
      }
    },
    revert(): void {
      // Reversed, so the parts unwind in the opposite order to the one they
      // were applied in - the last part is undone first.
      for (let index = commands.length - 1; index >= 0; index -= 1) {
        commands[index].revert();
      }
    },
  };
}
