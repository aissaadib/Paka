/**
 * Stroke colour controls: a primary and a secondary colour plus a small fixed
 * palette.
 *
 * Left-button gestures paint with the primary colour; right-button gestures
 * paint with the secondary one. Both are editor state captured at press time,
 * so swapping them never repaints existing strokes. The secondary colour has no
 * project-format field of its own.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { ColorSwatches } from "./ColorSwatches";
import { toColorInputValue } from "./colorInput";

export function ColorControls() {
  const { actions } = useEditor();
  const { brush, secondaryColor } = useEditorState();
  const current = toColorInputValue(brush.color);
  const secondary = toColorInputValue(secondaryColor);
  const canSwap = current.toLowerCase() !== secondary.toLowerCase();

  return (
    <div className="toolbar__group color-controls">
      <div className="color-controls__pickers">
        <input
          className="color-controls__picker"
          type="color"
          value={current}
          onChange={(event) => actions.setBrush({ color: event.target.value })}
          aria-label="Primary stroke color"
          title="Primary stroke color (left button)"
        />
        <input
          className="color-controls__picker color-controls__picker--secondary"
          type="color"
          value={secondary}
          onChange={(event) => actions.setSecondaryColor(event.target.value)}
          aria-label="Secondary stroke color"
          title="Secondary stroke color (right button)"
        />
        <button
          type="button"
          className="color-controls__swap"
          onClick={() => actions.swapColors()}
          disabled={!canSwap}
          aria-label="Swap primary and secondary colors"
          title="Swap primary and secondary colors"
        >
          ⇄
        </button>
      </div>
      <ColorSwatches />
    </div>
  );
}
