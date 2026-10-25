/**
 * The side panel stack.
 *
 * The stack is the shell's right-hand column: the panels the shell's mount
 * registry holds for the side slot, in registry order, each one either shown,
 * folded to its header or hidden. It is the only place a panel is mounted, so
 * a panel is never duplicated and its state has one home.
 *
 * Four rules shape the behaviour:
 *
 *  1. **The stack renders a list, not a set of components.** Which panels
 *     exist, what they are called and how they behave come from the panel
 *     catalogue; where they are mounted and what they draw come from the
 *     shell's mount registry. Adding a panel to the column is a change to
 *     those two lists, not to the shell's composition.
 *  2. **Hiding a panel reclaims the space at once.** A hidden panel takes no
 *     space, so the column shrinks and the canvas gets the pixels back
 *     without the user resizing anything.
 *  3. **Hiding a panel does not lose its state.** A panel that keeps React
 *     state of its own stays mounted while it is hidden; a panel that is
 *     derived from the document is unmounted, because it has nothing to
 *     lose. The catalogue decides which is which.
 *  4. **Folding a panel keeps it mounted.** A folded panel shows its header
 *     only, so the content is still there when it is unfolded.
 */

import type { ComponentType } from "react";
import {
  isPanelCollapsed,
  isPanelVisible,
  shouldMountPanel,
  type PanelLayoutState,
} from "../../core/panels/panelLayout";
import {
  findPanelDefinition,
  PANEL_SIDE_SLOT,
  registerCataloguePanel,
  sidePanelDefinitions,
  type PanelId,
} from "../../core/panels/panelRegistry";
import { findPanel, panelsInSlot } from "../../core/shell/panelRegistry";
import { ColorPanel } from "../../features/color/ColorPanel";
import { LayersPanel } from "../../features/layers/LayersPanel";
import { usePanelActions, usePanelState } from "../../hooks/usePanels";
import { PanelChromeContext, type PanelChromeState } from "./panelChrome";
import "./panel.css";

/**
 * The body of each panel the shell owns.
 *
 * The catalogue says which panels exist; the shell's mount registry says what
 * they draw. This map is where the bodies the shell already owns are handed
 * to the registry, and it is the only place the stack names a component: a
 * panel that registers itself is mounted without being named here.
 */
const PANEL_BODIES: Partial<Record<PanelId, ComponentType>> = {
  color: ColorPanel,
  layers: LayersPanel,
};

/**
 * Registers the bodies with the shell's mount registry.
 *
 * A panel that has already registered itself keeps its own registration: the
 * first registration wins, so a builder who registers a panel deliberately is
 * not overruled by the fallback here.
 */
function registerPanelBodies(): void {
  for (const definition of sidePanelDefinitions()) {
    const Body = PANEL_BODIES[definition.id];
    if (!Body) {
      continue;
    }
    if (findPanel(definition.id)) {
      continue;
    }
    registerCataloguePanel(definition, () => <Body />);
  }
}

// The panels register themselves when their module is evaluated, which is
// the contract the shell's mount registry is built on.
registerPanelBodies();

interface PanelSlotProps {
  /** The id the mount registry knows the panel by. */
  readonly panelId: string;
  readonly layout: PanelLayoutState;
}

function PanelSlot({ panelId, layout }: PanelSlotProps) {
  const actions = usePanelActions();
  const definition = findPanelDefinition(panelId as PanelId);
  const registered = findPanel(panelId);

  if (!definition || !registered) {
    // A panel the catalogue does not know is not part of the panel manager:
    // it has no id in the layout and cannot be shown, folded or hidden.
    return null;
  }

  const visible = isPanelVisible(layout, definition.id);
  const collapsed = isPanelCollapsed(layout, definition.id);

  if (!shouldMountPanel(definition, layout)) {
    return null;
  }

  const chrome: PanelChromeState = {
    hidden: !visible,
    collapsed,
    collapsible: definition.collapsible,
    grow: definition.grow,
    onToggleCollapsed: () => {
      actions.setPanelCollapsed(definition.id, !collapsed);
    },
  };

  const className = [
    "panel-slot",
    visible ? "" : "panel-slot--hidden",
    collapsed ? "panel-slot--collapsed" : "",
    definition.grow ? "panel-slot--grow" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} data-panel-id={definition.id}>
      <PanelChromeContext.Provider value={chrome}>
        {registered.render()}
      </PanelChromeContext.Provider>
    </div>
  );
}

export function PanelStack() {
  const layout = usePanelState();
  const panels = panelsInSlot(PANEL_SIDE_SLOT);

  return (
    <div className="side-panels panel-stack" role="complementary" aria-label="Panels">
      {panels.map((panel) => (
        <PanelSlot key={panel.id} panelId={panel.id} layout={layout} />
      ))}
    </div>
  );
}
