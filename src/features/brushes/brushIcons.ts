/**
 * The brush icons, drawn as vector art in TypeScript.
 *
 * An icon is a short list of SVG paths and their colours, not an image file:
 * the repository ships no brush art, and a path list can be read, diffed and
 * tested like any other constant. Every icon is built the same way - a rounded
 * tile, a sheen and a shadow, then the subject and the mark the brush leaves -
 * so the library reads as one family whatever the brush.
 *
 * The drawing is vector, not a pixel grid: the shapes are curves and round
 * joins, so a tile stays crisp at 40 CSS pixels, on a high-density display, and
 * at any size a future panel might ask for.
 *
 * A subject says what *kind* of brush a preset is - a nib, a soft round head, a
 * chisel, an airbrush, a charcoal stick, a stamp, a round brush, a bristle
 * bundle, a felt pad. The mark under it is the brush's own: its ink, its width,
 * its opacity, its taper and its dabs. `brushIconFromBrush` builds both from
 * the settings, so no icon depends on a preset's name or id.
 *
 * The icons are decoration: the tile's name and description carry the meaning
 * for a screen reader, so nothing here is announced.
 */

/** The width and height of every icon, in its own units. */
export const BRUSH_ICON_SIZE = 48;

/** The tile's outline, and the outline every subject is drawn with. */
export const BORDER = "#10161f";

/**
 * Which kind of brush an icon draws.
 *
 * The first six are the built-in brushes; `round`, `bristle` and `felt` are
 * kinds only a saved brush can be, and are reached through
 * `brushIconFromBrush`.
 */
export type BrushIconId =
  | "pen"
  | "soft"
  | "marker"
  | "airbrush"
  | "charcoal"
  | "stamps"
  | "round"
  | "bristle"
  | "felt";

/** The colours one kind of brush is drawn in. */
export interface BrushIconPalette {
  /** The tile's own colour. */
  readonly tile: string;
  /** The outline, and the darkest tone of the drawing. */
  readonly edge: string;
  /** The translucent highlight on the tile's top left. */
  readonly sheen: string;
  /** The shadow along the tile's bottom. */
  readonly shade: string;
  /** The handle. */
  readonly body: string;
  /** The handle's highlight. */
  readonly bodyLight: string;
  /** The ferrule, the collar or the metal of the subject. */
  readonly metal: string;
  /** The metal's highlight. */
  readonly metalLight: string;
  /** The working end: the nib, the head, the pad, the bristles. */
  readonly head: string;
  /** The working end's highlight. */
  readonly headLight: string;
  /** The kind's dark accent: a nib's slit, a stamp's ink. */
  readonly accent: string;
}

/**
 * One path of an icon.
 *
 * A path may be filled, stroked or both; `transform` is what turns the upright
 * subject into the diagonal pose the whole family is drawn in. The order of the
 * list is the order the paths are painted, back to front.
 */
export interface BrushIconPath {
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly transform?: string;
}

/** One icon: its identity, its colours and the paths that draw it. */
export interface BrushIcon {
  readonly id: BrushIconId;
  readonly label: string;
  readonly palette: BrushIconPalette;
  readonly paths: readonly BrushIconPath[];
}

/** The pose every subject is drawn in: upright, then leaned to the left. */
const SUBJECT_TRANSFORM = "rotate(38 24 24)";

/** A number as the path data wants it: at most two decimals. */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A rounded rectangle, clockwise from its top-left corner. */
function roundedRect(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  const right = x + width;
  const bottom = y + height;
  return [
    `M${n(x + r)} ${n(y)}`,
    `H${n(right - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(right)} ${n(y + r)}`,
    `V${n(bottom - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(right - r)} ${n(bottom)}`,
    `H${n(x + r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(bottom - r)}`,
    `V${n(y + r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}`,
    "Z",
  ].join("");
}

/** A circle, as two half arcs. */
function circle(cx: number, cy: number, radius: number): string {
  const r = n(radius);
  return `M${n(cx - radius)} ${n(cy)}A${r} ${r} 0 1 0 ${n(cx + radius)} ${n(cy)}A${r} ${r} 0 1 0 ${n(cx - radius)} ${n(cy)}Z`;
}

/** An ellipse, as two half arcs. */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  const y = n(cy);
  return `M${n(cx - rx)} ${y}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${y}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${y}Z`;
}

/** A closed polygon through the given points. */
function polygon(points: readonly (readonly [number, number])[]): string {
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${n(x)} ${n(y)}`).join("")}Z`;
}

/** A line, drawn as a stroked path. */
function line(x1: number, y1: number, x2: number, y2: number): string {
  return `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`;
}

/**
 * The palettes, one per kind.
 *
 * Each is a tile, a light handle, a metal collar and a working end, in a hue
 * that belongs to the kind: steel-blue for a pen, violet for a soft brush,
 * green for a round brush, and so on. The tile's hue is what tells two kinds
 * apart at a glance in a grid of forty thumbnails, so no two kinds share one -
 * the blues are spread into blue, cyan and green for exactly that reason.
 */
export const BRUSH_PALETTES: Readonly<Record<BrushIconId, BrushIconPalette>> = {
  pen: {
    tile: "#3f86c9",
    edge: BORDER,
    sheen: "rgba(255, 255, 255, 0.16)",
    shade: "rgba(0, 0, 0, 0.12)",
    body: "#cfdae7",
    bodyLight: "#f4f9ff",
    metal: "#aec1d6",
    metalLight: "#eef5fd",
    head: "#e8eef6",
    headLight: "#ffffff",
    accent: "#0a2350",
  },
  soft: {
    tile: "#b184d6",
    edge: BORDER,
    sheen: "rgba(255, 255, 255, 0.16)",
    shade: "rgba(0, 0, 0, 0.12)",
    body: "#e9d8f7",
    bodyLight: "#fbf5ff",
    metal: "#c9a9e6",
    metalLight: "#f0e3fb",
    head: "#8b5cb5",
    headLight: "#d9bff2",
    accent: "#5b2f86",
  },
  marker: {
    tile: "#ef8f2c",
    edge: BORDER,
    sheen: "rgba(255, 255, 255, 0.16)",
    shade: "rgba(0, 0, 0, 0.12)",
    body: "#74dcd5",
    bodyLight: "#c9f6f2",
    metal: "#2fb3ad",
    metalLight: "#9be9e4",
    head: "#1c8a85",
    headLight: "#5fd0ca",
    accent: "#0d4f4c",
  },
  airbrush: {
    tile: "#35a8c4",
    edge: BORDER,
    sheen: "rgba(255, 255, 255, 0.16)",
    shade: "rgba(0, 0, 0, 0.12)",
    body: "#c8d1db",
    bodyLight: "#eef3f8",
    metal: "#8fa6bd",
    metalLight: "#dfe9f2",
    head: "#bff0ff",
    headLight: "#eafcff",
    accent: "#123c5c",
  },
  charcoal: {
    tile: "#9b9b97",
    edge: BORDER,
    sheen: "rgba(255, 255, 255, 0.2)",
    shade: "rgba(0, 0, 0, 0.14)",
    body: "#8b8b88",
    bodyLight: "#b9b9b6",
    metal: "#5d5d5a",
    metalLight: "#9a9a96",
    head: "#2c2c2a",
    headLight: "#77776f",
    accent: "#141414",
  },
  stamps: {
    tile: "#cf5c6a",
    edge: BORDER,
    sheen: "rgba(255, 255, 255, 0.16)",
    shade: "rgba(0, 0, 0, 0.12)",
    body: "#d9b98a",
    bodyLight: "#f0d9b5",
    metal: "#9c7b52",
    metalLight: "#d3b285",
    head: "#0b3b6f",
    headLight: "#2f6fa8",
    accent: "#062a52",
  },
  round: {
    tile: "#5c9e4a",
    edge: BORDER,
    sheen: "rgba(255, 255, 255, 0.16)",
    shade: "rgba(0, 0, 0, 0.12)",
    body: "#cfdae7",
    bodyLight: "#f4f9ff",
    metal: "#9fc4e6",
    metalLight: "#e6f1fa",
    head: "#e6f1fa",
    headLight: "#f7fbff",
    accent: "#123f66",
  },
  bristle: {
    tile: "#b8753a",
    edge: BORDER,
    sheen: "rgba(255, 255, 255, 0.16)",
    shade: "rgba(0, 0, 0, 0.12)",
    body: "#e8c39a",
    bodyLight: "#fff6ec",
    metal: "#b98a5b",
    metalLight: "#e0c19c",
    head: "#f6e2cc",
    headLight: "#fffaf2",
    accent: "#4a2a18",
  },
  felt: {
    tile: "#b85fa0",
    edge: BORDER,
    sheen: "rgba(255, 255, 255, 0.16)",
    shade: "rgba(0, 0, 0, 0.12)",
    body: "#cdbceb",
    bodyLight: "#f9f5ff",
    metal: "#a68fd6",
    metalLight: "#e2d7f5",
    head: "#e9e0f8",
    headLight: "#ffffff",
    accent: "#3a2a63",
  },
};

/** What each kind of brush is, for a screen reader that never hears it. */
export const BRUSH_ICON_LABELS: Readonly<Record<BrushIconId, string>> = {
  pen: "A pen nib",
  soft: "A soft round brush",
  marker: "A chisel marker",
  airbrush: "An airbrush",
  charcoal: "A charcoal stick",
  stamps: "A stamp",
  round: "A round brush",
  bristle: "A bristle brush",
  felt: "A felt pad",
};

/**
 * The tile every icon sits in: a rounded plate, a highlight at its top left and
 * a shadow along its bottom, so the art has depth without a gradient.
 */
function frame(palette: BrushIconPalette): readonly BrushIconPath[] {
  return [
    {
      d: roundedRect(2.5, 2.5, 43, 43, 9),
      fill: palette.tile,
      stroke: palette.edge,
      strokeWidth: 1.5,
    },
    { d: ellipse(15, 9, 12, 7), fill: palette.sheen },
    { d: ellipse(26, 46, 21, 6), fill: palette.shade },
  ];
}

/** The handle and its collar, shared by every kind that has one. */
function grip(palette: BrushIconPalette): readonly BrushIconPath[] {
  return [
    {
      d: roundedRect(21.4, 5, 5.2, 20, 2.6),
      fill: palette.body,
      stroke: palette.edge,
      strokeWidth: 1.3,
    },
    {
      d: roundedRect(22.7, 7, 1.5, 15, 0.75),
      fill: palette.bodyLight,
      opacity: 0.9,
    },
    {
      d: polygon([
        [20.2, 23.4],
        [27.8, 23.4],
        [28.8, 28.2],
        [19.2, 28.2],
      ]),
      fill: palette.metal,
      stroke: palette.edge,
      strokeWidth: 1.2,
    },
    {
      d: polygon([
        [21.1, 24.6],
        [23.7, 24.6],
        [24.3, 27.2],
        [21.7, 27.2],
      ]),
      fill: palette.metalLight,
      opacity: 0.85,
    },
  ];
}

/** A pen: a fine steel nib, slit down the middle. */
function pen(palette: BrushIconPalette): readonly BrushIconPath[] {
  return [
    {
      d: polygon([
        [21.2, 27.4],
        [26.8, 27.4],
        [24, 41.2],
      ]),
      fill: palette.head,
      stroke: palette.edge,
      strokeWidth: 1.3,
    },
    {
      d: polygon([
        [22.3, 28.6],
        [23.8, 28.6],
        [24, 38],
      ]),
      fill: palette.headLight,
      opacity: 0.9,
    },
    { d: line(24, 29.6, 24, 36.4), stroke: palette.accent, strokeWidth: 1 },
  ];
}

/** A soft round brush: a round head with the halo it paints. */
function soft(palette: BrushIconPalette): readonly BrushIconPath[] {
  return [
    { d: circle(24, 33.6, 9.8), fill: palette.head, opacity: 0.25 },
    {
      d: circle(24, 33.6, 6.8),
      fill: palette.head,
      stroke: palette.edge,
      strokeWidth: 1.2,
    },
    { d: circle(24, 33.6, 3.6), fill: palette.headLight, opacity: 0.35 },
    { d: circle(21.4, 30.8, 1.9), fill: palette.headLight, opacity: 0.9 },
  ];
}

/** A chisel marker: a flat, angled tip with a lit facet. */
function marker(palette: BrushIconPalette): readonly BrushIconPath[] {
  return [
    {
      d: polygon([
        [20, 27.4],
        [28, 27.4],
        [31.2, 36.6],
        [23.2, 36.6],
      ]),
      fill: palette.head,
      stroke: palette.edge,
      strokeWidth: 1.3,
    },
    {
      d: polygon([
        [20, 27.4],
        [24, 27.4],
        [27.2, 36.6],
        [23.2, 36.6],
      ]),
      fill: palette.headLight,
      opacity: 0.8,
    },
  ];
}

/** An airbrush: the gun, its nozzle, and the cone of mist it sprays. */
function airbrush(palette: BrushIconPalette): readonly BrushIconPath[] {
  return [
    {
      d: polygon([
        [23.2, 37.4],
        [24.8, 37.4],
        [21.4, 43.4],
        [17.4, 43.4],
      ]),
      fill: palette.head,
      opacity: 0.3,
    },
    {
      d: roundedRect(20.2, 26.6, 7.6, 9, 2.6),
      fill: palette.metal,
      stroke: palette.edge,
      strokeWidth: 1.2,
    },
    {
      d: roundedRect(22.6, 34.6, 2.8, 3.4, 1.2),
      fill: palette.head,
      stroke: palette.edge,
      strokeWidth: 1,
    },
    { d: circle(19.6, 41.4, 2.1), fill: palette.head, opacity: 0.55 },
    { d: circle(15.8, 40.6, 1.4), fill: palette.head, opacity: 0.45 },
    { d: circle(17.8, 44, 1), fill: palette.head, opacity: 0.4 },
  ];
}

/** A charcoal stick: a rough, faceted point. */
function charcoal(palette: BrushIconPalette): readonly BrushIconPath[] {
  return [
    {
      d: polygon([
        [21, 27],
        [27, 27],
        [27.8, 33.6],
        [24.8, 41],
        [21.8, 33.6],
      ]),
      fill: palette.head,
      stroke: palette.edge,
      strokeWidth: 1.2,
    },
    { d: line(23, 29.4, 24.4, 36.4), stroke: palette.headLight, strokeWidth: 1.2, opacity: 0.7 },
  ];
}

/** A stamp: a wooden handle, a collar and an inked pad. */
function stamps(palette: BrushIconPalette): readonly BrushIconPath[] {
  return [
    {
      d: roundedRect(22.4, 26.6, 3.2, 6.6, 1.2),
      fill: palette.body,
      stroke: palette.edge,
      strokeWidth: 1.1,
    },
    {
      d: roundedRect(18.6, 32.2, 10.8, 2.8, 1.2),
      fill: palette.metal,
      stroke: palette.edge,
      strokeWidth: 1.1,
    },
    {
      d: roundedRect(16, 34.6, 16, 4.4, 1.6),
      fill: palette.head,
      stroke: palette.edge,
      strokeWidth: 1.2,
    },
    {
      d: roundedRect(18, 36, 12, 1.4, 0.7),
      fill: palette.headLight,
      opacity: 0.6,
    },
  ];
}

/** A round brush: a wide, flat head. */
function round(palette: BrushIconPalette): readonly BrushIconPath[] {
  return [
    {
      d: roundedRect(17.6, 27.2, 12.8, 9, 4.6),
      fill: palette.head,
      stroke: palette.edge,
      strokeWidth: 1.2,
    },
    {
      d: roundedRect(19.8, 29.2, 5.6, 2.8, 1.4),
      fill: palette.headLight,
      opacity: 0.85,
    },
  ];
}

/** A bristle brush: a collar and five splayed strands. */
function bristle(palette: BrushIconPalette): readonly BrushIconPath[] {
  const strands: readonly (readonly [number, number, number, number])[] = [
    [20.8, 31, 18.4, 38.4],
    [22.5, 31, 21.4, 39.6],
    [24, 31, 24, 40.2],
    [25.5, 31, 26.6, 39.6],
    [27.2, 31, 29.6, 38.4],
  ];
  return [
    {
      d: polygon([
        [19.8, 27.2],
        [28.2, 27.2],
        [28.8, 31.2],
        [19.2, 31.2],
      ]),
      fill: palette.metal,
      stroke: palette.edge,
      strokeWidth: 1.1,
    },
    ...strands.map(([x1, y1, x2, y2]) => ({
      d: line(x1, y1, x2, y2),
      stroke: palette.head,
      strokeWidth: 1.8,
    })),
    {
      d: line(21.4, 37.6, 22.3, 39.6),
      stroke: palette.headLight,
      strokeWidth: 1.2,
      opacity: 0.85,
    },
  ];
}

/** A felt pad: a flat, soft pad with a lit face. */
function felt(palette: BrushIconPalette): readonly BrushIconPath[] {
  return [
    {
      d: polygon([
        [17, 28.4],
        [31, 28.4],
        [31.6, 36],
        [16.4, 36],
      ]),
      fill: palette.head,
      stroke: palette.edge,
      strokeWidth: 1.2,
    },
    {
      d: polygon([
        [18.6, 30.2],
        [29.4, 30.2],
        [29.8, 34.2],
        [18.2, 34.2],
      ]),
      fill: palette.headLight,
      opacity: 0.85,
    },
  ];
}

/** The subject of each kind, in the pose the whole family is drawn in. */
const SUBJECTS: Readonly<Record<BrushIconId, (palette: BrushIconPalette) => readonly BrushIconPath[]>> = {
  pen: (palette) => [...grip(palette), ...pen(palette)],
  soft: (palette) => [...grip(palette), ...soft(palette)],
  marker: (palette) => [...grip(palette), ...marker(palette)],
  airbrush: (palette) => [...grip(palette), ...airbrush(palette)],
  charcoal: (palette) => [...grip(palette), ...charcoal(palette)],
  stamps: (palette) => [...grip(palette), ...stamps(palette)],
  round: (palette) => [...grip(palette), ...round(palette)],
  bristle: (palette) => [...grip(palette), ...bristle(palette)],
  felt: (palette) => [...grip(palette), ...felt(palette)],
};

/** The subject of a kind, leaned into the family's pose. */
export function brushIconSubject(kind: BrushIconId, palette: BrushIconPalette): readonly BrushIconPath[] {
  return SUBJECTS[kind](palette).map((path) => ({ ...path, transform: SUBJECT_TRANSFORM }));
}

/**
 * Builds an icon: the frame, the mark, then the subject over it.
 *
 * The mark is passed in rather than computed here: the art of a kind is fixed,
 * the mark is the brush's own, and `brushIconFromBrush` is what knows how to
 * read it from the settings.
 */
export function composeBrushIcon(
  kind: BrushIconId,
  palette: BrushIconPalette,
  mark: readonly BrushIconPath[],
): BrushIcon {
  return {
    id: kind,
    label: BRUSH_ICON_LABELS[kind],
    palette,
    paths: [...frame(palette), ...mark, ...brushIconSubject(kind, palette)],
  };
}
