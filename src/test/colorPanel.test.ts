/**
 * The colour dock's tests.
 *
 * The dock is a shell panel, so what matters is that it registers itself with
 * the facts the shell reads, that the shell's preferences decide where it
 * lives and whether it is shown, and that nothing in it is an edit: choosing
 * a colour says what the *next* stroke is painted with, so it adds no history
 * step, dirties nothing and never reaches a project file.
 *
 * The tests run without a browser: the registration and the layout are plain
 * data, and the drawing engine runs without a canvas.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import {
  findPanel,
  listPanels,
  panelsInSlot,
  registerPanel,
  resetPanelRegistry,
} from "../core/shell/panelRegistry";
import {
  DEFAULT_SHELL_PREFERENCES,
  normalizeShellPreferences,
} from "../core/shell/preferences";
import {
  COLOR_PANEL_COLLAPSIBLE,
  COLOR_PANEL_DESCRIPTION,
  COLOR_PANEL_GROW,
  COLOR_PANEL_ICON,
  COLOR_PANEL_ID,
  COLOR_PANEL_MOUNTING,
  COLOR_PANEL_ORDER,
  COLOR_PANEL_SLOT,
  COLOR_PANEL_TITLE,
  createColorPanelDefinition,
  registerColorPanel,
} from "../features/color/colorPanelRegistration";
import {
  colorPanelOrder,
  colorPanelPlacement,
  colorPanelSlot,
  foldColorPanel,
  isColorPanelFolded,
  isColorPanelVisible,
  toggleColorPanelFold,
  unfoldColorPanel,
} from "../features/color/colorPanelState";
import type { PointerSample } from "../types/pointer";

function createEngine() {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
  });
}

function createSample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    phase: "move",
    pointerId: 1,
    kind: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: 0,
    docY: 0,
    screenX: 0,
    screenY: 0,
    pressure: 0.7,
    hasPressure: true,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    ...overrides,
  };
}

beforeEach(() => {
  resetPanelRegistry();
});

describe("the colour dock's registration", () => {
  it("tells the shell its id, its title, its slot, its order, its glyph and its policy", () => {
    const definition = createColorPanelDefinition(() => null);

    expect(definition.id).toBe(COLOR_PANEL_ID);
    expect(definition.title).toBe(COLOR_PANEL_TITLE);
    expect(definition.slot).toBe(COLOR_PANEL_SLOT);
    expect(definition.order).toBe(COLOR_PANEL_ORDER);
    expect(definition.icon).toBe(COLOR_PANEL_ICON);
    expect(definition.mounting).toBe(COLOR_PANEL_MOUNTING);
    expect(definition.collapsible).toBe(COLOR_PANEL_COLLAPSIBLE);
    expect(definition.grow).toBe(COLOR_PANEL_GROW);
    expect(definition.description).toBe(COLOR_PANEL_DESCRIPTION);
  });

  it("keeps the facts the shell writes to the settings file", () => {
    // The id is written to disk, so it is pinned here: a renamed dock would
    // leave its old id behind in every saved layout. It is also the id the
    // shell and the panel manager's catalogue use, so there is one dock and
    // not two.
    expect(COLOR_PANEL_ID).toBe("color");
    expect(COLOR_PANEL_TITLE).toBe("Color");
    expect(COLOR_PANEL_SLOT).toBe("right");
    expect(COLOR_PANEL_ICON).toBe("palette");
    expect(COLOR_PANEL_ORDER).toBe(0);
    expect(COLOR_PANEL_DESCRIPTION).toMatch(/\S/);
  });

  it("stays mounted while it is hidden, because it holds state of its own", () => {
    // The wheel remembers the hue the user asked for and the readout the
    // colour it compares against: unmounting the dock would lose both.
    expect(COLOR_PANEL_MOUNTING).toBe("always");
  });

  it("can be folded to its header, and does not take the column's leftover height", () => {
    // The wheel is tall, so the user can fold the dock away; the panel that
    // grows is the one that lists the document's layers.
    expect(COLOR_PANEL_COLLAPSIBLE).toBe(true);
    expect(COLOR_PANEL_GROW).toBe(false);
  });

  it("registers itself in the shell's panel registry", () => {
    registerColorPanel(() => null);

    const found = findPanel(COLOR_PANEL_ID);
    expect(found).toBeDefined();
    expect(found?.slot).toBe(COLOR_PANEL_SLOT);
    expect(panelsInSlot(COLOR_PANEL_SLOT).map((panel) => panel.id)).toContain(COLOR_PANEL_ID);
  });

  it("does not appear twice when its module is evaluated again", () => {
    registerColorPanel(() => null);
    registerColorPanel(() => null);

    expect(listPanels().filter((panel) => panel.id === COLOR_PANEL_ID)).toHaveLength(1);
  });

  it("keeps its place among the panels docked in the same slot", () => {
    registerPanel({
      id: "layers",
      title: "Layers",
      slot: COLOR_PANEL_SLOT,
      order: 1,
      render: () => null,
    });
    registerColorPanel(() => null);

    expect(panelsInSlot(COLOR_PANEL_SLOT).map((panel) => panel.id)).toEqual([
      COLOR_PANEL_ID,
      "layers",
    ]);
  });

  it("draws the body the shell asks for", () => {
    const definition = createColorPanelDefinition(() => "the dock");
    expect(definition.render()).toBe("the dock");
  });
});

describe("where the dock lives", () => {
  it("is shown unless the preferences hide it", () => {
    expect(isColorPanelVisible(DEFAULT_SHELL_PREFERENCES)).toBe(true);

    const hidden = normalizeShellPreferences({ hiddenPanels: [COLOR_PANEL_ID] });
    expect(isColorPanelVisible(hidden)).toBe(false);
  });

  it("docks in the side column until the preferences say otherwise", () => {
    expect(colorPanelSlot(DEFAULT_SHELL_PREFERENCES)).toBe(COLOR_PANEL_SLOT);

    const moved = normalizeShellPreferences({ panelSlots: { [COLOR_PANEL_ID]: "left" } });
    expect(colorPanelSlot(moved)).toBe("left");
  });

  it("takes the place the preferences remember", () => {
    expect(colorPanelOrder(DEFAULT_SHELL_PREFERENCES)).toBe(COLOR_PANEL_ORDER);

    const ordered = normalizeShellPreferences({ panelOrder: ["layers", COLOR_PANEL_ID] });
    expect(colorPanelOrder(ordered)).toBe(1);
  });

  it("describes where it sits in the shell's own vocabulary", () => {
    const preferences = normalizeShellPreferences({
      panelSlots: { [COLOR_PANEL_ID]: "bottom" },
      panelOrder: [COLOR_PANEL_ID],
    });

    expect(colorPanelPlacement(preferences)).toEqual({
      panelId: COLOR_PANEL_ID,
      slot: "bottom",
      order: 0,
    });
  });
});

describe("the dock's fold state", () => {
  it("is folded when the shell's folded list names it", () => {
    expect(isColorPanelFolded([])).toBe(false);
    expect(isColorPanelFolded(["layers"])).toBe(false);
    expect(isColorPanelFolded([COLOR_PANEL_ID])).toBe(true);
  });

  it("folds and unfolds without listing the dock twice", () => {
    const folded = foldColorPanel([]);
    expect(isColorPanelFolded(folded)).toBe(true);
    expect(folded.filter((id) => id === COLOR_PANEL_ID)).toHaveLength(1);

    expect(isColorPanelFolded(foldColorPanel(folded))).toBe(true);
    expect(foldColorPanel(folded)).toHaveLength(1);

    const unfolded = unfoldColorPanel(folded);
    expect(isColorPanelFolded(unfolded)).toBe(false);
    expect(unfolded).toHaveLength(0);
  });

  it("toggles between the two states", () => {
    const folded = toggleColorPanelFold([]);
    expect(isColorPanelFolded(folded)).toBe(true);
    expect(isColorPanelFolded(toggleColorPanelFold(folded))).toBe(false);
  });

  it("leaves the other panels' fold state alone", () => {
    const folded = foldColorPanel(["layers"]);
    expect(folded).toEqual(["layers", COLOR_PANEL_ID]);
    expect(unfoldColorPanel(folded)).toEqual(["layers"]);
  });
});

describe("the dock does not edit the drawing", () => {
  it("choosing a colour adds no history step and does not dirty the file", () => {
    const engine = createEngine();

    // The paths the dock writes through: the wheel, the hex field, the
    // palette, the readout's ink picker and the canvas picker all land here.
    engine.setBrush({ color: "#ff0000" });
    engine.setSecondaryColor("#00ff00");
    engine.swapColors();

    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("a stroke keeps the colour it was drawn with, and undo undoes the stroke", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.setBrush({ color: "#ff0000" });
    engine.beginStroke(createSample({ docX: 10, docY: 10 }));
    engine.extendStroke(createSample({ docX: 60, docY: 40, timeStamp: 16 }));
    engine.finishStroke();

    expect(engine.getState().history.depth).toBe(1);
    expect(engine.listStrokes(layerId)[0].brush.color).toBe("#ff0000");

    // Changing the colour afterwards describes the next stroke: it adds no
    // step, and the stroke that is already there keeps its own colour.
    engine.setBrush({ color: "#0000ff" });
    expect(engine.getState().history.depth).toBe(1);
    expect(engine.listStrokes(layerId)[0].brush.color).toBe("#ff0000");

    expect(engine.undo()).toBe(true);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.listStrokes(layerId)).toEqual([]);
  });
});
