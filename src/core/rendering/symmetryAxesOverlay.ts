/**
 * The symmetry overlay: the mirror axes drawn over the canvas.
 *
 * The axes are **display only**. They are painted on the display canvas, above
 * the artwork, and they never reach a layer surface, a PNG export or the
 * document: an export of a document with a symmetry on is byte-identical to
 * one with it off. This is the same rule the grid and the composition guides
 * follow, and for the same reason - they describe the *next* gesture, not the
 * artwork.
 *
 * The overlay registers itself through the shell's overlay registry
 * (`core/shell/overlayRegistry`), so the renderer paints the list of overlays
 * and this feature never touches the renderer's paint sequence.
 *
 * **The transform must be in force.** The overlay paints in *document*
 * coordinates, exactly as the grid and the composition guides do, so the
 * renderer has to call `paint` with the document transform already set on the
 * context - the same place in the paint sequence the grid and the guides are
 * painted. The context's `scale` is what turns a device-pixel measurement
 * into a document one, so a line of `1 / scale` is one device pixel wide at
 * any zoom.
 *
 * Where the axes are comes from the editor's symmetry settings, which the
 * engine owns. The overlay keeps the last settings it was handed - the same
 * way the renderer is handed the grid's settings - and paints from them.
 */

import {
  registerOverlay,
  type OverlayDefinition,
  type OverlayPaintContext,
} from "../shell/overlayRegistry";
import {
  DEFAULT_SYMMETRY_SETTINGS,
  activeSymmetryAxes,
  type SymmetrySettings,
} from "../document/symmetry";

/** The overlay's id in the registry. */
export const SYMMETRY_OVERLAY_ID = "symmetry";

/**
 * The colour of the mirror axes.
 *
 * A hue of its own, so an axis is never mistaken for a composition guide
 * (pink) or for the selection (blue). Teal reads over both dark ink and pale
 * paper.
 */
export const SYMMETRY_AXIS_COLOR = "#00b8a9";

/**
 * The dash of the axis line, in device pixels: a long dash, a short gap.
 *
 * A dashed line says "this is a mirror line", which a solid hairline does
 * not - the composition guides are solid hairlines too.
 */
const SYMMETRY_AXIS_DASH: readonly [number, number] = [8, 6];

/** The settings the overlay draws, until it is told otherwise. */
let current: SymmetrySettings = DEFAULT_SYMMETRY_SETTINGS;

/**
 * Hands the overlay the symmetry to draw.
 *
 * The engine owns the settings; the overlay only draws them. A change is
 * display-only: it adds no history step and dirties nothing.
 */
export function setSymmetryOverlaySettings(settings: SymmetrySettings): void {
  current = settings;
}

/** The settings the overlay is drawing right now. */
export function symmetryOverlaySettings(): SymmetrySettings {
  return current;
}

/**
 * Puts the overlay back to the default symmetry.
 *
 * Only for tests: nothing in the running app should clear the overlay's
 * settings behind the engine's back.
 */
export function resetSymmetryOverlaySettings(): void {
  current = DEFAULT_SYMMETRY_SETTINGS;
}

/**
 * The part of the document the canvas shows, in document pixels.
 *
 * An axis is a **registration aid**, not a mark on the paper, so it spans the
 * whole viewport like a composition guide: it stays visible while the paper is
 * panned away, and an axis the user has dragged off the paper is still there
 * to be seen and grabbed.
 *
 * The canvas is measured in backing-store pixels and the viewport's zoom is in
 * CSS pixels, so the two are joined through the scale - the number of
 * backing-store pixels a document pixel covers. A canvas that reports no size
 * falls back to the document itself, which is the right answer for a canvas
 * that has not been laid out yet.
 */
function visibleDocumentRect(context: OverlayPaintContext): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const { ctx, viewport, documentWidth, documentHeight, scale } = context;
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  const left = 0 - viewport.offsetX / zoom;
  const top = 0 - viewport.offsetY / zoom;
  const canvas = ctx.canvas;
  const canvasWidth = canvas ? canvas.width : 0;
  const canvasHeight = canvas ? canvas.height : 0;
  if (canvasWidth <= 0 || canvasHeight <= 0 || scale <= 0) {
    return { left: 0, top: 0, right: documentWidth, bottom: documentHeight };
  }
  return {
    left,
    top,
    right: left + canvasWidth / scale,
    bottom: top + canvasHeight / scale,
  };
}

/**
 * Draws the mirror axes.
 *
 * The axes are drawn in **document space**, in the transform the renderer has
 * already put in force, and their line is a **hairline**: one device pixel at
 * any zoom, the same idiom as the grid, the guides and the document border.
 * The dash is in device pixels too, so an axis looks the same at 2 % and at
 * 6400 %.
 */
export function paintSymmetryAxes(context: OverlayPaintContext): void {
  const axes = activeSymmetryAxes(current);
  if (axes.length === 0) {
    return;
  }

  const { ctx, scale } = context;
  const visible = visibleDocumentRect(context);

  ctx.globalAlpha = 1;
  ctx.strokeStyle = SYMMETRY_AXIS_COLOR;
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([SYMMETRY_AXIS_DASH[0] / scale, SYMMETRY_AXIS_DASH[1] / scale]);
  ctx.beginPath();
  for (const axis of axes) {
    if (axis.kind === "vertical") {
      ctx.moveTo(axis.position, visible.top);
      ctx.lineTo(axis.position, visible.bottom);
    } else {
      ctx.moveTo(visible.left, axis.position);
      ctx.lineTo(visible.right, axis.position);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

/**
 * The symmetry overlay.
 *
 * It is drawn **over** the artwork, like the guides and the selection, so it
 * is never hidden by the ink it describes.
 */
export const symmetryOverlay: OverlayDefinition = registerOverlay({
  id: SYMMETRY_OVERLAY_ID,
  layer: "over",
  order: 10,
  paint: paintSymmetryAxes,
});
