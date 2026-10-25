/**
 * The scene schema for the visual-regression harness.
 *
 * A scene is **data**: a description of a document, not a script. The harness
 * renders it through the product's own renderer, so a new capability is
 * added by adding a scene file, never by changing the runner.
 *
 * The schema deliberately has **no text element**. Font rendering differs
 * between machines, so a text scene's golden could not be stable; the text
 * tool's font policy is still open (decision D-1, question Q-a).
 */

import type { ShapeGeometry } from "/src/core/document/types";

export type SceneBlendMode = "normal" | "multiply" | "screen";

/**
 * A transform applied to a stroke's samples before it is drawn.
 *
 * The transform is the **product's own**: the harness runs the same scale and
 * rotation maps the editor runs on a selection, so the golden pins what a
 * transformed selection really looks like rather than a picture of a
 * hand-written approximation.
 *
 * The centre is stated in document pixels, because a transform is always about
 * a centre - the centre of the selection's frame, in the editor.
 */
export interface SceneTransform {
  /** Uniform scale factor about the centre. */
  readonly scale?: number;
  /** Clockwise rotation in degrees about the centre. */
  readonly rotateDegrees?: number;
  /** The centre of the transform, in document pixels. */
  readonly centerX: number;
  readonly centerY: number;
}

/** A painted or erasing stroke. */
export interface SceneStroke {
  readonly kind: "stroke";
  /** Brush settings; omitted fields come from the product's default brush. */
  readonly brush?: Readonly<Record<string, unknown>>;
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly pressures?: readonly number[];
  /** When true the stroke subtracts coverage instead of painting it. */
  readonly erase?: boolean;
  /**
   * When true the stroke's closed outline is filled before it is traced.
   *
   * The same flag the shape tools write: a filled shape is one stroke whose
   * interior takes the brush colour and whose outline is still traced on top.
   */
  readonly fill?: boolean;
  /** A transform to apply to the samples before the stroke is drawn. */
  readonly transform?: SceneTransform;
}

/** A bucket-fill patch, as the flood fill records it. */
export interface SceneFill {
  readonly kind: "fill";
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** `width * height` coverage bytes; omitted means fully covered. */
  readonly mask?: readonly number[];
}

/** A gradient, as the gradient tool records it. */
export interface SceneGradient {
  readonly kind: "gradient";
  readonly type: "linear" | "radial";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stops: readonly { readonly offset: number; readonly color: string }[];
  readonly opacity?: number;
}

/**
 * A native shape: the primitive and its parameters, as the shape tools record
 * them.
 *
 * The geometry is the document model's own `ShapeGeometry`, so a scene pins the
 * exact record an editor would save - not a polyline approximating it. A shape
 * has no live path (it is committed, not drawn), so a scene that declares one
 * checks the rebuilt layer against the export.
 */
export interface SceneShape {
  readonly kind: "shape";
  readonly geometry: ShapeGeometry;
  /** Brush settings; omitted fields come from the product's default brush. */
  readonly brush?: Readonly<Record<string, unknown>>;
  /** When true the outline's closed interior is filled. */
  readonly fill?: boolean;
}

export type SceneElement = SceneStroke | SceneFill | SceneGradient | SceneShape;

/**
 * A composition guide: a marker on one axis, in document pixels.
 *
 * The guides are display-only, so a scene that declares them pins two
 * pictures: the export, which does not contain them, and the display, which
 * does.
 */
export interface SceneGuide {
  readonly axis: "vertical" | "horizontal";
  readonly position: number;
}

/**
 * The grid overlay a scene draws.
 *
 * The grid is display-only, like the guides: it is painted over the artwork on
 * the display canvas and never reaches an export. The spacing is in **document
 * pixels**, so the same scene at two zooms shows the same lattice at two
 * scales.
 *
 * The zoom belongs to the **display capture** only: the product's invariant is
 * checked at 1x, and the display golden is the picture the user sees.
 */
export interface SceneGrid {
  /** The distance between grid lines, in document pixels. */
  readonly spacing: number;
  /** The zoom of the display capture; 1 by default. */
  readonly zoom?: number;
}

/**
 * A reference image in a scene.
 *
 * The harness synthesizes the picture (a solid `color`, optionally with the
 * left half in `accent`) instead of carrying a base64 file: a reference is
 * drawn through `drawImage`, so a real canvas is a faithful stand-in and the
 * scene stays readable.
 *
 * References are document metadata, not artwork: they are painted on the
 * display canvas and never reach the exported composite. A scene that declares
 * them therefore pins two pictures, like a scene with guides or a grid.
 */
export interface SceneReference {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The picture's own size; the source canvas is built at this size. */
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  /** Clockwise rotation about the centre, in degrees. */
  readonly rotation?: number;
  readonly opacity?: number;
  readonly blendMode?: SceneBlendMode;
  /** Painted after the paper and before the layers when true. */
  readonly behind?: boolean;
  readonly visible?: boolean;
  /** The picture's colour. */
  readonly color: string;
  /** An optional second colour for the left half, to make rotation visible. */
  readonly accent?: string;
}

export interface SceneLayer {
  /** The layer's name; it is also the layer's identity in the document. */
  readonly id: string;
  /**
   * `"group"` for a container; omitted or `"layer"` for a paintable layer.
   *
   * A group owns no elements. Its children are composited as one unit when the
   * group's opacity is below 1 or its blend mode is not normal.
   */
  readonly kind?: "layer" | "group";
  readonly opacity?: number;
  readonly blendMode?: SceneBlendMode;
  readonly visible?: boolean;
  /** The layer's content; empty for a group. */
  readonly elements?: readonly SceneElement[];
  /** A group's children, bottom-first. */
  readonly children?: readonly SceneLayer[];
}

export interface Scene {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly background?: string;
  readonly layers: readonly SceneLayer[];
  /** The composition guides; omitted means the document has none. */
  readonly guides?: readonly SceneGuide[];
  /** The grid overlay; omitted means the document shows no grid. */
  readonly grid?: SceneGrid;
  /** The reference images; omitted means the document has none. */
  readonly references?: readonly SceneReference[];
}

/** True when the element is a stroke, which is the only kind with a live path. */
export function isSceneStroke(element: SceneElement): element is SceneStroke {
  return element.kind === "stroke";
}

/**
 * The result of rendering one scene.
 *
 * It lives here, beside the schema, because both halves of the harness need
 * it: the page produces it and the Playwright spec asserts on it. Neither
 * imports the other, so the spec never pulls the page's module graph into
 * Node.
 */
export interface SceneVerdict {
  readonly sceneId: string;
  /** The live drawing and the rebuilt layer agree, pixel for pixel. */
  readonly liveEqualsRebuilt: boolean;
  /** The rebuilt layer and the export agree, away from the display's border. */
  readonly rebuiltEqualsExported: boolean;
  /** Whether the scene has a live path at all (only strokes do). */
  readonly liveChecked: boolean;
  /** The guides changed the display: they are painted over the artwork. */
  readonly guidesVisible: boolean;
  /** The guides did not change the export: they are display-only. */
  readonly guidesNotExported: boolean;
  /** The grid changed the display: it is painted over the artwork. */
  readonly gridVisible: boolean;
  /** The grid did not change the export: it is display-only. */
  readonly gridNotExported: boolean;
  /** The references changed the display: they are painted around the layers. */
  readonly referencesVisible: boolean;
  /** The references did not change the export: they are not artwork. */
  readonly referencesNotExported: boolean;
  readonly liveVsRebuiltDiffering: number;
  readonly rebuiltVsExportedDiffering: number;
  readonly firstDifference: { x: number; y: number } | null;
  readonly size: { width: number; height: number };
}
