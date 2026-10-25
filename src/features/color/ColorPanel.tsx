/**
 * The colour dock: the panel the shell's side column shows.
 *
 * The dock holds everything about the colour the next stroke is painted with:
 * the two colours and their exact values at the top, the HSV wheel, the
 * editable palette, the colours that were picked recently, and the contrast
 * readout that says whether the ink reads on the paper.
 *
 * The two colours are **ink** and **alt**: a left-button gesture paints with
 * the ink and a right-button gesture paints with the alt colour. A gesture
 * resolves which of the two it uses once, at press time, so changing a colour
 * here never repaints anything already drawn.
 *
 * The dock used to be hard-wired into the shell's layout, so adding a panel
 * meant editing the shell's composition. Now it **registers itself**: the
 * module below hands the shell a definition - its id, its title, the slot it
 * docks in, its order, its glyph, whether it stays mounted while it is
 * hidden, whether it can be folded and one line about what it is for - and the
 * shell renders whatever the registry says. The facts live in
 * `colorPanelRegistration.ts`; where the user has put the dock lives in
 * `colorPanelState.ts`.
 *
 * The dock is a panel of its own rather than another toolbar group, because
 * the wheel needs room and the toolbar is already a wrapping row of sliders.
 *
 * Nothing in here is an edit. The colour the dock shows is the colour the
 * *next* gesture paints with: choosing one adds no history step, dirties
 * nothing and never reaches a project file.
 */

import { Panel } from "../../components/panels/Panel";
import { ColorDock } from "./ColorDock";
import { ColorWheel } from "./ColorWheel";
import { ContrastReadout } from "./ContrastReadout";
import { PalettePanel } from "./PalettePanel";
import { RecentColors } from "./RecentColors";
import { COLOR_PANEL_TITLE, registerColorPanel } from "./colorPanelRegistration";
import "./color.css";

/**
 * The dock's body.
 *
 * The chrome around it - the heading, the fold button, the hidden state - is
 * the shell's, so the body is only the controls themselves.
 */
export function ColorPanelBody() {
  return (
    <div className="color-panel">
      <ColorWheel />
      <ColorDock />
      <PalettePanel />
      <RecentColors />
      <ContrastReadout />
    </div>
  );
}

/**
 * The colour panel.
 *
 * The panel the shell's stack draws: the dock's body inside the generic panel
 * chrome, which is where the heading and the fold button come from.
 */
export function ColorPanel() {
  return (
    <Panel title={COLOR_PANEL_TITLE}>
      <ColorPanelBody />
    </Panel>
  );
}

/*
 * The dock registers itself when its module is evaluated, so the shell only
 * has to import the panel to find it in the registry. Registering the same id
 * twice replaces the earlier definition rather than adding a second panel, so
 * an import that happens twice cannot show the dock twice.
 */
registerColorPanel(() => <ColorPanel />);
