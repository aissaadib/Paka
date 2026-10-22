/**
 * One control of the options bar.
 *
 * The contract in `core/shell/toolOptions.ts` says what an option is; this
 * component says what it looks like. A slider is the shared `SliderField`, a
 * toggle is a checkbox, a colour is the native colour well, a select is a
 * native list, and a group is a fieldset of more controls.
 *
 * The dispatch on the option's kind is `optionControl` in
 * `core/options/optionControl.ts`, and it is exhaustive: a kind the contract
 * gains without a control to draw it is a compile error there and here, not a
 * blank space in the bar. The switch below covers the same kinds for the same
 * reason.
 *
 * Every control writes through `EditorActions`, so a control that is visible
 * is a control that changes something real.
 */

import type { ReactElement } from "react";
import { SliderField } from "../../components/toolbar/SliderField";
import type { EditorSnapshot } from "../../core/engine/DrawingEngine";
import { optionControl, type OptionControl as OptionControlSpec } from "../../core/options/optionControl";
import type { ToolOption } from "../../core/shell/toolOptions";
import type { EditorActions } from "../../state/editorStore";
import "./toolOptions.css";

export interface OptionControlProps {
  /** The option to draw. */
  readonly option: ToolOption;
  /** The snapshot the option reads its value from. */
  readonly snapshot: EditorSnapshot;
  /** The actions the option writes through. */
  readonly actions: EditorActions;
}

/** The control for one option, of any kind. */
export function OptionControl({ option, snapshot, actions }: OptionControlProps) {
  return <OptionControlView control={optionControl(option, snapshot, actions)} />;
}

export interface OptionControlViewProps {
  /** The control to draw. */
  readonly control: OptionControlSpec;
}

/** Draws a control the options bar has already resolved. */
export function OptionControlView({ control }: OptionControlViewProps) {
  switch (control.kind) {
    case "slider":
      return (
        <SliderField
          label={control.label}
          min={control.min}
          max={control.max}
          step={control.step}
          scale={control.scale}
          value={control.value}
          title={control.title}
          format={control.format}
          onChange={control.write}
        />
      );
    case "number":
      return (
        <label className="option-number" title={control.title}>
          <span className="option-number__label">{control.label}</span>
          <input
            className="option-number__input"
            type="number"
            min={control.min}
            max={control.max}
            step={control.step}
            value={control.value}
            aria-label={control.label}
            onChange={(event) => {
              const raw = event.target.value;
              // An empty field is not a value: it writes nothing rather than
              // snapping the option to zero.
              control.write(raw.trim() === "" ? Number.NaN : Number(raw));
            }}
          />
        </label>
      );
    case "toggle":
      return (
        <label className="toggle" title={control.title}>
          <input
            type="checkbox"
            checked={control.value}
            onChange={(event) => control.write(event.target.checked)}
          />
          {control.label}
        </label>
      );
    case "select":
      return (
        <label className="option-select" title={control.title}>
          <span className="option-select__label">{control.label}</span>
          <select
            className="option-select__input"
            value={control.value}
            aria-label={control.label}
            onChange={(event) => control.write(event.target.value)}
          >
            {control.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "color":
      return (
        <label className="option-color" title={control.title}>
          <span className="option-color__label">{control.label}</span>
          <input
            className="option-color__input"
            type="color"
            value={control.value}
            aria-label={control.label}
            onChange={(event) => control.write(event.target.value)}
          />
        </label>
      );
    case "group":
      return (
        <fieldset className="option-group" title={control.title}>
          <legend className="option-group__legend">{control.label}</legend>
          <div className="option-group__children">
            {control.children.map((child) => (
              <OptionControlView key={child.id} control={child} />
            ))}
          </div>
        </fieldset>
      );
    default:
      return unknownControl(control);
  }
}

/** Reached only by a kind this build does not know. */
function unknownControl(control: never): ReactElement {
  throw new Error(`Unknown tool option kind "${(control as OptionControlSpec).kind}".`);
}
