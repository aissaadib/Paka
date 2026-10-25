/**
 * The top chrome: the tool options bar and the document bar.
 *
 * Two rows, each one line tall:
 *
 *  - the **options bar** is contextual: it follows the active tool and is
 *    where the brush's stroke controls live;
 *  - the **document bar** is stable: history, zoom, the grid and the colour
 *    swatches never move when the tool changes, so they stay findable by
 *    position rather than by reading.
 *
 * Keeping them apart is what stops the toolbar from wrapping: the options
 * bar scrolls its own excess, and the document bar holds only controls that
 * fit one row at the narrowest supported window.
 */

import { ColorControls } from "../../features/color/ColorControls";
import { GridControls } from "../../features/grid/GridControls";
import { UndoRedoControls } from "../../features/history/UndoRedoControls";
import { ToolOptionsBar } from "../../features/options/ToolOptionsBar";
import { useEditor } from "../../hooks/useEditor";
import { IconActualSize, IconFit, IconZoomIn, IconZoomOut } from "../icons";
import { IconButton } from "../toolbar/IconButton";

export function ToolBar() {
  const { actions } = useEditor();

  return (
    <div className="top-bars">
      <ToolOptionsBar />
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
    </div>
  );
}
