/**
 * Gradient edit command.
 *
 * Editing a committed gradient replaces its record in place: the element keeps
 * its id and its position in the layer's painting order, and only its geometry
 * or its stops change. The command therefore carries **two** records - the one
 * that was committed and the one that replaced it - so undo restores the
 * original exactly and redo applies the edited one exactly.
 *
 * This is deliberately not the gradient *creation* command
 * (`core/commands/gradientCommand.ts`): that one inserts a new element, this
 * one swaps an existing one. Keeping them apart means the history label can
 * say what happened ("Gradient" versus "Edit Gradient") and the undo path of a
 * creation is never confused with the undo path of an edit.
 */

import { createId } from "../../utils/id";
import type { GradientRecord, LayerElement, LayerId } from "../document/types";
import { gradientRecordProblem } from "../gradient/gradientRecord";
import type { Command } from "./types";

/**
 * What the command needs from the document.
 *
 * A gradient edit does not insert or remove anything, so it does not need the
 * full element host: it swaps one record for another and asks for a repaint.
 */
export interface GradientEditHost {
  /** Swaps an element for a new version with the same id, keeping its position. */
  replace(element: LayerElement): void;
  /** Re-rasterizes a layer after its element list changed. */
  refresh(layerId: LayerId): void;
}

/** The command, with the two records it swaps between. */
export interface GradientEditCommand extends Command {
  /** The record the edit replaced. */
  readonly original: GradientRecord;
  /** The record the edit put in its place. */
  readonly next: GradientRecord;
}

/**
 * Builds the command that records one gradient edit.
 *
 * `original` is the committed record and `next` the one that replaced it. Undo
 * puts `original` back; redo puts `next` back. The records are the very
 * objects the editor holds, so an undo restores the identical record rather
 * than an equal copy.
 *
 * `mergeKey` lets a run of edits (a held arrow key, for instance) collapse
 * into one history entry. The merged command reverts to the **first** original
 * and applies the **last** replacement, which is what makes the run undo as
 * one step.
 *
 * A record the file format could not read is **refused** rather than
 * repaired: a gradient with no stops, or with a stop outside the ramp, would
 * be a file the reader rejects, so the document would become unsaveable. The
 * model never produces such a record - `moveGradientHandle` holds a stop
 * between its neighbours and the geometry inside the paper - so reaching this
 * is a programming error rather than a user mistake, and it is reported as
 * one.
 */
export function createGradientEditCommand(
  original: GradientRecord,
  next: GradientRecord,
  host: GradientEditHost,
  mergeKey?: string,
): GradientEditCommand {
  const originalProblem = gradientRecordProblem(original);
  if (originalProblem) {
    throw new Error(`A gradient edit needs a valid record: ${originalProblem}.`);
  }
  const nextProblem = gradientRecordProblem(next);
  if (nextProblem) {
    throw new Error(`A gradient edit needs a valid record: ${nextProblem}.`);
  }

  return {
    id: createId("cmd"),
    label: "Edit Gradient",
    original,
    next,
    ...(mergeKey === undefined ? {} : { mergeKey }),
    apply(): void {
      host.replace(next);
      host.refresh(next.layerId);
    },
    revert(): void {
      host.replace(original);
      host.refresh(original.layerId);
    },
    mergeWith(other: Command): Command {
      const replacement = (other as Partial<GradientEditCommand>).next;
      if (!replacement) {
        return this;
      }
      return createGradientEditCommand(original, replacement, host, mergeKey);
    },
  };
}
