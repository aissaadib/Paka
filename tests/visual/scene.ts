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

export type SceneBlendMode = "normal" | "multiply" | "screen";

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

export type SceneElement = SceneStroke | SceneFill | SceneGradient;

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

export interface SceneLayer {
  /** The layer's name; it is also the layer's identity in the document. */
  readonly id: string;
  readonly opacity?: number;
  readonly blendMode?: SceneBlendMode;
  readonly visible?: boolean;
  readonly elements: readonly SceneElement[];
}

export interface Scene {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly background?: string;
  readonly layers: readonly SceneLayer[];
  /** The composition guides; omitted means the document has none. */
  readonly guides?: readonly SceneGuide[];
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
  readonly liveVsRebuiltDiffering: number;
  readonly rebuiltVsExportedDiffering: number;
  readonly firstDifference: { x: number; y: number } | null;
  readonly size: { width: number; height: number };
}
