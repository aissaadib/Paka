/**
 * Where a popup goes.
 *
 * A context menu opens where the pointer is, but the pointer can be at the
 * very edge of the window: a menu that opened there would hang off the
 * screen, and a menu that opened off-screen could not be dismissed by
 * clicking outside it. The position is therefore clamped to the window.
 *
 * The numbers are CSS pixels throughout. A window's inner size is reported in
 * CSS pixels and a pointer's client coordinates are CSS pixels, so the two can
 * be compared directly - the device pixel ratio is a property of the backing
 * store, not of the layout.
 */

export interface MenuSize {
  readonly width: number;
  readonly height: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface MenuPosition {
  readonly x: number;
  readonly y: number;
}

/** The gap kept between a popup and the edge of the window. */
export const MENU_EDGE_MARGIN = 4;

/**
 * Clamps a popup's top-left corner so the popup stays inside the window.
 *
 * A popup wider or taller than the window is pinned to the top-left corner
 * with the margin: it is then clipped by the window, but its first item and
 * its title stay reachable, which matters more than showing all of it.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  size: MenuSize,
  viewport: ViewportSize,
  margin: number = MENU_EDGE_MARGIN,
): MenuPosition {
  const maxX = viewport.width - size.width - margin;
  const maxY = viewport.height - size.height - margin;
  return {
    x: maxX < margin ? margin : Math.min(Math.max(x, margin), maxX),
    y: maxY < margin ? margin : Math.min(Math.max(y, margin), maxY),
  };
}
