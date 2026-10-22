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

import { DEFAULT_BRUSH, DEFAULT_SECONDARY_COLOR } from "../../core/brushes/defaults";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { colorInputValue } from "../../utils/color";

export function ColorControls() {
  const { actions } = useEditor();
  const { brush, secondaryColor } = useEditorState();
  const current = brush.color;
  const secondary = secondaryColor;
  const canSwap = current !== secondary;
  const isDefault =
    current === DEFAULT_BRUSH.color && secondary === DEFAULT_SECONDARY_COLOR;

  return (
    <div className="toolbar__group color-controls">
      <div className="color-controls__pickers">
        <input
          className="color-controls__picker"
          type="color"
          value={colorInputValue(current)}
          onChange={(event) => actions.setBrush({ color: event.target.value })}
          aria-label="Primary stroke color"
          title="Primary stroke color (left button)"
        />
        <input
          className="color-controls__picker color-controls__picker--secondary"
          type="color"
          value={colorInputValue(secondary)}
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
        <button
          type="button"
          className="color-controls__reset"
          onClick={() => actions.resetColors()}
          disabled={isDefault}
          aria-label="Default colors"
          title="Put both colors back to their defaults (D)"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
