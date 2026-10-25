/**
 * The colour dock's registration in the shell's panel registry.
 *
 * The colour panel used to be hard-wired into the shell: the shell imported it
 * and put it in the side column by hand, so a panel could only be added by
 * editing the shell's composition. The registry makes the shell the *reader* of
 * a list instead of its owner - a panel registers itself and the shell renders
 * whatever the registry says.
 *
 * This module is the dock's one statement about itself to the shell: its id,
 * the heading it shows, the slot it docks in, its place in that slot, the name
 * of the glyph it is drawn with, whether it stays mounted while it is hidden,
 * whether it can be folded down to its header, and one line on what it is for.
 * A second list of those facts anywhere else would be a second truth.
 *
 * None of it is document state. Where the dock sits, whether it is folded and
 * whether it is shown are the shell's business: they add no history step, dirty
 * nothing and never reach a project file. The colour the dock *paints* with is
 * editor state for the same reason - it describes the next gesture, not the
 * drawing.
 */

import type { ReactNode } from "react";
import { registerPanel } from "../../core/shell/panelRegistry";
import type { PanelDefinition } from "../../core/shell/panelRegistry";
import type { ShellSlotId } from "../../core/shell/slots";

/**
 * The dock's id.
 *
 * Stable, because it is written to the settings file: a renamed panel keeps
 * its id, and a removed panel leaves its id behind in old files, where the
 * reader drops it.
 *
 * One id, one spelling: the shell, the panel manager's catalogue and the
 * dock itself all name the same panel the same way. Two ids for one panel
 * would put two docks in the side column.
 */
export const COLOR_PANEL_ID = "color";

/** The heading the dock shows. */
export const COLOR_PANEL_TITLE = "Color";

/**
 * The slot the dock docks in: the shell's side column.
 *
 * The dock was the top panel of that column before the registry existed, so
 * this is where it keeps living.
 */
export const COLOR_PANEL_SLOT: ShellSlotId = "right";

/** The dock's place in its slot. */
export const COLOR_PANEL_ORDER = 0;

/**
 * The name of the glyph the dock is drawn with.
 *
 * A name, not a component: the registry stays free of React, and the shell
 * maps the name to a glyph.
 */
export const COLOR_PANEL_ICON = "palette";

/**
 * The dock stays mounted while it is hidden.
 *
 * The wheel and the contrast readout hold React state of their own - the hue
 * the user asked for and the colour they compare the ink against - so
 * unmounting the dock would lose what they were holding.
 */
export const COLOR_PANEL_MOUNTING = "always";

/**
 * The dock can be folded down to its header.
 *
 * The wheel is tall, and a user who is painting rather than choosing a colour
 * wants the pixels back. Folding keeps the dock mounted, so the state it holds
 * survives the fold.
 */
export const COLOR_PANEL_COLLAPSIBLE = true;

/**
 * The dock does not take the column's leftover height.
 *
 * It is as tall as the wheel is wide; the panel that grows is the one that
 * lists the document's layers.
 */
export const COLOR_PANEL_GROW = false;

/** One line on what the dock is for. */
export const COLOR_PANEL_DESCRIPTION =
  "The colour the next stroke is painted with: the wheel, the hex field, the palette and the contrast readout.";

/**
 * The dock's definition, with the body the shell draws.
 *
 * The definition is built rather than written out, so a caller that wants a
 * definition without registering it - a test, a tool that lists the panels -
 * gets exactly the same facts.
 */
export function createColorPanelDefinition(render: () => ReactNode): PanelDefinition {
  return {
    id: COLOR_PANEL_ID,
    title: COLOR_PANEL_TITLE,
    slot: COLOR_PANEL_SLOT,
    order: COLOR_PANEL_ORDER,
    icon: COLOR_PANEL_ICON,
    mounting: COLOR_PANEL_MOUNTING,
    collapsible: COLOR_PANEL_COLLAPSIBLE,
    grow: COLOR_PANEL_GROW,
    description: COLOR_PANEL_DESCRIPTION,
    render,
  };
}

/**
 * Registers the dock in the shell's panel registry.
 *
 * Registering the same id twice replaces the earlier definition rather than
 * adding a second panel, so a module that is evaluated twice - a hot reload, a
 * test that imports it again - cannot show the dock twice.
 */
export function registerColorPanel(render: () => ReactNode): PanelDefinition {
  return registerPanel(createColorPanelDefinition(render));
}
