/**
 * The HSV colour wheel.
 *
 * The wheel is one view of the brush colour: the disc picks a hue and a
 * saturation, the value slider picks the brightness, and the brush keeps
 * storing a plain `#rrggbb`. The component therefore owns no colour state of
 * its own - it reads the brush colour, converts it to HSV for the controls,
 * and writes the converted colour straight back through `setBrush`, the same
 * path the toolbar's colour input, the swatches and the canvas picker use. So
 * a colour picked from the canvas moves the wheel, and a colour chosen on the
 * wheel is the colour the next stroke is painted with.
 *
 * Changing the colour is not an edit: it sets session state for the next
 * gesture, exactly like the rest of the brush controls, so it pushes no
 * history entry and never marks the document dirty.
 */

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { hexToHsv, hsvToHex } from "../../utils/color";
import type { Hsv } from "../../utils/color";
import { hsvToWheelPoint, resolveWheelHsv, wheelPointToHsv } from "./wheelGeometry";
import { createWheelState, reduceWheelState } from "./wheelState";
import type { WheelState } from "./wheelState";

/** The disc's diameter in CSS pixels; the marker is placed in percentages, so
 * the disc may be restyled to another size without touching the maths. */
const WHEEL_SIZE = 148;

interface WheelSliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly display: string;
  readonly onChange: (value: number) => void;
}

function WheelSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: WheelSliderProps) {
  return (
    <label className="color-wheel__slider">
      <span className="color-wheel__slider-label">{label}</span>
      <input
        className="color-wheel__slider-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={display}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="color-wheel__slider-value">{display}</span>
    </label>
  );
}

export function ColorWheel() {
  const { actions } = useEditor();
  const { brush } = useEditorState();
  const dragging = useRef(false);

  // The colour the brush holds, read back as HSV. This is what the wheel
  // shows whenever the colour was set anywhere else - the toolbar's colour
  // input, the swatches, the canvas picker.
  const stored: Hsv = hexToHsv(brush.color) ?? { h: 0, s: 0, v: 0 };

  // The hue and saturation the *user* asked for, which are not always the
  // ones the colour can hold; `resolveWheelHsv` decides which of the two the
  // wheel shows.
  const [state, setState] = useState<WheelState>(() => createWheelState(brush.color));

  // The brush colour is the authority. When it changes and the wheel did not
  // write the change, another source did - the toolbar's colour input, a
  // swatch, the canvas picker - and the request is stale: the wheel would be
  // showing a hue the brush does not have. The state is reconciled here,
  // during the render, so the wheel never shows the stale hue at all.
  let current = state;
  if (current.observed !== brush.color) {
    current = reduceWheelState(current, { kind: "brush-changed", color: brush.color });
    setState(current);
  }

  const hsv: Hsv = resolveWheelHsv(stored, current.requested, current.written, brush.color);

  const marker = hsvToWheelPoint(hsv.h, hsv.s, WHEEL_SIZE);

  const apply = (next: Hsv) => {
    const color = hsvToHex(next);
    setState((previous) => reduceWheelState(previous, { kind: "picked", hsv: next, color }));
    actions.setBrush({ color });
  };

  const pickFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const picked = wheelPointToHsv(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
    );
    apply({ h: picked.h, s: picked.s, v: hsv.v });
  };

  return (
    <div className="color-wheel">
      <div
        className="color-wheel__disc"
        role="presentation"
        aria-hidden="true"
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          pickFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) {
            pickFromPointer(event);
          }
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          dragging.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      >
        <div
          className="color-wheel__shade"
          style={{ opacity: Math.max(0, 1 - hsv.v) }}
        />
        <div
          className="color-wheel__marker"
          style={{
            left: `${(marker.x / WHEEL_SIZE) * 100}%`,
            top: `${(marker.y / WHEEL_SIZE) * 100}%`,
            background: brush.color,
          }}
        />
      </div>

      <div className="color-wheel__controls">
        <WheelSlider
          label="Hue"
          value={Math.round(hsv.h)}
          min={0}
          max={360}
          step={1}
          display={`${Math.round(hsv.h)}°`}
          onChange={(h) => apply({ ...hsv, h })}
        />
        <WheelSlider
          label="Saturation"
          value={Math.round(hsv.s * 100)}
          min={0}
          max={100}
          step={1}
          display={`${Math.round(hsv.s * 100)}%`}
          onChange={(s) => apply({ ...hsv, s: s / 100 })}
        />
        <WheelSlider
          label="Value"
          value={Math.round(hsv.v * 100)}
          min={0}
          max={100}
          step={1}
          display={`${Math.round(hsv.v * 100)}%`}
          onChange={(v) => apply({ ...hsv, v: v / 100 })}
        />
      </div>

      <div className="color-wheel__readout">
        <span
          className="color-wheel__swatch"
          style={{ background: brush.color }}
          aria-hidden="true"
        />
        <span className="color-wheel__hex">{brush.color}</span>
      </div>
    </div>
  );
}
