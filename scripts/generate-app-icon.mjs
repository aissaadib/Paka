/**
 * Generates Paka's application icon: `src-tauri/app-icon.svg`.
 *
 * The artwork is original to this repository. It is defined here as
 * geometry - a rounded square and a chain of overlapping circular dabs
 * following a cubic Bezier - and written out as SVG. There is no source
 * image, no traced outline and no third-party asset anywhere in this
 * pipeline: every coordinate is computed from the constants below.
 *
 * The motif is deliberately a *dab chain*. It is the same idea the brush
 * engine in `src/core/rendering/stampCoverage.ts` uses: a stroke is a
 * sequence of overlapping round dabs whose radii taper along the path. The
 * mark therefore shows what Paka does rather than borrowing a shape from
 * somewhere else.
 *
 * Run it from the repository root:
 *
 *     node scripts/generate-app-icon.mjs
 *
 * Then regenerate every platform icon from it:
 *
 *     pnpm tauri icon src-tauri/app-icon.svg
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Edge length of the generated SVG, in user units. */
const SIZE = 1024;

/** The app's own dark surface colour (`--bg-app` in `src/styles/theme.css`). */
const BACKGROUND = "#17191c";

/** The app's own border colour (`--border`), used as a hairline. */
const BORDER = "#2a2e34";

/** The app's own accent colour (`--accent`). */
const ACCENT = "#4c8ef7";

/** Rounded square that carries the mark. */
const PLATE = { x: 24, y: 24, size: 976, radius: 232 };

/** Cubic Bezier the dab chain follows, from lower-left to upper-right. */
const PATH = {
  p0: [272, 752],
  p1: [392, 744],
  p2: [600, 462],
  p3: [772, 258],
};

/** How many dabs the chain is built from. */
const DAB_COUNT = 110;

/** Radius of the first (fattest) dab and of the last (thinnest) one. */
const DAB_START_RADIUS = 47;
const DAB_END_RADIUS = 13;

/** Exponent that makes the taper fall away quickly, like a brush lifting. */
const TAPER_EXPONENT = 1.45;

/**
 * Detached dabs trailing behind the stroke, as [x, y, radius, opacity].
 * They read as the stamp trail a stamped brush leaves.
 */
const TRAIL = [
  [186, 806, 31, 0.5],
  [128, 844, 20, 0.34],
  [86, 872, 12, 0.22],
];

const round = (n) => Number(n.toFixed(2));

/** A point on the cubic Bezier at parameter `t`. */
function pointOnPath(t) {
  const { p0, p1, p2, p3 } = PATH;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/** The radius of the dab at parameter `t`: fat at the start, thin at the tip. */
function dabRadius(t) {
  return (
    DAB_END_RADIUS + (DAB_START_RADIUS - DAB_END_RADIUS) * Math.pow(1 - t, TAPER_EXPONENT)
  );
}

function buildSvg() {
  const dabs = [];
  for (let i = 0; i < DAB_COUNT; i += 1) {
    const t = i / (DAB_COUNT - 1);
    const [x, y] = pointOnPath(t);
    const r = dabRadius(t);
    dabs.push(`    <circle cx="${round(x)}" cy="${round(y)}" r="${round(r)}" />`);
  }

  const trail = TRAIL.map(
    ([x, y, r, opacity]) =>
      `    <circle cx="${x}" cy="${y}" r="${r}" fill-opacity="${opacity}" />`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Paka">
  <title>Paka</title>
  <desc>Original Paka mark: a tapered chain of brush dabs across a rounded dark plate.</desc>
  <rect x="${PLATE.x}" y="${PLATE.y}" width="${PLATE.size}" height="${PLATE.size}" rx="${PLATE.radius}" fill="${BACKGROUND}" stroke="${BORDER}" stroke-width="8" />
  <g fill="${ACCENT}">
${trail.join("\n")}
${dabs.join("\n")}
  </g>
</svg>
`;
}

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "src-tauri", "app-icon.svg");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, buildSvg(), "utf8");
process.stdout.write(`wrote ${target}\n`);
