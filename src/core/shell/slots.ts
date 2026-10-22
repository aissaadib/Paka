/**
 * Shell slots: the named regions of the application shell where a panel can
 * live.
 *
 * The shell is the frame around the canvas: the menu bar, the tool rail, the
 * canvas, the side column and the status bar. A *slot* is one of the places a
 * panel may be docked. The set of slots is closed, so a typo in a saved
 * layout is a value this module rejects rather than a region that silently
 * never renders.
 *
 * The layout is pure data. It is not a React tree, not a DOM measurement and
 * not a drawing, so it can be normalized, compared and stored without a
 * browser. The React shell reads it; it never writes to it directly.
 */

/** Where a panel may be docked. */
export type ShellSlotId = "left" | "right" | "bottom" | "floating" | "hidden";

/** Every slot, in the order the shell lays them out. */
export const SHELL_SLOT_IDS: readonly ShellSlotId[] = Object.freeze([
  "left",
  "right",
  "bottom",
  "floating",
  "hidden",
]);

/** Whether an untrusted value names a slot. */
export function isShellSlotId(value: unknown): value is ShellSlotId {
  return (
    typeof value === "string" && (SHELL_SLOT_IDS as readonly string[]).includes(value)
  );
}

/** Where one panel sits and where it sits in that slot's order. */
export interface PanelPlacement {
  /** The panel's registry id. */
  readonly panelId: string;
  /** The slot the panel is docked in. */
  readonly slot: ShellSlotId;
  /** Position within the slot; lower numbers come first. */
  readonly order: number;
}

/** The whole layout: where every known panel lives. */
export interface ShellLayout {
  readonly placements: readonly PanelPlacement[];
}

/** The layout an installation starts from: nothing is placed yet. */
export const DEFAULT_SHELL_LAYOUT: ShellLayout = Object.freeze({ placements: [] });

/** The placements docked in one slot, in order. */
export function placementsInSlot(
  layout: ShellLayout,
  slot: ShellSlotId,
): readonly PanelPlacement[] {
  return layout.placements
    .filter((placement) => placement.slot === slot)
    .sort(byOrderThenId);
}

function byOrderThenId(a: PanelPlacement, b: PanelPlacement): number {
  if (a.order !== b.order) {
    return a.order - b.order;
  }
  return a.panelId < b.panelId ? -1 : a.panelId > b.panelId ? 1 : 0;
}

/** Where one panel sits, or `undefined` when the layout does not place it. */
export function findPlacement(
  layout: ShellLayout,
  panelId: string,
): PanelPlacement | undefined {
  return layout.placements.find((placement) => placement.panelId === panelId);
}

/**
 * Places a panel in a slot.
 *
 * Placing a panel that is already placed moves it: the old placement is
 * dropped, so a panel is in exactly one slot at a time. `order` defaults to
 * the end of the slot.
 */
export function placePanel(
  layout: ShellLayout,
  panelId: string,
  slot: ShellSlotId,
  order?: number,
): ShellLayout {
  if (panelId.trim() === "") {
    return layout;
  }
  const others = layout.placements.filter((placement) => placement.panelId !== panelId);
  const resolvedOrder = order ?? nextOrderInSlot(others, slot);
  const placement: PanelPlacement = { panelId, slot, order: resolvedOrder };
  return { placements: [...others, placement] };
}

/** Moves a panel to a slot at a given position. */
export function movePanel(
  layout: ShellLayout,
  panelId: string,
  slot: ShellSlotId,
  order: number,
): ShellLayout {
  return placePanel(layout, panelId, slot, order);
}

/** Hides a panel without forgetting which slot it came from. */
export function hidePanel(layout: ShellLayout, panelId: string): ShellLayout {
  return placePanel(layout, panelId, "hidden");
}

/** Shows a hidden panel again, back in the slot it was last docked in. */
export function showPanel(
  layout: ShellLayout,
  panelId: string,
  slot: ShellSlotId = "right",
  order?: number,
): ShellLayout {
  return placePanel(layout, panelId, slot, order);
}

/** The order a panel added to a slot would take. */
export function nextOrderInSlot(
  placements: readonly PanelPlacement[],
  slot: ShellSlotId,
): number {
  const inSlot = placements.filter((placement) => placement.slot === slot);
  if (inSlot.length === 0) {
    return 0;
  }
  return Math.max(...inSlot.map((placement) => placement.order)) + 1;
}

/**
 * Reads a layout out of an untrusted value.
 *
 * Unknown slots, blank ids and non-numeric orders are dropped rather than
 * repaired: a layout that names a slot this build does not have must not
 * crash the shell, and it must not invent a place to put the panel either.
 */
export function normalizeShellLayout(value: unknown): ShellLayout {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_SHELL_LAYOUT;
  }
  const record = value as { placements?: unknown };
  if (!Array.isArray(record.placements)) {
    return DEFAULT_SHELL_LAYOUT;
  }
  const seen = new Set<string>();
  const placements: PanelPlacement[] = [];
  for (const raw of record.placements) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      continue;
    }
    const entry = raw as { panelId?: unknown; slot?: unknown; order?: unknown };
    if (typeof entry.panelId !== "string" || entry.panelId.trim() === "") {
      continue;
    }
    if (!isShellSlotId(entry.slot)) {
      continue;
    }
    if (seen.has(entry.panelId)) {
      continue;
    }
    seen.add(entry.panelId);
    const order =
      typeof entry.order === "number" && Number.isFinite(entry.order)
        ? entry.order
        : placements.length;
    placements.push({ panelId: entry.panelId, slot: entry.slot, order });
  }
  return { placements };
}

/** Whether two layouts place every panel in the same slot at the same order. */
export function shellLayoutEqual(a: ShellLayout, b: ShellLayout): boolean {
  const left = [...a.placements].sort(byOrderThenId);
  const right = [...b.placements].sort(byOrderThenId);
  if (left.length !== right.length) {
    return false;
  }
  return left.every((placement, index) => {
    const other = right[index];
    return (
      placement.panelId === other.panelId &&
      placement.slot === other.slot &&
      placement.order === other.order
    );
  });
}
