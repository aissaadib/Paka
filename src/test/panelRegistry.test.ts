/**
 * Panel registry tests.
 *
 * The registry is the shell's list of panels. What matters is that a panel
 * registers itself once, that the list is ordered, and that a bad
 * registration is refused rather than half-accepted.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  findPanel,
  listPanels,
  panelCount,
  panelsInSlot,
  registerPanel,
  resetPanelRegistry,
  unregisterPanel,
  type PanelDefinition,
} from "../core/shell/panelRegistry";

function panel(id: string, slot: PanelDefinition["slot"], order: number): PanelDefinition {
  return { id, title: id, slot, order, render: () => null };
}

beforeEach(() => {
  resetPanelRegistry();
});

describe("panel registry", () => {
  it("starts empty", () => {
    expect(panelCount()).toBe(0);
    expect(listPanels()).toEqual([]);
  });

  it("registers a panel and finds it by id", () => {
    const definition = panel("layers", "right", 0);
    registerPanel(definition);
    expect(findPanel("layers")).toBe(definition);
    expect(panelCount()).toBe(1);
  });

  it("replaces a panel registered twice under the same id", () => {
    registerPanel(panel("layers", "right", 0));
    registerPanel(panel("layers", "left", 0));
    expect(panelCount()).toBe(1);
    expect(findPanel("layers")?.slot).toBe("left");
  });

  it("refuses a panel with no id", () => {
    expect(() => registerPanel(panel("   ", "right", 0))).toThrow(/non-empty id/);
  });

  it("refuses a panel in an unknown slot", () => {
    expect(() =>
      registerPanel({ ...panel("layers", "right", 0), slot: "middle" as never }),
    ).toThrow(/unknown slot/);
  });

  it("orders the panels by slot, then order, then id", () => {
    registerPanel(panel("zebra", "right", 0));
    registerPanel(panel("alpha", "right", 0));
    registerPanel(panel("layers", "left", 0));
    registerPanel(panel("colour", "right", 1));
    expect(listPanels().map((entry) => entry.id)).toEqual([
      "layers",
      "alpha",
      "zebra",
      "colour",
    ]);
  });

  it("lists the panels in one slot", () => {
    registerPanel(panel("layers", "right", 0));
    registerPanel(panel("colour", "right", 1));
    registerPanel(panel("brush", "left", 0));
    expect(panelsInSlot("right").map((entry) => entry.id)).toEqual(["layers", "colour"]);
    expect(panelsInSlot("bottom")).toEqual([]);
  });

  it("removes a panel", () => {
    registerPanel(panel("layers", "right", 0));
    expect(unregisterPanel("layers")).toBe(true);
    expect(unregisterPanel("layers")).toBe(false);
    expect(findPanel("layers")).toBeUndefined();
  });

  it("empties the registry on reset", () => {
    registerPanel(panel("layers", "right", 0));
    resetPanelRegistry();
    expect(panelCount()).toBe(0);
  });
});
