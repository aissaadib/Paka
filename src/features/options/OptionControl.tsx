/**
 * One control of the options bar.
 *
 * The schema decides *what* a control is; this component decides what it looks
 * like. A slider is the shared `SliderField`, a toggle is the toolbar's
 * checkbox, a colour is the native colour well and an action is a button that
 * is disabled while the action cannot run.
 *
 * Every control here writes through `EditorActions`, so a control that is
 * visible is a control that changes something real.
 */

import { SliderField } from "../../components/toolbar/SliderField";
import type { EditorSnapshot } from "../../core/engine/DrawingEngine";
import type { EditorActions } from "../../state/editorStore";
import {
  isToolOptionDisabled,
  toolOptionLabel,
  type ToolOption,
} from "./toolOptionSchema";

export interface OptionControlProps {
  readonly option: ToolOption;
  readonly snapshot: EditorSnapshot;
  readonly actions: EditorActions;
}

/** `input[type=color]` only accepts `#rrggbb`. */
function toColorInputValue(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
}

export function OptionControl({ option, snapshot, actions }: OptionControlProps) {
  const label = toolOptionLabel(option, snapshot);
  const disabled = isToolOptionDisabled(option, snapshot);

  if (option.kind === "action") {
    const title = option.shortcut
      ? `${option.title ?? label} (${option.shortcut})`
      : (option.title ?? label);
    return (
      <button
        type="button"
        className="option-action"
        title={title}
        aria-label={label}
        disabled={disabled}
        onClick={() => option.run(actions)}
      >
        {label}
      </button>
    );
  }

  if (option.kind === "toggle") {
    return (
      <label className="toggle" title={option.title ?? label}>
        <input
          type="checkbox"
          checked={option.read(snapshot)}
          disabled={disabled}
          onChange={(event) => option.write(actions, event.target.checked)}
        />
        {label}
      </label>
    );
  }

  if (option.kind === "select") {
    const entries = option.entries(snapshot);
    return (
      <label className="option-select" title={option.title ?? label}>
        <span className="option-select__label">{label}</span>
        <select
          className="option-select__control"
          aria-label={label}
          value={option.read(snapshot)}
          disabled={disabled}
          onChange={(event) => option.write(actions, event.target.value)}
        >
          {entries.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (option.kind === "color") {
    return (
      <label className="option-color" title={option.title ?? label}>
        <span className="option-color__label">{label}</span>
        <input
          type="color"
          className="color-controls__picker"
          aria-label={label}
          value={toColorInputValue(option.read(snapshot))}
          disabled={disabled}
          onChange={(event) => option.write(actions, event.target.value)}
        />
      </label>
    );
  }

  return (
    <SliderField
      label={label}
      min={option.min}
      max={option.max}
      step={option.step}
      scale={option.scale}
      value={option.read(snapshot)}
      title={option.title}
      format={option.format}
      disabled={disabled}
      keyboardStep={option.keyboardStep}
      onChange={(value) => option.write(actions, value)}
    />
  );
}
