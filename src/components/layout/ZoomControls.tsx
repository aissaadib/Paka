/**
 * The zoom group.
 *
 * The zoom is a view fact, so it lives in the app bar next to the document
 * it applies to: the four ways to change it (out, in, actual size, fit) and
 * the value they change. The value is read from the engine's snapshot, so it
 * is never a second copy of the viewport's state.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { IconActualSize, IconFit, IconZoomIn, IconZoomOut } from "../icons";
import { IconButton } from "../toolbar/IconButton";

/** The zoom as a percentage: whole numbers above 10 %, one decimal below. */
export function formatZoom(zoom: number): string {
  const percent = zoom * 100;
  return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1)}%`;
}

export function ZoomControls() {
  const { actions } = useEditor();
  const { viewport } = useEditorState();

  return (
    <div className="zoom-group" role="group" aria-label="Zoom">
      <IconButton label="Zoom out" shortcut="Ctrl+-" onClick={actions.zoomOut}>
        <IconZoomOut />
      </IconButton>
      <span className="zoom-group__value" aria-live="off">
        {formatZoom(viewport.zoom)}
      </span>
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
  );
}
