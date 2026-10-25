/**
 * The palette swatches.
 *
 * The toolbar and the colour dock both offer the same fixed palette, so the
 * row of swatches lives here once: a left click paints with the primary
 * colour, a right click sets the secondary one, and the swatch that holds the
 * primary colour is marked. Both places write through the same editor actions,
 * so the two rows can never disagree about which colour is current.
 *
 * Changing the colour is not an edit: it says what the *next* stroke is
 * painted with, so it adds no history step, dirties nothing and never reaches
 * a project file.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { toColorInputValue } from "./colorInput";
import { PALETTE } from "./palette";

export function ColorSwatches() {
  const { actions } = useEditor();
  const { brush } = useEditorState();
  const current = toColorInputValue(brush.color).toLowerCase();

  return (
    <div className="color-controls__palette" role="group" aria-label="Color palette">
      {PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          className={[
            "color-controls__swatch",
            color.toLowerCase() === current ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ backgroundColor: color }}
          title={`${color} (right-click: secondary)`}
          aria-label={`Use color ${color}`}
          onClick={() => actions.setBrush({ color })}
          onContextMenu={(event) => {
            event.preventDefault();
            actions.setSecondaryColor(color);
          }}
        />
      ))}
    </div>
  );
}
