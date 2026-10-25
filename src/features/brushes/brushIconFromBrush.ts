/**
 * The icon of a brush, from its settings.
 *
 * Every brush in the library draws its icon from the settings it paints with:
 * there is no per-preset art, so a built-in brush, one of the translated Krita
 * presets and a brush the user just saved are all drawn the same way, and no
 * icon can drift from the brush it stands for.
 *
 * Two things are the **kind's**, not the brush's:
 *
 *  1. **The subject.** A chisel tip, a bristle bundle, a felt pad, a ragged
 *     point, a chain of dabs, a soft dab, an airbrush, a round head, a nib.
 *     The tip only matters when the brush is stamped, because that is the only
 *     case the engine reads it in; a plain round brush with a chisel tip paints
 *     round. Grain outranks softness, because a grainy edge is the more visible
 *     property of a stroke. The two round kinds split on width: a fine nib is a
 *     pen, a wide hard round is a round brush.
 *  2. **The palette.** A tile, a handle, a metal collar and a working end, in
 *     the hue of that kind, so the library reads as one family and a tile says
 *     what kind of brush it is before it is applied.
 *
 * The **mark** under the subject is the brush's own: its colour, its width, its
 * opacity, and - from the settings - whether it is a band, a taper or a row of
 * dabs.
 *
 * Everything is a pure function of the settings: the same brush always draws
 * the same icon, and no icon depends on the preset's name or id.
 */

import type { BrushPreset } from "../../core/brushes/presets";
import type { BrushSettings } from "../../types/brush";
import { hexToRgb, rgbToHex } from "../../utils/color";
import {
  BRUSH_ICON_LABELS,
  BRUSH_PALETTES,
  composeBrushIcon,
  type BrushIcon,
  type BrushIconId,
  type BrushIconPalette,
  type BrushIconPath,
} from "./brushIcons";

/** The ink a brush is assumed to paint with when its colour cannot be read. */
const FALLBACK_INK = "#16181c";

/** Where the mark sits, and how long and wide it can be, in icon units. */
const MARK_CENTRE = 24;
const MARK_Y = 41.2;
const MARK_MIN_LENGTH = 9;
const MARK_MAX_LENGTH = 24;

/** What shape the brush leaves under its subject. */
export type BrushMarkShape = "band" | "taper" | "dots";

/** The mark a brush paints, as the icon draws it. */
export interface BrushMark {
  readonly shape: BrushMarkShape;
  /** The mark's colour: the brush's ink, lifted towards white. */
  readonly color: string;
  /** How solid the mark is, from the brush's opacity. */
  readonly opacity: number;
  /** The mark's length and width, in icon units. */
  readonly length: number;
  readonly width: number;
  /** The path that draws it. */
  readonly d: string;
}

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

/** The palette of the kind the brush paints. */
export function brushIconPalette(brush: BrushSettings): BrushIconPalette {
  return BRUSH_PALETTES[brushGlyphId(brush)];
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

/** Rounds a coordinate the way the path data wants it. */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The mark's length: the brush's width, in six steps far enough to read. */
function markLength(size: number): number {
  if (size <= 6) return MARK_MIN_LENGTH;
  if (size <= 20) return 12;
  if (size <= 40) return 15;
  if (size <= 80) return 18;
  if (size <= 150) return 21;
  return MARK_MAX_LENGTH;
}

/** The mark's thickness: a hairline, a stroke, or a wide band. */
function markWidth(size: number): number {
  if (size <= 8) return 2.5;
  if (size <= 40) return 3;
  return 4;
}

/** A band: a stroke of one width with round ends. */
function bandPath(length: number, width: number): string {
  const x = MARK_CENTRE - length / 2;
  const y = MARK_Y - width / 2;
  const r = width / 2;
  return [
    `M${n(x + r)} ${n(y)}`,
    `H${n(x + length - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + length)} ${n(MARK_Y)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + length - r)} ${n(y + width)}`,
    `H${n(x + r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(MARK_Y)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}`,
    "Z",
  ].join("");
}

/** A taper: a thin tail on the left, opening to the brush's full width. */
function taperPath(length: number, width: number): string {
  const x0 = MARK_CENTRE - length / 2;
  const x1 = x0 + length;
  const y = MARK_Y;
  const h = width / 2;
  return [
    `M${n(x0)} ${n(y)}`,
    `C${n(x0 + length * 0.45)} ${n(y - h)} ${n(x0 + length * 0.75)} ${n(y - h)} ${n(x1)} ${n(y - h)}`,
    `L${n(x1)} ${n(y + h)}`,
    `C${n(x0 + length * 0.75)} ${n(y + h)} ${n(x0 + length * 0.45)} ${n(y + h)} ${n(x0)} ${n(y)}`,
    "Z",
  ].join("");
}

/** Dabs: a row of round dots, as widely spaced as the brush stamps them. */
function dotsPath(length: number, width: number): string {
  const x0 = MARK_CENTRE - length / 2;
  const radius = Math.max(1, width / 2);
  const count = Math.max(3, Math.round(length / 4.6) + 1);
  const step = length / (count - 1);
  const dots: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const cx = x0 + index * step;
    const r = n(radius);
    dots.push(
      `M${n(cx - radius)} ${n(MARK_Y)}A${r} ${r} 0 1 0 ${n(cx + radius)} ${n(MARK_Y)}A${r} ${r} 0 1 0 ${n(cx - radius)} ${n(MARK_Y)}Z`,
    );
  }
  return dots.join("");
}

/**
 * The mark under the subject.
 *
 * Its length is the brush's width, in six steps far enough apart to read at the
 * size the library draws them. Its shape is what the brush does to a stroke: a
 * hairline or a band stays a band, pressure turns it into a taper, and widely
 * spaced dabs turn it into dots.
 */
export function brushMark(brush: BrushSettings): BrushMark {
  const length = markLength(brush.size);
  const width = markWidth(brush.size);
  const shape: BrushMarkShape =
    brush.stamp && brush.stampSpacing >= 0.4
      ? "dots"
      : brush.pressureSize >= 0.5
        ? "taper"
        : "band";
  const inkHex = hexToRgb(brush.color) ? brush.color : FALLBACK_INK;
  const d =
    shape === "dots"
      ? dotsPath(length, width)
      : shape === "taper"
        ? taperPath(length, width)
        : bandPath(length, width);
  return {
    shape,
    color: markColour(inkHex, BRUSH_PALETTES[brushGlyphId(brush)].tile),
    opacity: Math.min(0.75, Math.max(0.1, 0.25 + 0.5 * brush.opacity)),
    length,
    width,
    d,
  };
}

/** The sum of the channel differences between two hex colours. */
function colourDistance(a: string, b: string): number {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  if (!first || !second) return 0;
  return Math.abs(first.r - second.r) + Math.abs(first.g - second.g) + Math.abs(first.b - second.b);
}

/** How light a hex colour is, from 0 (black) to 1 (white). */
function lightness(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/**
 * The mark's colour: the brush's ink, moved away from the tile it sits on.
 *
 * A near-black ink would vanish into a dark tile and a white one into a light
 * tile, so the ink is lifted towards white on a dark tile and dropped towards
 * black on a light one. If that still does not stand out, the other direction
 * is used, so a mark is never invisible.
 */
function markColour(ink: string, tile: string): string {
  const light = mixHex(ink, "#ffffff", 0.45);
  const dark = mixHex(ink, "#000000", 0.35);
  const preferred = lightness(tile) > 0.55 ? dark : light;
  const other = preferred === dark ? light : dark;
  return colourDistance(preferred, tile) >= 60 ? preferred : other;
}

/** The mark as the one path the icon paints. */
function markPath(mark: BrushMark): BrushIconPath {
  return { d: mark.d, fill: mark.color, opacity: mark.opacity };
}

/** The icon a brush's settings draw. */
export function brushIconFromBrush(brush: BrushSettings): BrushIcon {
  const kind = brushGlyphId(brush);
  return composeBrushIcon(kind, BRUSH_PALETTES[kind], [markPath(brushMark(brush))]);
}

/**
 * The subject of each built-in brush.
 *
 * The six curated brushes are part of the app: their names are in the toolbar
 * and their pictures are how the library is read. A hard 14 px brush paints a
 * round stroke, so the settings alone would draw the Marker as a pen; the six
 * keep the subject their name promises. Every other brush is read from its
 * settings.
 */
const BUILT_IN_KINDS: Readonly<Record<string, BrushIconId>> = {
  "builtin-pen": "pen",
  "builtin-soft": "soft",
  "builtin-marker": "marker",
  "builtin-airbrush": "airbrush",
  "builtin-charcoal": "charcoal",
  "builtin-stamps": "stamps",
};

/**
 * The icon of any preset.
 *
 * There is one rule for all of them: the icon is the brush's settings drawn. A
 * built-in brush, a translated Krita preset and the user's own brush differ
 * only in what those settings are - except the six curated brushes, which keep
 * the subject their name promises.
 */
export function brushIconForPreset(preset: BrushPreset): BrushIcon {
  const kind = BUILT_IN_KINDS[preset.id] ?? brushGlyphId(preset.brush);
  return composeBrushIcon(kind, BRUSH_PALETTES[kind], [markPath(brushMark(preset.brush))]);
}

/** The label of a kind, for a test or a tooltip that needs the words. */
export function brushIconLabel(brush: BrushSettings): string {
  return BRUSH_ICON_LABELS[brushGlyphId(brush)];
}
