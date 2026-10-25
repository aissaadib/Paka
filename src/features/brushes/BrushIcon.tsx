/**
 * Draws a brush icon.
 *
 * The icon is a grid of colours, so the picture is a list of rectangles: one
 * per horizontal run, with the corners of the tile left transparent. The
 * rectangles are axis-aligned and the viewBox is the grid itself, so the art
 * stays sharp at every size instead of being resampled.
 *
 * The icon says what *kind* of brush a built-in preset is, so it is
 * decoration beside the preset's name; the row's text is what a screen reader
 * announces.
 */

import { BRUSH_ICON_SIZE, brushIconRuns, type BrushIcon as BrushIconData } from "./brushIcons";

/** The default size: the height a library row can carry. */
export const BRUSH_ICON_CSS_SIZE = 18;

export interface BrushIconProps {
  /** The icon to draw. */
  readonly icon: BrushIconData;
  /** The icon's width and height, in CSS pixels. */
  readonly size?: number;
}

export function BrushIcon({ icon, size = BRUSH_ICON_CSS_SIZE }: BrushIconProps) {
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
      {brushIconRuns(icon).map((run) => (
        <rect
          key={`${run.y}-${run.x}`}
          x={run.x}
          y={run.y}
          width={run.width}
          height={1}
          fill={run.color}
        />
      ))}
    </svg>
  );
}
