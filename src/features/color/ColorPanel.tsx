/**
 * Colour panel: the colour dock, the HSV wheel, the recent colours, the
 * palette and the contrast readout.
 *
 * A panel of its own rather than another toolbar group, because the wheel
 * needs room and the toolbar is already a wrapping row of sliders.
 *
 * Everything here is a *view* of one colour - the brush's - and every colour
 * the artist picks goes back through the same setter, so the wheel, the
 * swatches, the text fields, the canvas picker and the recent list can never
 * disagree about what the next stroke will be painted with.
 */

import { Panel } from "../../components/panels/Panel";
import { ColorDock } from "./ColorDock";
import { ColorWheel } from "./ColorWheel";
import { ContrastReadout } from "./ContrastReadout";
import { PalettePanel } from "./PalettePanel";
import { RecentColors } from "./RecentColors";
import "./color.css";

export function ColorPanel() {
  return (
    <Panel title="Colour">
      <ColorDock />
      <ColorWheel />
      <RecentColors />
      <PalettePanel />
      <ContrastReadout />
    </Panel>
  );
}
