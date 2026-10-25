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
  DEFAULT_BRUSH,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
} from "../../core/brushes/defaults";
import { MIN_SHAPE_SIZE } from "../../core/document/shapeRecord";
import type { BoxShapeGeometry } from "../../core/document/types";
import type { EditorSnapshot } from "../../core/engine/DrawingEngine";
import {
  FILL_MODES,
  FILL_SAMPLE_SCALES,
} from "../../core/fill/fillOptions";
import { MAX_DOCUMENT_SIZE } from "../../core/document/document";
import { SELECTION_SHAPES } from "../../core/document/selectionModes";
import {
  registerToolOptions,
  type ColorToolOption,
  type NumberToolOption,
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

const symmetryModeOption: SelectToolOption = {
  id: "symmetryMode",
  kind: "select",
  label: "Symmetry",
  group: "Symmetry",
  title:
    "Mirror the next stroke across a vertical axis, a horizontal axis or both (four-way)",
  choices: [
    { value: "off", label: "Off" },
    { value: "vertical", label: "Vertical" },
    { value: "horizontal", label: "Horizontal" },
    { value: "both", label: "Both" },
  ],
  read: (snapshot) => (snapshot.symmetryEnabled ? snapshot.symmetryMode : "off"),
  write: (actions, value) => {
    if (value === "off" || value === "vertical" || value === "horizontal" || value === "both") {
      actions.setSymmetryMode(value);
    }
  },
};

const symmetryVerticalAxisOption: NumberToolOption = {
  id: "symmetryVerticalAxis",
  kind: "number",
  label: "Axis X",
  group: "Symmetry",
  title: "Where the vertical mirror line stands, in document pixels",
  min: 0,
  max: MAX_DOCUMENT_SIZE,
  step: 1,
  integer: true,
  visible: (snapshot) =>
    snapshot.symmetryEnabled &&
    (snapshot.symmetryMode === "vertical" || snapshot.symmetryMode === "both"),
  read: (snapshot) => snapshot.symmetryVerticalAxis,
  write: (actions, value) => actions.setSymmetryAxis("vertical", value),
};

const symmetryHorizontalAxisOption: NumberToolOption = {
  id: "symmetryHorizontalAxis",
  kind: "number",
  label: "Axis Y",
  group: "Symmetry",
  title: "Where the horizontal mirror line stands, in document pixels",
  min: 0,
  max: MAX_DOCUMENT_SIZE,
  step: 1,
  integer: true,
  visible: (snapshot) =>
    snapshot.symmetryEnabled &&
    (snapshot.symmetryMode === "horizontal" || snapshot.symmetryMode === "both"),
  read: (snapshot) => snapshot.symmetryHorizontalAxis,
  write: (actions, value) => actions.setSymmetryAxis("horizontal", value),
};

const symmetryOptions: readonly ToolOption[] = [
  symmetryModeOption,
  symmetryVerticalAxisOption,
  symmetryHorizontalAxisOption,
];

const selectionShapeOption: SelectToolOption = {
  id: "selectionShape",
  kind: "select",
  label: "Shape",
  title:
    "Rectangle selects the box you drag; Lasso selects the freehand region you trace",
  choices: SELECTION_SHAPES.map((shape) => ({
    value: shape,
    label: shape === "lasso" ? "Lasso" : "Rectangle",
  })),
  read: (snapshot) => snapshot.selectionShape,
  write: (actions, value) => {
    if (value === "rect" || value === "lasso") {
      actions.setSelectionShape(value);
    }
  },
};

/**
 * The selected shape's box, or `null` when nothing is selected or the
 * selection is a line.
 *
 * A line has endpoints rather than a box, so the box-only controls - rotation,
 * width, height - must not appear for it: they would edit nothing.
 */
function selectedBox(snapshot: EditorSnapshot): BoxShapeGeometry | null {
  const shape = snapshot.selectedShape;
  return shape && shape.geometry.shape !== "line" ? shape.geometry : null;
}

/** Whether the selected shape is one of `kinds`. */
function selectedShapeIs(snapshot: EditorSnapshot, ...kinds: readonly string[]): boolean {
  const kind = snapshot.selectedShape?.geometry.shape;
  return kind !== undefined && kinds.includes(kind);
}

/**
 * The compact editor for a committed shape.
 *
 * These controls are registered on the shape-editor tool, not on the shape
 * tools: they edit the **selected** shape rather than the settings for the
 * next one. Every field is hidden until a shape is selected, and each is
 * hidden again for the kinds it cannot change - a line has no fill, rotation
 * or box, and only a polygon has sides and only a star has an inner radius.
 */
const shapeEditFillOption: ToggleToolOption = {
  id: "shapeEditFill",
  kind: "toggle",
  label: "Fill",
  group: "Shape",
  title: "Fill the selected shape's interior instead of tracing just its outline",
  visible: (snapshot) =>
    selectedShapeIs(snapshot, "rectangle", "ellipse", "polygon", "star"),
  read: (snapshot) => snapshot.selectedShape?.fill ?? false,
  write: (actions, value) => actions.setSelectedShapeFill(value),
};

const shapeEditSidesOption: SliderToolOption = {
  id: "shapeEditSides",
  kind: "slider",
  label: (snapshot) =>
    snapshot.selectedShape?.geometry.shape === "star" ? "Points" : "Sides",
  group: "Shape",
  title: "How many sides the selected polygon has, or how many points the selected star has",
  min: MIN_SHAPE_SIDES,
  max: MAX_SHAPE_SIDES,
  step: 1,
  visible: (snapshot) => selectedShapeIs(snapshot, "polygon", "star"),
  read: (snapshot) => selectedBox(snapshot)?.sides ?? MIN_SHAPE_SIDES,
  write: (actions, value) => actions.setSelectedShapeSides(value),
};

const shapeEditInnerRatioOption: SliderToolOption = {
  id: "shapeEditInnerRatio",
  kind: "slider",
  label: "Inner radius",
  group: "Shape",
  title: "How deep the selected star's valleys reach, as a fraction of its outer radius",
  min: MIN_SHAPE_INNER_RATIO,
  max: MAX_SHAPE_INNER_RATIO,
  step: SHAPE_INNER_RATIO_STEP,
  format: (value) => `${Math.round(value * 100)}%`,
  visible: (snapshot) => selectedShapeIs(snapshot, "star"),
  read: (snapshot) => selectedBox(snapshot)?.innerRatio ?? MIN_SHAPE_INNER_RATIO,
  write: (actions, value) =>
    actions.setSelectedShapeInnerRatio(
      Math.round(value / SHAPE_INNER_RATIO_STEP) * SHAPE_INNER_RATIO_STEP,
    ),
};

const shapeEditRotationOption: SliderToolOption = {
  id: "shapeEditRotation",
  kind: "slider",
  label: "Rotation",
  group: "Shape",
  title: "Turn the selected shape about the centre of its box",
  min: 0,
  max: 360,
  step: 1,
  format: (value) => `${Math.round(value)}°`,
  visible: (snapshot) => selectedBox(snapshot) !== null,
  read: (snapshot) => selectedBox(snapshot)?.rotation ?? 0,
  write: (actions, value) => actions.setSelectedShapeRotation(value),
};

const shapeEditWidthOption: NumberToolOption = {
  id: "shapeEditWidth",
  kind: "number",
  label: "Width",
  group: "Shape",
  title: "Width of the selected shape's box, in document pixels",
  min: MIN_SHAPE_SIZE,
  max: MAX_DOCUMENT_SIZE,
  step: 1,
  visible: (snapshot) => selectedBox(snapshot) !== null,
  read: (snapshot) => selectedBox(snapshot)?.width ?? MIN_SHAPE_SIZE,
  write: (actions, value) => actions.setSelectedShapeWidth(value),
};

const shapeEditHeightOption: NumberToolOption = {
  id: "shapeEditHeight",
  kind: "number",
  label: "Height",
  group: "Shape",
  title: "Height of the selected shape's box, in document pixels",
  min: MIN_SHAPE_SIZE,
  max: MAX_DOCUMENT_SIZE,
  step: 1,
  visible: (snapshot) => selectedBox(snapshot) !== null,
  read: (snapshot) => selectedBox(snapshot)?.height ?? MIN_SHAPE_SIZE,
  write: (actions, value) => actions.setSelectedShapeHeight(value),
};

const shapeEditColorOption: ColorToolOption = {
  id: "shapeEditColor",
  kind: "color",
  label: "Color",
  group: "Appearance",
  title: "Color of the selected shape's outline",
  visible: (snapshot) => snapshot.selectedShape !== null,
  read: (snapshot) => snapshot.selectedShape?.brush.color ?? DEFAULT_BRUSH.color,
  write: (actions, value) => actions.setSelectedShapeBrush({ color: value }),
};

const shapeEditStrokeOption: SliderToolOption = {
  id: "shapeEditStroke",
  kind: "slider",
  label: "Stroke",
  group: "Appearance",
  title: "Width of the selected shape's outline",
  min: MIN_BRUSH_SIZE,
  max: MAX_BRUSH_SIZE,
  step: 1,
  visible: (snapshot) => snapshot.selectedShape !== null,
  read: (snapshot) => snapshot.selectedShape?.brush.size ?? MIN_BRUSH_SIZE,
  write: (actions, value) => actions.setSelectedShapeBrush({ size: value }),
};

const shapeEditOpacityOption: SliderToolOption = {
  id: "shapeEditOpacity",
  kind: "slider",
  label: "Opacity",
  group: "Appearance",
  title: "Opacity of the selected shape",
  min: 0,
  max: 1,
  step: 0.01,
  format: (value) => `${Math.round(value * 100)}%`,
  visible: (snapshot) => snapshot.selectedShape !== null,
  read: (snapshot) => snapshot.selectedShape?.brush.opacity ?? 1,
  write: (actions, value) => actions.setSelectedShapeBrush({ opacity: value }),
};

const shapeEditOptions: readonly ToolOption[] = [
  shapeEditFillOption,
  shapeEditSidesOption,
  shapeEditInnerRatioOption,
  shapeEditRotationOption,
  shapeEditWidthOption,
  shapeEditHeightOption,
  shapeEditColorOption,
  shapeEditStrokeOption,
  shapeEditOpacityOption,
];

/**
 * The option fields for each tool, in toolbar order.
 *
 * Tools without an entry have no options of their own: their controls are the
 * brush group, the colour panel or nothing at all.
 */
export const TOOL_OPTION_FIELDS: Partial<Record<ToolId, readonly ToolOption[]>> = {
  select: [selectionShapeOption],
  shapeEdit: [...shapeEditOptions],
  brush: [...symmetryOptions],
  eraser: [...symmetryOptions],
  line: [...symmetryOptions],
  rectangle: [shapeFillOption, ...symmetryOptions],
  ellipse: [shapeFillOption, ...symmetryOptions],
  polygon: [shapeSidesOption, shapeRotationOption, shapeFillOption, ...symmetryOptions],
  star: [
    shapeSidesOption,
    shapeInnerRatioOption,
    shapeRotationOption,
    shapeFillOption,
    ...symmetryOptions,
  ],
  bucket: [fillToleranceOption, fillModeOption, fillSampleScaleOption],
};

/** Registers the built-in options into the shared per-tool registry. */
export function registerBuiltInToolOptions(): void {
  for (const [toolId, options] of Object.entries(TOOL_OPTION_FIELDS)) {
    registerToolOptions(toolId as ToolId, options ?? []);
  }
}

registerBuiltInToolOptions();
