/**
 * The layers panel's reordering arithmetic.
 *
 * The document stores the stack **bottom-first** (index 0 is the bottom-most
 * layer); the panel shows it **top-first**, because that is the order the
 * canvas composites in and the order an artist reads a stack in. A drag has to
 * say where a layer lands, and the answer is a *slot*: the position the layer
 * will occupy in the list the panel shows.
 *
 * Two coordinate systems are in play, and mixing them up is the whole bug
 * this module exists to prevent:
 *
 *  - the **full list** is every layer, top-first, in the order the panel
 *    renders them. The dragged row is still in it.
 *  - the **reduced list** is the same list *without* the dragged row. A slot
 *    is counted in this list, because the dragged row is not in its own drop
 *    position.
 *
 * The engine's reorder command is a *delta* over the document's bottom-first
 * stack, so the panel's answer is turned into one: {@link moveDeltaForSlot}.
 * The delta is exact - `moveLayer` clamps to the stack, so a delta that names
 * a slot outside the stack simply lands on the nearest end.
 *
 * Pure on purpose: the React layer has no automated tests, so the arithmetic
 * that decides where a layer ends up lives here, where it can be tested.
 */

import type { Layer } from "./types";

/**
 * The stack as the panel shows it: the top of the stack first.
 *
 * A copy, so the panel can reverse the stack without touching the document's
 * own array.
 */
export function topFirstLayers(layers: readonly Layer[]): Layer[] {
  return [...layers].reverse();
}

/**
 * True when a pointer at `pointerY` sits in the **top half** of a row, so a
 * drop there means "above this row".
 *
 * The midpoint rule is what makes a drop land where the user aimed: the upper
 * half of a row inserts above it, the lower half inserts below it. A pointer
 * exactly on the midpoint counts as below, so a row's own lower half is the
 * natural place to drop a layer that is already there.
 */
export function isAboveRowMidpoint(pointerY: number, rowTop: number, rowHeight: number): boolean {
  return pointerY - rowTop < rowHeight / 2;
}

/**
 * The slot a drop lands in, counted in the list **without** the dragged row.
 *
 * @param rowIndex     the row the pointer is over, in the full top-first list
 * @param above        the pointer is in the row's top half, so the drop goes
 *                     above it
 * @param draggedIndex the dragged row's own index in the full top-first list
 */
export function dropSlot(rowIndex: number, above: boolean, draggedIndex: number): number {
  // The slot in the full list: above the row, or below it.
  const fullSlot = above ? rowIndex : rowIndex + 1;
  // The dragged row is not in the reduced list, so every slot behind it moves
  // one place down.
  return fullSlot > draggedIndex ? fullSlot - 1 : fullSlot;
}

/**
 * The stack move that lands the dragged row in `slot`.
 *
 * The panel's list is top-first and the document's is bottom-first, and the
 * two are mirror images, so a slot and the drag's own row cancel out: the
 * delta is simply how far the row has to travel, counted upwards in the
 * document's own order.
 */
export function moveDeltaForSlot(draggedIndex: number, slot: number): number {
  return draggedIndex - slot;
}

/**
 * The index in the **full** top-first list where the insertion marker belongs.
 *
 * The marker is drawn in the list the user sees, but the slot is counted in
 * the reduced list, so the marker has to step back over the dragged row when
 * the drop is below it.
 *
 * The marker answers one question: *where does the dragged row land?* It
 * lands at full-list position `slot` - that is what `moveDeltaForSlot` moves
 * it to - so the marker is the gap just above that position. When the slot is
 * behind the dragged row the gap is the one the slot already names; when the
 * slot is past it, the dragged row is still in the list and takes one place,
 * so the marker steps over it.
 *
 * A slot *equal* to the dragged row's own index is the drop that changes
 * nothing: the row stays where it is, so the marker belongs to the gap above
 * it. Marking the gap below it would promise a move that never happens.
 */
export function markerIndex(draggedIndex: number, slot: number): number {
  return slot <= draggedIndex ? slot : slot + 1;
}

/**
 * The row the keyboard moves to, or `null` when the list has no such row.
 *
 * The list does **not** wrap: walking off the top or the bottom leaves the
 * focus where it is, because a list that silently jumps to the other end is
 * a list an artist loses their place in.
 *
 * @param delta how many rows to move: `-1` for up, `1` for down
 */
export function nextRowIndex(current: number, delta: number, count: number): number | null {
  const next = current + delta;
  if (next < 0 || next >= count) {
    return null;
  }
  return next;
}
