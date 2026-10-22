/**
 * Overlay registry tests.
 *
 * An overlay is display only: it never reaches a layer surface or an export.
 * What the registry guarantees is that an overlay is registered once, that
 * the draw order is total, and that a bad registration is refused.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  findOverlay,
  listOverlays,
  overlaysForLayer,
  registerOverlay,
  resetOverlayRegistry,
  unregisterOverlay,
  type OverlayDefinition,
} from "../core/shell/overlayRegistry";

function overlay(
  id: string,
  layer: OverlayDefinition["layer"],
  order: number,
): OverlayDefinition {
  return { id, layer, order };
}

beforeEach(() => {
  resetOverlayRegistry();
});

describe("overlay registry", () => {
  it("starts empty", () => {
    expect(listOverlays()).toEqual([]);
  });

  it("registers an overlay and finds it by id", () => {
    const definition = overlay("grid", "under", 0);
    registerOverlay(definition);
    expect(findOverlay("grid")).toBe(definition);
  });

  it("replaces an overlay registered twice under the same id", () => {
    registerOverlay(overlay("grid", "under", 0));
    registerOverlay(overlay("grid", "over", 0));
    expect(listOverlays()).toHaveLength(1);
    expect(findOverlay("grid")?.layer).toBe("over");
  });

  it("refuses an overlay with no id", () => {
    expect(() => registerOverlay(overlay("  ", "over", 0))).toThrow(/non-empty id/);
  });

  it("refuses an overlay in an unknown layer", () => {
    expect(() =>
      registerOverlay({ ...overlay("grid", "over", 0), layer: "middle" as never }),
    ).toThrow(/unknown layer/);
  });

  it("draws the under layer before the over layer", () => {
    registerOverlay(overlay("selection", "over", 0));
    registerOverlay(overlay("grid", "under", 0));
    registerOverlay(overlay("guides", "over", 1));
    expect(listOverlays().map((entry) => entry.id)).toEqual([
      "grid",
      "selection",
      "guides",
    ]);
  });

  it("orders a layer by order and then by id", () => {
    registerOverlay(overlay("zebra", "over", 1));
    registerOverlay(overlay("alpha", "over", 1));
    registerOverlay(overlay("first", "over", 0));
    expect(overlaysForLayer("over").map((entry) => entry.id)).toEqual([
      "first",
      "alpha",
      "zebra",
    ]);
    expect(overlaysForLayer("under")).toEqual([]);
  });

  it("removes an overlay", () => {
    registerOverlay(overlay("grid", "under", 0));
    expect(unregisterOverlay("grid")).toBe(true);
    expect(unregisterOverlay("grid")).toBe(false);
  });

  it("empties the registry on reset", () => {
    registerOverlay(overlay("grid", "under", 0));
    resetOverlayRegistry();
    expect(listOverlays()).toEqual([]);
  });
});
