/**
 * Symmetry: the mirror axes and the pure geometry of a mirrored point.
 *
 * Symmetry is **editor state**, like the grid: it describes the *next* gesture
 * and it is not part of the document. It never reaches a layer surface, a PNG
 * export or a project file. What does reach the artwork is the **copy** the
 * symmetry makes, and a copy is an ordinary stroke: the same brush, the same
 * pressure and timing, the same samples mapped through the mirror, stored
 * beside the original. That is what keeps the artwork self-describing - a
 * reopened project, an undo and a PNG export all reproduce the copies without
 * knowing that a symmetry was ever on.
 *
 * The model is deliberately small, because the geometry is the part that has to
 * be *provable*:
 *
 *  - a **mode**: which axes are in force - `vertical`, `horizontal` or `both`;
 *  - an **axis**: a line in document space standing at a position (the x of a
 *    vertical axis, the y of a horizontal one - the same "one number, not a
 *    point" rule the composition guides use, because the other coordinate of a
 *    line that spans the paper is meaningless);
 *  - a **mirror**: the sequence of axes a copy is reflected across.
 *
 * Two rules the rest of the feature leans on:
 *
 *  - **The mirror is about the axis, not about the document's centre.** A
 *    mirror only ever reads the axis it is handed, so an axis the user has
 *    moved off the middle mirrors about where it *is*. The document's size
 *    enters the model in exactly one place - the helper that *places* an axis
 *    at the middle - and nowhere else. A stroke at `x = 50` mirrored about an
 *    axis at `x = 100` lands at `x = 150`, whatever the paper's width.
 *  - **A point on the axis is its own mirror.** Reflecting a point that lies
 *    on an axis leaves it where it is, so a stroke that runs along the axis
 *    would be copied onto itself. Such a copy has to be recognised as a copy
 *    of nothing and dropped, rather than drawn twice, which would darken the
 *    ink.
 *
 * Everything here is pure and in **document space**: a position of `100` means
 * 100 document pixels at every zoom, and the module never reads a clock, a
 * random number or a canvas.
 */

import type { Point } from "../../types/geometry";

/** The kinds of axis a mirror can be taken across. */
export type SymmetryAxisKind = "vertical" | "horizontal";

/**
 * Which axes are in force.
 *
 * `vertical` mirrors left to right across a vertical axis, `horizontal` mirrors
 * top to bottom across a horizontal one, and `both` mirrors across the two
 * together - which is the four-way symmetry: the original, its left-right
 * flip, its top-bottom flip and its half turn.
 *
 * The name of a mode names the **axis** the ink is mirrored across, not the
 * direction the ink travels, so "vertical" means "the mirror line is
 * vertical".
 */
export type SymmetryMode = "vertical" | "horizontal" | "both";

/** Every mode, in the order the control offers them. */
export const SYMMETRY_MODES: readonly SymmetryMode[] = ["vertical", "horizontal", "both"];

/** The mode a fresh installation starts with. */
export const DEFAULT_SYMMETRY_MODE: SymmetryMode = "vertical";

/**
 * One mirror axis: a line in document space.
 *
 * The axis plus one position is the whole geometry: a vertical axis's y is
 * meaningless (it spans the paper), so it is not stored.
 */
export interface SymmetryAxis {
  /** Which way the axis runs. */
  readonly kind: SymmetryAxisKind;
  /** The x of a vertical axis, the y of a horizontal one, in document pixels. */
  readonly position: number;
}

/** The symmetry settings: what the next stroke will be mirrored by. */
export interface SymmetrySettings {
  /** Whether the symmetry is on. Off by default: nothing changes until asked for. */
  readonly enabled: boolean;
  /** Which axes are in force. */
  readonly mode: SymmetryMode;
  /** Where the vertical axis stands (its x), in document pixels. */
  readonly verticalAxis: number;
  /** Where the horizontal axis stands (its y), in document pixels. */
  readonly horizontalAxis: number;
}

/**
 * The symmetry a fresh installation starts with: off, mirrored left to right,
 * with the axes at the origin.
 *
 * The axes are *placed* when the symmetry is switched on (see
 * {@link centeredSymmetrySettings}); they are not placed here, because this
 * module has no document to place them in.
 */
export const DEFAULT_SYMMETRY_SETTINGS: SymmetrySettings = {
  enabled: false,
  mode: DEFAULT_SYMMETRY_MODE,
  verticalAxis: 0,
  horizontalAxis: 0,
};

/** Whether a value names a symmetry mode. */
export function isSymmetryMode(value: unknown): value is SymmetryMode {
  return typeof value === "string" && (SYMMETRY_MODES as readonly string[]).includes(value);
}

/**
 * The mode a value names, or the default when it names none.
 *
 * An unknown mode is a mode this build does not have, so it falls back rather
 * than producing an unreadable setting.
 */
export function normalizeSymmetryMode(value: unknown): SymmetryMode {
  return isSymmetryMode(value) ? value : DEFAULT_SYMMETRY_MODE;
}

/**
 * Rounds an axis position to a whole document pixel.
 *
 * An axis is a registration mark: a fractional position would draw a soft edge
 * at some zooms, and it would put the mirrored samples off the pixel grid the
 * original samples sit on. A value that is not a number at all takes the
 * fallback rather than poisoning the mirror.
 */
function normalizeAxisPosition(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  // `Math.round(-0.4)` is `-0`, which compares equal to `0` but is a
  // different value; it would leak a `-0` into a saved setting.
  return rounded === 0 ? 0 : rounded;
}

/**
 * Reads symmetry settings out of an untrusted value.
 *
 * Every field falls back to its default when it is missing or malformed, so a
 * hand-edited or truncated settings file still yields a usable symmetry.
 */
export function normalizeSymmetrySettings(value: unknown): SymmetrySettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_SYMMETRY_SETTINGS;
  }
  const record = value as {
    enabled?: unknown;
    mode?: unknown;
    verticalAxis?: unknown;
    horizontalAxis?: unknown;
  };
  return {
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : DEFAULT_SYMMETRY_SETTINGS.enabled,
    mode: normalizeSymmetryMode(record.mode),
    verticalAxis: normalizeAxisPosition(
      record.verticalAxis,
      DEFAULT_SYMMETRY_SETTINGS.verticalAxis,
    ),
    horizontalAxis: normalizeAxisPosition(
      record.horizontalAxis,
      DEFAULT_SYMMETRY_SETTINGS.horizontalAxis,
    ),
  };
}

/** Whether two settings describe exactly the same symmetry. */
export function symmetrySettingsEqual(a: SymmetrySettings, b: SymmetrySettings): boolean {
  return (
    a.enabled === b.enabled &&
    a.mode === b.mode &&
    a.verticalAxis === b.verticalAxis &&
    a.horizontalAxis === b.horizontalAxis
  );
}

/**
 * The settings that *place* the axes at the middle of a document.
 *
 * This is a placement helper, not the mirror rule: it says where a fresh
 * symmetry starts, and the mirror then follows the axis wherever it is moved
 * to. The symmetry stays off - switching it on is the user's decision.
 */
export function centeredSymmetrySettings(
  documentWidth: number,
  documentHeight: number,
  mode: SymmetryMode = DEFAULT_SYMMETRY_MODE,
): SymmetrySettings {
  return {
    enabled: false,
    mode: normalizeSymmetryMode(mode),
    verticalAxis: normalizeAxisPosition(documentWidth / 2, 0),
    horizontalAxis: normalizeAxisPosition(documentHeight / 2, 0),
  };
}

/**
 * The axes a symmetry has in force, with where each one stands.
 *
 * An empty list means the symmetry is off, so a caller that draws the axes
 * draws nothing without having to ask about the switch as well.
 */
export function activeSymmetryAxes(settings: SymmetrySettings): SymmetryAxis[] {
  if (!settings.enabled) {
    return [];
  }
  if (settings.mode === "vertical") {
    return [{ kind: "vertical", position: settings.verticalAxis }];
  }
  if (settings.mode === "horizontal") {
    return [{ kind: "horizontal", position: settings.horizontalAxis }];
  }
  return [
    { kind: "vertical", position: settings.verticalAxis },
    { kind: "horizontal", position: settings.horizontalAxis },
  ];
}

/**
 * A mirror: the axes a copy is reflected across, in order.
 *
 * One axis is a plain reflection; two axes in a row are the half turn, which
 * is the fourth quadrant of the four-way symmetry.
 */
export type SymmetryMirror = readonly SymmetryAxis[];

/**
 * The mirrors a symmetry makes, the copies a stroke produces.
 *
 * The list is empty when the symmetry is off, so a caller that copies a
 * stroke copies nothing without having to ask about the switch as well. The
 * order is fixed - the single flips first, the half turn last - so the copies
 * are painted in the same order every time.
 */
export function symmetryMirrors(settings: SymmetrySettings): SymmetryMirror[] {
  if (!settings.enabled) {
    return [];
  }
  const vertical: SymmetryAxis = { kind: "vertical", position: settings.verticalAxis };
  const horizontal: SymmetryAxis = { kind: "horizontal", position: settings.horizontalAxis };
  if (settings.mode === "vertical") {
    return [[vertical]];
  }
  if (settings.mode === "horizontal") {
    return [[horizontal]];
  }
  return [[vertical], [horizontal], [vertical, horizontal]];
}

/** True when a point lies exactly on an axis. */
export function isOnAxis(axis: SymmetryAxis, point: Point): boolean {
  return axis.kind === "vertical" ? point.x === axis.position : point.y === axis.position;
}

/**
 * The image of a point under a mirror.
 *
 * A point on an axis is its own mirror: reflecting it leaves it where it is,
 * which is the rule that lets a copy that would land on the original be
 * recognised and dropped.
 */
export function mirrorPoint(point: Point, mirror: SymmetryMirror): Point {
  let x = point.x;
  let y = point.y;
  for (const axis of mirror) {
    if (axis.kind === "vertical") {
      x = 2 * axis.position - x;
    } else {
      y = 2 * axis.position - y;
    }
  }
  return { x, y };
}

/** Whether a mirror moves a point at all. */
export function mirrorMovesPoint(point: Point, mirror: SymmetryMirror): boolean {
  const image = mirrorPoint(point, mirror);
  return image.x !== point.x || image.y !== point.y;
}

/**
 * Whether a mirror moves any of a run of points.
 *
 * This is the rule a stroke-level copy has to ask: a stroke that lies along
 * the axis maps onto itself, so copying it would draw the same ink twice and
 * darken it. The run is examined as a whole, because a stroke that merely
 * *crosses* the axis still moves - it is only a stroke that lies along it that
 * does not.
 */
export function mirrorMovesAny(
  points: readonly Point[],
  mirror: SymmetryMirror,
): boolean {
  return points.some((point) => mirrorMovesPoint(point, mirror));
}
