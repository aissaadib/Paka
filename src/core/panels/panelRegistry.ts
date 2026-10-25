/**
 * The panel catalogue: the panels the shell can show, and what the shell needs
 * to know about each of them.
 *
 * The catalogue is **data, not React**. It names the panels, fixes their ids
 * and their order, and says how each one behaves; the shell owns the pixels.
 * That split is what lets the whole thing be tested in Node: the rules about
 * which panel is visible, whether it is mounted and what the layout file may
 * contain live in plain modules, and the components only draw what those
 * modules decide.
 *
 * Three rules shape it:
 *
 *  1. **An id is stable.** Ids are written into the settings file, so they
 *     must not change when a panel is renamed or moved. A renamed panel keeps
 *     its id; a removed panel leaves its id behind in old settings files, and
 *     the reader drops the ids it does not know.
 *  2. **Only panels that exist are catalogued.** A panel that has not been
 *     built is not in the catalogue, so it cannot be shown, toggled, or
 *     offered in the menu. The catalogue is the list of things the shell can
 *     really mount - an entry for a panel that does not exist would be a
 *     button that opens nothing.
 *  3. **A panel is mounted, never duplicated.** One catalogued panel is one
 *     component in one place; hiding it changes what is on screen, not how
 *     many copies of it exist.
 *
 * ## How this relates to the shell's mount registry
 *
 * There are two registries, and they answer two different questions.
 *
 * - `src/core/shell/panelRegistry.ts` is the **mount registry**: the shared
 *   contract by which a panel says "mount me, here, in this order", with a
 *   render callback. It answers *where a panel goes* and *what it draws*.
 * - This module is the **catalogue**: the closed, typed list of the panels
 *   that exist, with the metadata the shell and the settings file need. It
 *   answers *what a panel is*.
 *
 * The catalogue is the **adapter** between the two: `toShellPanelDefinition`
 * and `registerCataloguePanel` map a catalogue entry onto the mount
 * registry's contract, carrying the catalogue's own slot and order across so
 * the two lists cannot drift apart. The shell reads the **mount registry** to
 * lay out its frame; the panel manager reads the **catalogue** to know which
 * panels exist, what they are called and how they behave. The two are joined
 * by the panel id, which is the same stable id the settings file stores.
 */

import type { ReactNode } from "react";
import {
  registerPanel as registerShellPanel,
  type PanelDefinition as ShellPanelDefinition,
} from "../shell/panelRegistry";
import type { ShellSlotId } from "../shell/slots";

/** The panels the shell can show. */
export type PanelId = "color" | "brushes" | "layers" | "references" | "navigator";

/**
 * The icon a panel is drawn with.
 *
 * A name rather than a component: the catalogue must stay free of React, so
 * the shell maps the name to a glyph.
 */
export type PanelIconName = "palette" | "brush" | "layers" | "image" | "navigator";

/**
 * When a panel is mounted.
 *
 * - `always`: the panel stays mounted while it is hidden, so a panel that
 *   keeps React state of its own cannot lose it.
 * - `when-visible`: the panel is mounted only while it is visible. Use it
 *   for a panel that is derived from the document, which has no state of its
 *   own to lose and no reason to keep rendering while it is out of sight.
 */
export type PanelMounting = "always" | "when-visible";

/** One panel the shell can show. */
export interface PanelDefinition {
  /** The stable id. It is written to the settings file. */
  readonly id: PanelId;
  /** The name shown in the menu and in the panel's header. */
  readonly label: string;
  /** The icon the panel is drawn with. */
  readonly icon: PanelIconName;
  /** The shell slot the panel is docked in. */
  readonly slot: ShellSlotId;
  /** The panel's place in the stack, lowest first. */
  readonly order: number;
  /** Whether the panel is shown in a fresh layout. */
  readonly defaultVisible: boolean;
  /** Whether the panel can be folded to its header. */
  readonly collapsible: boolean;
  /** Whether the panel takes the leftover height of the column. */
  readonly grow: boolean;
  /** Whether the panel stays mounted while it is hidden. */
  readonly mounting: PanelMounting;
  /** One line on what the panel is for; the menu shows it as a tooltip. */
  readonly description: string;
}

/**
 * The slot the panel manager's column is docked in.
 *
 * The side column is the shell's right-hand stack. A panel that is not in it
 * is not part of the panel manager's column, and is not mounted by it.
 */
export const PANEL_SIDE_SLOT: ShellSlotId = "right";

const PANEL_DEFINITIONS: readonly PanelDefinition[] = [
  {
    id: "color",
    label: "Color",
    icon: "palette",
    slot: PANEL_SIDE_SLOT,
    order: 0,
    defaultVisible: true,
    collapsible: true,
    grow: false,
    // The wheel keeps the hue and saturation the user asked for in React
    // state, so the panel stays mounted while it is hidden and cannot lose it.
    mounting: "always",
    description: "The colour wheel, its sliders and the contrast readout.",
  },
  {
    id: "brushes",
    label: "Brushes",
    icon: "brush",
    slot: PANEL_SIDE_SLOT,
    order: 5,
    defaultVisible: true,
    collapsible: true,
    grow: false,
    // The browser keeps the search text and the selection in React state, so
    // the panel stays mounted while it is hidden and cannot lose them.
    mounting: "always",
    description: "The brush library: search it, apply a brush, and manage the saved ones.",
  },
  {
    id: "layers",
    label: "Layers",
    icon: "layers",
    slot: PANEL_SIDE_SLOT,
    order: 10,
    defaultVisible: true,
    collapsible: true,
    grow: true,
    // Everything the panel shows comes from the document, so there is no
    // state to lose by unmounting it.
    mounting: "when-visible",
    description: "The layer list, its blend mode and its opacity.",
  },
  {
    id: "references",
    label: "References",
    icon: "image",
    slot: PANEL_SIDE_SLOT,
    order: 15,
    defaultVisible: true,
    collapsible: true,
    grow: false,
    // The panel holds the file input and the last import's message; keeping it
    // mounted means hiding the panel cannot lose a refusal the user still
    // needs to read.
    mounting: "always",
    description: "Import reference images and manage the ones on the canvas.",
  },
  {
    id: "navigator",
    label: "Navigator",
    icon: "navigator",
    slot: PANEL_SIDE_SLOT,
    order: 20,
    defaultVisible: true,
    collapsible: true,
    grow: false,
    // The overview is drawn from the engine's cached composite and the panel
    // holds no state of its own, so unmounting it costs nothing.
    mounting: "when-visible",
    description: "An overview of the document, with the visible area marked.",
  },
];

/** Every catalogued panel, in stack order (lowest first). */
export function panelDefinitions(): readonly PanelDefinition[] {
  return [...PANEL_DEFINITIONS].sort((a, b) => a.order - b.order);
}

/**
 * The panels docked in the side column, in stack order.
 *
 * The panel manager owns one column. A panel docked in another slot belongs
 * to the shell's frame, not to this stack, so it is not mounted here.
 */
export function sidePanelDefinitions(): readonly PanelDefinition[] {
  return panelDefinitions().filter((definition) => definition.slot === PANEL_SIDE_SLOT);
}

/** The definition of one panel, or `undefined` when the id is not catalogued. */
export function findPanelDefinition(id: PanelId): PanelDefinition | undefined {
  return PANEL_DEFINITIONS.find((definition) => definition.id === id);
}

/** Whether a value is the id of a catalogued panel. */
export function isPanelId(value: unknown): value is PanelId {
  return (
    typeof value === "string" && PANEL_DEFINITIONS.some((definition) => definition.id === value)
  );
}

/** The ids the shell knows, in stack order. */
export function knownPanelIds(): PanelId[] {
  return panelDefinitions().map((definition) => definition.id);
}

/** The panels a fresh layout shows, in stack order. */
export function defaultVisiblePanelIds(): PanelId[] {
  return panelDefinitions()
    .filter((definition) => definition.defaultVisible)
    .map((definition) => definition.id);
}

/**
 * Maps a catalogue entry onto the shell's mount-registry contract.
 *
 * The mapping is the whole point of the adapter: the catalogue's slot and
 * order are carried across, so the shell's list and the panel manager's list
 * cannot say two different things about where a panel goes. The label
 * becomes the registry's title, and the behaviour flags are carried as they
 * are - the mount registry already speaks the same vocabulary.
 */
export function toShellPanelDefinition(
  definition: PanelDefinition,
  render: () => ReactNode,
): ShellPanelDefinition {
  return {
    id: definition.id,
    title: definition.label,
    slot: definition.slot,
    order: definition.order,
    render,
    icon: definition.icon,
    mounting: definition.mounting,
    collapsible: definition.collapsible,
    grow: definition.grow,
    description: definition.description,
  };
}

/**
 * Registers a catalogue entry in the shell's mount registry.
 *
 * This is how a panel's body reaches the shell: the catalogue says what the
 * panel is, the mount registry says where it is mounted and what it draws.
 * Registering the same id twice replaces the earlier entry rather than
 * duplicating the panel, so a remount is harmless.
 */
export function registerCataloguePanel(
  definition: PanelDefinition,
  render: () => ReactNode,
): ShellPanelDefinition {
  const shellDefinition = toShellPanelDefinition(definition, render);
  return registerShellPanel(shellDefinition);
}
