/**
 * The brush controls: the preset picker and the brush's properties.
 *
 * The properties are **not** written out here. They come from the property
 * model (`core/brushes/brushProperties.ts`), the one table of what a brush
 * can be asked to do, so the controls cannot offer a field the engine does
 * not honour and cannot show a range the engine would refuse. Every one of
 * them writes through `setBrush`, which is the path the colour picker and
 * the preset picker use too.
 *
 * The two things that are not properties live here: the preset picker and the
 * pressure curve, which are widgets rather than fields.
 */

import { useState } from "react";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { SliderField } from "../../components/toolbar/SliderField";
import {
  brushPropertyControlValue,
  brushPropertyFormat,
  brushPropertyPatch,
  brushPropertyRange,
  brushPropertiesFor,
  type BrushSliderProperty,
} from "../../core/brushes/brushProperties";
import { BrushPreview } from "./BrushPreview";
import { BrushPresets } from "./BrushPresets";
import { PressureCurveEditor } from "./PressureCurveEditor";

export function BrushControls() {
  const { actions } = useEditor();
  const { brush } = useEditorState();
  const [curveOpen, setCurveOpen] = useState(false);
  const pressureEnabled = brush.pressureSize > 0 || brush.pressureOpacity > 0;

  return (
    <div className="toolbar__group brush-controls">
      {/* The live swatch: what this brush will paint, painted by the engine's
          own rasterizer. The size is read from the slider below it. */}
      <BrushPreview />
      <BrushPresets />
      {brushPropertiesFor(brush).map((property) => {
        if (property.kind === "toggle") {
          return (
            <label key={property.id} className="toggle" title={property.title}>
              <input
                type="checkbox"
                checked={property.read(brush)}
                onChange={(event) => actions.setBrush(property.write(event.target.checked))}
              />
              {property.label}
            </label>
          );
        }
        return (
          <BrushSlider
            key={property.id}
            property={property}
            value={brushPropertyControlValue(property, brush[property.id])}
            onChange={(value) => actions.setBrush(brushPropertyPatch(property, value))}
          />
        );
      })}
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

/** One slider, as the property model describes it. */
function BrushSlider({
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
