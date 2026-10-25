/**
 * Panel registry tests.
 *
 * The registry is the shell's list of panels. What matters is that a panel
 * registers itself once, that the list is ordered, that a bad registration is
 * refused rather than half-accepted, that the registry tells the shell when
 * it changes, and that the order two registrations arrive in does not decide
 * which panel the shell draws.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  canonicalPanelId,
  findPanel,
  isPanelRegistered,
  listPanels,
  panelCount,
  panelRegistryVersion,
  panelsInSlot,
  registerPanel,
  registerPanelIfAbsent,
  resetPanelRegistry,
  subscribeToPanelRegistry,
  unregisterPanel,
  type PanelDefinition,
} from "../core/shell/panelRegistry";

function panel(id: string, slot: PanelDefinition["slot"], order: number): PanelDefinition {
  return { id, title: id, slot, order, render: () => null };
}

/** Waits for the registry's batched notification to arrive. */
function flushNotification(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

describe("the registration order", () => {
  it("keeps a panel's own registration when a fallback comes later", () => {
    const own = panel("layers", "right", 0);
    registerPanel(own);

    // The shell's own body for a panel the catalogue knows is a fallback: it
    // fills an id nothing else has claimed, and it stands down when the
    // panel itself has spoken.
    const fallback = { ...panel("layers", "left", 0), fallback: true };
    expect(registerPanel(fallback)).toBe(own);
    expect(findPanel("layers")?.slot).toBe("right");
    expect(panelCount()).toBe(1);
  });

  it("lets a panel's own registration overrule a fallback that came first", () => {
    registerPanel({ ...panel("layers", "left", 0), fallback: true });

    const own = panel("layers", "right", 0);
    registerPanel(own);

    expect(findPanel("layers")?.slot).toBe("right");
    expect(panelCount()).toBe(1);
  });

  it("does not register a panel that is already registered again", () => {
    const first = panel("layers", "right", 0);
    registerPanel(first);

    expect(registerPanelIfAbsent(panel("layers", "left", 0))).toBe(first);
    expect(findPanel("layers")?.slot).toBe("right");
    expect(panelCount()).toBe(1);
  });

  it("registers a panel whose id is free", () => {
    const definition = panel("layers", "right", 0);
    expect(registerPanelIfAbsent(definition)).toBe(definition);
    expect(findPanel("layers")).toBe(definition);
  });

  it("holds one panel under two spellings of its id", () => {
    // The colour dock was registered once as "colour" and once as "color",
    // and the side column drew it twice. The registry is keyed by the
    // canonical id, so the two spellings are one panel.
    registerPanel(panel("color", "right", 0));
    registerPanel(panel("colour", "right", 1));

    expect(panelCount()).toBe(1);
    expect(findPanel("color")).toBeDefined();
    expect(findPanel("colour")).toBeDefined();
  });

  it("lets the canonical spelling win the id, whichever arrived first", () => {
    registerPanel(panel("colour", "right", 1));
    registerPanel(panel("color", "right", 0));

    expect(panelCount()).toBe(1);
    expect(findPanel("color")?.id).toBe("color");
  });

  it("does not let a spelling overrule the canonical registration", () => {
    const canonical = panel("color", "right", 0);
    registerPanel(canonical);

    const spelling = panel("colour", "right", 1);
    expect(registerPanel(spelling)).toBe(canonical);
    expect(findPanel("color")?.slot).toBe("right");
    expect(panelCount()).toBe(1);
  });

  it("knows the canonical spelling of an id", () => {
    expect(canonicalPanelId("colour")).toBe("color");
    expect(canonicalPanelId("color")).toBe("color");
    expect(canonicalPanelId("layers")).toBe("layers");
  });

  it("says whether a panel is registered", () => {
    expect(isPanelRegistered("layers")).toBe(false);
    registerPanel(panel("layers", "right", 0));
    expect(isPanelRegistered("layers")).toBe(true);
    expect(isPanelRegistered("colour")).toBe(false);
  });

  it("treats a panel's own spellings as the same panel", () => {
    registerPanel({ ...panel("layers", "right", 0), aliases: ["layer"] });

    expect(canonicalPanelId("layer")).toBe("layers");
    expect(isPanelRegistered("layer")).toBe(true);
    expect(panelCount()).toBe(1);
  });
});

describe("the registry's notification", () => {
  it("tells a subscriber when a panel registers", async () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToPanelRegistry(() => seen.push(panelRegistryVersion()));

    registerPanel(panel("layers", "right", 0));
    await flushNotification();

    expect(seen).toHaveLength(1);
    unsubscribe();
  });

  it("does not tell a subscriber that unsubscribed", async () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToPanelRegistry(() => seen.push(1));

    unsubscribe();
    registerPanel(panel("layers", "right", 0));
    await flushNotification();

    expect(seen).toEqual([]);
  });

  it("batches a burst of registrations into one notification", async () => {
    let calls = 0;
    const unsubscribe = subscribeToPanelRegistry(() => {
      calls += 1;
    });

    registerPanel(panel("layers", "right", 0));
    registerPanel(panel("alpha", "right", 1));
    registerPanel(panel("zebra", "right", 2));
    await flushNotification();

    expect(calls).toBe(1);
    unsubscribe();
  });

  it("does not notify when nothing was registered", async () => {
    let calls = 0;
    const unsubscribe = subscribeToPanelRegistry(() => {
      calls += 1;
    });

    await flushNotification();

    expect(calls).toBe(0);
    unsubscribe();
  });

  it("moves its version when the registry changes", () => {
    const before = panelRegistryVersion();

    registerPanel(panel("layers", "right", 0));
    const registered = panelRegistryVersion();
    expect(registered).not.toBe(before);

    unregisterPanel("layers");
    expect(panelRegistryVersion()).not.toBe(registered);
  });
});
