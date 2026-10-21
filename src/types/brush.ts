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
  /**
   * Whether the stroke is rasterized as a chain of dabs instead of segments.
   *
   * `false` is the plain segment path, which is what every stroke drawn
   * before the stamp engine existed uses. `true` places round dabs along the
   * stored path at `stampSpacing` intervals and unions their coverage, so the
   * stroke keeps its own opacity and never darkens where dabs overlap. The
   * stamp is a *rasterization strategy*: the stored samples stay the
   * authoritative record, and the setting is captured per stroke.
   */
  readonly stamp: boolean;
  /**
   * Distance between dab centres, as a fraction of the brush size.
   *
   * This is **not** `spacing`, which is the density of the stored samples: the
   * dab distance is measured against the brush's nominal size, so a 10 % dab
   * spacing is 0.1 * `size` document pixels apart. Lower values place more
   * dabs and make the stroke smoother (and more expensive to rasterize); the
   * maximum is the brush's own diameter, where the dabs just touch.
   */
  readonly stampSpacing: number;
  /**
   * Radial falloff of one dab, in `[0, 1]`.
   *
   * `1` is a crisp dab edge with a one-pixel antialiased rim. Lower values
   * widen the falloff towards the dab's centre, which is a true hardness
   * curve rather than a blur of the finished silhouette. It is independent of
   * `hardness`, which feathers the whole stroke after its coverage exists.
   */
  readonly stampHardness: number;
  /**
   * Strength of the **per-dab directional texture**, in `[0, 1]`.
   *
   * `0` is the plain round dab, byte for byte as before this field existed.
   * Above `0` each dab's coverage is modulated by a set of bristle lanes that
   * run **along the path**, so a stroke reads as a bundle of streaks rather
   * than a line of dots - the way a bristle or a ribbed brush marks.
   *
   * This is **not** {@link texture}, which is one document-anchored grain pass
   * over the finished coverage and applies to every stroke. The per-dab
   * texture only applies to a stamped stroke, is multiplied into a dab's
   * coverage *before* the dabs are unioned, and therefore can only ever
   * remove ink - a stroke still cannot darken where its dabs overlap.
   *
   * The lanes are laid out in the brush's own frame and follow the path's
   * direction, so they rotate with the stroke. The pattern is a function of
   * the document coordinates and the dab's direction only: it is the same in
   * live drawing, in a layer rebuild, after undo/redo, in a reopened project
   * and in a PNG export, at every zoom and `rasterScale`.
   */
  readonly stampTexture: number;
}
