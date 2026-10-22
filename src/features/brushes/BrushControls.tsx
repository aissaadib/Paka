/** Brush size, opacity and pressure mapping controls. */

import { useState } from "react";
import {
  MAX_BRUSH_SIZE,
  MAX_SPACING,
  MAX_STAMP_ASPECT,
  MAX_STAMP_SPACING,
  MIN_BRUSH_SIZE,
  MIN_SPACING,
  MIN_STAMP_ASPECT,
  MIN_STAMP_SPACING,
} from "../../core/brushes/defaults";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { SliderField } from "../../components/toolbar/SliderField";
import { BrushPresets } from "./BrushPresets";
import { PressureCurveEditor } from "./PressureCurveEditor";
import type { StampTipKind } from "../../types/brush";

/** Pressure strength applied by the on/off toggles. */
const PRESSURE_STRENGTH = 0.6;

/** The tips a brush can be stamped with, in the order the picker shows them. */
const TIP_CHOICES: readonly { readonly value: StampTipKind; readonly label: string }[] = [
  { value: "round", label: "Round" },
  { value: "ellipse", label: "Ellipse" },
  { value: "square", label: "Square" },
];

export function BrushControls() {
  const { actions } = useEditor();
  const { brush } = useEditorState();
  const [curveOpen, setCurveOpen] = useState(false);
  const pressureEnabled = brush.pressureSize > 0 || brush.pressureOpacity > 0;

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
          />
          <SliderField
            label="Stamp hardness"
            min={0}
            max={1}
            step={0.01}
            value={brush.stampHardness}
            title="Falloff of a single dab; 100% is a crisp dab edge, lower values soften it towards the centre"
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(stampHardness) => actions.setBrush({ stampHardness })}
          />
          <SliderField
            label="Stamp texture"
            min={0}
            max={1}
            step={0.01}
            value={brush.stampTexture}
            title="Bristle lanes along the stroke; 0% is the plain round dab and 100% is the full effect"
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(stampTexture) => actions.setBrush({ stampTexture })}
          />
          <label
            className="brush-tip__field"
            title="The shape of the dab's tip: a round disc, an ellipse or a square"
          >
            <span className="brush-tip__label">Tip</span>
            <select
              className="brush-tip__select"
              aria-label="Stamp tip"
              value={brush.stampTip}
              onChange={(event) =>
                actions.setBrush({ stampTip: event.target.value as StampTipKind })
              }
            >
              {TIP_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          {brush.stampTip === "round" ? null : (
            <>
              <SliderField
                label="Tip roundness"
                min={MIN_STAMP_ASPECT * 100}
                max={MAX_STAMP_ASPECT * 100}
                step={1}
                value={brush.stampAspect * 100}
                title="The tip's short axis as a percentage of its long one; the brush size is the long axis"
                format={(value) => `${Math.round(value)}%`}
                onChange={(stampAspect) => actions.setBrush({ stampAspect: stampAspect / 100 })}
              />
              <SliderField
                label="Tip angle"
                min={0}
                max={359}
                step={1}
                value={brush.stampAngle}
                title="The tip's angle in degrees; with 'Follow direction' on it is the angle away from the stroke's direction"
                format={(value) => `${Math.round(value)}°`}
                onChange={(stampAngle) => actions.setBrush({ stampAngle })}
              />
              <label
                className="toggle"
                title="Turn the tip with the stroke, the way a flat or chisel brush does"
              >
                <input
                  type="checkbox"
                  checked={brush.stampAngleFollow}
                  onChange={(event) =>
                    actions.setBrush({ stampAngleFollow: event.target.checked })
                  }
                />
                Follow direction
              </label>
            </>
          )}
        </>
      ) : null}
      <label
        className="toggle"
        title="Pen pressure controls stroke width (ignored by mouse input)"
      >
        <input
          type="checkbox"
          checked={brush.pressureSize > 0}
          onChange={(event) =>
            actions.setBrush({ pressureSize: event.target.checked ? PRESSURE_STRENGTH : 0 })
          }
        />
        Pressure size
      </label>
      <label className="toggle" title="Pen pressure controls stroke opacity">
        <input
          type="checkbox"
          checked={brush.pressureOpacity > 0}
          onChange={(event) =>
            actions.setBrush({ pressureOpacity: event.target.checked ? PRESSURE_STRENGTH : 0 })
          }
        />
        Pressure opacity
      </label>
      {pressureEnabled ? (
        <button
          type="button"
          className="pressure-curve__toggle"
          aria-expanded={curveOpen}
          title="Shape how raw pen pressure maps to the size and opacity response"
          onClick={() => setCurveOpen((open) => !open)}
        >
          Pressure curve
        </button>
      ) : null}
      {pressureEnabled && curveOpen ? <PressureCurveEditor /> : null}
    </div>
  );
}
