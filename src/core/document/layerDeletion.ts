/**
 * When deleting a layer has to be confirmed.
 *
 * Deleting a layer is an undoable step, so it is not data loss in the strict
 * sense - the elements come back with the undo. It is still the most
 * destructive thing the layers panel does, and an artist who clicks the wrong
 * row loses a drawing they had not meant to touch. So the rule is narrow and
 * explicit: a layer that **holds content** is confirmed, a layer that holds
 * nothing is removed without asking.
 *
 * The wording lives here, next to the rule, so the prompt and the rule cannot
 * drift apart - and so both can be tested without a DOM. The React layer has
 * no automated tests, so this is where the "cannot silently lose content"
 * promise is actually pinned.
 */

/** What the confirmation says. */
export interface LayerDeletionPrompt {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
}

/**
 * True when a layer may be deleted at all.
 *
 * The document always keeps one layer: the drawing pipeline needs somewhere
 * to paint, so the last layer is never removed. The rule lives here so the
 * panel can refuse *before* it asks the user to confirm a deletion that the
 * document model would then refuse - a question with no answer behind it is
 * worse than no question.
 *
 * @param layerCount how many layers the document holds
 */
export function canDeleteLayer(layerCount: number): boolean {
  return layerCount > 1;
}

/**
 * The prompt for deleting the layer called `name`, or `null` when the layer
 * holds nothing and the deletion needs no confirmation.
 *
 * @param elementCount how many elements (strokes, fills and gradients) the
 *        layer holds
 */
export function layerDeletionPrompt(
  name: string,
  elementCount: number,
): LayerDeletionPrompt | null {
  if (elementCount <= 0) {
    return null;
  }
  const body =
    elementCount === 1
      ? "This layer holds 1 item - a stroke, a fill or a gradient. " +
        "Deleting the layer removes it from the drawing. Undo brings it back."
      : `This layer holds ${elementCount} items - strokes, fills or gradients. ` +
        "Deleting the layer removes them from the drawing. Undo brings them back.";
  return {
    title: `Delete "${name}"?`,
    body,
    confirmLabel: "Delete layer",
  };
}
