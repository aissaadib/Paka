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
    <div className="toolbar__group brush-controls">
      <BrushPresets />
      <SliderField
        label="Size"
        scale="log"
        min={MIN_BRUSH_SIZE}
        max={MAX_BRUSH_SIZE}
        step={1}
        value={brush.size}
        title="Brush size in document pixels. Ctrl+Alt and drag on the canvas to resize the brush; [ and ] step the size and Alt+[ and Alt+] change it by one pixel. Escape cancels a resize in progress"
        format={(value) => `${Math.round(value)} px`}
        onChange={(size) => actions.setBrush({ size })}
      />
      <SliderField
        label="Opacity"
        min={0}
        max={1}
        step={0.01}
        value={brush.opacity}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(opacity) => actions.setBrush({ opacity })}
      />
      <SliderField
        label="Hardness"
        min={0}
        max={1}
        step={0.01}
        value={brush.hardness}
        title="Edge falloff: 100% is a crisp edge, lower values soften it"
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(hardness) => actions.setBrush({ hardness })}
      />
      <SliderField
        label="Sampling"
        min={MIN_SPACING * 100}
        max={MAX_SPACING * 100}
        step={1}
        value={brush.spacing * 100}
        title="Gap between interpolated samples as a percentage of brush size; lower values smooth fast strokes at a memory cost. This is the sample density, not the dab spacing of the stamp"
        format={(value) => `${Math.round(value)}%`}
        onChange={(spacing) => actions.setBrush({ spacing: spacing / 100 })}
      />
      <SliderField
        label="Stabilizer"
        min={0}
        max={1}
        step={0.01}
        value={brush.stabilizer}
        title="Smooths the pointer path; 0% follows the pointer exactly and 100% lags the most"
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(stabilizer) => actions.setBrush({ stabilizer })}
      />
      <SliderField
        label="Texture"
        min={0}
        max={1}
        step={0.01}
        value={brush.texture}
        title="Document-anchored grain over the finished stroke; 0% is the plain edge"
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(texture) => actions.setBrush({ texture })}
      />
      <label
        className="toggle"
        title="Draw the stroke as a chain of round dabs instead of continuous segments"
      >
        <input
          type="checkbox"
          checked={brush.stamp}
          onChange={(event) => actions.setBrush({ stamp: event.target.checked })}
        />
        Stamp
      </label>
      {brush.stamp ? (
        <>
          <SliderField
            label="Stamp spacing"
            min={MIN_STAMP_SPACING * 100}
            max={MAX_STAMP_SPACING * 100}
            step={1}
            value={brush.stampSpacing * 100}
            title="Distance between dabs as a percentage of the brush size; this is not the sample density above"
            format={(value) => `${Math.round(value)}%`}
            onChange={(stampSpacing) => actions.setBrush({ stampSpacing: stampSpacing / 100 })}
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
