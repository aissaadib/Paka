/**
 * Declarative tool options.
 *
 * A small typed schema for option controls that share one shape: a slider over
 * a numeric field or a toggle over a flag, where the field is read from the
 * editor snapshot and written through an `EditorActions` method.
 *
 * Only genuinely common fields live here. Brush controls keep their own
 * component because the pressure-curve editor is not a slider, and the gradient
 * stop editor is not a toggle. The schema exists to stop rectangle, ellipse,
 * polygon, star and bucket from each carrying their own copy of the same
 * "visible for this tool, read this field, call this action" wiring.
 */

import {
  MAX_SHAPE_INNER_RATIO,
  MAX_SHAPE_SIDES,
  MIN_SHAPE_INNER_RATIO,
  MIN_SHAPE_SIDES,
  SHAPE_INNER_RATIO_STEP,
} from "../../core/tools/shapeGeometry";
import type { EditorSnapshot } from "../../core/engine/DrawingEngine";
import type { EditorActions } from "../../state/editorStore";
import type { ToolId } from "../../types/tool";

/** A label, or a function of the snapshot when the label follows the tool. */
export type ToolOptionLabel = string | ((snapshot: EditorSnapshot) => string);

interface ToolOptionBase {
  /** Stable id, unique within one tool's field list. */
  readonly id: string;
  readonly label: ToolOptionLabel;
  readonly title?: string;
  /** Extra visibility rule on top of the section's tool association. */
  readonly visible?: (snapshot: EditorSnapshot) => boolean;
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

export type ToolOption = SliderToolOption | ToggleToolOption;

/** Resolves a label against the current snapshot. */
export function toolOptionLabel(option: ToolOption, snapshot: EditorSnapshot): string {
  return typeof option.label === "function" ? option.label(snapshot) : option.label;
}

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
  bucket: [fillToleranceOption],
};

/** The options a tool shows right now, after per-field visibility rules. */
export function visibleToolOptions(
  toolId: ToolId,
  snapshot: EditorSnapshot,
): readonly ToolOption[] {
  const fields = TOOL_OPTION_FIELDS[toolId] ?? [];
  return fields.filter((option) => option.visible?.(snapshot) ?? true);
}

/**
 * Tools whose drawing reads the brush group.
 *
 * Colour always stays available through the colour panel. The brush group is
 * hidden for tools that do not paint with a brush: the selection marquee, the
 * picker, the composition guides and pan. The bucket keeps its own tolerance
 * option, and the gradient keeps the brush opacity that its record captures.
 */
export function toolShowsBrushControls(toolId: ToolId): boolean {
  switch (toolId) {
    case "brush":
    case "eraser":
    case "line":
    case "rectangle":
    case "ellipse":
    case "polygon":
    case "star":
    case "gradient":
      return true;
    case "select":
    case "bucket":
    case "picker":
    case "guides":
    case "pan":
      return false;
  }
}
