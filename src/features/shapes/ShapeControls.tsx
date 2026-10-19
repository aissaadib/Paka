/**
 * Shape options: whether a committed shape is filled or traced.
 *
 * Shown only while the active tool's shapes bound an area (`fillable`), because
 * the setting has no meaning for a brush, an eraser or a line. It switches the
 * shape tools from an outline to a solid silhouette - the outline is still
 * traced, so the edge stays where an unfilled shape's edge was, and the interior
 * takes the brush colour.
 */

import { getToolDefinition } from "../../core/tools/toolDefinitions";
import { useEditor, useEditorState } from "../../hooks/useEditor";

export function ShapeControls() {
  const { actions } = useEditor();
  const { toolId, shapeFill } = useEditorState();

  if (getToolDefinition(toolId).fillable !== true) {
    return null;
  }

  return (
    <>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <label
          className="toggle"
          title="Fill the shape's interior instead of tracing just its outline"
        >
          <input
            type="checkbox"
            checked={shapeFill}
            onChange={(event) => actions.setShapeFill(event.target.checked)}
          />
          Fill shape
        </label>
      </div>
    </>
  );
}
