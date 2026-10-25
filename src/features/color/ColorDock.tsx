/**
 * The colour dock: the two colours the artist paints with.
 *
 * The **ink** is the colour a left-button gesture paints with and the **alt**
 * colour is the one a right-button gesture paints with. Both live in the
 * editor: the ink is the brush's colour and the alt colour is the engine's
 * secondary, and a gesture resolves which of the two it paints with once, at
 * press time. So changing a colour here never repaints anything already
 * drawn, and neither colour is part of the project file.
 *
 * Each row is a swatch and a text field for the same colour, so the colour
 * can be picked by eye or typed exactly. The text field refuses what it
 * cannot store - anything that is not a colour, and anything translucent,
 * because the app paints opaque colours only - and says so instead of
 * changing the colour behind the artist's back.
 *
 * Swapping exchanges the two, and **Reset** puts both back to the colours a
 * fresh session starts with.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { canSwapColors, isDefaultColors } from "../../core/color/colors";
import { colorInputValue } from "../../utils/color";
import { ColorTextField } from "./ColorTextField";

/** One row of the dock: a swatch and the exact value of the same colour. */
function ColorDockRow(props: {
  readonly label: string;
  readonly color: string;
  readonly onCommit: (color: string) => void;
}) {
  const { label, color, onCommit } = props;
  const shown = colorInputValue(color);

  return (
    <div className="color-dock__row">
      <span className="color-dock__label">{label}</span>
      <span className="color-dock__chip" style={{ backgroundColor: shown }}>
        <input
          className="color-dock__picker"
          type="color"
          value={shown}
          onChange={(event) => onCommit(event.target.value)}
          aria-label={`${label} swatch`}
          title={`${label} colour`}
        />
      </span>
      <ColorTextField
        value={color}
        label={`${label} colour value`}
        className="color-dock__field"
        onCommit={onCommit}
      />
    </div>
  );
}

export function ColorDock() {
  const { actions } = useEditor();
  const { brush, secondaryColor } = useEditorState();

  const ink = brush.color;
  const alt = secondaryColor;
  const canSwap = canSwapColors(ink, alt);
  const isDefault = isDefaultColors(ink, alt);

  return (
    <div className="color-dock">
      <ColorDockRow
        label="Ink"
        color={ink}
        onCommit={(color) => actions.setBrush({ color })}
      />
      <ColorDockRow
        label="Alt"
        color={alt}
        onCommit={(color) => actions.setSecondaryColor(color)}
      />
      <div className="color-dock__actions">
        <button
          type="button"
          className="color-dock__button"
          onClick={() => actions.swapColors()}
          disabled={!canSwap}
          title="Swap the ink and the alt colour"
        >
          Swap
        </button>
        <button
          type="button"
          className="color-dock__button"
          onClick={() => actions.resetColors()}
          disabled={isDefault}
          title="Put both colours back to their defaults"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
