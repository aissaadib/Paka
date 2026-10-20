/**
 * Brush configuration.
 *
 * This is *configuration only*. Sampling lives in `core/input`, stroke
 * processing in `core/brushes` and rasterization in `core/rendering`. Every
 * field below is implemented by those modules today; unimplemented concepts
 * (texture, blending modes) are intentionally absent so the configuration
 * cannot claim capabilities the engine does not have.
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
  /**
   * Pointer smoothing strength in `[0, 1]`.
   *
   * `0` follows the pointer exactly. Higher values apply an exponential average
   * to the incoming path before samples are captured: the line lags behind the
   * pointer while moving and settles to the release point on `finish()`. The
   * stored samples are the smoothed path, so live drawing, undo/redo, reopen and
   * export all replay exactly what was shown. It affects the brush and eraser,
   * not shape tools, whose geometry comes from the drag rather than the path.
   */
  readonly stabilizer: number;
  /**
   * Deterministic grain over the finished stroke coverage, in `[0, 1]`.
   *
   * `0` keeps the plain coverage byte-identical. Higher values multiply the
   * stroke's coverage by a document-anchored noise tile once, after the
   * hardness feather, so the grain is the same in live drawing, layer rebuilds,
   * undo/redo, reopen and PNG export. It is not a per-dab texture and cannot
   * change with zoom or `rasterScale`. It applies to the brush, eraser and
   * shapes through the same coverage path.
   */
  readonly texture: number;
}
