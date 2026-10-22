/**
 * What a brush can be asked to do.
 *
 * This module is the **one model** of the brush's properties: every field the
 * brush shows, the range the engine clamps it to, the value a fresh brush
 * carries, the unit the control shows it in, and whether the engine honours
 * it yet.
 *
 * Two lists, and the gap between them is the point:
 *
 *  - the properties the engine honours, with the range it clamps them to;
 *  - the properties a brush is commonly expected to have that the engine does
 *    **not** implement.
 *
 * A control may only be offered for a property in the first list. A switch for
 * a property the engine ignores is worse than no switch at all: it looks like it
 * works, it does not, and the user has no way to tell. The missing properties
 * are therefore listed here, with the reason and the work that would close the
 * gap, rather than being quietly left out.
 *
 * The ranges are read out of `normalizeBrush`, the function the engine clamps
 * a brush with, so they cannot drift away from what the engine does.
 */

import type { BrushSettings } from "../../types/brush";
import { roundTo } from "../../utils/math";
import {
  BRUSH_NUMBER_FIELDS,
  brushSizeStep,
  DEFAULT_BRUSH,
  updateBrushSettings,
} from "./defaults";
import type { StepMode } from "./numericInput";

/** The numeric fields of a brush, as the engine lists them. */
export type BrushNumberField = (typeof BRUSH_NUMBER_FIELDS)[number];

/** The unit a property's value is shown in. */
export type BrushPropertyUnit = "px" | "percent" | "ratio";

/** A range of values, in one unit or another. */
export interface BrushRange {
  readonly min: number;
  readonly max: number;
}

/**
 * How many decimals a control's value keeps.
 *
 * The conversion between a stored fraction and its percentage is not exact in
 * binary floating point, so a control's value is rounded here. A number box
 * that shows `7.000000000000001` is a number box nobody trusts.
 */
const CONTROL_PRECISION = 6;

/**
 * A property the brush shows as a slider.
 *
 * The range and the default are **not** stored here: they are read out of the
 * engine (`normalizeBrush` and `DEFAULT_BRUSH`), so a control can never offer
 * a range the engine would refuse.
 */
export interface BrushSliderProperty {
  readonly kind: "slider";
  /** The field of `BrushSettings` the property edits. */
  readonly id: BrushNumberField;
  /** The name the control shows. */
  readonly label: string;
  /** What the property does, as a tooltip. */
  readonly title: string;
  /** The step the control moves the value by, in the control's own units. */
  readonly step: number;
  /** The unit the control shows the value in. */
  readonly unit: BrushPropertyUnit;
  /** The scale the slider uses. */
  readonly scale: "linear" | "log";
  /** Whether the engine honours the field. A false one may not be offered. */
  readonly honoured: boolean;
  /** Whether the property applies to the brush as it stands. */
  readonly visible: (brush: BrushSettings) => boolean;
  /**
   * The step a key press moves the value by.
   *
   * Most fields move by their own step. A field whose step depends on the
   * value - the brush size, which moves by a pixel when it is small and by a
   * tenth of itself when it is large - supplies its own.
   */
  readonly keyboardStep?: (
    current: number,
    direction: 1 | -1,
    mode: StepMode,
  ) => number;
}

/** The fields the brush shows as an on/off switch. */
export type BrushToggleField = "stamp" | "pressureSize" | "pressureOpacity";

/**
 * A property the brush shows as a switch.
 *
 * A switch reads the brush and writes a patch, so the two halves of the
 * control - what it shows and what it changes - cannot drift apart.
 */
export interface BrushToggleProperty {
  readonly kind: "toggle";
  /** The field of `BrushSettings` the switch edits. */
  readonly id: BrushToggleField;
  /** The name the control shows. */
  readonly label: string;
  /** What the property does, as a tooltip. */
  readonly title: string;
  /** Whether the engine honours the field. A false one may not be offered. */
  readonly honoured: boolean;
  /** Whether the property applies to the brush as it stands. */
  readonly visible: (brush: BrushSettings) => boolean;
  /** Whether the property is on for this brush. */
  readonly read: (brush: BrushSettings) => boolean;
  /** The patch that turns the property on or off. */
  readonly write: (enabled: boolean) => Partial<BrushSettings>;
}

/** A property the brush shows. */
export type BrushProperty = BrushSliderProperty | BrushToggleProperty;

/** The strength the pressure switches turn on. */
export const PRESSURE_STRENGTH = 0.6;

/**
 * Every property the brush shows, in toolbar order.
 *
 * The order is the toolbar's order: the plain brush first, the stamp's own
 * properties after the switch that turns them on, and the pressure switches
 * last.
 */
export const BRUSH_PROPERTIES = [
  {
    kind: "slider",
    id: "size",
    label: "Size",
    title: "Stroke diameter in document pixels at full pressure",
    step: 1,
    unit: "px",
    scale: "log",
    honoured: true,
    visible: (_brush: BrushSettings): boolean => true,
    keyboardStep: (current: number, direction: 1 | -1, mode: StepMode): number =>
      brushSizeStep(current, direction, mode),
  },
  {
    kind: "slider",
    id: "opacity",
    label: "Opacity",
    title: "Opacity of the whole stroke",
    step: 1,
    unit: "percent",
    scale: "linear",
    honoured: true,
    visible: (_brush: BrushSettings): boolean => true,
  },
  {
    kind: "slider",
    id: "hardness",
    label: "Hardness",
    title: "Edge falloff: 100% is a crisp edge, lower values soften it",
    step: 1,
    unit: "percent",
    scale: "linear",
    honoured: true,
    visible: (_brush: BrushSettings): boolean => true,
  },
  {
    kind: "slider",
    id: "spacing",
    label: "Sampling",
    title:
      "Gap between interpolated samples as a percentage of brush size; lower values smooth fast strokes at a memory cost. This is the sample density, not the dab spacing of the stamp",
    step: 1,
    unit: "percent",
    scale: "linear",
    honoured: true,
    visible: (_brush: BrushSettings): boolean => true,
  },
  {
    kind: "slider",
    id: "stabilizer",
    label: "Stabilizer",
    title:
      "Smooths the pointer path; 0% follows the pointer exactly and 100% lags the most",
    step: 1,
    unit: "percent",
    scale: "linear",
    honoured: true,
    visible: (_brush: BrushSettings): boolean => true,
  },
  {
    kind: "slider",
    id: "texture",
    label: "Texture",
    title: "Document-anchored grain over the finished stroke; 0% is the plain edge",
    step: 1,
    unit: "percent",
    scale: "linear",
    honoured: true,
    visible: (_brush: BrushSettings): boolean => true,
  },
  {
    kind: "toggle",
    id: "stamp",
    label: "Stamp",
    title: "Draw the stroke as a chain of round dabs instead of continuous segments",
    honoured: true,
    visible: (_brush: BrushSettings): boolean => true,
    read: (brush: BrushSettings): boolean => brush.stamp,
    write: (enabled: boolean): Partial<BrushSettings> => ({ stamp: enabled }),
  },
  {
    kind: "slider",
    id: "stampSpacing",
    label: "Stamp spacing",
    title:
      "Distance between dabs as a percentage of the brush size; this is not the sample density above",
    step: 1,
    unit: "percent",
    scale: "linear",
    honoured: true,
    visible: (brush: BrushSettings): boolean => brush.stamp,
  },
  {
    kind: "slider",
    id: "stampHardness",
    label: "Stamp hardness",
    title:
      "Falloff of a single dab; 100% is a crisp dab edge, lower values soften it towards the centre",
    step: 1,
    unit: "percent",
    scale: "linear",
    honoured: true,
    visible: (brush: BrushSettings): boolean => brush.stamp,
  },
  {
    kind: "slider",
    id: "stampTexture",
    label: "Stamp texture",
    title:
      "Bristle lanes along the stroke; 0% is the plain round dab and 100% is the full effect",
    step: 1,
    unit: "percent",
    scale: "linear",
    honoured: true,
    visible: (brush: BrushSettings): boolean => brush.stamp,
  },
  {
    kind: "toggle",
    id: "pressureSize",
    label: "Pressure size",
    title: "Pen pressure controls stroke width (ignored by mouse input)",
    honoured: true,
    visible: (_brush: BrushSettings): boolean => true,
    read: (brush: BrushSettings): boolean => brush.pressureSize > 0,
    write: (enabled: boolean): Partial<BrushSettings> => ({
      pressureSize: enabled ? PRESSURE_STRENGTH : 0,
    }),
  },
  {
    kind: "toggle",
    id: "pressureOpacity",
    label: "Pressure opacity",
    title: "Pen pressure controls stroke opacity",
    honoured: true,
    visible: (_brush: BrushSettings): boolean => true,
    read: (brush: BrushSettings): boolean => brush.pressureOpacity > 0,
    write: (enabled: boolean): Partial<BrushSettings> => ({
      pressureOpacity: enabled ? PRESSURE_STRENGTH : 0,
    }),
  },
] as const satisfies readonly BrushProperty[];

/**
 * The numeric fields the brush keeps but offers no control for.
 *
 * They are listed rather than forgotten: a field that is neither shown nor
 * declared is a field whose control was dropped by accident.
 */
export const BRUSH_HIDDEN_FIELDS = ["minSizeRatio"] as const satisfies readonly BrushNumberField[];

/** One entry of the property table, with its literal types. */
type TableProperty = (typeof BRUSH_PROPERTIES)[number];

/** The fields the property table accounts for. */
type AccountedField =
  | Extract<TableProperty, { kind: "slider" }>["id"]
  | Extract<TableProperty, { kind: "toggle" }>["id"]
  | (typeof BRUSH_HIDDEN_FIELDS)[number];

/** A numeric field the property table does not account for. */
type UnaccountedField = Exclude<BrushNumberField, AccountedField>;

/**
 * Compile-time guard: every numeric field of a brush is shown, switched or
 * explicitly held back.
 *
 * A field added to `BrushSettings` and not to one of the lists above makes
 * this line fail to compile, because the controls would quietly stop offering
 * it and nobody would notice.
 */
export const EVERY_BRUSH_FIELD_IS_ACCOUNTED_FOR: UnaccountedField extends never
  ? true
  : never = true;

/**
 * The properties a brush is commonly expected to have that Paka does not
 * implement.
 *
 * They are listed rather than hidden so the gap is visible and owned: a
 * control for one of these would be a switch the engine ignores. Closing a
 * gap means teaching the engine the property - the brush-engine work - and
 * then adding it to the table above.
 */
export const UNIMPLEMENTED_BRUSH_PROPERTIES: readonly {
  /** The name the property has in other paint programs. */
  readonly name: string;
  /** Why the engine does not have it. */
  readonly reason: string;
  /** The work that would close the gap. */
  readonly owner: string;
}[] = [
  {
    name: "flow",
    reason:
      "Paka applies a stroke's opacity once, when its finished coverage composites, so a stroke never darkens where it overlaps itself. A flow is the per-dab build-up that would darken a slow stroke, which needs a per-dab alpha the coverage union cannot carry.",
    owner:
      "the brush engine: the dab union would have to keep a per-dab alpha instead of a maximum",
  },
  {
    name: "taper",
    reason:
      "A stroke always starts and ends at full width. The dynamics layer models a taper (core/brushes/dynamics.ts), but the sampling and rasterization paths do not apply it yet, so a control for it would change nothing.",
    owner:
      "the brush engine: a per-sample width multiplier on the sampling path and in the dab plan",
  },
  {
    name: "speed dynamics",
    reason:
      "The dynamics layer models a speed-sensitive width (core/brushes/dynamics.ts), but nothing measures a stroke's speed and applies it, so a control for it would change nothing.",
    owner: "the brush engine: a velocity source on the sampling path",
  },
  {
    name: "cap and join styles",
    reason:
      "The segment path is round-capped and round-joined, and the stamp path draws round dabs. A flat cap is different geometry, not a setting.",
    owner: "the brush engine: the cap and join geometry of the segment path",
  },
  {
    name: "size jitter and scatter",
    reason:
      "Paka's rasterization is deterministic by rule: the same samples always produce the same pixels, so a random jitter would have to be derived from a hash of the sample rather than from a random number.",
    owner: "the brush engine: a hash-derived per-dab offset",
  },
  {
    name: "roundness and tip shape",
    reason:
      "Every dab is a circle and every segment is round-capped, so a brush tip is always as wide as it is tall. An elliptical tip is different geometry, not a setting.",
    owner: "the brush engine: a tip shape in the dab plan and in the segment path",
  },
  {
    name: "tilt and angle",
    reason:
      "Paka draws every stroke upright: a tilted pen would have to rotate the tip and the bristle lanes with the device's tilt, and the input layer carries no tilt at all.",
    owner: "the input layer and the brush engine together: a tilt value per sample",
  },
];

/**
 * The range the engine clamps one brush field to.
 *
 * The probe values are far outside every range, so the clamp answers with the
 * range's own ends. A change to `normalizeBrush` therefore changes these
 * numbers with it.
 */
export function brushFieldBounds(field: BrushNumberField): BrushRange {
  const probe = (value: number): number => {
    const patch: Partial<Record<BrushNumberField, number>> = {};
    patch[field] = value;
    return updateBrushSettings(DEFAULT_BRUSH, patch)[field];
  };
  return {
    min: probe(-Number.MAX_VALUE),
    max: probe(Number.MAX_VALUE),
  };
}

/** How many control units one stored unit is worth. */
export function brushPropertyUnitScale(property: BrushSliderProperty): number {
  return property.unit === "percent" ? 100 : 1;
}

/** The range the engine clamps the property's field to, in the field's units. */
export function brushPropertyBounds(property: BrushSliderProperty): BrushRange {
  return brushFieldBounds(property.id);
}

/** The range the control shows, in the control's own units. */
export function brushPropertyRange(property: BrushSliderProperty): BrushRange {
  const bounds = brushPropertyBounds(property);
  const scale = brushPropertyUnitScale(property);
  return {
    min: roundTo(bounds.min * scale, CONTROL_PRECISION),
    max: roundTo(bounds.max * scale, CONTROL_PRECISION),
  };
}

/**
 * The value a control shows for a stored value.
 *
 * The result is rounded to six decimals, because the conversion between a
 * stored fraction and its percentage is not exact in binary floating point
 * and a number box that shows `7.000000000000001` is a number box nobody
 * trusts.
 */
export function brushPropertyControlValue(
  property: BrushSliderProperty,
  stored: number,
): number {
  const scale = brushPropertyUnitScale(property);
  const scaled = stored * scale;
  return Number.isFinite(scaled) ? roundTo(scaled, CONTROL_PRECISION) : 0;
}

/** The stored value a control's value means. */
export function brushPropertyStoredValue(
  property: BrushSliderProperty,
  control: number,
): number {
  const scale = brushPropertyUnitScale(property);
  return control / scale;
}

/** The value a fresh brush carries, in the control's own units. */
export function brushPropertyDefault(property: BrushSliderProperty): number {
  return brushPropertyControlValue(property, DEFAULT_BRUSH[property.id]);
}

/**
 * The patch that writes a control's value into the brush.
 *
 * The patch carries the field under its own name, so it goes through the same
 * `setBrush` path as the colour picker and the preset picker.
 */
export function brushPropertyPatch(
  property: BrushSliderProperty,
  control: number,
): Partial<BrushSettings> {
  const stored = brushPropertyStoredValue(property, control);
  const patch: Partial<Record<BrushNumberField, number>> = {};
  patch[property.id] = stored;
  return patch;
}

/** The text a control shows for a value, in the property's own unit. */
export function brushPropertyFormat(property: BrushSliderProperty, value: number): string {
  switch (property.unit) {
    case "px":
      return `${Math.round(value)} px`;
    case "percent":
      return `${Math.round(value)}%`;
    case "ratio":
      return String(Math.round(value * 100) / 100);
  }
}

/** The properties the brush shows for the brush as it stands, in order. */
export function brushPropertiesFor(brush: BrushSettings): readonly BrushProperty[] {
  return BRUSH_PROPERTIES.filter((property) => property.visible(brush));
}

/** One property by id, or `undefined`. */
export function findBrushProperty(id: string): BrushProperty | undefined {
  return BRUSH_PROPERTIES.find((property) => property.id === id);
}
