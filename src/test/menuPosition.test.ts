/**
 * Popup placement tests.
 *
 * A menu that opened at the very edge of the window would hang off the
 * screen, and a menu that opened off-screen could not be dismissed by
 * clicking outside it. The clamp is pure, so it is pinned down here.
 */

import { describe, expect, it } from "vitest";
import { clampMenuPosition, MENU_EDGE_MARGIN } from "../utils/menuPosition";

const WINDOW = { width: 1000, height: 800 };
const MENU = { width: 200, height: 300 };

describe("clamping a menu to the window", () => {
  it("leaves a menu that fits where it was asked for", () => {
    expect(clampMenuPosition(400, 300, MENU, WINDOW)).toEqual({ x: 400, y: 300 });
  });

  it("pulls a menu back from the right edge", () => {
    expect(clampMenuPosition(950, 300, MENU, WINDOW)).toEqual({
      x: WINDOW.width - MENU.width - MENU_EDGE_MARGIN,
      y: 300,
    });
  });

  it("pulls a menu back from the bottom edge", () => {
    expect(clampMenuPosition(400, 780, MENU, WINDOW)).toEqual({
      x: 400,
      y: WINDOW.height - MENU.height - MENU_EDGE_MARGIN,
    });
  });

  it("pulls a menu back from the top-left corner", () => {
    expect(clampMenuPosition(0, 0, MENU, WINDOW)).toEqual({
      x: MENU_EDGE_MARGIN,
      y: MENU_EDGE_MARGIN,
    });
  });

  it("keeps a menu that is bigger than the window reachable", () => {
    const position = clampMenuPosition(500, 400, { width: 2000, height: 2000 }, WINDOW);
    expect(position).toEqual({ x: MENU_EDGE_MARGIN, y: MENU_EDGE_MARGIN });
  });

  it("works in a small window", () => {
    const position = clampMenuPosition(300, 200, MENU, { width: 320, height: 240 });
    // The menu is taller than the window, so it is pinned to the top; it is
    // narrower, so it keeps to the right edge.
    expect(position.x).toBe(320 - 200 - MENU_EDGE_MARGIN);
    expect(position.y).toBe(MENU_EDGE_MARGIN);
  });

  it("uses the window's own size, not the screen's", () => {
    // The numbers are CSS pixels: a window on a high-density screen is
    // smaller in CSS pixels than it is on the screen, and the menu has to
    // follow the window.
    const position = clampMenuPosition(400, 300, MENU, { width: 640, height: 480 });
    expect(position.x).toBe(400);
    expect(position.y).toBe(480 - 300 - MENU_EDGE_MARGIN);
  });
});
