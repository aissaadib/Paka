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
 * Read-only access to the stroke data stored for the document.
 *
 * Anything that needs strokes without needing to change them - the renderer
 * when it re-rasterizes a layer, the project writer when it serializes - takes
 * this interface rather than the `StrokeStore` itself.
 */
export interface StrokeSource {
  listStrokes(layerId: LayerId): readonly StrokeRecord[];
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
