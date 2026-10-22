/**
 * The layers panel's keyboard contract.
 *
 * The panel is keyboard-drivable: a row can be reached, renamed, reordered and
 * removed without the mouse. The rules that decide what a key press *means*
 * live here, in a pure module, because the React layer that renders the panel
 * has no automated tests - this is where the contract is pinned.
 *
 * Two rules matter more than the rest:
 *
 *  - **A field owns its own keys.** While a row's name field or its opacity
 *    field has the focus, typing wins: Backspace has to clear a number, not
 *    ask the engine to delete a layer. The caller says whether the press came
 *    from a field (`textEntry`), and the panel then keeps its hands off. The
 *    same rule already guards the global shortcuts, and both use the same
 *    helper, so the two never disagree about what "typing" means.
 *
 *  - **The panel's keys stop at the panel.** The caller is told what to do and
 *    stops the event there, so the global nudge never fires at the same time
 *    as the panel's own arrow keys.
 *
 * Two orders are in play, and mixing them up is the bug this module exists to
 * prevent:
 *
 *  - the **panel's list** is top-first (index 0 is the top of the stack), and
 *    the `focus` offset is counted in it: `-1` is the row above.
 *  - the **document's stack** is bottom-first, and the `move` delta is counted
 *    in it: `+1` moves a layer towards the top of the stack. It is the delta
 *    `engine.moveLayer` takes, so the panel hands it over unchanged.
 */

/** What a key press asks the layers panel to do. */
export type LayerPanelAction =
  /** Move the row focus by `offset` rows in the panel's top-first list. */
  | { readonly kind: "focus"; readonly offset: number }
  /** Put the row focus on the first or the last row. */
  | { readonly kind: "focusEdge"; readonly edge: "first" | "last" }
  /** Start renaming the focused row. */
  | { readonly kind: "rename" }
  /** Remove the focused row. */
  | { readonly kind: "delete" }
  /** Move the focused layer in the stack by `delta`. */
  | { readonly kind: "move"; readonly delta: number }
  /** Abandon a drag reorder in flight. */
  | { readonly kind: "cancelDrag" };

/** What the panel needs to know about a key press. */
export interface LayerPanelKeyPress {
  /** The key, as the browser reports it (`"ArrowUp"`, `"F2"`, `"Delete"`). */
  readonly key: string;
  /** The primary modifier is held (Ctrl, or Cmd on macOS). */
  readonly mod: boolean;
  /** The press came from a field where typing wins. */
  readonly textEntry: boolean;
  /** A drag reorder is in flight. */
  readonly dragging: boolean;
}

/**
 * What a key press means to the layers panel, or `null` when the panel has
 * nothing to do with it.
 *
 * `null` means two different things, and the caller treats them the same way:
 * the key is not the panel's, or the panel must not have it. Either way the
 * event is left alone.
 */
export function layerPanelAction(press: LayerPanelKeyPress): LayerPanelAction | null {
  if (press.textEntry) {
    // A field owns its own keys.
    return null;
  }
  switch (press.key) {
    case "ArrowUp":
    case "ArrowDown": {
      const up = press.key === "ArrowUp";
      if (press.mod) {
        // The layer moves in the stack: up is towards the top of the stack,
        // which is a positive delta in the document's bottom-first order.
        return { kind: "move", delta: up ? 1 : -1 };
      }
      // The focus moves in the panel's own list: up is the row above.
      return { kind: "focus", offset: up ? -1 : 1 };
    }
    case "Home":
      return { kind: "focusEdge", edge: "first" };
    case "End":
      return { kind: "focusEdge", edge: "last" };
    case "F2":
      return { kind: "rename" };
    case "Delete":
    case "Backspace":
      return { kind: "delete" };
    case "Escape":
      // Escape only means something to the panel while a drag is in flight;
      // otherwise it is the global "clear the selection".
      return press.dragging ? { kind: "cancelDrag" } : null;
    default:
      return null;
  }
}
