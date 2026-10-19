/** Document toolbar: history, zoom, brush and color controls. */

import { BrushControls } from "../../features/brushes/BrushControls";
import { ColorControls } from "../../features/color/ColorControls";
import { FillControls } from "../../features/fill/FillControls";
import { GradientControls } from "../../features/gradient/GradientControls";
import { ShapeControls } from "../../features/shapes/ShapeControls";
import { UndoRedoControls } from "../../features/history/UndoRedoControls";
import { useEditor } from "../../hooks/useEditor";
import { IconActualSize, IconFit, IconZoomIn, IconZoomOut } from "../icons";
import { IconButton } from "../toolbar/IconButton";

export function ToolBar() {
  const { actions } = useEditor();

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
      <BrushControls />
      <ShapeControls />
      <FillControls />
      <GradientControls />
      <div className="toolbar__divider" />
      <ColorControls />
      <div className="toolbar__spacer" />
      <p className="toolbar__hint">Wheel: scroll · Ctrl+Wheel: zoom · Middle-drag: pan</p>
    </div>
  );
}
