/**
 * Turning a tool option into a control.
 *
 * The contract in `core/shell/toolOptions.ts` says what an option *is*; this
 * module says what the options bar has to draw for it. A slider is a range
 * with a number box, a toggle is a checkbox, a colour is the native colour
 * well, a select is a native list, and a group is a row of other controls.
 *
 * **The dispatch on the option's kind lives here and nowhere else.** The
 * contract lists the kinds; the table below turns each of them into the
 * control that draws it, and the table is exhaustive against that list: a
 * kind the contract gains without a builder here is a compile error in this
 * file, and in no other. The options bar draws the *control*, so it never
 * has to learn a new kind - the React component's switch is over the
 * drawings, which are a list of their own.
 *
 * A kind this build does not know is refused rather than drawn as a blank
 * space: the lookup finds no builder and the option is an error.
 *
 * It is pure on purpose. The React layer is a thin shell over it, so the
 * whole table of controls can be checked without a browser.
 */

import type { EditorSnapshot } from "../engine/DrawingEngine";
import {
  toolOptionLabel,
  type ColorToolOption,
  type GroupToolOption,
  type NumberToolOption,
  type SelectToolOption,
  type SliderToolOption,
  type ToggleToolOption,
  type ToolOption,
  type ToolOptionKind,
} from "../shell/toolOptions";
import type { EditorActions } from "../../state/editorStore";
import { parseHexColor, rgbToHex } from "../../utils/color";
import { clamp } from "../../utils/math";

/** What every control knows about the option it shows. */
export interface OptionControlBase {
  /** The option's id, unique within its tool. */
  readonly id: string;
  /** The label the control shows. */
  readonly label: string;
  /** The tooltip, when the option has one. */
  readonly title?: string;
}

/** A continuous value, dragged or typed. */
export interface SliderControl extends OptionControlBase {
  readonly kind: "slider";
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly scale?: "linear" | "log";
  readonly format?: (value: number) => string;
  readonly write: (value: number) => void;
}

/** A number typed into a field. */
export interface NumberControl extends OptionControlBase {
  readonly kind: "number";
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly integer: boolean;
  readonly format?: (value: number) => string;
  readonly write: (value: number) => void;
}

/** A flag. */
export interface ToggleControl extends OptionControlBase {
  readonly kind: "toggle";
  readonly value: boolean;
  readonly write: (value: boolean) => void;
}

/** One of a fixed set of values. */
export interface SelectControl extends OptionControlBase {
  readonly kind: "select";
  readonly value: string;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly write: (value: string) => void;
}

/** A colour. */
export interface ColorControl extends OptionControlBase {
  readonly kind: "color";
  /** The colour as `#rrggbb`, the only form the native well understands. */
  readonly value: string;
  readonly write: (value: string) => void;
}

/** A row of other options, shown together. */
export interface GroupControl extends OptionControlBase {
  readonly kind: "group";
  readonly children: readonly OptionControl[];
}

/**
 * The control an option is drawn as.
 *
 * The kinds are the *drawings*, not the contract's option kinds, and the two
 * lists are separate on purpose: a new kind of option is drawn with one of
 * these, so the options bar's own switch does not grow when the contract
 * gains a kind. A drawing that does not exist yet is a change to this file
 * and to the options bar, which is a deliberate change rather than a side
 * effect of adding an option.
 */
export type OptionControl =
  | SliderControl
  | NumberControl
  | ToggleControl
  | SelectControl
  | ColorControl
  | GroupControl;

/** The name of a drawing. */
export type OptionControlKind = OptionControl["kind"];

/** Every drawing, in the order the contract lists its kinds. */
export const OPTION_CONTROL_KINDS: readonly OptionControlKind[] = Object.freeze([
  "slider",
  "number",
  "toggle",
  "select",
  "color",
  "group",
]);

/** The builder for one kind of option. */
type OptionBuilder<K extends ToolOptionKind> = (
  option: Extract<ToolOption, { readonly kind: K }>,
  snapshot: EditorSnapshot,
  actions: EditorActions,
) => OptionControl;

/** A builder that takes any option: the table's entries, seen from outside. */
type AnyOptionBuilder = (
  option: ToolOption,
  snapshot: EditorSnapshot,
  actions: EditorActions,
) => OptionControl;

/**
 * The dispatch from a kind of option to the control that draws it.
 *
 * The table is exhaustive against the contract's kinds, and the mapped type
 * is what says so: a kind the contract gains without a builder here is a
 * compile error in this file and in no other.
 */
const CONTROL_BUILDERS = {
  slider: sliderControl,
  number: numberControl,
  toggle: toggleControl,
  select: selectControl,
  color: colorControl,
  group: groupControl,
} satisfies { [K in ToolOptionKind]: OptionBuilder<K> };

/** The builder for a kind, or `undefined` for a kind this build does not know. */
function builderFor(kind: string): AnyOptionBuilder | undefined {
  return (
    CONTROL_BUILDERS as unknown as Record<string, AnyOptionBuilder | undefined>
  )[kind];
}

/**
 * The control for an option.
 *
 * The lookup is exhaustive over the kinds the contract lists: every one of
 * them has a builder above. A kind this build does not know - an option that
 * came from somewhere untyped, or a contract this build is older than - has
 * no builder, and is refused rather than drawn as a blank space.
 */
export function optionControl(
  option: ToolOption,
  snapshot: EditorSnapshot,
  actions: EditorActions,
): OptionControl {
  const builder = builderFor(option.kind);
  if (!builder) {
    throw new Error(`Unknown tool option kind "${option.kind}".`);
  }
  return builder(option, snapshot, actions);
}

/** The control for a continuous option. */
export function sliderControl(
  option: SliderToolOption,
  snapshot: EditorSnapshot,
  actions: EditorActions,
): SliderControl {
  return {
    id: option.id,
    kind: "slider",
    label: toolOptionLabel(option, snapshot),
    title: option.title,
    value: optionNumberValue(option.read(snapshot), option.min, option.max),
    min: option.min,
    max: option.max,
    step: option.step,
    scale: option.scale,
    format: option.format,
    write: (value) => option.write(actions, value),
  };
}

/**
 * The control for a number option.
 *
 * The write keeps the value on the option's step: the number box and the
 * slider's thumb can then never disagree about what the value is.
 */
export function numberControl(
  option: NumberToolOption,
  snapshot: EditorSnapshot,
  actions: EditorActions,
): NumberControl {
  const value = optionNumberValue(option.read(snapshot), option.min, option.max);
  return {
    id: option.id,
    kind: "number",
    label: toolOptionLabel(option, snapshot),
    title: option.title,
    value: option.integer ? Math.round(value) : value,
    min: option.min,
    max: option.max,
    step: option.step,
    integer: option.integer ?? false,
    format: option.format,
    write: (next) => {
      // An empty field is not a value, so it writes nothing rather than
      // snapping the option to the bottom of its range.
      if (!Number.isFinite(next)) {
        return;
      }
      option.write(actions, optionStepValue(next, option.min, option.max, option.step));
    },
  };
}

/** The control for a flag. */
export function toggleControl(
  option: ToggleToolOption,
  snapshot: EditorSnapshot,
  actions: EditorActions,
): ToggleControl {
  return {
    id: option.id,
    kind: "toggle",
    label: toolOptionLabel(option, snapshot),
    title: option.title,
    value: option.read(snapshot),
    write: (value) => option.write(actions, value),
  };
}

/**
 * The control for a fixed set of values.
 *
 * A value the choices do not have would leave the control showing nothing, so
 * the first choice stands in for it.
 */
export function selectControl(
  option: SelectToolOption,
  snapshot: EditorSnapshot,
  actions: EditorActions,
): SelectControl {
  const value = option.read(snapshot);
  const known = option.choices.some((choice) => choice.value === value);
  return {
    id: option.id,
    kind: "select",
    label: toolOptionLabel(option, snapshot),
    title: option.title,
    value: known ? value : (option.choices[0]?.value ?? ""),
    choices: option.choices,
    write: (next) => option.write(actions, next),
  };
}

/** The control for a colour. */
export function colorControl(
  option: ColorToolOption,
  snapshot: EditorSnapshot,
  actions: EditorActions,
): ColorControl {
  return {
    id: option.id,
    kind: "color",
    label: toolOptionLabel(option, snapshot),
    title: option.title,
    value: colorInputValue(option.read(snapshot)),
    write: (value) => option.write(actions, value),
  };
}

/** The control for a row of other options. */
export function groupControl(
  option: GroupToolOption,
  snapshot: EditorSnapshot,
  actions: EditorActions,
): GroupControl {
  return {
    id: option.id,
    kind: "group",
    label: toolOptionLabel(option, snapshot),
    title: option.title,
    children: option.children.map((child) => optionControl(child, snapshot, actions)),
  };
}

/**
 * The number a slider or number field shows.
 *
 * A value outside the option's range, or one that is not a number at all,
 * falls back to the start of the range rather than reaching the control.
 */
export function optionNumberValue(value: number, min: number, max: number): number {
  return clamp(value, min, max);
}

/**
 * A value brought inside the option's range and onto its step.
 *
 * A step of zero or less means the option has no steps, so the value is only
 * clamped.
 */
export function optionStepValue(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  const clamped = clamp(value, min, max);
  if (!(step > 0)) {
    return clamped;
  }
  const steps = Math.round((clamped - min) / step);
  return clamp(min + steps * step, min, max);
}

/**
 * The colour a native colour well can show.
 *
 * `input[type=color]` only understands `#rrggbb`, so a shorthand or an
 * eight-digit colour is converted, and anything else falls back to black
 * rather than leaving the well blank.
 */
export function colorInputValue(color: string): string {
  const parsed = parseHexColor(color);
  return parsed ? rgbToHex(parsed.rgb) : "#000000";
}

/** One group of options in the options bar. */
export interface ToolOptionGroup {
  /** The heading the group sits under; empty for the options with none. */
  readonly id: string;
  /** The heading's text, when the group has one. */
  readonly label?: string;
  /** The options in the group, in registration order. */
  readonly options: readonly ToolOption[];
}

/**
 * The options, grouped by the heading they sit under.
 *
 * The options keep the order they were registered in, and the groups appear
 * in the order their first option appeared, so the bar reads the same way
 * every time. Options with no heading share one group.
 */
export function groupToolOptions(options: readonly ToolOption[]): readonly ToolOptionGroup[] {
  const groups: { id: string; label?: string; options: ToolOption[] }[] = [];
  const indexById = new Map<string, number>();
  for (const option of options) {
    const id = option.group ?? "";
    let index = indexById.get(id);
    if (index === undefined) {
      index = groups.length;
      indexById.set(id, index);
      groups.push({ id, label: option.group, options: [] });
    }
    groups[index].options.push(option);
  }
  return groups;
}
