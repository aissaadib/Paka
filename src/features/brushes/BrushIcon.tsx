/**
 * Draws a brush icon.
 *
 * The icon is a grid of colours, so the picture is one path per colour: the
 * grid's horizontal runs are merged into a path, and a tile is at most a
 * palette's worth of paths. That keeps the drawing sharp - the coordinates
 * are the grid's own and `crispEdges` keeps the edges hard at every size -
 * and keeps the library cheap, because every tile of it draws a picture.
 *
 * The icon says what *kind* of brush a preset is, so it is decoration inside
 * the tile; the button's accessible name is what a screen reader announces.
 */

import { useMemo } from "react";
import { BRUSH_ICON_SIZE, brushIconPaths, type BrushIcon as BrushIconData } from "./brushIcons";

/**
 * The size the library draws an icon at: a square thumbnail, with room for the
 * tile's padding and its corner marks.
 */
export const BRUSH_ICON_CSS_SIZE = 40;

export interface BrushIconProps {
  /** The icon to draw. */
  readonly icon: BrushIconData;
  /** The icon's width and height, in CSS pixels. */
  readonly size?: number;
}

export function BrushIcon({ icon, size = BRUSH_ICON_CSS_SIZE }: BrushIconProps) {
  const paths = useMemo(() => brushIconPaths(icon), [icon]);
  return (
    <svg
      className="brush-icon"
      width={size}
      height={size}
      viewBox={`0 0 ${BRUSH_ICON_SIZE} ${BRUSH_ICON_SIZE}`}
      shapeRendering="crispEdges"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((path) => (
        <path key={path.color} d={path.d} fill={path.color} />
      ))}
    </svg>
  );
}
