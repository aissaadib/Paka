/**
 * Colour panel: the HSV wheel, its sliders and the contrast readout.
 *
 * A panel of its own rather than another toolbar group, because the wheel
 * needs room and the toolbar is already a wrapping row of sliders.
 */

import { Panel } from "../../components/panels/Panel";
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
