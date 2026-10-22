/** Document toolbar: history, zoom, brush and color controls. */

import { BrushControls } from "../../features/brushes/BrushControls";
import { ColorControls } from "../../features/color/ColorControls";
import { GradientControls } from "../../features/gradient/GradientControls";
import { GridControls } from "../../features/grid/GridControls";
import { ToolOptionsPanel } from "../../features/options/ToolOptionsPanel";
import { toolShowsBrushControls } from "../../features/options/toolOptionSchema";
import { UndoRedoControls } from "../../features/history/UndoRedoControls";
import { toolUsesBrushSize } from "../../core/brushes/brushSizeGesture";
import { useEditor, useEditorToolId } from "../../hooks/useEditor";
import { IconActualSize, IconFit, IconZoomIn, IconZoomOut } from "../icons";
import { IconButton } from "../toolbar/IconButton";

/** The navigation shortcuts, the same for every tool. */
const NAVIGATION_HINT = "Wheel: scroll · Ctrl+Wheel: zoom · Middle-drag: pan";

/** The brush size shortcuts, added when the brush is the active tool. */
const BRUSH_SIZE_HINT = "Ctrl+Alt+drag: brush size · [ / ]: size";

export function ToolBar() {
  const { actions } = useEditor();
  const toolId = useEditorToolId();
  const hint = toolUsesBrushSize(toolId)
    ? `${BRUSH_SIZE_HINT} · ${NAVIGATION_HINT}`
    : NAVIGATION_HINT;

  return (
    <div className="toolbar" role="toolbar" aria-label="Document toolbar">
      <UndoRedoControls />
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <IconButton label="Zoom out" shortcut="Ctrl+-" onClick={actions.zoomOut}>
          <IconZoomOut />
        </IconButton>
        <IconButton label="Zoom in" shortcut="Ctrl+=" onClick={actions.zoomIn}>
          <IconZoomIn />
        </IconButton>
        <IconButton label="Actual size" shortcut="Ctrl+1" onClick={() => actions.zoomTo(1)}>
          <IconActualSize />
        </IconButton>
        <IconButton label="Fit to window" shortcut="Ctrl+0" onClick={actions.zoomToFit}>
          <IconFit />
        </IconButton>
      </div>
      <div className="toolbar__divider" />
      <GridControls />
      {toolShowsBrushControls(toolId) ? <BrushControls /> : null}
      <ToolOptionsPanel />
      <GradientControls />
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
