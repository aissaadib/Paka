/**
 * Shell slot tests.
 *
 * The layout is pure data, so everything here is about the rules the shell
 * relies on: a panel is in exactly one slot, hiding keeps the panel, and an
 * untrusted layout never invents a place for a panel.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHELL_LAYOUT,
  findPlacement,
  hidePanel,
  isShellSlotId,
  movePanel,
  nextOrderInSlot,
  normalizeShellLayout,
  placePanel,
  placementsInSlot,
  shellLayoutEqual,
  showPanel,
} from "../core/shell/slots";

describe("shell slots", () => {
  it("recognises the closed set of slots", () => {
    expect(isShellSlotId("left")).toBe(true);
    expect(isShellSlotId("right")).toBe(true);
    expect(isShellSlotId("bottom")).toBe(true);
    expect(isShellSlotId("floating")).toBe(true);
    expect(isShellSlotId("hidden")).toBe(true);
    expect(isShellSlotId("middle")).toBe(false);
    expect(isShellSlotId(7)).toBe(false);
    expect(isShellSlotId(null)).toBe(false);
  });

  it("starts with nothing placed", () => {
    expect(DEFAULT_SHELL_LAYOUT.placements).toEqual([]);
    expect(placementsInSlot(DEFAULT_SHELL_LAYOUT, "right")).toEqual([]);
  });

  it("places a panel in a slot", () => {
    const layout = placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right");
    expect(findPlacement(layout, "layers")).toEqual({
      panelId: "layers",
      slot: "right",
      order: 0,
    });
  });

  it("keeps a panel in exactly one slot when it is moved", () => {
    let layout = placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right");
    layout = movePanel(layout, "layers", "left", 2);
    expect(layout.placements).toHaveLength(1);
    expect(findPlacement(layout, "layers")?.slot).toBe("left");
    expect(findPlacement(layout, "layers")?.order).toBe(2);
  });

  it("ignores a blank panel id", () => {
    const layout = placePanel(DEFAULT_SHELL_LAYOUT, "   ", "right");
    expect(layout).toBe(DEFAULT_SHELL_LAYOUT);
  });

  it("appends to the end of a slot", () => {
    let layout = placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right");
    layout = placePanel(layout, "colour", "right");
    layout = placePanel(layout, "history", "left");
    layout = placePanel(layout, "brush", "right");
    expect(placementsInSlot(layout, "right").map((entry) => entry.panelId)).toEqual([
      "layers",
      "colour",
      "brush",
    ]);
  });

  it("numbers the next position in a slot", () => {
    const layout = placePanel(placePanel(DEFAULT_SHELL_LAYOUT, "a", "right"), "b", "right");
    expect(nextOrderInSlot(layout.placements, "right")).toBe(2);
    expect(nextOrderInSlot(layout.placements, "left")).toBe(0);
  });

  it("hides a panel and shows it again", () => {
    let layout = placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right");
    layout = hidePanel(layout, "layers");
    expect(findPlacement(layout, "layers")?.slot).toBe("hidden");
    expect(placementsInSlot(layout, "right")).toHaveLength(0);
    layout = showPanel(layout, "layers", "right");
    expect(findPlacement(layout, "layers")?.slot).toBe("right");
  });

  it("orders a slot by order and then by id", () => {
    const layout = {
      placements: [
        { panelId: "b", slot: "right" as const, order: 1 },
        { panelId: "a", slot: "right" as const, order: 1 },
        { panelId: "c", slot: "right" as const, order: 0 },
      ],
    };
    expect(placementsInSlot(layout, "right").map((entry) => entry.panelId)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("reading an untrusted layout", () => {
  it("drops a placement in an unknown slot", () => {
    const layout = normalizeShellLayout({
      placements: [
        { panelId: "layers", slot: "middle", order: 0 },
        { panelId: "colour", slot: "right", order: 1 },
      ],
    });
    expect(layout.placements).toEqual([
      { panelId: "colour", slot: "right", order: 1 },
    ]);
  });

  it("drops a placement with no panel id", () => {
    const layout = normalizeShellLayout({ placements: [{ slot: "right", order: 0 }] });
    expect(layout.placements).toEqual([]);
  });

  it("keeps the first of two placements for the same panel", () => {
    const layout = normalizeShellLayout({
      placements: [
        { panelId: "layers", slot: "right", order: 0 },
        { panelId: "layers", slot: "left", order: 1 },
      ],
    });
    expect(layout.placements).toEqual([{ panelId: "layers", slot: "right", order: 0 }]);
  });

  it("falls back to the defaults for anything that is not a layout", () => {
    for (const value of [null, undefined, 3, "layout", []]) {
      expect(normalizeShellLayout(value)).toEqual(DEFAULT_SHELL_LAYOUT);
    }
    expect(normalizeShellLayout({ placements: "none" })).toEqual(DEFAULT_SHELL_LAYOUT);
  });

  it("gives a placement without an order the next free number", () => {
    const layout = normalizeShellLayout({
      placements: [
        { panelId: "a", slot: "right" },
        { panelId: "b", slot: "right" },
      ],
    });
    expect(layout.placements.map((entry) => entry.order)).toEqual([0, 1]);
  });
});

describe("comparing layouts", () => {
  it("sees two layouts with the same placements as equal", () => {
    const a = placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right");
    const b = placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right");
    expect(shellLayoutEqual(a, b)).toBe(true);
  });

  it("sees a moved panel as a different layout", () => {
    const a = placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right");
    const b = placePanel(DEFAULT_SHELL_LAYOUT, "layers", "left");
    expect(shellLayoutEqual(a, b)).toBe(false);
  });

  it("sees an extra panel as a different layout", () => {
    const a = placePanel(DEFAULT_SHELL_LAYOUT, "layers", "right");
    const b = placePanel(a, "colour", "right");
    expect(shellLayoutEqual(a, b)).toBe(false);
  });
});
