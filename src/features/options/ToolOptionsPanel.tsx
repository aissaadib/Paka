/**
 * Renders the active tool's declarative options.
 *
 * The schema decides which fields exist; this component only hands them to
 * the shared control. There is one renderer for every kind of option, so a
 * feature that registers an option of a kind this file has never seen still
 * gets a control rather than a blank space.
 */

import { visibleToolOptions } from "../../core/shell/toolOptions";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { OptionControl } from "./OptionControl";

export function ToolOptionsPanel() {
  const { actions } = useEditor();
  const snapshot = useEditorState();
  const options = visibleToolOptions(snapshot.toolId, snapshot);

  if (options.length === 0) {
    return null;
  }

  return (
    <>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        {options.map((option) => (
          <OptionControl
            key={option.id}
            option={option}
            snapshot={snapshot}
            actions={actions}
          />
        ))}
      </div>
    </>
  );
}
