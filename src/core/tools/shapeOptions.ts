/**
 * The shape options: one model for every shape tool.
 *
 * The five shape tools - the line, the rectangle, the ellipse, the polygon and
 * the star - share one set of options, and this module is where that set is
 * written down. Three readers agree on it, and they all read it here:
 *
 * - the **geometry** (`shapeGeometry.ts`) reads the values to place the
 *   vertices and to turn them;
 * - the **engine** (`DrawingEngine.ts`) reads the values to publish them and
 *   to clamp whatever the user sets;
 * - the **controls** (`shapeToolOptions.ts`) read the ranges, the steps and
 *   the labels, so a slider can never offer a value the geometry would
 *   refuse.
 *
 * The options are **editor state**: they describe the *next* shape, they are
 * read when the gesture starts, and changing one is not an edit - no history
 * step, no dirty flag, nothing in the project file. A committed shape stores
 * only its points, so no option needs a file-format field and the format does
 * not move.
 *
 * The table at the bottom of this module is the model. It says what an option
 * *is* - its range, its step, its default, its label - and which shape kinds
 * have it. The value behind a field lives where it already lived: the engine
 * owns the editor state and publishes it in the snapshot, and the controls
 * read it from there. The model is what keeps the three readers from drifting
 * apart.
 */

import { clamp } from "../../utils/math";

/**
 * The shape kinds the shape tools draw.
 *
 * The five ids are also the tool ids, so a shape's kind and the active tool
 * are the same word.
 */
export type ShapeKind = "line" | "rectangle" | "ellipse" | "polygon" | "star";

/** Every shape kind, in the order the tools are offered. */
export const SHAPE_KINDS: readonly ShapeKind[] = [
  "line",
  "rectangle",
  "ellipse",
  "polygon",
  "star",
];

/** True when a tool id names a shape kind. */
export function isShapeKind(value: string): value is ShapeKind {
  return (SHAPE_KINDS as readonly string[]).includes(value);
}

/**
 * The options a shape is drawn with.
 *
 * They describe the *next* shape, not the ones already committed: a committed
 * shape stores only its points, so changing an option never rewrites existing
 * work and never needs a file-format field. The engine owns them (they are
 * editor state, like `shapeFill`) and the tool reads them once, when the
 * gesture starts.
 *
 * - `sides` is the polygon's side count and the star's point count.
 * - `innerRatio` is the star's inner radius as a fraction of its outer radius.
 * - `rotation` turns the outline about the box's centre, in degrees.
 */
export interface ShapeOptions {
  readonly sides: number;
  readonly innerRatio: number;
  readonly rotation: number;
}

/** A polygon needs three sides; 24 is visually a circle and still tiny. */
export const MIN_SHAPE_SIDES = 3;
export const MAX_SHAPE_SIDES = 24;
/**
 * The floor of the star's inner radius.
 *
 * It keeps the outline simple - a star whose valleys reach the centre would
 * pinch - so the non-zero fill fills the star instead of a blob.
 */
export const MIN_SHAPE_INNER_RATIO = 0.05;
export const MAX_SHAPE_INNER_RATIO = 1;

/**
 * The step the inner-radius control moves in.
 *
 * The value is snapped to it, so the slider's thumb and its number box can
 * never show two different ratios.
 */
export const SHAPE_INNER_RATIO_STEP = 0.05;

/** The rotation is a whole number of degrees, and a whole turn is a full turn. */
export const MIN_SHAPE_ROTATION = 0;
export const MAX_SHAPE_ROTATION = 360;
export const SHAPE_ROTATION_STEP = 1;

export const DEFAULT_SHAPE_SIDES = 5;
export const DEFAULT_SHAPE_INNER_RATIO = 0.5;
export const DEFAULT_SHAPE_ROTATION = 0;
/** A shape is an outline until the user asks for its interior to be filled. */
export const DEFAULT_SHAPE_FILL = false;

/** The options a polygon or a star gets before the user changes them. */
export const DEFAULT_SHAPE_OPTIONS: ShapeOptions = {
  sides: DEFAULT_SHAPE_SIDES,
  innerRatio: DEFAULT_SHAPE_INNER_RATIO,
  rotation: DEFAULT_SHAPE_ROTATION,
};

/**
 * Clamps the options into their documented ranges.
 *
 * The geometry clamps too, so an out-of-range value can never produce a
 * degenerate shape; this helper is what the engine's setters use, so the
 * value the user sees is already the value the geometry will use.
 */
export function normalizeShapeOptions(options: ShapeOptions): ShapeOptions {
  return {
    sides: clamp(Math.round(options.sides), MIN_SHAPE_SIDES, MAX_SHAPE_SIDES),
    innerRatio: clamp(options.innerRatio, MIN_SHAPE_INNER_RATIO, MAX_SHAPE_INNER_RATIO),
    rotation: clamp(Math.round(options.rotation), MIN_SHAPE_ROTATION, MAX_SHAPE_ROTATION),
  };
}

/**
 * The ids of the shape options.
 *
 * An id is also the name of the snapshot field the control reads and of the
 * editor action it writes, so the three cannot drift apart.
 */
export type ShapeOptionId =
  | "shapeSides"
  | "shapeInnerRatio"
  | "shapeRotation"
  | "shapeFill";

/** What a shape option is called, and what it is worth before the user acts. */
interface ShapeOptionBase {
  /** Stable id: the registry id, the snapshot field and the action's name. */
  readonly id: ShapeOptionId;
  /** The label the control shows. It may follow the shape kind. */
  readonly label: string | ((kind: ShapeKind) => string);
  /** The tooltip. */
  readonly title: string;
  /** The kinds that have this option. */
  readonly kinds: readonly ShapeKind[];
}

/** A numeric option: a slider over a range. */
export interface ShapeNumberOption extends ShapeOptionBase {
  readonly control: "number";
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** How the value is written out, when the control shows a unit. */
  readonly format?: (value: number) => string;
  readonly defaultValue: number;
}

/** A flag: the shape is filled, or it is not. */
export interface ShapeToggleOption extends ShapeOptionBase {
  readonly control: "toggle";
  readonly defaultValue: boolean;
}

/** One option of a shape tool. */
export type ShapeOptionField = ShapeNumberOption | ShapeToggleOption;

/**
 * Every option a shape tool can have.
 *
 * This is the model the geometry, the engine and the controls all read:
 *
 * - the **sides** count is the polygon's sides and the star's points, so its
 *   label follows the kind: *Sides* for the polygon, *Points* for the star.
 * - the **inner radius** belongs to the star alone: the polygon's valleys are
 *   its own vertices.
 * - the **rotation** turns a shape about the centre of the dragged box. It
 *   belongs to every shape that has a box - the rectangle, the ellipse, the
 *   polygon and the star - and to no other: a line's angle is the drag
 *   itself.
 * - the **fill** belongs to the shapes whose outline bounds an interior. The
 *   line's does not, so the line has no fill.
 */
export const SHAPE_OPTION_FIELDS: readonly ShapeOptionField[] = [
  {
    id: "shapeSides",
    control: "number",
    // One number serves both tools, so the label follows the active one
    // rather than showing "Sides" while a star is selected.
    label: (kind) => (kind === "star" ? "Points" : "Sides"),
    title: "How many sides the next polygon has, or how many points the next star has",
    min: MIN_SHAPE_SIDES,
    max: MAX_SHAPE_SIDES,
    step: 1,
    defaultValue: DEFAULT_SHAPE_SIDES,
    kinds: ["polygon", "star"],
  },
  {
    id: "shapeInnerRatio",
    control: "number",
    label: "Inner radius",
    title: "How deep the star's valleys reach, as a fraction of its outer radius",
    min: MIN_SHAPE_INNER_RATIO,
    max: MAX_SHAPE_INNER_RATIO,
    step: SHAPE_INNER_RATIO_STEP,
    format: (value) => `${Math.round(value * 100)}%`,
    defaultValue: DEFAULT_SHAPE_INNER_RATIO,
    kinds: ["star"],
  },
  {
    id: "shapeRotation",
    control: "number",
    label: "Rotation",
    title: "Turn the outline about the centre of the dragged box",
    min: MIN_SHAPE_ROTATION,
    max: MAX_SHAPE_ROTATION,
    step: SHAPE_ROTATION_STEP,
    format: (value) => `${Math.round(value)}°`,
    defaultValue: DEFAULT_SHAPE_ROTATION,
    kinds: ["rectangle", "ellipse", "polygon", "star"],
  },
  {
    id: "shapeFill",
    control: "toggle",
    label: "Fill shape",
    title: "Fill the shape's interior instead of tracing just its outline",
    defaultValue: DEFAULT_SHAPE_FILL,
    kinds: ["rectangle", "ellipse", "polygon", "star"],
  },
];

/**
 * The options a shape kind has, in the order the toolbar shows them.
 *
 * The order is the order of the table, so the polygon reads *Sides*,
 * *Rotation*, *Fill shape* and the star reads *Points*, *Inner radius*,
 * *Rotation*, *Fill shape*.
 */
export function shapeOptionFieldsFor(kind: ShapeKind): readonly ShapeOptionField[] {
  return SHAPE_OPTION_FIELDS.filter((field) => field.kinds.includes(kind));
}

/** One option by id. */
export function findShapeOptionField(id: ShapeOptionId): ShapeOptionField | undefined {
  return SHAPE_OPTION_FIELDS.find((field) => field.id === id);
}

/** The label an option shows for a shape kind. */
export function shapeOptionLabel(field: ShapeOptionField, kind: ShapeKind): string {
  return typeof field.label === "function" ? field.label(kind) : field.label;
}

/**
 * The value an option has before the user changes it.
 *
 * A number for a slider, a flag for a toggle.
 */
export function defaultShapeOptionValue(id: ShapeOptionId): number | boolean {
  const field = findShapeOptionField(id);
  if (!field) {
    return false;
  }
  return field.defaultValue;
}
