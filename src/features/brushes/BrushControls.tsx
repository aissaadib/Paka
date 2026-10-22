/**
 * The brush controls: the preset picker, the live preview and the properties.
 *
 * The properties are not written out here. They come from the options schema,
 * the same table the rest of the options bar is built from, so the brush group
 * shows exactly the fields the active tool consumes - a shape has no
 * stabilizer and no dab spacing, and a control that changes nothing is worse
 * than no control at all - and every one of them writes through `setBrush`,
 * which is the path the colour picker and the preset picker use too.
 *
 * The two things that are not schema fields live here: the preset picker and
 * the pressure curve, which are widgets rather than fields, and the preview
 * and the reset button, which are about the brush as a whole.
 */

import { useState } from "react";
import { brushSettingsEqual, DEFAULT_BRUSH } from "../../core/brushes/defaults";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { useWorkspaceSettings } from "../../hooks/useWorkspace";
import { OptionControl } from "../options/OptionControl";
import { toolOptionFields } from "../options/toolOptionSchema";
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
import { BrushPreview } from "./BrushPreview";
import { PressureCurveEditor } from "./PressureCurveEditor";

export function BrushControls() {
  const { actions } = useEditor();
  const snapshot = useEditorState();
  const workspace = useWorkspaceSettings();
  const [curveOpen, setCurveOpen] = useState(false);
  const allFields = toolOptionFields("brush", snapshot.toolId, snapshot);
  // The compact brush panel keeps the size and the opacity - the two
  // properties a brush is judged by - and leaves the rest to the options
  // strip. The choice is a workspace preference, so it survives a restart.
  const fields = workspace.brushPanel.advanced
    ? allFields
    : allFields.filter(
        (option) => option.id === "brushSize" || option.id === "brushOpacity",
      );
  const pressureEnabled =
    snapshot.brush.pressureSize > 0 || snapshot.brush.pressureOpacity > 0;

  // The preset the brush is based on, if there is one. It holds the preset's
  // defaults, which stay apart from the edited values the next stroke uses.
  const origin =
    snapshot.activePresetId === null
      ? null
      : (snapshot.presets.find((preset) => preset.id === snapshot.activePresetId) ?? null);

  // What the reset restores: the preset's own values, or the default brush.
  // When the brush already holds them there is nothing to restore, so the
  // button says so by being disabled.
  const resetTarget = origin?.brush ?? DEFAULT_BRUSH;
  const canReset = !brushSettingsEqual(snapshot.brush, resetTarget);

  return (
    <div className="toolbar__group brush-controls">
      {workspace.brushPanel.presets ? <BrushPresets /> : null}
      <BrushPreview />
      {fields.map((option) => (
        <OptionControl
          key={option.id}
          option={option}
          snapshot={snapshot}
          actions={actions}
        />
      ))}
      {workspace.brushPanel.advanced && pressureEnabled ? (
        <button
          type="button"
          className="pressure-curve__toggle"
          aria-expanded={curveOpen}
          title="Shape how raw pen pressure maps to the size and opacity response"
          onClick={() => setCurveOpen((open) => !open)}
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
      {workspace.brushPanel.advanced && pressureEnabled && curveOpen ? (
        <PressureCurveEditor />
      ) : null}
      <button
        type="button"
        className="button brush-controls__reset"
        disabled={!canReset}
        title={
          origin === null
            ? "Restore the default brush"
            : `Restore the brush to the defaults of "${origin.name}"`
        }
        onClick={actions.resetBrush}
      >
        Reset
      </button>
    </div>
  );
}
