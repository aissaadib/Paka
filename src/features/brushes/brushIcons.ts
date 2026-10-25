/**
 * The built-in brushes' icons, drawn as pixel art in TypeScript.
 *
 * An icon is a 16-by-16 character grid and a palette, not an image file: the
 * repository ships no brush art, and a grid can be read, diffed and tested
 * like any other constant. The frame - the dark tile the subject sits in - is
 * the same for every icon, so the set reads as one family; only the palette
 * and the twelve-by-twelve subject change.
 *
 * The grid is deliberately small. At the size the library draws it (18 CSS
 * pixels) a 16-pixel grid is already at its limit, and every extra pixel of
 * detail would be invisible. The subject is a *type* of brush - a nib, a soft
 * dab, a chisel marker, an airbrush, a charcoal stick, a stamp - not a
 * picture of a stroke. The mark a preset paints is drawn by the row itself.
 *
 * Each subject carries its own dark outline. That outline is what survives
 * the shrinking: at 18 pixels the fills are a handful of squares each, and
 * the silhouette is what the eye reads.
 *
 * The icons are decoration: the row's name and description carry the meaning
 * for a screen reader, so nothing here is announced.
 */

/** The width and height of every icon, in grid squares. */
export const BRUSH_ICON_SIZE = 16;

/** Which built-in brush an icon belongs to. */
export type BrushIconId = "pen" | "soft" | "marker" | "airbrush" | "charcoal" | "stamps";

/** One icon: its identity, its colours and its grid. */
export interface BrushIcon {
  readonly id: BrushIconId;
  readonly label: string;
  /**
   * The colour of every character in the grid. `.` is transparent and has no
   * colour; `B` is the tile's background, which the frame fills in.
   */
  readonly palette: Readonly<Record<string, string>>;
  /** {@link BRUSH_ICON_SIZE} rows of {@link BRUSH_ICON_SIZE} characters. */
  readonly grid: readonly string[];
}

/** One horizontal run of one colour, ready to become a rectangle. */
export interface BrushIconRun {
  readonly y: number;
  readonly x: number;
  readonly width: number;
  readonly color: string;
}

/** The tile's outline, and the outline every subject is drawn with. */
const BORDER = "#10161f";

/**
 * Wraps a subject in the tile.
 *
 * The subject is twelve rows of twelve characters. Inside it `.` means "the
 * tile's background": the frame turns it into `B`, so the subject can be
 * written against nothing and still sit on a solid colour.
 */
function framed(art: readonly string[]): readonly string[] {
  return [
    `..${"k".repeat(12)}..`,
    `.k${"b".repeat(12)}k.`,
    ...art.map((row) => `.k${row.split(".").join("B")}k.`),
    `.k${"b".repeat(12)}k.`,
    `..${"k".repeat(12)}..`,
  ];
}

/**
 * A pen nib: a steel point coming down from the top right, with the ink line
 * it leaves behind.
 */
const PEN: BrushIcon = {
  id: "pen",
  label: "A pen nib",
  palette: {
    k: BORDER,
    b: "#4f95d4",
    B: "#3f86c9",
    d: BORDER,
    l: "#cfdae7",
    w: "#f4f9ff",
    p: "#0a2350",
  },
  grid: framed([
    "........dddd",
    ".......dllwd",
    "......dllwd.",
    ".....dllwd..",
    "....dllwd...",
    "...dllwd....",
    "..dllwd.....",
    ".dllwd......",
    ".dppd.......",
    "..dd........",
    "ppppppp.....",
    ".ppppp......",
  ]),
};

/** A soft round brush: a blurred dab with the handle entering at the top right. */
const SOFT: BrushIcon = {
  id: "soft",
  label: "A soft round dab",
  palette: {
    k: BORDER,
    b: "#bb90dd",
    B: "#b184d6",
    p: "#8b5cb5",
    q: "#a97fd0",
    l: "#e9d8f7",
    w: "#fbf5ff",
  },
  grid: framed([
    "..........ww",
    ".........ww.",
    "........ww..",
    "...ppppww...",
    "..pqqqqp....",
    ".pqllllqp...",
    ".pqllwwlp...",
    ".pqllwwlp...",
    ".pqllllqp...",
    "..pqqqqp....",
    "...pppp.....",
    "............",
  ]),
};

/** A chisel marker: a teal body with its flat tip down, and the swash it lays down. */
const MARKER: BrushIcon = {
  id: "marker",
  label: "A chisel marker",
  palette: {
    k: BORDER,
    b: "#f39b3c",
    B: "#ef8f2c",
    d: BORDER,
    l: "#74dcd5",
    q: "#2fb3ad",
    p: "#1c8a85",
  },
  grid: framed([
    "........dqqd",
    ".......dlqd.",
    "......dlqd..",
    ".....dlqd...",
    "....dlqd....",
    "...dlqd.....",
    "..dlqd......",
    ".dlqd.......",
    "dqqqd.......",
    "dppd........",
    "............",
    "pppppppp....",
  ]),
};

/** An airbrush: the gun at the right, its cup above and its mist leaving to the left. */
const AIRBRUSH: BrushIcon = {
  id: "airbrush",
  label: "An airbrush",
  palette: {
    k: BORDER,
    b: "#3a8ccb",
    B: "#2f7fbf",
    d: BORDER,
    l: "#c8d1db",
    w: "#bff0ff",
    p: "#2b6f9e",
  },
  grid: framed([
    ".........dd.",
    "........dppd",
    "........dppd",
    ".........dd.",
    "..w.dlllllld",
    "wwwdllllllll",
    "wwwdllllllll",
    "..w.dlllllld",
    ".........dd.",
    ".........dd.",
    ".........dd.",
    "............",
  ]),
};

/** A charcoal stick at an angle, with the smear and the dust it leaves. */
const CHARCOAL: BrushIcon = {
  id: "charcoal",
  label: "A charcoal stick",
  palette: {
    k: BORDER,
    b: "#c2c2bf",
    B: "#b6b6b3",
    d: "#141414",
    p: "#333331",
    q: "#7e7e7a",
  },
  grid: framed([
    ".......dddd.",
    "......ddddd.",
    ".....ddddd..",
    "....ddddd...",
    "...ddddd....",
    "..ddddd.....",
    ".ddddd......",
    "ddddd.......",
    ".ddd........",
    "d...q..d....",
    "..q...d..q..",
    "............",
  ]),
};

/** A stamp: the handle and its pad, above the dotted line it prints. */
const STAMPS: BrushIcon = {
  id: "stamps",
  label: "A stamp",
  palette: {
    k: BORDER,
    b: "#35aaa7",
    B: "#2fa3a0",
    d: BORDER,
    q: "#1d7f7c",
    p: "#0b3b6f",
  },
  grid: framed([
    "p.....ddd...",
    ".....d...d..",
    "p....d...d..",
    "......ddd...",
    "p......d....",
    "......dd....",
    "p....dd.....",
    "..ddddddd...",
    "pdqqqqqqqd..",
    ".ddddddddd..",
    "p...........",
    ".p.p.p.p.p..",
  ]),
};

/** Every icon, in the order the built-in brushes are listed. */
export const BRUSH_ICONS: readonly BrushIcon[] = [PEN, SOFT, MARKER, AIRBRUSH, CHARCOAL, STAMPS];

/**
 * The icon of a built-in preset, by the preset's id.
 *
 * The built-in brushes are `builtin-pen`, `builtin-soft` and so on; an icon's
 * id is the part after the prefix. A user preset has its own generated id, so
 * it has no entry here and falls back to its painted mark.
 */
export const BRUSH_ICON_BY_PRESET_ID: Readonly<Record<string, BrushIcon>> = Object.freeze(
  Object.fromEntries(BRUSH_ICONS.map((icon) => [`builtin-${icon.id}`, icon])),
);

/** The icon for a preset id, or `null` when the preset is not a built-in one. */
export function brushIconForPreset(presetId: string): BrushIcon | null {
  return BRUSH_ICON_BY_PRESET_ID[presetId] ?? null;
}

/**
 * Turns a grid into one rectangle per horizontal run of one colour.
 *
 * Merging a row's neighbours is what keeps the drawing cheap: a tile is a few
 * dozen rectangles rather than 256. Transparent squares are skipped, so the
 * runs cover exactly the pixels the grid paints.
 */
export function brushIconRuns(icon: BrushIcon): readonly BrushIconRun[] {
  const runs: BrushIconRun[] = [];
  icon.grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      if (key === ".") {
        x += 1;
        continue;
      }
      const color = icon.palette[key];
      if (color === undefined) {
        throw new Error(`The ${icon.id} icon uses ${key}, which its palette does not define.`);
      }
      let width = 1;
      while (x + width < row.length && row[x + width] === key) {
        width += 1;
      }
      runs.push({ y, x, width, color });
      x += width;
    }
  });
  return runs;
}
