/**
 * Draws a brush icon.
 *
 * The icon is a short list of vector paths - a tile, a sheen, the mark the
 * brush leaves and the subject that says what kind of brush it is - so the
 * picture is sharp at any size and any display density, and a grid of forty of
 * them costs a handful of nodes per tile.
 *
 * The icon says what *kind* of brush a preset is, so it is decoration inside
 * the tile; the button's accessible name is what a screen reader announces.
 */

import { useMemo } from "react";
import { BRUSH_ICON_SIZE, type BrushIcon as BrushIconData } from "./brushIcons";

/**
 * The size the library draws an icon at: a square thumbnail, with room for the
 * tile's corner marks. The art itself is inset inside the icon, so the icon is
 * a little larger than the picture it holds.
 */
export const BRUSH_ICON_CSS_SIZE = 46;

export interface BrushIconProps {
  /** The icon to draw. */
  readonly icon: BrushIconData;
  /** The icon's width and height, in CSS pixels. */
  readonly size?: number;
}

export function BrushIcon({ icon, size = BRUSH_ICON_CSS_SIZE }: BrushIconProps) {
  const paths = useMemo(() => icon.paths, [icon]);
  return (
    <svg
      className="brush-icon"
      width={size}
      height={size}
      viewBox={`0 0 ${BRUSH_ICON_SIZE} ${BRUSH_ICON_SIZE}`}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          fill={path.fill ?? "none"}
          stroke={path.stroke}
          strokeWidth={path.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={path.opacity}
          transform={path.transform}
        />
      ))}
    </svg>
  );
}
