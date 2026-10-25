/**
 * The layers panel's keyboard contract.
 *
 * The panel is keyboard-drivable, and the rules that decide what a key press
 * means are pinned here, because the React layer that renders the panel has no
 * automated tests.
 *
 * The two rules that protect the artist are the important ones: a field owns
 * its own keys (Backspace in the opacity field must not delete a layer), and
 * the panel's keys stop at the panel (the global nudge must not fire at the
 * same time).
 */

import { describe, expect, it } from "vitest";
import { layerPanelAction, type LayerPanelKeyPress } from "../core/document/layerKeyboard";

/** A press with everything off: no modifier, no field, no drag. */
function press(key: string, overrides: Partial<LayerPanelKeyPress> = {}): LayerPanelKeyPress {
  return { key, mod: false, textEntry: false, dragging: false, ...overrides };
}

describe("layerPanelAction", () => {
  it("moves the row focus with the arrow keys", () => {
    expect(layerPanelAction(press("ArrowUp"))).toEqual({ kind: "focus", offset: -1 });
    expect(layerPanelAction(press("ArrowDown"))).toEqual({ kind: "focus", offset: 1 });
  });

  it("moves the layer in the stack with the arrow keys and the modifier", () => {
    // The stack is bottom-first in the document, so "up" is a positive delta.
    expect(layerPanelAction(press("ArrowUp", { mod: true }))).toEqual({ kind: "move", delta: 1 });
    expect(layerPanelAction(press("ArrowDown", { mod: true }))).toEqual({ kind: "move", delta: -1 });
  });

  it("collapses and expands groups with the left and right arrows", () => {
    expect(layerPanelAction(press("ArrowLeft"))).toEqual({ kind: "collapse" });
    expect(layerPanelAction(press("ArrowRight"))).toEqual({ kind: "expand" });
    expect(layerPanelAction(press("ArrowLeft", { mod: true }))).toBeNull();
    expect(layerPanelAction(press("ArrowRight", { mod: true }))).toBeNull();
  });

  it("jumps to the first and the last row", () => {
    expect(layerPanelAction(press("Home"))).toEqual({ kind: "focusEdge", edge: "first" });
    expect(layerPanelAction(press("End"))).toEqual({ kind: "focusEdge", edge: "last" });
  });

  it("renames with F2", () => {
    expect(layerPanelAction(press("F2"))).toEqual({ kind: "rename" });
  });

  it("removes the row with Delete and with Backspace", () => {
    expect(layerPanelAction(press("Delete"))).toEqual({ kind: "delete" });
    expect(layerPanelAction(press("Backspace"))).toEqual({ kind: "delete" });
  });

  it("cancels a drag in flight with Escape", () => {
    expect(layerPanelAction(press("Escape", { dragging: true }))).toEqual({ kind: "cancelDrag" });
  });

  it("leaves Escape alone when there is no drag", () => {
    // Escape is the global "clear the selection"; the panel must not take it.
    expect(layerPanelAction(press("Escape"))).toBeNull();
  });

  it("leaves a key that is not the panel's alone", () => {
    expect(layerPanelAction(press("a"))).toBeNull();
    expect(layerPanelAction(press("Tab"))).toBeNull();
    expect(layerPanelAction(press("Enter"))).toBeNull();
  });

  it("keeps its hands off every key while a field has the focus", () => {
    // The rule that keeps a number field usable: Backspace clears the number
    // and the arrow keys step it, instead of the panel moving a layer.
    for (const key of ["Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "F2"]) {
      expect(layerPanelAction(press(key, { textEntry: true }))).toBeNull();
    }
    expect(layerPanelAction(press("ArrowUp", { textEntry: true, mod: true }))).toBeNull();
  });

  it("still cancels a drag in flight when a field has the focus", () => {
    // A drag and a field cannot be open at the same time, but the rule is
    // absolute: a field owns its keys.
    expect(layerPanelAction(press("Escape", { textEntry: true, dragging: true }))).toBeNull();
  });
});
