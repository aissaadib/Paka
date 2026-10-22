/**
 * Numeric slider field: label + range + exact number input.
 *
 * Supports a logarithmic scale so brush size stays usable from 1 px to 512 px.
 */

import { fromLogPosition, toLogPosition } from "../../utils/math";

export interface SliderFieldProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly scale?: "linear" | "log";
  readonly format?: (value: number) => string;
  readonly onChange: (value: number) => void;
  readonly disabled?: boolean;
  readonly title?: string;
}

const SLIDER_RESOLUTION = 1000;

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  scale = "linear",
  format,
  onChange,
  disabled = false,
  title,
}: SliderFieldProps) {
  const display = format ? format(value) : String(value);

  const sliderValue =
    scale === "log"
      ? Math.round(toLogPosition(value, min, max) * SLIDER_RESOLUTION)
      : Math.min(Math.max(value, min), max);

  const sliderStep = scale === "log" ? 1 : step;
  const sliderMin = scale === "log" ? 0 : min;
  const sliderMax = scale === "log" ? SLIDER_RESOLUTION : max;

  const handleSlider = (raw: number) => {
    if (scale === "log") {
      onChange(fromLogPosition(raw / SLIDER_RESOLUTION, min, max));
      return;
    }
    onChange(raw);
  };

  return (
    <div className="slider-field" title={title}>
      <span className="slider-field__label">{label}</span>
      <input
        className="slider-field__range"
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={sliderStep}
        value={sliderValue}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => handleSlider(Number(event.target.value))}
      />
      <input
        className="slider-field__value"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isInteger(value) ? value : Number(value.toFixed(2))}
        disabled={disabled}
        aria-label={`${label} (exact value)`}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) {
            onChange(Math.min(Math.max(next, min), max));
          }
        }}
      />
      {/* The readout only earns its place when it says something the number
          box does not: the unit. Without a format it would only repeat the
          number next to itself. */}
      {format ? <span className="slider-field__display">{display}</span> : null}
    </div>
  );
}
