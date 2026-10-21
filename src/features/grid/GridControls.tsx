/**
 * Grid and snapping controls.
 *
 * Two switches and a spacing slider, in the toolbar beside the zoom controls:
 *
 *  - **Grid** shows the document grid. It is off by default and is display-only,
 *    so it never appears in an export or a saved project.
 *  - **Snap** makes a drawing sample land exactly on a guide or a grid line
 *    when it is within 6 CSS pixels of one. It is off by default and
 *    independent of the grid being visible: a user may want invisible grid
 *    snapping, and the two switches therefore change two different things.
 *  - **Spacing** is the distance between grid lines, in document pixels. It is
 *    shown while the grid is visible or the snapping is on, because it is the
 *    setting both of them use.
 *
 * The same two switches have shortcuts: `Ctrl+'` for the grid and
 * `Ctrl+Shift+'` for snapping.
 */

import { SliderField } from "../../components/toolbar/SliderField";
import {
  GRID_SPACING_STEP,
  MAX_GRID_SPACING,
  MIN_GRID_SPACING,
  SNAP_TOLERANCE_PX,
} from "../../core/document/grid";
import { useEditor, useEditorState } from "../../hooks/useEditor";

export function GridControls() {
  const { actions } = useEditor();
  const { gridVisible, gridSpacing, gridSnapping } = useEditorState();

  return (
    <>
      <div className="toolbar__divider" />
      <div className="toolbar__group grid-controls">
        <label className="toggle" title="Show the document grid (Ctrl+')">
          <input
            type="checkbox"
            checked={gridVisible}
            onChange={(event) => actions.setGridVisible(event.target.checked)}
          />
          Grid
        </label>
        <label
          className="toggle"
          title={`Snap drawing to guides and grid lines within ${SNAP_TOLERANCE_PX} screen pixels (Ctrl+Shift+')`}
        >
          <input
            type="checkbox"
            checked={gridSnapping}
            onChange={(event) => actions.setGridSnapping(event.target.checked)}
          />
          Snap
        </label>
        {gridVisible || gridSnapping ? (
          <SliderField
            label="Spacing"
            min={MIN_GRID_SPACING}
            max={MAX_GRID_SPACING}
            step={GRID_SPACING_STEP}
            scale="log"
            value={gridSpacing}
            format={(value) => `${Math.round(value)} px`}
            title="Distance between grid lines, in document pixels"
            onChange={(value) => actions.setGridSpacing(value)}
          />
        ) : null}
      </div>
    </>
  );
}
