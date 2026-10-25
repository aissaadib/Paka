/**
 * Stroke colour controls: the primary and the secondary colour.
 *
 * Left-button gestures paint with the primary colour; right-button gestures
 * paint with the secondary one. Both are editor state captured at press time,
 * so swapping them never repaints existing strokes. The secondary colour has
 * no project-format field of its own.
 *
 * This is the *quick* half of the colour dock: the two colours and the two
 * actions that change them. The palette and the recent colours live in the
 * colour panel, which is where they can be edited - a swatch list in a toolbar
 * row would grow with every colour the artist saves, and a toolbar that grows
 * is a toolbar that pushes the canvas off the screen.
 */

import { canSwapColors } from "../../core/color/colors";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { ColorSwatches } from "./ColorSwatches";
import { toColorInputValue } from "./colorInput";

export function ColorControls() {
  const { actions } = useEditor();
  const { brush, secondaryColor } = useEditorState();
  const current = brush.color;
  const secondary = secondaryColor;
  const canSwap = canSwapColors(current, secondary);

  return (
    <div className="toolbar__group color-controls">
      <div className="color-controls__pickers">
        <input
          className="color-controls__picker"
          type="color"
          value={toColorInputValue(current)}
          onChange={(event) => actions.setBrush({ color: event.target.value })}
          aria-label="Primary stroke color"
          title="Primary stroke color (left button)"
        />
        <input
          className="color-controls__picker color-controls__picker--secondary"
          type="color"
          value={toColorInputValue(secondary)}
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
          title="Swap primary and secondary colors (X)"
        >
          ⇄
        </button>
      </div>
      <ColorSwatches />
    </div>
  );
}
