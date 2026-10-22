/**
 * Stroke colour controls: the primary and the secondary colour, and the
 * palette the artist keeps to hand.
 *
 * Left-button gestures paint with the primary colour; right-button gestures
 * paint with the secondary one. Both are editor state captured at press time,
 * so swapping them never repaints existing strokes. The secondary colour has
 * no project-format field of its own.
 *
 * The swatches come from the editor's palette, which is the same list the
 * colour panel edits and the settings file persists - so a swatch saved in
 * the panel is here too, and one added here is in the panel.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { colorInputValue } from "../../utils/color";

export function ColorControls() {
  const { actions } = useEditor();
  const { brush, secondaryColor, palette } = useEditorState();
  const current = brush.color;
  const secondary = secondaryColor;
  const canSwap = current !== secondary;

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
          title="Swap primary and secondary colors"
        >
          ⇄
        </button>
      </div>
      <div className="color-controls__palette" role="group" aria-label="Color palette">
        {palette.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            className={[
              "color-controls__swatch",
              swatch.color === current ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ backgroundColor: swatch.color }}
            title={`${swatch.name} ${swatch.color} (right-click: secondary)`}
            aria-label={`Use color ${swatch.name} ${swatch.color}`}
            onClick={() => actions.setBrush({ color: swatch.color })}
            onContextMenu={(event) => {
              event.preventDefault();
              actions.setSecondaryColor(swatch.color);
            }}
          />
        ))}
      </div>
    </div>
  );
}
