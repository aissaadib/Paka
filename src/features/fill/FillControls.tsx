/**
 * Bucket-fill options: the colour tolerance of the contiguous flood.
 *
 * Shown only for the bucket tool. Tolerance is a per-channel 8-bit sRGB
 * distance (`0` fills only the exact seed colour); it describes the next fill,
 * so changing it never rewrites a committed patch.
 */

import { SliderField } from "../../components/toolbar/SliderField";
import { useEditor, useEditorState } from "../../hooks/useEditor";

export function FillControls() {
  const { actions } = useEditor();
  const { toolId, fillTolerance } = useEditorState();

  if (toolId !== "bucket") {
    return null;
  }

  return (
    <>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <SliderField
          label="Tolerance"
          min={0}
          max={255}
          step={1}
          value={fillTolerance}
          format={(value) => `${Math.round(value)}`}
          onChange={(value) => actions.setFillTolerance(value)}
        />
      </div>
    </>
  );
}
