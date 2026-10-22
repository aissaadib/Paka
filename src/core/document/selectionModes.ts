/**
 * Selection modes: how a marquee combines with the selection that is already
 * there.
 *
 * The selection in this engine is a **set of stroke ids** on one layer (see
 * `core/document/strokeSelection.ts` and the engine's `Selection`), so every
 * classic marquee mode is a set operation on those ids and nothing else:
 *
 *  - **New** (`replace`) - the marquee *is* the selection. A marquee that meets
 *    nothing clears the selection.
 *  - **Add** - the marquee joins the selection. A marquee that meets nothing
 *    leaves the selection exactly as it was.
 *  - **Subtract** - the marquee is taken out of the selection. A marquee that
 *    meets nothing leaves the selection as it was.
 *  - **Intersect** - only the strokes that are in *both* the marquee and the
 *    selection survive.
 *
 * All four are exact: a unit of selection is a whole stroke, so a mode can
 * never split a stroke or pick part of one. What the geometry **cannot** do
 * is feather or expand a selection - that would need a region rather than a
 * set of ids - so no such mode is offered here, and none is displayed in the
 * toolbar.
 *
 * The module is pure: it knows about ids, not about strokes, the document, the
 * pointer or the renderer. That is what makes the set operations testable
 * without a canvas.
 */

/**
 * How a marquee combines with the selection that is already there.
 *
 * `replace` is the mode a plain drag uses; the other three are reached from
 * the toolbar or from the modifier keys.
 */
export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

/** Every mode, in the order the toolbar shows them. */
export const SELECTION_MODES: readonly SelectionMode[] = [
  "replace",
  "add",
  "subtract",
  "intersect",
];

/** The mode a fresh editor starts in: a marquee replaces the selection. */
export const DEFAULT_SELECTION_MODE: SelectionMode = "replace";

/** True when `value` names a selection mode. */
export function isSelectionMode(value: unknown): value is SelectionMode {
  return (
    value === "replace" || value === "add" || value === "subtract" || value === "intersect"
  );
}

/** The short name the toolbar shows. */
export const SELECTION_MODE_LABELS: Readonly<Record<SelectionMode, string>> = {
  replace: "New",
  add: "Add",
  subtract: "Subtract",
  intersect: "Intersect",
};

/**
 * What a mode does, in one sentence, with the modifier keys that reach it.
 *
 * The modifiers are named here because they are the *same* modes: the toolbar
 * button and the held key are two ways of asking for one mode, and the engine
 * resolves both through `resolveSelectionMode`.
 */
export const SELECTION_MODE_HINTS: Readonly<Record<SelectionMode, string>> = {
  replace:
    "The marquee replaces the selection. Hold Shift to add, Alt to subtract, Shift+Alt to intersect.",
  add: "The marquee is added to the selection. Hold Shift+Alt to intersect, Alt to subtract.",
  subtract:
    "The marquee is taken out of the selection. Hold Shift to add, Shift+Alt to intersect.",
  intersect:
    "Only the strokes in both the marquee and the selection survive. Hold Shift to add, Alt to subtract.",
};

/** The modifier keys a gesture can be started with. */
export interface SelectionModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
}

/**
 * The mode a gesture uses: the toolbar's mode, overridden by the modifier keys
 * held when the press landed.
 *
 * The override is deliberate and total, so the two controls can never
 * disagree about what a drag will do:
 *
 *  - `Shift` alone asks for **Add**;
 *  - `Alt` alone asks for **Subtract**;
 *  - `Shift`+`Alt` asks for **Intersect**;
 *  - no modifier asks for the mode the toolbar has set.
 *
 * The modifier is read at press time and belongs to that gesture: a key
 * pressed or released while the pointer is down does not change what the
 * gesture is already doing.
 */
export function resolveSelectionMode(
  base: SelectionMode,
  modifiers: SelectionModifiers,
): SelectionMode {
  if (modifiers.shift && modifiers.alt) {
    return "intersect";
  }
  if (modifiers.shift) {
    return "add";
  }
  if (modifiers.alt) {
    return "subtract";
  }
  return base;
}

/** The ids of `ids`, without repeats and in the order they first appear. */
function unique(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * Combines the strokes a marquee met with the strokes that are already
 * selected, according to the mode.
 *
 * `current` is the selection that is there now and `incoming` is the set the
 * marquee met. The result keeps the order of `current` first and appends the
 * new ids, so the outcome reads like the layer does; the engine re-sorts it
 * into painting order afterwards, because that is the order the transforms
 * and the history commands want.
 *
 * An empty result is an empty selection: the caller turns it into "no
 * selection", because a selection that holds nothing is not a selection.
 */
export function combineSelectionIds(
  mode: SelectionMode,
  current: readonly string[],
  incoming: readonly string[],
): string[] {
  switch (mode) {
    case "replace":
      return unique(incoming);
    case "add": {
      const result = unique(current);
      const seen = new Set(result);
      for (const id of incoming) {
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        result.push(id);
      }
      return result;
    }
    case "subtract": {
      const removed = new Set(incoming);
      return unique(current).filter((id) => !removed.has(id));
    }
    case "intersect": {
      const kept = new Set(incoming);
      return unique(current).filter((id) => kept.has(id));
    }
  }
}

/**
 * The complement of `current` within `all`.
 *
 * The inversion of an empty selection is everything, and the inversion of
 * everything is nothing: both are ordinary set operations, and the caller
 * turns the empty result into "no selection".
 */
export function invertSelectionIds(
  all: readonly string[],
  current: readonly string[],
): string[] {
  const selected = new Set(current);
  return unique(all).filter((id) => !selected.has(id));
}
