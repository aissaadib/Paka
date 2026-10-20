/**
 * Brush configuration.
 *
 * This is *configuration only*. Sampling lives in `core/input`, stroke
 * processing in `core/brushes` and rasterization in `core/rendering`. Every
 * field below is implemented by those modules today; unimplemented concepts
 * (texture, stabilizers, blending modes) are intentionally absent so the
 * configuration cannot claim capabilities the engine does not have.
 */

export interface BrushSettings {
  /** Stroke diameter in document pixels at full pressure. */
  readonly size: number;
  /** Opacity of the whole stroke in `[0, 1]`. */
  readonly opacity: number;
  /** CSS color of the stroke. */
  readonly color: string;
  /**
   * Edge falloff of the stroke, in `[0, 1]`.
   *
   * `1` is the hard, antialiased edge of a plain stroke; lower values soften
   * the outer edge by blurring the finished stroke silhouette once, so the
   * interior keeps full coverage and self-overlap still cannot darken. The
   * radius is proportional to `size`, so the setting reads the same at any
   * brush diameter; the cost is that the soft edge extends slightly beyond the
   * hard diameter (see `strokeFeatherRadius`).
   */
  readonly hardness: number;
  /**
   * How strongly pressure modulates diameter, in `[0, 1]`.
   * 0 = constant size, 1 = diameter scales linearly with pressure.
   */
  readonly pressureSize: number;
  /**
   * How strongly pressure modulates opacity, in `[0, 1]`.
   * 0 = constant opacity, 1 = opacity scales linearly with pressure.
   */
  readonly pressureOpacity: number;
  /** Diameter floor as a fraction of `size`, in `[0, 1]`. */
  readonly minSizeRatio: number;
  /**
   * Distance between interpolated samples as a fraction of `size`.
   * Lower values produce smoother curves for fast input at a memory cost.
   */
  readonly spacing: number;
}
