/**
 * The selection mode control.
 *
 * Four buttons - **New**, **Add**, **Subtract** and **Intersect** - that say
 * how the next marquee combines with the selection that is already there.
 * They are the same four modes the modifier keys reach, and they can never
 * disagree with them: while a marquee is in flight the engine publishes the
 * mode that gesture resolved, so the button that is highlighted is the mode
 * the drag is actually applying.
 *
 * Only modes the selection can express are offered. The unit of selection is
 * a whole stroke, so all four set operations are exact; what the geometry
 * cannot do is feather or expand a selection, and no such button appears here.
 *
 * Choosing a mode is editor state, not an edit: it adds no history step and
 * never marks the document unsaved.
 */

import {
  SELECTION_MODE_HINTS,
  SELECTION_MODE_LABELS,
  SELECTION_MODES,
} from "../../core/document/selectionModes";
import { useEditor, useEditorState } from "../../hooks/useEditor";

export function SelectionModeControl() {
  const { actions } = useEditor();
  const { selectionMode } = useEditorState();

  return (
    <div className="toolbar__group selection-modes" role="radiogroup" aria-label="Selection mode">
      {SELECTION_MODES.map((mode) => {
        const active = selectionMode === mode;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={active}
            className={active ? "selection-modes__button is-active" : "selection-modes__button"}
            key={mode}
            title={SELECTION_MODE_HINTS[mode]}
            onClick={() => actions.setSelectionMode(mode)}
          >
            {SELECTION_MODE_LABELS[mode]}
          </button>
        );
      })}
    </div>
  );
}
