/**
 * The path of a tapered stroke.
 *
 * A stroke whose width changes along its path cannot be drawn as a chain of
 * round-capped segments: a segment has one width, so the tip would be as wide
 * as the segment that carries it. The tapered stroke is therefore drawn as
 * **one path** that is filled once, and the path is built from two kinds of
 * piece:
 *
 *  - A **disc** at every sample, with the sample's own half width. The discs
 *    are the round joins and the round tips: the tip is exactly as wide as
 *    the taper says, and a corner keeps the stroke's width.
 *  - A **quad** for every segment, joining the two samples' edges. The quads
 *    are the body of the stroke: the width ramps along the path.
 *
 * Filling the path once is what keeps the invariants the rest of the renderer
 * relies on:
 *
 *  - The stroke is one shape, so it gets one alpha, applied when the buffer
 *    composites. It cannot darken where it overlaps itself.
 *  - There are no seams: the path is filled in one go, so its edge is
 *    antialiased once instead of once per piece.
 *  - A path that doubles back on itself is still one shape: the pieces
 *    overlap and the union is filled, so the stroke does not pinch at the
 *    turn.
 *
 * The plan is a pure function of the samples and their half-widths, so the
 * live preview, the commit, a rebuild, a reopened project and a PNG export
 * all draw the same pixels.
 */

/** A round piece of the path: a disc at one sample. */
export interface TaperDisc {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** A straight piece of the path: the body of one segment. */
export interface TaperQuad {
  /** The four corners, in the order the path walks them. */
  readonly points: readonly (readonly [number, number])[];
}

/** Everything the path is made of. */
export interface TaperedPath {
  readonly discs: readonly TaperDisc[];
  readonly quads: readonly TaperQuad[];
}

/**
 * The path of a stroke whose width changes along it.
 *
 * `halfWidths[i]` is half the stroke's width at sample `i`.
 *
 * The pieces are wound the same way round, because the path is filled with
 * the non-zero rule: two pieces that wind in opposite directions would
 * cancel each other where they overlap and leave a hole in the stroke.
 */
export function buildTaperedPath(
  xs: readonly number[],
  ys: readonly number[],
  halfWidths: readonly number[],
): TaperedPath {
  const count = Math.min(xs.length, ys.length, halfWidths.length);
  const discs: TaperDisc[] = [];
  const quads: TaperQuad[] = [];
  if (count === 0) {
    return { discs, quads };
  }

  for (let index = 0; index < count; index += 1) {
    discs.push({ x: xs[index], y: ys[index], radius: Math.max(halfWidths[index], 0) });
  }

  for (let index = 1; index < count; index += 1) {
    const dx = xs[index] - xs[index - 1];
    const dy = ys[index] - ys[index - 1];
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) {
      // The pointer did not move: there is no body to draw between the two
      // samples, and the disc at the sample already covers the ground.
      continue;
    }
    const normalX = -dy / length;
    const normalY = dx / length;
    const from = halfWidths[index - 1];
    const to = halfWidths[index];
    const ax = xs[index - 1];
    const ay = ys[index - 1];
    const bx = xs[index];
    const by = ys[index];
    quads.push({
      points: [
        [ax - normalX * from, ay - normalY * from],
        [bx - normalX * to, by - normalY * to],
        [bx + normalX * to, by + normalY * to],
        [ax + normalX * from, ay + normalY * from],
      ],
    });
  }

  return { discs, quads };
}

/**
 * Draws the path of a tapered stroke and fills it.
 *
 * The caller owns the colour and the alpha: the stroke is drawn at full
 * coverage, and its own opacity is applied once, when the buffer composites.
 */
export function drawTaperedPath(ctx: CanvasRenderingContext2D, path: TaperedPath): void {
  if (path.discs.length === 0) {
    return;
  }
  ctx.beginPath();

  for (const disc of path.discs) {
    if (!(disc.radius > 0)) {
      // A tip with no width at all: the path converges on the point.
      ctx.moveTo(disc.x, disc.y);
      continue;
    }
    // The move lands on the arc's own start, so the path never draws a line
    // from one piece to the next.
    ctx.moveTo(disc.x + disc.radius, disc.y);
    ctx.arc(disc.x, disc.y, disc.radius, 0, Math.PI * 2);
  }

  for (const quad of path.quads) {
    const [first, second, third, fourth] = quad.points;
    ctx.moveTo(first[0], first[1]);
    ctx.lineTo(second[0], second[1]);
    ctx.lineTo(third[0], third[1]);
    ctx.lineTo(fourth[0], fourth[1]);
    ctx.closePath();
  }

  ctx.fill();
}
