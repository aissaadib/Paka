/**
 * Numeric slider field: label + range + exact number input.
 *
 * Supports a logarithmic scale so brush size stays usable from 1 px to 512 px.
 *
 * The number box is treated as a text field first. It keeps what the user
 * typed until the text is a number the field accepts, so clearing the box to
 * type a new value does not snap the brush to its minimum, and a value that is
 * out of range is corrected in place rather than silently ignored.
 *
 * The keyboard moves the value in three steps: an arrow key moves it by the
 * field's own step, Shift + arrow by a tenth of that (the fine adjustment),
 * and Page Up / Page Down by ten times it.
 */

import { useEffect, useState, type KeyboardEvent } from "react";
import {
  clampNumber,
  parseNumericInput,
  stepSize,
  stepValue,
  type StepMode,
} from "../../core/brushes/numericInput";
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
  /**
   * The step a key press moves the value by.
   *
   * The default moves by the field's own step. A control whose step should
   * depend on the value - the brush size, which moves by a pixel when it is
   * small and by a tenth of itself when it is large - supplies its own.
   */
  readonly keyboardStep?: (
    current: number,
    direction: 1 | -1,
    mode: StepMode,
  ) => number;
}

const SLIDER_RESOLUTION = 1000;

/** The text the number box shows for a value. */
function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** The direction a key moves a value in, or `0` when it does not move it. */
function keyDirection(key: string): 1 | -1 | 0 {
  switch (key) {
    case "ArrowUp":
    case "ArrowRight":
    case "PageUp":
      return 1;
    case "ArrowDown":
    case "ArrowLeft":
    case "PageDown":
      return -1;
    default:
      return 0;
  }
}

/** The step a key press asks for. */
function keyMode(key: string, shift: boolean): StepMode {
  if (key === "PageUp" || key === "PageDown") {
    return "coarse";
  }
  return shift ? "fine" : "normal";
}

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
  keyboardStep,
}: SliderFieldProps) {
  // What the user has typed, while they are typing it. `null` means the box
  // shows the value.
  const [draft, setDraft] = useState<string | null>(null);
  const display = format ? format(value) : String(value);

  const sliderValue =
    scale === "log"
      ? Math.round(toLogPosition(value, min, max) * SLIDER_RESOLUTION)
      : Math.min(Math.max(value, min), max);

  const sliderStep = scale === "log" ? 1 : step;
  const sliderMin = scale === "log" ? 0 : min;
  const sliderMax = scale === "log" ? SLIDER_RESOLUTION : max;

  // A value that changed under the box replaces what was typed, so the box
  // shows the value the editor actually holds. A value that is still the one
  // that was typed is left alone, so the caret does not jump while typing.
  useEffect(() => {
    setDraft((current) => {
      if (current === null) {
        return null;
      }
      const parsed = parseNumericInput(current);
      return parsed !== null && parsed !== value ? null : current;
    });
  }, [value]);

  const handleSlider = (raw: number) => {
    if (scale === "log") {
      onChange(fromLogPosition(raw / SLIDER_RESOLUTION, min, max));
      return;
    }
    onChange(raw);
  };

  const moveByKeyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction = keyDirection(event.key);
    if (direction === 0) {
      return;
    }
    event.preventDefault();
    // The box shows the value again: whatever was typed into it is not a
    // number the field can move from.
    setDraft(null);
    const mode = keyMode(event.key, event.shiftKey);
    const next = keyboardStep
      ? keyboardStep(value, direction, mode)
      : stepValue(value, direction * stepSize(step, mode), min, max);
    onChange(clampNumber(next, min, max));
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
        onKeyDown={moveByKeyboard}
        onChange={(event) => handleSlider(Number(event.target.value))}
      />
      <input
        className="slider-field__value"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        role="spinbutton"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        value={draft ?? displayNumber(value)}
        disabled={disabled}
        aria-label={`${label} (exact value)`}
        onKeyDown={moveByKeyboard}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = parseNumericInput(text);
          if (parsed !== null) {
            onChange(clampNumber(parsed, min, max));
          }
        }}
        onBlur={() => setDraft(null)}
      />
      <span className="slider-field__display">{display}</span>
    </div>
  );
}
