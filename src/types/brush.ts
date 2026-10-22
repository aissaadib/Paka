/**
 * Brush configuration.
 *
 * This is *configuration only*. Sampling lives in `core/input`, stroke
 * processing in `core/brushes` and rasterization in `core/rendering`. Every
 * field below is implemented by those modules today; unimplemented concepts
 * (texture, blending modes) are intentionally absent so the configuration
 * cannot claim capabilities the engine does not have.
 */

/**
 * One point of a pressure-response curve.
 *
 * `x` is the raw pressure the device reported and `y` is the pressure the
 * brush uses, both in `[0, 1]`. A point at `(0, 0)` and one at `(1, 1)` is the
 * identity mapping every file written before the curve existed behaves like.
 */
export interface PressureCurvePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The width ramp at the start and the end of a stroke.
 *
 * A taper narrows the stroke towards its two ends, so a stroke can end in a
 * clean point instead of a blunt cap. The model is deliberately small:
 *
 *  - `startLength` and `endLength` are the length of the ramp, as a fraction
 *    of the brush's nominal size, so a taper means the same thing at every
 *    brush size, at every zoom and at every `rasterScale`.
 *  - `startStrength` and `endStrength` are how much narrower the stroke is at
 *    the very tip, as a fraction of its full width: `0` is no taper at all
 *    and `1` is a point.
 *  - The width ramps linearly along the path between the two.
 *
 * The taper applies to the stroke's **width**, not to its opacity: a stroke
 * gets one alpha for its whole coverage (see `strokeOpacity`), so a fade
 * could not be expressed per sample without breaking the rule that a stroke
 * never darkens where it overlaps itself.
 */
export interface TaperSettings {
  /** Whether the taper is applied at all. */
  readonly enabled: boolean;
  /** Length of the start ramp, as a fraction of the brush size. */
  readonly startLength: number;
  /** How much narrower the stroke is at its very start, as a fraction of its full width. */
  readonly startStrength: number;
  /** Length of the end ramp, as a fraction of the brush size. */
  readonly endLength: number;
  /** How much narrower the stroke is at its very end, as a fraction of its full width. */
  readonly endStrength: number;
}

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
  /**
   * Maps raw device pressure to the pressure the brush reacts to.
   *
   * Evaluated exactly once, at the brush's mapping boundary: stored samples
   * keep the raw device pressure, so the mapping is the same in live drawing,
   * a layer rebuild, undo/redo, a reopened project and export, and it is never
   * applied twice. The identity curve (`(0,0) -> (1,1)`) reproduces the old
   * linear behaviour exactly; a curve can flatten, steepen or invert a part of
   * the response without changing the stroke geometry.
   */
  readonly pressureCurve: readonly PressureCurvePoint[];
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
  /**
   * The width ramp at the start and the end of the stroke.
   *
   * `enabled` is off by default, so every stroke drawn before the taper
   * existed is byte for byte unchanged. The taper is captured per stroke like
   * every other appearance field, and it is applied to the **width**: the
   * pressure response is evaluated first (the curve, then the size factor),
   * and the taper multiplies the diameter that comes out of it, so a taper can
   * narrow a stroke below the brush's minimum size - that is what makes a
   * point possible. A stroke that has no path (a tap) or no length (the
   * pointer did not move) is drawn at its full width: there is nothing for a
   * ramp to run along.
   *
   * The dab engine draws its own dabs, so a stamped stroke keeps the plain
   * dab plan and the taper does not apply to it.
   */
  readonly taper: TaperSettings;
}
