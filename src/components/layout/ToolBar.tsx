/**
 * Document toolbar: history, zoom, grid and colour.
 *
 * The tool's own options live in the strip above this bar, so nothing here
 * changes when the tool changes and the toolbar keeps the same height.
 */

import { ColorControls } from "../../features/color/ColorControls";
import { GridControls } from "../../features/grid/GridControls";
import { UndoRedoControls } from "../../features/history/UndoRedoControls";
import { RulerControls } from "../../features/rulers/RulerControls";
import { ViewControls } from "../../features/view/ViewControls";
import { MAX_ZOOM, MIN_ZOOM } from "../../core/rendering/viewport";
import { useEditor, useEditorState, useEditorToolId } from "../../hooks/useEditor";
import { toolUsesBrushSize } from "../../core/brushes/brushSizeGesture";
import { IconActualSize, IconFit, IconZoomIn, IconZoomOut } from "../icons";
import { IconButton } from "../toolbar/IconButton";

/** The navigation shortcuts, the same for every tool. */
const NAVIGATION_HINT = "Wheel: scroll · Ctrl+Wheel: zoom · Middle-drag: pan";

/** The brush size shortcuts, added when the brush is the active tool. */
const BRUSH_SIZE_HINT = "Ctrl+Alt+drag: brush size · [ / ]: size";

export function ToolBar() {
  const { actions } = useEditor();
  const { viewport } = useEditorState();
  const toolId = useEditorToolId();
  const hint = toolUsesBrushSize(toolId)
    ? `${BRUSH_SIZE_HINT} · ${NAVIGATION_HINT}`
    : NAVIGATION_HINT;

  return (
    <div className="toolbar" role="toolbar" aria-label="Document toolbar">
      <UndoRedoControls />
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <IconButton
          label="Zoom out"
          shortcut="Ctrl+-"
          disabled={viewport.zoom <= MIN_ZOOM}
          onClick={actions.zoomOut}
        >
          <IconZoomOut />
        </IconButton>
        <IconButton
          label="Zoom in"
          shortcut="Ctrl+="
          disabled={viewport.zoom >= MAX_ZOOM}
          onClick={actions.zoomIn}
        >
          <IconZoomIn />
        </IconButton>
        <IconButton label="Actual size" shortcut="Ctrl+1" onClick={() => actions.zoomTo(1)}>
          <IconActualSize />
        </IconButton>
        <IconButton label="Fit to window" shortcut="Ctrl+0" onClick={actions.zoomToFit}>
          <IconFit />
        </IconButton>
      </div>
      <ViewControls />
      <div className="toolbar__divider" />
      <GridControls />
      <RulerControls />
      <div className="toolbar__divider" />
      <ColorControls />
      <div className="toolbar__spacer" />
      <p
        className="toolbar__hint"
        title="Ctrl+Alt and drag on the canvas to change the brush size; [ and ] step it, Alt+[ and Alt+] change it by one pixel. Escape cancels a resize in progress."
      >
        {hint}
      </p>
    </div>
  );
}
