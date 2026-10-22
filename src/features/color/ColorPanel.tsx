/**
 * Colour panel: the HSV wheel, its sliders and the contrast readout.
 *
 * A panel of its own rather than another toolbar group, because the wheel
 * needs room and the toolbar is already a wrapping row of sliders.
 *
 * The panel registers itself with the shell's registry, so adding a panel to
 * the shell means editing the panel's own module and nothing else.
 */

import { Panel } from "../../components/panels/Panel";
import { registerPanel } from "../../core/shell/panelRegistry";
import { ColorWheel } from "./ColorWheel";
import { ContrastReadout } from "./ContrastReadout";
import "./color.css";

export function ColorPanel() {
  return (
    <Panel title="Colour">
      <ColorWheel />
      <ContrastReadout />
    </Panel>
  );
}

registerPanel({
  id: "color",
  title: "Colour",
  slot: "right",
  order: 0,
  icon: "palette",
  // The wheel keeps the hue and saturation the user asked for in React
  // state, so the panel stays mounted while it is hidden and cannot lose it.
  mounting: "always",
  collapsible: true,
  grow: false,
  description: "The colour wheel, its sliders and the contrast readout.",
  render: () => <ColorPanel />,
});
