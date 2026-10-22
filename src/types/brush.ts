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
 * The shape of a dab's tip.
 *
 * A tip is the mask a stamped stroke is drawn with. Every kind is a bounded,
 * procedural shape described by a couple of numbers - never a blob of pixels -
 * so a project file stays small and the parser can validate what it reads.
 *
 * - `round` is the plain disc the stamp engine has always drawn. It is the
 *   default, and it is byte for byte the picture every earlier file produced.
 * - `ellipse` is a stretched disc: the brush's size is the **major** axis and
 *   {@link BrushSettings.stampAspect} shortens the minor one, so the tip can
 *   be long and narrow.
 * - `square` is a rectangle with the same two axes: a chisel mark rather than
 *   a round one.
 */
export type StampTipKind = "round" | "ellipse" | "square";

/**
 * The profile of the per-dab texture.
 *
 * - `bristles` is a bundle of irregular bristles: every lane holds one bristle
 *   whose width and place come from a fixed hash of the lane's index, so the
 *   texture looks hand-made.
 * - `ridges` is a regular ribbed brush: every lane holds one centred ridge of
 *   the same width, so the texture looks machined.
 *
 * Both profiles are laid out against the brush's centre line, so the per-pixel
 * maximum union keeps them instead of filling them in.
 */
export type StampTextureMode = "bristles" | "ridges";

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
   * The profile of the per-dab texture.
   *
   * `bristles` is the bundle of irregular bristles every earlier file was
   * written by; `ridges` is a regular ribbed brush. The profile only changes
   * the shape of the lanes, never where they are: both are laid out against
   * the brush's centre line, so the union still keeps them.
   *
   * Required from project format 14.
   */
  readonly stampTextureMode: StampTextureMode;
  /**
   * How many bristle lanes there are across the brush, as a multiple of the
   * default four, in `[0.25, 4]`.
   *
   * `1` is the density every earlier file was written by. A higher value
   * packs more lanes into the same brush, a lower one spreads them out. The
   * lanes are measured against the brush's **nominal** size, so the pattern
   * stays the same in document pixels at every zoom and `rasterScale`.
   */
  readonly stampTextureScale: number;
  /**
   * How crisp the texture's edges are, in `[0, 1]`.
   *
   * `1` is the crisp one-device-pixel bristle edge every earlier file was
   * written by. Lower values widen the edge into a soft ramp, so the texture
   * reads as a smooth variation rather than as separate bristles.
   */
  readonly stampTextureContrast: number;
  /**
   * The shape of a dab's tip.
   *
   * `round` is the plain disc the stamp engine has always drawn, and it is
   * the default: a stroke drawn with it is byte for byte the stroke every
   * earlier file produced. `ellipse` and `square` are the tipped shapes - the
   * tip is the *mask* the dabs are painted with, so a tipped stroke is a
   * different picture and the field is required from project format 13.
   *
   * A tip only applies to a stamped stroke: the plain segment path has no
   * dabs to tip.
   */
  readonly stampTip: StampTipKind;
  /**
   * The tip's minor axis as a fraction of its major axis, in `(0, 1]`.
   *
   * `1` is a tip as wide as it is long - a disc, or a square. Lower values
   * make the tip long and narrow, which is what a flat or chisel brush does.
   * The brush's `size` is the **major** axis, so a tip with a smaller aspect
   * paints a stroke narrower along its length than the size suggests.
   *
   * A round tip ignores it: a disc has no minor axis to shorten.
   */
  readonly stampAspect: number;
  /**
   * The tip's angle, in degrees.
   *
   * With `stampAngleFollow` off it is the tip's absolute angle: the tip points
   * that way whatever the stroke does. With `stampAngleFollow` on it is the
   * **offset** from the stroke's direction, so `0` points the tip along the
   * path and `90` turns it across it.
   */
  readonly stampAngle: number;
  /**
   * Whether the tip turns with the stroke.
   *
   * `true` points the tip along the path (plus the `stampAngle` offset),
   * which is what a flat or chisel brush does: the mark is long along the
   * stroke and narrow across it. `false` keeps the tip at a fixed angle, so a
   * stroke that turns draws the same mark throughout.
   */
  readonly stampAngleFollow: boolean;
}
