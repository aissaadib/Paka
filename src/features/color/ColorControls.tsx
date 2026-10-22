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
import { PALETTE } from "./palette";

/** `input[type=color]` only accepts `#rrggbb`. */
function toColorInputValue(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
}

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
          className="color-well"
          type="color"
          value={current}
          onChange={(event) => actions.setBrush({ color: event.target.value })}
          aria-label="Primary stroke color"
          title="Primary stroke color (left button)"
        />
        <input
          className="color-well color-controls__picker--secondary"
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
      <div className="color-controls__palette" role="group" aria-label="Color palette">
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            className={[
              "color-controls__swatch",
              color.toLowerCase() === current.toLowerCase() ? "is-active" : "",
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
    </div>
  );
}
