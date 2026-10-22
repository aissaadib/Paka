/**
 * The built-in tool options.
 *
 * The contract lives in `core/shell/toolOptions.ts`: the kinds of control, the
 * per-tool registry and the visibility rules. This module is the *content* -
 * the options the editor ships with - and it registers them into that
 * registry when it is evaluated.
 *
 * Keeping the two apart is what lets a feature add an option to a tool it
 * does not own: it registers its own option in its own module, and the
 * options bar shows it without either file knowing about the other.
 */

import {
  MAX_SHAPE_INNER_RATIO,
  MAX_SHAPE_SIDES,
  MIN_SHAPE_INNER_RATIO,
  MIN_SHAPE_SIDES,
  SHAPE_INNER_RATIO_STEP,
} from "../../core/tools/shapeGeometry";
import {
  FILL_MODES,
  FILL_SAMPLE_SCALES,
} from "../../core/fill/fillOptions";
import {
  registerToolOptions,
  type SelectToolOption,
  type SliderToolOption,
  type ToggleToolOption,
  type ToolOption,
} from "../../core/shell/toolOptions";
import type { ToolId } from "../../types/tool";

export {
  findToolOption,
  toolOptionLabel,
  toolOptionsFor,
  toolShowsBrushControls,
  visibleToolOptions,
} from "../../core/shell/toolOptions";
export type {
  ColorToolOption,
  GroupToolOption,
  NumberToolOption,
  SelectToolOption,
  SliderToolOption,
  ToggleToolOption,
  ToolOption,
  ToolOptionLabel,
} from "../../core/shell/toolOptions";

const shapeFillOption: ToggleToolOption = {
  id: "shapeFill",
  kind: "toggle",
  label: "Fill shape",
  title: "Fill the shape's interior instead of tracing just its outline",
  read: (snapshot) => snapshot.shapeFill,
  write: (actions, value) => actions.setShapeFill(value),
};

const shapeSidesOption: SliderToolOption = {
  id: "shapeSides",
  kind: "slider",
  // One number serves both tools, so the label follows the active one rather
  // than showing "Sides" while a star is selected.
  label: (snapshot) => (snapshot.toolId === "star" ? "Points" : "Sides"),
  title: "How many sides the next polygon has, or how many points the next star has",
  min: MIN_SHAPE_SIDES,
  max: MAX_SHAPE_SIDES,
  step: 1,
  read: (snapshot) => snapshot.shapeSides,
  write: (actions, value) => actions.setShapeSides(value),
};

const shapeRotationOption: SliderToolOption = {
  id: "shapeRotation",
  kind: "slider",
  label: "Rotation",
  title: "Turn the outline about the centre of the dragged box",
  min: 0,
  max: 360,
  step: 1,
  format: (value) => `${Math.round(value)}°`,
  read: (snapshot) => snapshot.shapeRotation,
  write: (actions, value) => actions.setShapeRotation(value),
};

const shapeInnerRatioOption: SliderToolOption = {
  id: "shapeInnerRatio",
  kind: "slider",
  label: "Inner radius",
  title: "How deep the star's valleys reach, as a fraction of its outer radius",
  min: MIN_SHAPE_INNER_RATIO,
  max: MAX_SHAPE_INNER_RATIO,
  step: SHAPE_INNER_RATIO_STEP,
  format: (value) => `${Math.round(value * 100)}%`,
  read: (snapshot) => snapshot.shapeInnerRatio,
  // Snapped to the step, so the number box and the slider's thumb can never
  // show two different ratios.
  write: (actions, value) =>
    actions.setShapeInnerRatio(
      Math.round(value / SHAPE_INNER_RATIO_STEP) * SHAPE_INNER_RATIO_STEP,
    ),
};

const fillToleranceOption: SliderToolOption = {
  id: "fillTolerance",
  kind: "slider",
  label: "Tolerance",
  title: "Colour distance the bucket treats as the same region, per 8-bit channel",
  min: 0,
  max: 255,
  step: 1,
  format: (value) => `${Math.round(value)}`,
  read: (snapshot) => snapshot.fillTolerance,
  write: (actions, value) => actions.setFillTolerance(value),
};

const fillModeOption: SelectToolOption = {
  id: "fillMode",
  kind: "select",
  label: "Mode",
  title:
    "Contiguous fills the region reachable from the click; Global fills every matching pixel in the visible artwork",
  choices: FILL_MODES.map((mode) => ({
    value: mode,
    label: mode === "global" ? "Global" : "Contiguous",
  })),
  read: (snapshot) => snapshot.fillMode,
  write: (actions, value) => {
    if (value === "contiguous" || value === "global") {
      actions.setFillMode(value);
    }
  },
};

const fillSampleScaleOption: SelectToolOption = {
  id: "fillSampleScale",
  kind: "select",
  label: "Sample",
  title:
    "How finely the fill reads the composite: 1x is exact, coarser scales scan large regions faster",
  choices: FILL_SAMPLE_SCALES.map((scale) => ({
    value: String(scale),
    label: `${scale}x`,
  })),
  read: (snapshot) => String(snapshot.fillSampleScale),
  write: (actions, value) => actions.setFillSampleScale(Number(value)),
};

/**
 * The option fields for each tool, in toolbar order.
 *
 * Tools without an entry have no options of their own: their controls are the
 * brush group, the colour panel or nothing at all.
 */
export const TOOL_OPTION_FIELDS: Partial<Record<ToolId, readonly ToolOption[]>> = {
  rectangle: [shapeFillOption],
  ellipse: [shapeFillOption],
  polygon: [shapeSidesOption, shapeRotationOption, shapeFillOption],
  star: [shapeSidesOption, shapeInnerRatioOption, shapeRotationOption, shapeFillOption],
  bucket: [fillToleranceOption, fillModeOption, fillSampleScaleOption],
};

/** Registers the built-in options into the shared per-tool registry. */
export function registerBuiltInToolOptions(): void {
  for (const [toolId, options] of Object.entries(TOOL_OPTION_FIELDS)) {
    registerToolOptions(toolId as ToolId, options ?? []);
  }
}

registerBuiltInToolOptions();
