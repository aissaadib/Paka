/**
 * Document toolbar: history, zoom, grid and colour.
 *
 * The tool's own options live in the strip above this bar, so nothing here
 * changes when the tool changes and the toolbar keeps the same height.
 */

import { ColorControls } from "../../features/color/ColorControls";
import { GridControls } from "../../features/grid/GridControls";
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
      <GridControls />
      <div className="toolbar__divider" />
      <ColorControls />
      <div className="toolbar__spacer" />
      <p className="toolbar__hint">Wheel: scroll · Ctrl+Wheel: zoom · Middle-drag: pan</p>
    </div>
  );
}
