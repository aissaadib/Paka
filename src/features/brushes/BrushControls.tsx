/**
 * The brush controls, split by how often they are reached for.
 *
 * The property model (`core/brushes/brushProperties.ts`) is the one table of
 * what a brush can be asked to do, and it says which tier each field belongs
 * to. This file only draws the two tiers:
 *
 *  - **primary** - size, opacity and hardness, beside the preset picker in
 *    the options bar. These are the values a stroke is adjusted with while
 *    drawing, so they never leave the screen.
 *  - **advanced** - sampling, stabilizer, texture, the stamp and the pressure
 *    switches, in the bar's "Brush settings" panel. They are set once and
 *    then left alone; a permanent row of them made the toolbar three rows
 *    tall and pushed the canvas down.
 *
 * Neither tier is a second registry: both read the same table and write
 * through the same `setBrush` path, so a field cannot exist in one place and
 * be missing from the other.
 */

import { useState } from "react";
import { SliderField } from "../../components/toolbar/SliderField";
import {
  advancedBrushProperties,
  brushPropertyControlValue,
  brushPropertyFormat,
  brushPropertyPatch,
  brushPropertyRange,
  primaryBrushProperties,
  type BrushProperty,
  type BrushSliderProperty,
} from "../../core/brushes/brushProperties";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import type { BrushSettings } from "../../types/brush";
import { BrushPresetControls } from "./BrushPresets";
import { BrushPreview } from "./BrushPreview";
import { PressureCurveEditor } from "./PressureCurveEditor";

/** The stroke controls: always in the options bar. */
export function BrushPrimaryControls() {
  const { actions } = useEditor();
  const { brush } = useEditorState();

  return (
    <div className="brush-primary">
      <BrushPreview />
      <BrushPresetControls />
      {primaryBrushProperties(brush).map((property) => (
        <BrushPropertyControl
          key={property.id}
          property={property}
          brush={brush}
          onChange={actions.setBrush}
        />
      ))}
    </div>
  );
}

/** The settings, behind the options bar's "Brush settings" panel. */
export function BrushAdvancedControls() {
  const { actions } = useEditor();
  const { brush } = useEditorState();
  const [curveOpen, setCurveOpen] = useState(false);
  const pressureEnabled = brush.pressureSize > 0 || brush.pressureOpacity > 0;

  return (
    <div className="brush-advanced">
      <p className="brush-advanced__hint">
        The shape of the stroke. Size, opacity and hardness stay in the options bar.
      </p>
      {advancedBrushProperties(brush).map((property) => (
        <BrushPropertyControl
          key={property.id}
          property={property}
          brush={brush}
          onChange={actions.setBrush}
        />
      ))}
      {pressureEnabled ? (
        <button
          type="button"
          className="brush-advanced__curve-toggle"
          aria-expanded={curveOpen}
          title="Shape how raw pen pressure maps to the size and opacity response"
          onClick={() => setCurveOpen((open) => !open)}
        >
          {curveOpen ? "Hide pressure curve" : "Pressure curve"}
        </button>
      ) : null}
      {pressureEnabled && curveOpen ? <PressureCurveEditor /> : null}
    </div>
  );
}

/** One property, as the table describes it. */
function BrushPropertyControl({
  property,
  brush,
  onChange,
}: {
  readonly property: BrushProperty;
  readonly brush: BrushSettings;
  readonly onChange: (patch: Partial<BrushSettings>) => void;
}) {
  if (property.kind === "toggle") {
    return (
      <label className="toggle" title={property.title}>
        <input
          type="checkbox"
          checked={property.read(brush)}
          onChange={(event) => onChange(property.write(event.target.checked))}
        />
        {property.label}
      </label>
    );
  }
  return (
    <BrushSliderField
      property={property}
      value={brushPropertyControlValue(property, brush[property.id])}
      onChange={(value) => onChange(brushPropertyPatch(property, value))}
    />
  );
}

/** One slider, as the property model describes it. */
function BrushSliderField({
  property,
  value,
  onChange,
}: {
  readonly property: BrushSliderProperty;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const range = brushPropertyRange(property);
  return (
    <SliderField
      label={property.label}
      min={range.min}
      max={range.max}
      step={property.step}
      scale={property.scale}
      value={value}
      title={property.title}
      format={(shown) => brushPropertyFormat(property, shown)}
      keyboardStep={property.keyboardStep}
      onChange={onChange}
    />
  );
}
