/**
 * View controls: the buttons that change how the canvas is seen.
 *
 * A rotation, a mirror and a reset are **view state**: they change where the
 * artwork is seen, never what the artwork is. The document's pixels, its
 * history and its dirty flag are untouched by every button here, so a user can
 * turn the paper over to look at something and the file stays saved.
 *
 * The buttons report the view's real state - the mirror button is lit while
 * the view is mirrored, and the rotate button says how far the view is turned
 * - so the toolbar never claims a state the canvas is not in.
 */

import { IconMirrorView, IconResetView, IconRotateView } from "../../components/icons";
import { IconButton } from "../../components/toolbar/IconButton";
import { viewTransformOf } from "../../core/rendering/viewport";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { VIEW_ROTATION_DEGREES } from "./viewNavigation";

export function ViewControls() {
  const { actions } = useEditor();
  const { viewport } = useEditorState();
  const transform = viewTransformOf(viewport);
  const degrees = Math.round((transform.rotation * 180) / Math.PI);

  return (
    <div className="toolbar__group">
      <IconButton
        label={`Rotate the view ${VIEW_ROTATION_DEGREES}° clockwise (now ${degrees}°)`}
        shortcut="Shift+R"
        onClick={() => actions.rotateView(VIEW_ROTATION_DEGREES)}
      >
        <IconRotateView />
      </IconButton>
      <IconButton
        label={
          transform.mirrored
            ? "Undo the view's mirror"
            : "Mirror the view left to right"
        }
        shortcut="Shift+M"
        active={transform.mirrored}
        onClick={actions.toggleViewMirror}
      >
        <IconMirrorView />
      </IconButton>
      <IconButton
        label="Reset the view: the whole document, upright"
        shortcut="Ctrl+Shift+0"
        onClick={actions.resetView}
      >
        <IconResetView />
      </IconButton>
    </div>
  );
}
