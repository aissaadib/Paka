/**
 * The side panel stack.
 *
 * The stack is the shell's right-hand column: the panels that dock in the
 * side slot, in the registry's order, each one either shown, folded to its
 * header or hidden. It renders whatever the registry says - a panel is
 * mounted in one place only, so a panel is never duplicated and its state has
 * one home.
 *
 * Three rules shape the behaviour:
 *
 *  1. **Hiding a panel reclaims the space at once.** The column's width
 *     follows its content, so a hidden panel takes no width and a stack with
 *     no visible panel takes none at all - the canvas gets the pixels back
 *     without the user resizing anything.
 *  2. **Hiding a panel does not lose its state.** A panel that keeps React
 *     state of its own stays mounted while it is hidden; a panel that is
 *     derived from the document is unmounted, because it has nothing to
 *     lose. The registry says which is which.
 *  3. **Folding a panel keeps it mounted.** A folded panel shows its header
 *     only, so the content is still there when it is unfolded.
 */

// The panels register themselves when their module is evaluated, so the stack
// imports them for that side effect: it renders the registry, not a list.
import "../../features/brushes/BrushPresetPanel";
import "../../features/color/ColorPanel";
import "../../features/layers/LayersPanel";
import "../../features/navigator/NavigatorPanel";
import "../../features/reference/ReferencePanel";

import {
  isPanelCollapsed,
  isPanelVisible,
  shouldMountPanel,
  type PanelLayoutState,
} from "../../core/panels/panelLayout";
import { sidePanelDefinitions, type PanelDefinition } from "../../core/panels/panelRegistry";
import { usePanelActions, usePanelState } from "../../hooks/usePanels";
import { PanelChromeContext, type PanelChromeState } from "./panelChrome";

interface PanelSlotProps {
  readonly definition: PanelDefinition;
  readonly layout: PanelLayoutState;
}

function PanelSlot({ definition, layout }: PanelSlotProps) {
  const actions = usePanelActions();
  const visible = isPanelVisible(layout, definition.id);
  const collapsed = isPanelCollapsed(layout, definition.id);

  if (!shouldMountPanel(definition, layout)) {
    return null;
  }

  const chrome: PanelChromeState = {
    hidden: !visible,
    collapsed,
    collapsible: definition.collapsible === true,
    grow: definition.grow === true,
    onToggleCollapsed: () => {
      actions.setPanelCollapsed(definition.id, !collapsed);
    },
  };

  return (
    <PanelChromeContext.Provider value={chrome}>
      {definition.render()}
    </PanelChromeContext.Provider>
  );
}

export function PanelStack() {
  const layout = usePanelState();
  const definitions = sidePanelDefinitions();

  return (
    <div className="side-panels" role="complementary" aria-label="Panels">
      {definitions.map((definition) => (
        <PanelSlot key={definition.id} definition={definition} layout={layout} />
      ))}
    </div>
  );
}
