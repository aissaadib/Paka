/**
 * Stroke color control: system color picker plus a small fixed palette.
 *
 * A single foreground color is supported; there is deliberately no secondary
 * or swap control until the engine can actually use them.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { PALETTE } from "./palette";

/** `input[type=color]` only accepts `#rrggbb`. */
function toColorInputValue(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
}

export function ColorControls() {
  const { actions } = useEditor();
  const { brush } = useEditorState();
  const current = toColorInputValue(brush.color);

  return (
    <div className="toolbar__group color-controls">
      <input
        className="color-controls__picker"
        type="color"
        value={current}
        onChange={(event) => actions.setBrush({ color: event.target.value })}
        aria-label="Stroke color"
        title="Stroke color"
      />
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
            title={color}
            aria-label={`Use color ${color}`}
            onClick={() => actions.setBrush({ color })}
          />
        ))}
      </div>
    </div>
  );
}
