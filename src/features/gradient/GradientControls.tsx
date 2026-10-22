/**
 * The gradient group of the options bar.
 *
 * Shown only for the gradient tool. The start colour is the current brush
 * colour, so the two controls that matter are the type toggle and the
 * destination colour; the middle stops live in a popover, because they are
 * used rarely and take a lot of room.
 *
 * Like the fill tolerance, these describe the *next* drag; a committed
 * gradient carries its own copy of the type, the colours and the stops.
 */

import { Popover } from "../../components/toolbar/Popover";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { OptionControl } from "../options/OptionControl";
import { toolOptionFields } from "../options/toolOptionSchema";
import { GradientStopEditor } from "./GradientStopEditor";

export function GradientControls() {
  const { actions } = useEditor();
  const snapshot = useEditorState();
  const fields = toolOptionFields("gradient", snapshot.toolId, snapshot);

  return (
    <div className="gradient-options">
      <div className="tool-options__fields">
        {fields.map((option) => (
          <OptionControl key={option.id} option={option} snapshot={snapshot} actions={actions} />
        ))}
      </div>
      <Popover label="Stops" title="Middle stops of the next gradient">
        <GradientStopEditor />
      </Popover>
    </div>
  );
}
