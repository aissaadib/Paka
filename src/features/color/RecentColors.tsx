/**
 * The recent-colours history.
 *
 * The colours the artist has picked, most recent first. The list is bounded
 * (see `COLOR_HISTORY_LIMIT`), it never holds the same colour twice, and it
 * has a **Clear** button, because a history that cannot be emptied is a list
 * that grows without the artist choosing it to.
 *
 * It is session state: the list is not written to the settings file and does
 * not survive a restart. The palette is the thing that does.
 *
 * Choosing a colour here goes through the same setter the wheel, the
 * swatches and the canvas picker use, so it becomes the ink of the next
 * stroke, of the next shape, of the next fill and of the next gradient alike.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { SwatchGrid } from "./SwatchGrid";

export function RecentColors() {
  const { actions } = useEditor();
  const { colorHistory } = useEditorState();

  return (
    <section className="color-recent" aria-labelledby="color-recent-title">
      <div className="color-recent__header">
        <h3 className="color-recent__title" id="color-recent-title">
          Recent
        </h3>
        <button
          type="button"
          className="color-recent__clear"
          onClick={() => actions.clearColorHistory()}
          disabled={colorHistory.length === 0}
          title="Empty the recent-colours list"
        >
          Clear
        </button>
      </div>

      {colorHistory.length === 0 ? (
        <p className="color-recent__empty">
          Colours you pick appear here, newest first.
        </p>
      ) : (
        <SwatchGrid
          items={colorHistory}
          columns={8}
          groupLabel="Recent colours"
          renderItem={(color) => (
            <button
              key={color}
              type="button"
              className="swatch-grid__swatch"
              style={{ backgroundColor: color }}
              aria-label={`Use colour ${color}`}
              title={`${color} - right-click: alt colour`}
              data-swatch-focusable
              onClick={() => actions.setBrush({ color })}
              onContextMenu={(event) => {
                event.preventDefault();
                actions.setSecondaryColor(color);
              }}
            />
          )}
        />
      )}
    </section>
  );
}
