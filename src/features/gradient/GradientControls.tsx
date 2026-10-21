/**
 * Gradient options: shape and end colour.
 *
 * Shown only for the gradient tool. The start colour is the current brush
 * colour, so the two toolbar controls that matter are the type toggle and the
 * destination colour. Like the fill tolerance, these describe the *next* drag;
 * a committed gradient carries its own copy.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { GradientStopEditor } from "./GradientStopEditor";

export function GradientControls() {
  const { actions } = useEditor();
  const { toolId, gradientType, gradientEndColor } = useEditorState();

  if (toolId !== "gradient") {
    return null;
  }

  return (
    <>
      <div className="toolbar__divider" />
      <div className="toolbar__group gradient-controls">
        <label
          className="toggle"
          title="Draw a radial gradient from the start point instead of a linear one"
        >
          <input
            type="checkbox"
            checked={gradientType === "radial"}
            onChange={(event) =>
              actions.setGradientType(event.target.checked ? "radial" : "linear")
            }
          />
          Radial
        </label>
        <label className="gradient-controls__color" title="Gradient end colour">
          <span>To</span>
          <input
            type="color"
            className="color-controls__picker"
            aria-label="Gradient end colour"
            value={gradientEndColor}
            onChange={(event) => actions.setGradientEndColor(event.target.value)}
          />
        </label>
        <GradientStopEditor />
      </div>
    </>
  );
}
