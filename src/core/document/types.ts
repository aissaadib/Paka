/**
 * Document model.
 *
 * A document is pure metadata: dimensions, background and an ordered list of
 * layers. Pixel data is *not* stored here; it lives in the renderer's layer
 * surfaces, while the stroke list that produced it lives in `StrokeStore`.
 * That separation keeps the document cheap to copy, easy to serialize, and
 * independent from whichever renderer is active.
 */

import type { BrushSettings } from "../../types/brush";

export type LayerId = string;

/**
 * Layer compositing mode. Only `normal` is implemented by the Canvas 2D
 * compositor today; the field exists so layer data and UI can carry a mode
 * once the compositor supports more.
 */
export type LayerBlendMode = "normal";

export interface Layer {
  readonly id: LayerId;
  readonly name: string;
  readonly visible: boolean;
  /** Layer opacity in `[0, 1]`. */
  readonly opacity: number;
  readonly blendMode: LayerBlendMode;
}

/** Mutable fields of a layer that user actions may change. */
export type LayerPatch = Partial<Pick<Layer, "name" | "visible" | "opacity" | "blendMode">>;

export interface DrawingDocument {
  readonly id: string;
  readonly name: string;
  /** Logical width in document pixels, independent of display resolution. */
  readonly width: number;
  /** Logical height in document pixels, independent of display resolution. */
  readonly height: number;
  /** Paper color painted below all layers. */
  readonly background: string;
  /** Bottom-first layer order: index 0 is the bottom-most layer. */
  readonly layers: readonly Layer[];
  readonly activeLayerId: LayerId | null;
}

/**
 * Read-only access to the content stored for the document.
 *
 * Anything that needs layer content without needing to change it - the renderer
 * when it re-rasterizes a layer, the project writer when it serializes - takes
 * this interface rather than the `StrokeStore` itself.
 *
 * `listElements` is the authoritative painting order: strokes, pixel fills and
 * gradients interleave exactly as the user made them. `listStrokes` is a
 * filtered view for stroke-only features (selection, transforms) and never
 * includes a non-stroke element.
 */
export interface StrokeSource {
  listStrokes(layerId: LayerId): readonly StrokeRecord[];
  listElements(layerId: LayerId): readonly LayerElement[];
}

/**
 * A captured stroke: brush configuration plus parallel sample arrays.
 *
 * Arrays are structure-of-arrays on purpose. Appending numbers to `xs`/`ys`
 * during capture allocates no per-sample objects, which keeps the input hot
 * path free of garbage. Sample `i` is `(xs[i], ys[i], pressures[i], times[i])`.
 *
 * A stroke is self-describing: it carries the brush it was drawn with and
 * whether it added or removed coverage, so re-rasterizing a layer after undo,
 * reopen or resize reproduces the pixels without consulting tool state.
 */
export interface StrokeRecord {
  readonly id: string;
  readonly layerId: LayerId;
  readonly brush: BrushSettings;
  /**
   * True when this stroke erased instead of painted. Absent means paint, which
   * keeps brush strokes and older project files free of a redundant field.
   */
  readonly erase?: boolean;
  /**
   * True when the stroke's samples are the outline of a region to *fill*, not a
   * path to trace. Only shape tools set it, and only for kinds whose outline
   * encloses an area; a line has no interior, so it is never filled. Absent means
   * an ordinary stroked path, which keeps every other stroke free of a redundant
   * field.
   *
   * A fill is still a stroke: same samples, same brush, same history entry, same
   * place in the project file. That is what keeps the stroke list authoritative -
   * the interior is rasterized from the outline every time the layer is rebuilt,
   * so undo, reopen and export reproduce it without a second kind of content.
   */
  readonly fill?: boolean;
  readonly xs: number[];
  readonly ys: number[];
  readonly pressures: number[];
  readonly times: number[];
  /** Timestamp of the first sample; used for future velocity/stabilizer work. */
  startTime: number;
}

/**
 * A committed bucket fill: a bounded, pixel-accurate raster patch.
 *
 * This is deliberately **not** a traced polygon. The fill's boundary is the set
 * of pixels the flood selected, so the stored mask is the result itself; a
 * reopened project and a redo reproduce those exact pixels instead of
 * re-deriving a region from whatever the composite happens to look like later.
 *
 * The patch is bounded to the filled pixels' bounding box (`width * height`
 * coverage bytes, never a full-canvas copy for a small fill). Byte `i` is the
 * coverage of pixel `(x + i % width, y + floor(i / width))`: `0` leaves the
 * layer alone, `255` paints the patch colour at full coverage. The mask is
 * binary in this first implementation - anti-aliased boundary pixels either
 * match the tolerance and are filled, or they do not - which is what keeps a
 * save/reopen and an undo/redo byte-identical.
 *
 * Patches, strokes and gradients share one ordered list on a layer
 * (`LayerElement`), so a stroke drawn after a fill paints above it and undo can
 * restore painting order exactly.
 */
export interface FillPatchRecord {
  readonly id: string;
  readonly layerId: LayerId;
  /** Discriminator for the `LayerElement` union. */
  readonly kind: "fill";
  /** Opaque colour the flood wrote, as a CSS colour string. */
  readonly color: string;
  /** Bounding-box origin and size in document pixels. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** `width * height` coverage bytes. */
  readonly mask: Uint8Array;
}

/** One colour stop in a gradient. `offset` is `0..1` along the gradient axis. */
export interface GradientStop {
  readonly offset: number;
  /** CSS hex colour (`#rrggbb` or `#rgb`). */
  readonly color: string;
}

/**
 * A committed gradient: a per-pixel colour function over the whole layer.
 *
 * Unlike a fill patch this stores **geometry plus colour stops**, not pixels.
 * The renderer can therefore rebuild it from the document at any time (undo,
 * reopen, resize) with no snapshot: it is deterministic content, like a stroke.
 * The element list keeps gradients in painting order with strokes and fills.
 *
 * `linear` interpolates from `(x1, y1)` to `(x2, y2)`. `radial` centres on
 * `(x1, y1)` and uses the distance to `(x2, y2)` as its outer radius. `opacity`
 * is applied once when the gradient paints, like a stroke's opacity.
 */
export interface GradientRecord {
  readonly id: string;
  readonly layerId: LayerId;
  readonly kind: "gradient";
  readonly type: "linear" | "radial";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stops: readonly GradientStop[];
  /** Whole-element alpha, `0..1`. */
  readonly opacity: number;
}

/** One item of a layer's authoritative content, in painting order. */
export type LayerElement = StrokeRecord | FillPatchRecord | GradientRecord;

/** Narrows a layer element to a bucket-fill patch. */
export function isFillPatch(element: LayerElement): element is FillPatchRecord {
  return (element as FillPatchRecord).kind === "fill";
}

/** Narrows a layer element to a gradient. */
export function isGradient(element: LayerElement): element is GradientRecord {
  return (element as GradientRecord).kind === "gradient";
}

/** Narrows a layer element to a stroke (the only element without a `kind`). */
export function isStroke(element: LayerElement): element is StrokeRecord {
  return !isFillPatch(element) && !isGradient(element);
}
