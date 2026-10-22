/**
 * The brush group of the options bar.
 *
 * The size and the opacity stay in the strip, because they change with every
 * stroke. The rest of the brush - the edge, the sampling, the stabilizer, the
 * grain, the dab engine and the pressure response - lives in a popover, so
 * the strip stays one row tall and every control stays reachable.
 *
 * A tool that does not paint with a brush has no brush group at all, and a
 * tool that uses only part of the brush - a shape, a gradient - shows only
 * the fields it really reads. A control that cannot change what the tool
 * draws is not offered.
 */

import { Popover } from "../../components/toolbar/Popover";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { OptionControl } from "../options/OptionControl";
import {
  toolOptionFields,
  toolUsesWholeBrush,
  type ToolOption,
} from "../options/toolOptionSchema";
import { BrushPresets } from "./BrushPresets";
import { PressureCurveEditor } from "./PressureCurveEditor";

function isPopoverOption(option: ToolOption): boolean {
  return option.placement === "popover";
}

export function BrushControls() {
  const { actions } = useEditor();
  const snapshot = useEditorState();
  const fields = toolOptionFields("brush", snapshot.toolId, snapshot);
  const inline = fields.filter((option) => !isPopoverOption(option));
  const advanced = fields.filter(isPopoverOption);

  // The pressure curve only means something for a tool that reacts to
  // pressure, and only while pressure is switched on at all.
  const usesPressure = advanced.some((option) => option.brushField === "pressureSize");
  const pressureEnabled =
    snapshot.brush.pressureSize > 0 || snapshot.brush.pressureOpacity > 0;
  const showCurve = usesPressure && pressureEnabled;
  // The preset picker replaces the whole brush, so it belongs to the tools that
  // use the whole brush.
  const showPresets = toolUsesWholeBrush(snapshot.toolId);

  return (
    <div className="brush-options">
      <div className="tool-options__fields">
        {inline.map((option) => (
          <OptionControl
            key={option.id}
            option={option}
            snapshot={snapshot}
            actions={actions}
          />
        ))}
      </div>
      {advanced.length > 0 || showPresets || showCurve ? (
        <Popover
          label="Brush settings"
          title="The rest of the brush: edge, sampling, grain, dabs and pressure"
        >
          <div className="tool-options__fields tool-options__fields--stacked">
            {advanced.map((option) => (
              <OptionControl
                key={option.id}
                option={option}
                snapshot={snapshot}
                actions={actions}
              />
            ))}
          </div>
          {showPresets ? <BrushPresets /> : null}
          {showCurve ? <PressureCurveEditor /> : null}
        </Popover>
      ) : null}
    </div>
  );
}
