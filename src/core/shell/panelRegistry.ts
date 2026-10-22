/**
 * Panel registry: the list of panels the application shell can show.
 *
 * A panel used to be hard-wired into the shell's layout, so adding one meant
 * editing the shell's composition. The registry makes the shell the *reader*
 * of a list instead of its owner: a panel registers itself and the shell
 * renders whatever the registry says.
 *
 * The registry holds metadata and a render callback. It is deliberately a
 * module-level list rather than a React context: the shell is the only
 * consumer, and a plain list can be inspected and asserted on without a
 * browser, which is what the project's own rule about the React layer
 * requires.
 */

import type { ReactNode } from "react";
import { isShellSlotId, type ShellSlotId } from "./slots";

/** One panel the shell may show. */
export interface PanelDefinition {
  /** Stable id, unique across the registry. */
  readonly id: string;
  /** The heading the panel shows. */
  readonly title: string;
  /** Where the panel is docked by default. */
  readonly slot: ShellSlotId;
  /** Position within the slot; lower numbers come first. */
  readonly order: number;
  /** The panel's body. */
  readonly render: () => ReactNode;
  /**
   * The icon name the panel is drawn with.
   *
   * A name, not a component: the registry stays free of React so the shell
   * can map the name to a glyph.
   */
  readonly icon?: string;
  /**
   * Whether the panel stays mounted while it is hidden.
   *
   * `"always"` keeps a panel that holds React state of its own from losing
   * it; `"when-visible"` is for a panel derived from the document, which has
   * no state to lose.
   */
  readonly mounting?: "always" | "when-visible";
  /** Whether the panel can be folded down to its header. */
  readonly collapsible?: boolean;
  /** Whether the panel takes the column's leftover height. */
  readonly grow?: boolean;
  /** One line on what the panel is for. */
  readonly description?: string;
}

const panels = new Map<string, PanelDefinition>();

/**
 * Adds a panel, or replaces the one already registered under the same id.
 *
 * Registering the same id twice is a replacement, not a duplicate: a panel
 * that is re-registered (because its module was evaluated again) must not
 * appear twice in the shell.
 */
export function registerPanel(definition: PanelDefinition): PanelDefinition {
  if (definition.id.trim() === "") {
    throw new Error("a panel needs a non-empty id");
  }
  if (!isShellSlotId(definition.slot)) {
    throw new Error(`panel "${definition.id}" names an unknown slot`);
  }
  panels.set(definition.id, definition);
  return definition;
}

/** Removes a panel. Returns whether one was there. */
export function unregisterPanel(id: string): boolean {
  return panels.delete(id);
}

/** Every registered panel, ordered by slot order and then by panel order. */
export function listPanels(): readonly PanelDefinition[] {
  return [...panels.values()].sort((a, b) => {
    if (a.slot !== b.slot) {
      return a.slot < b.slot ? -1 : 1;
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** One panel by id, or `undefined`. */
export function findPanel(id: string): PanelDefinition | undefined {
  return panels.get(id);
}

/** The panels docked in one slot, in order. */
export function panelsInSlot(slot: ShellSlotId): readonly PanelDefinition[] {
  return listPanels().filter((panel) => panel.slot === slot);
}

/** How many panels are registered. */
export function panelCount(): number {
  return panels.size;
}

/**
 * Empties the registry.
 *
 * Only for tests: the shell's panels register themselves when their module is
 * evaluated, and nothing in the running app should empty the list.
 */
export function resetPanelRegistry(): void {
  panels.clear();
}
