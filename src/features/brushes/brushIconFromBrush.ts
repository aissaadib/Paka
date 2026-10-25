/**
 * The icon of a brush that has no hand-drawn one.
 *
 * A saved brush - one of the 81 translated Krita presets, or one the user
 * made - used to show a dot of its own colour. A dot says almost nothing: a
 * chisel and a bristle brush can paint the same dot. Every brush now draws an
 * icon in the same language as the six built-in ones: a dark-outlined subject
 * on a coloured tile, with the mark the brush leaves underneath.
 *
 * Two things are the **kind's**, not the brush's:
 *
 *  1. **The subject.** A chisel tip, a bristle bundle, a felt pad, a ragged
 *     blot, a chain of dabs, a soft dab, an airbrush, a round head, a nib.
 *     The tip only matters when the brush is stamped, because that is the only
 *     case the engine reads it in; a plain round brush with a chisel tip
 *     paints round. Grain outranks softness, because a grainy edge is the
 *     more visible property of a stroke. The two round kinds split on width:
 *     a fine nib is a pen, a wide hard round is a round brush.
 *  2. **The palette.** It is the palette of the built-in icon of that kind, so
 *     a saved pen looks like the Pen and a saved charcoal looks like the
 *     Charcoal. A generated palette would have to guess at contrast; this one
 *     is already drawn.
 *
 * Four things are the **brush's own**, and they are the mark under the
 * subject:
 *
 *  - its **colour** - the mark is the ink the brush paints with, lifted
 *    towards white so it does not vanish into the tile;
 *  - its **width** - the mark gets longer with the brush;
 *  - its **opacity** - a translucent brush leaves a fainter mark;
 *  - its **dab spacing**, when it is stamped - widely spaced dabs leave a
 *    dotted mark - and its **pressure response**, when pressure changes the
 *    width - the mark tapers instead of staying a band.
 *
 * The subject of the six built-in kinds is taken from the built-in icon
 * itself, not copied, so the hand-drawn set and the generated one cannot
 * drift apart. The three kinds only a saved brush can be - a round brush, a
 * bristle and a felt pad - are drawn here in the same twelve-by-twelve frame,
 * in the palettes of the same family.
 *
 * Everything is a pure function of the settings: the same brush always draws
 * the same icon, and no icon depends on the preset's name or id.
 */

import type { BrushPreset } from "../../core/brushes/presets";
import type { BrushSettings } from "../../types/brush";
import { hexToRgb, rgbToHex } from "../../utils/color";
import {
  BORDER,
  BRUSH_ICON_BY_PRESET_ID,
  BRUSH_ICON_SIZE,
  brushIconForBuiltIn,
  framed,
  type BrushIcon,
  type BrushIconId,
} from "./brushIcons";

/** The ink a brush is assumed to paint with when its colour cannot be read. */
const FALLBACK_INK = "#16181c";

/** The tile's frame rows, and the size of the subject they wrap. */
const FRAME_ROWS = 2;
const SUBJECT_HEIGHT = 10;
const SUBJECT_WIDTH = 12;

/** A bristle bundle: a ferrule at the top right and its lanes splaying out. */
const BRISTLE: readonly string[] = [
  "........ddd.",
  ".......dppd.",
  "......dppd..",
  ".....dpppd..",
  "....dllllld.",
  "...dlldllld.",
  "..dlldlld...",
  ".dlldlld....",
  "dlldlld.....",
  "d.d.d.......",
];

/** A felt pad: a flat, soft pad with its handle coming in from the top right. */
const FELT: readonly string[] = [
  ".........ddd",
  "........dppd",
  ".......dppd.",
  "......dppd..",
  ".....dppd...",
  "...dddddddd.",
  "..dqqqqqqqd.",
  ".dqqllllqqd.",
  ".dqqqqqqqqd.",
  "..dddddddd..",
];

/** A round brush: a flat round head, for the hard brushes wide enough to show one. */
const ROUND: readonly string[] = [
  "........ddd.",
  ".......dppd.",
  "......dppd..",
  ".....dppd...",
  "...dddddd...",
  "..dqqqqqqd..",
  ".dqqqqqqqqd.",
  ".dqqqqqqqqd.",
  "..dqqqqqqd..",
  "...dddddd...",
];

/** The ten subject rows of a built-in icon, without its frame. */
function subjectOf(presetId: string): readonly string[] {
  const icon = BRUSH_ICON_BY_PRESET_ID[presetId];
  if (!icon) {
    return [];
  }
  return icon.grid
    .slice(FRAME_ROWS, FRAME_ROWS + SUBJECT_HEIGHT)
    .map((row) => row.slice(2, BRUSH_ICON_SIZE - 2));
}

/** The subject of each kind, in the order the tile is built. */
const SUBJECTS: Readonly<Record<BrushIconId, readonly string[]>> = {
  pen: subjectOf("builtin-pen"),
  soft: subjectOf("builtin-soft"),
  marker: subjectOf("builtin-marker"),
  airbrush: subjectOf("builtin-airbrush"),
  charcoal: subjectOf("builtin-charcoal"),
  stamps: subjectOf("builtin-stamps"),
  round: ROUND,
  bristle: BRISTLE,
  felt: FELT,
};

/**
 * The palette of each kind.
 *
 * The six built-in ones are the palettes the icons are already drawn in; the
 * three drawn here keep the same structure - a tile, a darker band, a light
 * subject, a highlight and a dark accent - so the set reads as one hand.
 */
const PALETTES: Readonly<Record<BrushIconId, Readonly<Record<string, string>>>> = {
  pen: BRUSH_ICON_BY_PRESET_ID["builtin-pen"].palette,
  soft: BRUSH_ICON_BY_PRESET_ID["builtin-soft"].palette,
  marker: BRUSH_ICON_BY_PRESET_ID["builtin-marker"].palette,
  airbrush: BRUSH_ICON_BY_PRESET_ID["builtin-airbrush"].palette,
  charcoal: BRUSH_ICON_BY_PRESET_ID["builtin-charcoal"].palette,
  stamps: BRUSH_ICON_BY_PRESET_ID["builtin-stamps"].palette,
  round: {
    k: BORDER,
    b: "#5f9bd0",
    B: "#3d7bb0",
    d: BORDER,
    q: "#9fc4e6",
    l: "#e6f1fa",
    w: "#f7fbff",
    p: "#123f66",
  },
  bristle: {
    k: BORDER,
    b: "#d9a06a",
    B: "#b8753a",
    d: BORDER,
    q: "#e8c39a",
    l: "#f6e2cc",
    w: "#fff6ec",
    p: "#4a2a12",
  },
  felt: {
    k: BORDER,
    b: "#b49ae0",
    B: "#8f74c4",
    d: BORDER,
    q: "#cdbceb",
    l: "#e9e0f8",
    w: "#f9f5ff",
    p: "#3a2a63",
  },
};

/** What each kind of brush is, for a screen reader that never hears it. */
const LABELS: Readonly<Record<BrushIconId, string>> = {
  pen: "A pen nib",
  soft: "A soft round dab",
  marker: "A chisel marker",
  airbrush: "An airbrush",
  charcoal: "A charcoal stick",
  stamps: "A stamp",
  round: "A round brush",
  bristle: "A bristle brush",
  felt: "A felt pad",
};

/**
 * Which kind of brush a set of settings paints.
 *
 * The order is a decision, not a fallback chain: a tip is only read when the
 * brush is stamped (otherwise the engine never looks at it), grain beats a
 * soft edge, and a stamped round brush is a stamp however soft its dabs are.
 */
export function brushGlyphId(brush: BrushSettings): BrushIconId {
  if (brush.stamp) {
    if (brush.tip === "chisel") return "marker";
    if (brush.tip === "bristle") return "bristle";
    if (brush.tip === "felt") return "felt";
    if (brush.tip === "blot") return "charcoal";
    return "stamps";
  }
  if (brush.texture >= 0.5) return "charcoal";
  if (brush.hardness <= 0.12) return "airbrush";
  if (brush.hardness < 0.75) return "soft";
  return brush.size >= 24 ? "round" : "pen";
}

/** Mixes two hex colours; `amount` is how far the result moves towards `to`. */
function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return to;
  const t = Math.min(1, Math.max(0, amount));
  const mix = (x: number, y: number) => x + (y - x) * t;
  return rgbToHex({ r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b) });
}

/**
 * The icon's colours: the palette of its kind, plus the mark.
 *
 * The mark is the ink at the brush's opacity, laid over the tile. A near-black
 * ink would vanish into a mid-tone tile, so the ink is first lifted towards
 * white: the mark keeps the ink's hue and gains the contrast the tile needs.
 */
export function brushIconPalette(brush: BrushSettings): Readonly<Record<string, string>> {
  const palette = PALETTES[brushGlyphId(brush)];
  const inkHex = hexToRgb(brush.color) ? brush.color : FALLBACK_INK;
  const mark = mixHex(inkHex, "#ffffff", 0.45);
  return { ...palette, s: mixHex(palette.B, mark, brush.opacity) };
}

/**
 * The mark under the subject.
 *
 * Its length is the brush's width, in six steps far enough apart to read at
 * the size the library draws them. Its second row is what the brush does to a
 * stroke: a hairline narrows, a wide brush keeps a band, pressure turns it into
 * a taper, and widely spaced dabs turn it into dots.
 */
function swashRows(brush: BrushSettings): readonly string[] {
  const length =
    brush.size <= 6
      ? 3
      : brush.size <= 20
        ? 5
        : brush.size <= 40
          ? 7
          : brush.size <= 80
            ? 9
            : brush.size <= 150
              ? 11
              : 12;
  const dotted = brush.stamp && brush.stampSpacing >= 0.4;
  const tapered = brush.pressureSize >= 0.5;
  const band = brush.size > 40;
  const top = dotted
    ? "s.s.s.s.s.s."
    : "s".repeat(length) + ".".repeat(SUBJECT_WIDTH - length);
  // The mark is two rows so it reads at the size the library draws it; the
  // second row is what tells a band from a hairline from a taper.
  const narrow = tapered
    ? Math.max(2, length - 4)
    : band
      ? length - 1
      : Math.max(2, length - 2);
  const bottom = dotted
    ? "..s.s.s.s..."
    : "." + "s".repeat(narrow) + ".".repeat(SUBJECT_WIDTH - narrow - 1);
  return [top, bottom];
}

/** The icon a brush's settings draw. */
export function brushIconFromBrush(brush: BrushSettings): BrushIcon {
  const id = brushGlyphId(brush);
  return {
    id,
    label: LABELS[id],
    palette: brushIconPalette(brush),
    grid: framed([...SUBJECTS[id], ...swashRows(brush)]),
  };
}

/**
 * The icon of any preset.
 *
 * A built-in brush shows the picture drawn for it by hand; everything else is
 * drawn from its settings. There is no third case: every row of the library
 * has a picture.
 */
export function brushIconForPreset(preset: BrushPreset): BrushIcon {
  return brushIconForBuiltIn(preset.id) ?? brushIconFromBrush(preset.brush);
}
