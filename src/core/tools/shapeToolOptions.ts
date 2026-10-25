/**
 * The shape tools' options in the options bar.
 *
 * The controls are *descriptions*, not React: the shared contract
 * (`core/shell/toolOptions.ts`) says what a slider is and where a tool's
 * options live, and this module says what the shape tools' options are. Every
 * description is built from the one model (`shapeOptions.ts`), so a slider's
 * range is the range the geometry clamps to, its step is the step the value
 * is snapped to, and its label follows the shape kind.
 *
 * The module registers the options itself, the way the contract intends: a
 * feature adds an option to a tool it does not own by calling
 * `appendToolOptions`. Registering is idempotent - the contract ignores an
 * option whose id is already registered for that tool - so the built-in
 * schema and this module may both describe the shape options without a
 * control ever appearing twice.
 *
 * The options are **editor state**: writing one calls an editor action, which
 * publishes a new snapshot. It is not an edit - no history step, no dirty
 * flag, nothing in the project file.
 *
 * One ordering caveat, because the contract has two ways to register: an
 * *append* adds to a tool's list, but a later *registration* replaces it. The
 * shape tools' options are appended here, so a schema that registers the
 * shape options again afterwards would drop them. Call
 * `registerShapeToolOptions()` after such a registration - it is idempotent -
 * or import this module from the schema, and the order stops mattering.
 */

import type { EditorActions } from "../../state/editorStore";
import type { EditorSnapshot } from "../engine/DrawingEngine";
import {
  appendToolOptions,
  type SliderToolOption,
  type ToggleToolOption,
  type ToolOption,
} from "../shell/toolOptions";
import {
  SHAPE_KINDS,
  isShapeKind,
  shapeOptionFieldsFor,
  shapeOptionLabel,
  type ShapeKind,
  type ShapeNumberOption,
  type ShapeOptionField,
  type ShapeToggleOption,
} from "./shapeOptions";

/** The shape kind the snapshot is showing, or the line's when it is none. */
function shapeKindOf(snapshot: EditorSnapshot): ShapeKind {
  return isShapeKind(snapshot.toolId) ? snapshot.toolId : "line";
}

/**
 * Reads a numeric option from the snapshot.
 *
 * The id names the snapshot field, so the control and the engine cannot
 * drift apart. The fallback is the option's default: a numeric option that is
 * not wired to the engine yet reads its default rather than breaking the
 * toolbar.
 */
function readNumber(field: ShapeNumberOption, snapshot: EditorSnapshot): number {
  switch (field.id) {
    case "shapeSides":
      return snapshot.shapeSides;
    case "shapeInnerRatio":
      return snapshot.shapeInnerRatio;
    case "shapeRotation":
      return snapshot.shapeRotation;
    default:
      return field.defaultValue;
  }
}

/**
 * Writes a numeric option through the matching editor action.
 *
 * The value is snapped to the option's step first, so the slider's thumb and
 * its number box can never show two different values.
 */
function writeNumber(field: ShapeNumberOption, actions: EditorActions, value: number): void {
  const snapped = snapToStep(value, field.step);
  switch (field.id) {
    case "shapeSides":
      actions.setShapeSides(snapped);
      return;
    case "shapeInnerRatio":
      actions.setShapeInnerRatio(snapped);
      return;
    case "shapeRotation":
      actions.setShapeRotation(snapped);
      return;
    default:
      return;
  }
}

/** Snaps a value to the option's step. */
function snapToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
}

/** The control for a numeric option, built from the model. */
function sliderFor(field: ShapeNumberOption): SliderToolOption {
  return {
    id: field.id,
    kind: "slider",
    label: (snapshot) => shapeOptionLabel(field, shapeKindOf(snapshot)),
    title: field.title,
    min: field.min,
    max: field.max,
    step: field.step,
    format: field.format,
    read: (snapshot) => readNumber(field, snapshot),
    write: (actions, value) => writeNumber(field, actions, value),
  };
}

/**
 * Reads a flag from the snapshot.
 *
 * The id names the snapshot field, so the control and the engine cannot drift
 * apart. The fallback is the option's default, for a flag that is not wired to
 * the engine yet.
 */
function readToggle(field: ShapeToggleOption, snapshot: EditorSnapshot): boolean {
  switch (field.id) {
    case "shapeFill":
      return snapshot.shapeFill;
    default:
      return field.defaultValue;
  }
}

/** Writes a flag through the matching editor action. */
function writeToggle(field: ShapeToggleOption, actions: EditorActions, value: boolean): void {
  switch (field.id) {
    case "shapeFill":
      actions.setShapeFill(value);
      return;
    default:
      return;
  }
}

/** The control for a flag, built from the model. */
function toggleFor(field: ShapeToggleOption): ToggleToolOption {
  return {
    id: field.id,
    kind: "toggle",
    label: (snapshot) => shapeOptionLabel(field, shapeKindOf(snapshot)),
    title: field.title,
    read: (snapshot) => readToggle(field, snapshot),
    write: (actions, value) => writeToggle(field, actions, value),
  };
}

/** The control for one option of the model. */
function optionFor(field: ShapeOptionField): ToolOption {
  return field.control === "toggle" ? toggleFor(field) : sliderFor(field);
}

/**
 * Registers the shape tools' options.
 *
 * The model says which options each shape kind has, so the list is the model's
 * list: the polygon reads *Sides*, *Rotation* and *Fill shape*, the star reads
 * *Points*, *Inner radius*, *Rotation* and *Fill shape*, the rectangle and the
 * ellipse read *Rotation* and *Fill shape*, and the line - whose angle is the
 * drag - reads nothing.
 *
 * Calling it twice is harmless: the contract ignores an option whose id is
 * already registered for that tool.
 */
export function registerShapeToolOptions(): void {
  for (const kind of SHAPE_KINDS) {
    const options = shapeOptionFieldsFor(kind).map(optionFor);
    if (options.length > 0) {
      appendToolOptions(kind, options);
    }
  }
}

registerShapeToolOptions();
