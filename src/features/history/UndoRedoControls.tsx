/** Undo/redo controls, driven by the command stack state. */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { IconRedo, IconUndo } from "../../components/icons";
import { IconButton } from "../../components/toolbar/IconButton";

export function UndoRedoControls() {
  const { actions } = useEditor();
  const { history } = useEditorState();

  return (
    <div className="toolbar__group">
      <IconButton
        label={history.undoLabel ? `Undo ${history.undoLabel}` : "Undo"}
        shortcut="Ctrl+Z"
        disabled={!history.canUndo}
        onClick={actions.undo}
      >
        <IconUndo />
      </IconButton>
      <IconButton
        label={history.redoLabel ? `Redo ${history.redoLabel}` : "Redo"}
        shortcut="Ctrl+Shift+Z"
        disabled={!history.canRedo}
        onClick={actions.redo}
      >
        <IconRedo />
      </IconButton>
    </div>
  );
}
