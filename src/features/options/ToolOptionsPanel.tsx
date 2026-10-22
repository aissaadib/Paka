/**
 * Renders one group's declarative options.
 *
 * The schema decides which fields a group has and which of them are visible
 * for the active tool; this component only maps a field onto the shared
 * control. Keeping the renderer this small is deliberate: a generic form
 * framework would be more code than the fields it replaces.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { OptionControl } from "./OptionControl";
import { toolOptionFields, type ToolOptionGroupId } from "./toolOptionSchema";

export interface ToolOptionsPanelProps {
  /** The group to render. */
  readonly groupId: ToolOptionGroupId;
}

export function ToolOptionsPanel({ groupId }: ToolOptionsPanelProps) {
  const { actions } = useEditor();
  const snapshot = useEditorState();
  const fields = toolOptionFields(groupId, snapshot.toolId, snapshot);

  if (fields.length === 0) {
    return null;
  }

  return (
    <div className="tool-options__fields">
      {fields.map((option) => (
        <OptionControl key={option.id} option={option} snapshot={snapshot} actions={actions} />
      ))}
    </div>
  );
}
