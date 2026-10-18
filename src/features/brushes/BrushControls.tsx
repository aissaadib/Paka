/** Brush size, opacity and pressure mapping controls. */

import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from "../../core/brushes/defaults";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { SliderField } from "../../components/toolbar/SliderField";

/** Pressure strength applied by the on/off toggles. */
const PRESSURE_STRENGTH = 0.6;

export function BrushControls() {
  const { actions } = useEditor();
  const { brush } = useEditorState();

  return (
    <div className="toolbar__group brush-controls">
      <SliderField
        label="Size"
        scale="log"
        min={MIN_BRUSH_SIZE}
        max={MAX_BRUSH_SIZE}
        step={1}
        value={brush.size}
        format={(value) => `${Math.round(value)} px`}
        onChange={(size) => actions.setBrush({ size })}
      />
      <SliderField
        label="Opacity"
        min={0}
        max={1}
        step={0.01}
        value={brush.opacity}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(opacity) => actions.setBrush({ opacity })}
      />
      <label
        className="toggle"
        title="Pen pressure controls stroke width (ignored by mouse input)"
      >
        <input
          type="checkbox"
          checked={brush.pressureSize > 0}
          onChange={(event) =>
            actions.setBrush({ pressureSize: event.target.checked ? PRESSURE_STRENGTH : 0 })
          }
        />
        Pressure size
      </label>
      <label className="toggle" title="Pen pressure controls stroke opacity">
        <input
          type="checkbox"
          checked={brush.pressureOpacity > 0}
          onChange={(event) =>
            actions.setBrush({ pressureOpacity: event.target.checked ? PRESSURE_STRENGTH : 0 })
          }
        />
        Pressure opacity
      </label>
    </div>
  );
}
