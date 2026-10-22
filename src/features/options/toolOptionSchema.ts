/**
 * Declarative tool options.
 *
 * One typed schema describes every control the options bar can show, and one
 * table says which groups each tool shows. An option says where its value is
 * read from - the editor snapshot - and where it is written - an
 * `EditorActions` method - so the bar itself holds no per-tool logic and no
 * second copy of a brush value.
 *
 * The options are grouped. A group is a set of controls that belong together:
 * the brush, the shape, the selection, the fill, the gradient. A control is
 * only in a group when the tool really uses it. The gradient has no brush
 * size, and a shape has no stabilizer and no dab spacing, so those controls
 * are absent rather than present and inert: a slider the user can move but
 * that changes nothing is worse than no slider at all.
 *
 * Every option here is *editor state*: it describes the next gesture, and the
 * committed record keeps the value it was drawn with. Changing one is not an
 * edit, so none of these writes touches history or the file's dirty flag.
 */

import {
  MAX_BRUSH_SIZE,
  MAX_SPACING,
  MAX_STAMP_SPACING,
  MIN_BRUSH_SIZE,
  MIN_SPACING,
  MIN_STAMP_SPACING,
} from "../../core/brushes/defaults";
import type { EditorSnapshot } from "../../core/engine/DrawingEngine";
import {
  MAX_SHAPE_INNER_RATIO,
  MAX_SHAPE_SIDES,
  MIN_SHAPE_INNER_RATIO,
  MIN_SHAPE_SIDES,
  SHAPE_INNER_RATIO_STEP,
} from "../../core/tools/shapeGeometry";
import { getToolDefinition } from "../../core/tools/toolDefinitions";
import type { EditorActions } from "../../state/editorStore";
import type { ToolId } from "../../types/tool";

/** A label, or a function of the snapshot when the label follows the tool. */
export type ToolOptionLabel = string | ((snapshot: EditorSnapshot) => string);

/**
 * Where a control sits.
 *
 * `inline` controls are in the strip itself. `popover` controls live in the
 * group's popover, behind a compact trigger: the strip stays one row tall, and
 * the brush alone has a dozen settings.
 */
export type ToolOptionPlacement = "inline" | "popover";

/**
 * The brush field a control writes.
 *
 * It is what lets one brush control serve several tools: the brush and the
 * eraser use every field, a shape uses four of them, and a gradient uses one.
 */
export type BrushOptionField =
  | "size"
  | "opacity"
  | "hardness"
  | "sampling"
  | "stabilizer"
  | "texture"
  | "stamp"
  | "stampSpacing"
  | "stampHardness"
  | "stampTexture"
  | "pressureSize"
  | "pressureOpacity";

interface ToolOptionBase {
  /** Stable id, unique within one group's field list. */
  readonly id: string;
  readonly label: ToolOptionLabel;
  readonly title?: string;
  /** Extra visibility rule on top of the group's tool association. */
  readonly visible?: (snapshot: EditorSnapshot) => boolean;
  /** True when the control exists but cannot act right now. */
  readonly disabled?: (snapshot: EditorSnapshot) => boolean;
  /** Where the control sits. Defaults to `inline`. */
  readonly placement?: ToolOptionPlacement;
  /** Set on the brush group's controls: the brush field the control writes. */
  readonly brushField?: BrushOptionField;
}

export interface SliderToolOption extends ToolOptionBase {
  readonly kind: "slider";
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly scale?: "linear" | "log";
  readonly format?: (value: number) => string;
  readonly read: (snapshot: EditorSnapshot) => number;
  readonly write: (actions: EditorActions, value: number) => void;
}

export interface ToggleToolOption extends ToolOptionBase {
  readonly kind: "toggle";
  readonly read: (snapshot: EditorSnapshot) => boolean;
  readonly write: (actions: EditorActions, value: boolean) => void;
}

export interface ColorToolOption extends ToolOptionBase {
  readonly kind: "color";
  readonly read: (snapshot: EditorSnapshot) => string;
  readonly write: (actions: EditorActions, value: string) => void;
}

export interface ActionToolOption extends ToolOptionBase {
  readonly kind: "action";
  /** The keyboard shortcut the same action has, shown in the tooltip. */
  readonly shortcut?: string;
  readonly run: (actions: EditorActions) => void;
}

export type ToolOption =
  | SliderToolOption
  | ToggleToolOption
  | ColorToolOption
  | ActionToolOption;

/** The groups the options bar knows. */
export type ToolOptionGroupId = "brush" | "shape" | "selection" | "fill" | "gradient";

export interface ToolOptionGroup {
  readonly id: ToolOptionGroupId;
  /** The group's name, used for the region's accessible label. */
  readonly label: string;
  readonly title?: string;
  /** The group's controls, already filtered for the active tool. */
  readonly fields: readonly ToolOption[];
}

/** Resolves a label against the current snapshot. */
export function toolOptionLabel(option: ToolOption, snapshot: EditorSnapshot): string {
  return typeof option.label === "function" ? option.label(snapshot) : option.label;
}

/** True when the control exists but cannot act right now. */
export function isToolOptionDisabled(
  option: ToolOption,
  snapshot: EditorSnapshot,
): boolean {
  return option.disabled?.(snapshot) ?? false;
}

/* ---------------------------------------------------------------- the brush */

/** Pressure strength the on/off toggles switch to. */
const PRESSURE_STRENGTH = 0.6;

const brushSizeOption: SliderToolOption = {
  id: "brushSize",
  kind: "slider",
  label: "Size",
  title: "Diameter of the stroke in document pixels",
  min: MIN_BRUSH_SIZE,
  max: MAX_BRUSH_SIZE,
  step: 1,
  scale: "log",
  format: (value) => `${Math.round(value)} px`,
  read: (snapshot) => snapshot.brush.size,
  write: (actions, size) => actions.setBrush({ size }),
  brushField: "size",
};

const brushOpacityOption: SliderToolOption = {
  id: "brushOpacity",
  kind: "slider",
  label: "Opacity",
  title: "Opacity of the whole stroke",
  min: 0,
  max: 1,
  step: 0.01,
  format: (value) => `${Math.round(value * 100)}%`,
  read: (snapshot) => snapshot.brush.opacity,
  write: (actions, opacity) => actions.setBrush({ opacity }),
  brushField: "opacity",
};

const brushHardnessOption: SliderToolOption = {
  id: "brushHardness",
  kind: "slider",
  label: "Hardness",
  title: "Edge falloff: 100% is a crisp edge, lower values soften it",
  min: 0,
  max: 1,
  step: 0.01,
  format: (value) => `${Math.round(value * 100)}%`,
  read: (snapshot) => snapshot.brush.hardness,
  write: (actions, hardness) => actions.setBrush({ hardness }),
  placement: "popover",
  brushField: "hardness",
};

const brushSamplingOption: SliderToolOption = {
  id: "brushSampling",
  kind: "slider",
  label: "Sampling",
  title:
    "Gap between interpolated samples as a percentage of brush size; lower values smooth fast strokes at a memory cost. This is the sample density, not the dab spacing of the stamp",
  min: MIN_SPACING * 100,
  max: MAX_SPACING * 100,
  step: 1,
  format: (value) => `${Math.round(value)}%`,
  read: (snapshot) => snapshot.brush.spacing * 100,
  write: (actions, spacing) => actions.setBrush({ spacing: spacing / 100 }),
  placement: "popover",
  brushField: "sampling",
};

const brushStabilizerOption: SliderToolOption = {
  id: "brushStabilizer",
  kind: "slider",
  label: "Stabilizer",
  title: "Smooths the pointer path; 0% follows the pointer exactly and 100% lags the most",
  min: 0,
  max: 1,
  step: 0.01,
  format: (value) => `${Math.round(value * 100)}%`,
  read: (snapshot) => snapshot.brush.stabilizer,
  write: (actions, stabilizer) => actions.setBrush({ stabilizer }),
  placement: "popover",
  brushField: "stabilizer",
};

const brushTextureOption: SliderToolOption = {
  id: "brushTexture",
  kind: "slider",
  label: "Texture",
  title: "Document-anchored grain over the finished stroke; 0% is the plain edge",
  min: 0,
  max: 1,
  step: 0.01,
  format: (value) => `${Math.round(value * 100)}%`,
  read: (snapshot) => snapshot.brush.texture,
  write: (actions, texture) => actions.setBrush({ texture }),
  placement: "popover",
  brushField: "texture",
};

const brushStampOption: ToggleToolOption = {
  id: "brushStamp",
  kind: "toggle",
  label: "Stamp",
  title: "Draw the stroke as a chain of round dabs instead of continuous segments",
  read: (snapshot) => snapshot.brush.stamp,
  write: (actions, stamp) => actions.setBrush({ stamp }),
  placement: "popover",
  brushField: "stamp",
};

const brushStampSpacingOption: SliderToolOption = {
  id: "brushStampSpacing",
  kind: "slider",
  label: "Stamp spacing",
  title: "Distance between dabs as a percentage of the brush size; this is not the sample density above",
  min: MIN_STAMP_SPACING * 100,
  max: MAX_STAMP_SPACING * 100,
  step: 1,
  format: (value) => `${Math.round(value)}%`,
  read: (snapshot) => snapshot.brush.stampSpacing * 100,
  write: (actions, stampSpacing) => actions.setBrush({ stampSpacing: stampSpacing / 100 }),
  // Only meaningful while the stamp is on.
  visible: (snapshot) => snapshot.brush.stamp,
  placement: "popover",
  brushField: "stampSpacing",
};

const brushStampHardnessOption: SliderToolOption = {
  id: "brushStampHardness",
  kind: "slider",
  label: "Stamp hardness",
  title: "Falloff of a single dab; 100% is a crisp dab edge, lower values soften it towards the centre",
  min: 0,
  max: 1,
  step: 0.01,
  format: (value) => `${Math.round(value * 100)}%`,
  read: (snapshot) => snapshot.brush.stampHardness,
  write: (actions, stampHardness) => actions.setBrush({ stampHardness }),
  visible: (snapshot) => snapshot.brush.stamp,
  placement: "popover",
  brushField: "stampHardness",
};

const brushStampTextureOption: SliderToolOption = {
  id: "brushStampTexture",
  kind: "slider",
  label: "Stamp texture",
  title: "Bristle lanes along the stroke; 0% is the plain round dab and 100% is the full effect",
  min: 0,
  max: 1,
  step: 0.01,
  format: (value) => `${Math.round(value * 100)}%`,
  read: (snapshot) => snapshot.brush.stampTexture,
  write: (actions, stampTexture) => actions.setBrush({ stampTexture }),
  visible: (snapshot) => snapshot.brush.stamp,
  placement: "popover",
  brushField: "stampTexture",
};

const brushPressureSizeOption: ToggleToolOption = {
  id: "brushPressureSize",
  kind: "toggle",
  label: "Pressure size",
  title: "Pen pressure controls stroke width (ignored by mouse input)",
  read: (snapshot) => snapshot.brush.pressureSize > 0,
  write: (actions, on) => actions.setBrush({ pressureSize: on ? PRESSURE_STRENGTH : 0 }),
  placement: "popover",
  brushField: "pressureSize",
};

const brushPressureOpacityOption: ToggleToolOption = {
  id: "brushPressureOpacity",
  kind: "toggle",
  label: "Pressure opacity",
  title: "Pen pressure controls stroke opacity",
  read: (snapshot) => snapshot.brush.pressureOpacity > 0,
  write: (actions, on) => actions.setBrush({ pressureOpacity: on ? PRESSURE_STRENGTH : 0 }),
  placement: "popover",
  brushField: "pressureOpacity",
};

/**
 * Every brush control, in the order the brush group shows them.
 *
 * The order is the order of use: the two controls that change with every
 * stroke are inline, and the rest live in the popover.
 */
const BRUSH_OPTIONS: readonly ToolOption[] = [
  brushSizeOption,
  brushOpacityOption,
  brushHardnessOption,
  brushSamplingOption,
  brushStabilizerOption,
  brushTextureOption,
  brushStampOption,
  brushStampSpacingOption,
  brushStampHardnessOption,
  brushStampTextureOption,
  brushPressureSizeOption,
  brushPressureOpacityOption,
];

/* ---------------------------------------------------------------- the shape */

const shapeFillOption: ToggleToolOption = {
  id: "shapeFill",
  kind: "toggle",
  label: "Fill shape",
  title: "Fill the shape's interior instead of tracing just its outline",
  // Only the shapes that enclose an area can be filled.
  visible: (snapshot) => getToolDefinition(snapshot.toolId).fillable === true,
  read: (snapshot) => snapshot.shapeFill,
  write: (actions, filled) => actions.setShapeFill(filled),
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
  visible: (snapshot) => snapshot.toolId === "polygon" || snapshot.toolId === "star",
  read: (snapshot) => snapshot.shapeSides,
  write: (actions, sides) => actions.setShapeSides(sides),
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
  visible: (snapshot) => snapshot.toolId === "star",
  read: (snapshot) => snapshot.shapeInnerRatio,
  // Snapped to the step, so the number box and the slider's thumb can never
  // show two different ratios.
  write: (actions, ratio) =>
    actions.setShapeInnerRatio(Math.round(ratio / SHAPE_INNER_RATIO_STEP) * SHAPE_INNER_RATIO_STEP),
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
  visible: (snapshot) => snapshot.toolId === "polygon" || snapshot.toolId === "star",
  read: (snapshot) => snapshot.shapeRotation,
  write: (actions, degrees) => actions.setShapeRotation(degrees),
};

/* ------------------------------------------------------------- the selection */

const selectionDuplicateOption: ActionToolOption = {
  id: "selectionDuplicate",
  kind: "action",
  label: "Duplicate",
  title: "Copy the selected strokes above the originals",
  shortcut: "Ctrl+D",
  disabled: (snapshot) => snapshot.selectedStrokes === 0,
  run: (actions) => actions.duplicateSelection(),
};

const selectionFlipHorizontalOption: ActionToolOption = {
  id: "selectionFlipHorizontal",
  kind: "action",
  label: "Flip H",
  title: "Reflect the selected strokes about their own vertical centre line",
  shortcut: "Ctrl+Shift+H",
  disabled: (snapshot) => snapshot.selectedStrokes === 0,
  run: (actions) => actions.flipSelection("horizontal"),
};

const selectionFlipVerticalOption: ActionToolOption = {
  id: "selectionFlipVertical",
  kind: "action",
  label: "Flip V",
  title: "Reflect the selected strokes about their own horizontal centre line",
  shortcut: "Ctrl+Shift+V",
  disabled: (snapshot) => snapshot.selectedStrokes === 0,
  run: (actions) => actions.flipSelection("vertical"),
};

const selectionDeleteOption: ActionToolOption = {
  id: "selectionDelete",
  kind: "action",
  label: "Delete",
  title: "Remove the selected strokes from the layer",
  shortcut: "Delete",
  disabled: (snapshot) => snapshot.selectedStrokes === 0,
  run: (actions) => actions.deleteSelection(),
};

const selectionDeselectOption: ActionToolOption = {
  id: "selectionDeselect",
  kind: "action",
  label: "Deselect",
  title: "Drop the selection and its overlay",
  shortcut: "Esc",
  disabled: (snapshot) => snapshot.selectedStrokes === 0,
  run: (actions) => actions.clearSelection(),
};

/* ------------------------------------------------------------------ the fill */

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
  write: (actions, tolerance) => actions.setFillTolerance(tolerance),
};

/* -------------------------------------------------------------- the gradient */

const gradientRadialOption: ToggleToolOption = {
  id: "gradientRadial",
  kind: "toggle",
  label: "Radial",
  title: "Draw a radial gradient from the start point instead of a linear one",
  read: (snapshot) => snapshot.gradientType === "radial",
  write: (actions, radial) => actions.setGradientType(radial ? "radial" : "linear"),
};

const gradientEndColorOption: ColorToolOption = {
  id: "gradientEndColor",
  kind: "color",
  label: "To",
  title: "Colour the next gradient fades to; its start colour is the current brush colour",
  read: (snapshot) => snapshot.gradientEndColor,
  write: (actions, color) => actions.setGradientEndColor(color),
};

/* ---------------------------------------------------------------- the groups */

/** The controls of each group, before the tool filter is applied. */
const GROUP_FIELDS: Record<ToolOptionGroupId, readonly ToolOption[]> = {
  brush: BRUSH_OPTIONS,
  shape: [shapeSidesOption, shapeInnerRatioOption, shapeRotationOption, shapeFillOption],
  selection: [
    selectionDuplicateOption,
    selectionFlipHorizontalOption,
    selectionFlipVerticalOption,
    selectionDeleteOption,
    selectionDeselectOption,
  ],
  fill: [fillToleranceOption],
  gradient: [gradientRadialOption, gradientEndColorOption],
};

/** The group's name, used for the region's accessible label. */
const GROUP_LABELS: Record<ToolOptionGroupId, string> = {
  brush: "Brush",
  shape: "Shape",
  selection: "Selection",
  fill: "Fill",
  gradient: "Gradient",
};

/**
 * The brush fields each tool consumes.
 *
 * A shape traces an outline: it has a width, an opacity, a soft edge and a
 * grain, but no sample density, no stabilizer, no dabs and no pressure - the
 * geometry comes from the drag, not from a sampled path. A gradient captures
 * the brush's colour and opacity and nothing else, so it has no size.
 */
const FULL_BRUSH_FIELDS: readonly BrushOptionField[] = [
  "size",
  "opacity",
  "hardness",
  "sampling",
  "stabilizer",
  "texture",
  "stamp",
  "stampSpacing",
  "stampHardness",
  "stampTexture",
  "pressureSize",
  "pressureOpacity",
];

const SHAPE_BRUSH_FIELDS: readonly BrushOptionField[] = [
  "size",
  "opacity",
  "hardness",
  "texture",
];

const GRADIENT_BRUSH_FIELDS: readonly BrushOptionField[] = ["opacity"];

const BRUSH_FIELDS_BY_TOOL: Partial<Record<ToolId, readonly BrushOptionField[]>> = {
  brush: FULL_BRUSH_FIELDS,
  eraser: FULL_BRUSH_FIELDS,
  line: SHAPE_BRUSH_FIELDS,
  rectangle: SHAPE_BRUSH_FIELDS,
  ellipse: SHAPE_BRUSH_FIELDS,
  polygon: SHAPE_BRUSH_FIELDS,
  star: SHAPE_BRUSH_FIELDS,
  gradient: GRADIENT_BRUSH_FIELDS,
};

/**
 * The groups each tool shows, in order.
 *
 * A tool with no entry has no options of its own: the picker, the guides and
 * pan have none, and the strip says what the tool does instead of showing a
 * row of dead controls.
 */
export const TOOL_OPTION_GROUP_IDS: Partial<Record<ToolId, readonly ToolOptionGroupId[]>> = {
  brush: ["brush"],
  eraser: ["brush"],
  line: ["brush"],
  rectangle: ["brush", "shape"],
  ellipse: ["brush", "shape"],
  polygon: ["brush", "shape"],
  star: ["brush", "shape"],
  select: ["selection"],
  bucket: ["fill"],
  gradient: ["brush", "gradient"],
  picker: [],
  guides: [],
  pan: [],
};

/**
 * The controls a group shows for the active tool.
 *
 * A group's fields are filtered twice: the brush group keeps only the fields
 * the tool consumes, and every group keeps only the fields whose own
 * visibility rule holds for the current snapshot.
 */
export function toolOptionFields(
  groupId: ToolOptionGroupId,
  toolId: ToolId,
  snapshot: EditorSnapshot,
): readonly ToolOption[] {
  const fields = GROUP_FIELDS[groupId];
  const brushFields =
    groupId === "brush" ? (BRUSH_FIELDS_BY_TOOL[toolId] ?? []) : null;
  return fields.filter((option) => {
    if (brushFields !== null && option.brushField !== undefined) {
      if (!brushFields.includes(option.brushField)) {
        return false;
      }
    }
    return option.visible?.(snapshot) ?? true;
  });
}

/**
 * The groups the options bar shows for the active tool.
 *
 * A group with no visible control is dropped: the strip shows what the tool
 * can do, not a group heading over nothing.
 */
export function toolOptionGroups(
  toolId: ToolId,
  snapshot: EditorSnapshot,
): readonly ToolOptionGroup[] {
  const ids = TOOL_OPTION_GROUP_IDS[toolId] ?? [];
  const groups: ToolOptionGroup[] = [];
  for (const id of ids) {
    const fields = toolOptionFields(id, toolId, snapshot);
    if (fields.length === 0) {
      continue;
    }
    groups.push({ id, label: GROUP_LABELS[id], fields });
  }
  return groups;
}

/**
 * True when the tool's drawing reads the brush group.
 *
 * The colour always stays available through the colour panel, so the brush
 * group is hidden for the tools that do not paint with a brush: the selection
 * marquee, the picker, the composition guides and pan. The bucket keeps its
 * own tolerance option, and the gradient keeps the brush opacity its record
 * captures.
 */
export function toolShowsBrushControls(toolId: ToolId): boolean {
  return (BRUSH_FIELDS_BY_TOOL[toolId] ?? []).length > 0;
}

/**
 * True when the tool uses every brush field.
 *
 * The brush and the eraser do: a stroke samples the pointer path, so the
 * sampling, the stabilizer, the dabs and the pressure all apply. A shape or a
 * gradient uses only part of the brush, so the preset picker - which replaces
 * the whole brush - is not offered for them.
 */
export function toolUsesWholeBrush(toolId: ToolId): boolean {
  return BRUSH_FIELDS_BY_TOOL[toolId] === FULL_BRUSH_FIELDS;
}
