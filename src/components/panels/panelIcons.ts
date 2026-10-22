/**
 * The glyphs the catalogued panels are drawn with.
 *
 * The catalogue names an icon so it can stay free of React; this map is where
 * the name becomes a glyph. A name without an entry here would draw nothing,
 * so the map covers every catalogued name.
 *
 * The brush glyph is the one the shared icon set already has; the other three
 * are drawn in the same house style in `panelGlyphs.tsx`, so the panel
 * manager does not depend on the icon set growing a glyph for every panel.
 */

import type { ComponentType, SVGProps } from "react";
import { IconBrush } from "../icons";
import type { PanelIconName } from "../../core/panels/panelRegistry";
import {
  PanelLayersIcon,
  PanelNavigatorIcon,
  PanelPaletteIcon,
} from "./panelGlyphs";

/** The glyph each catalogued icon name is drawn with. */
export const PANEL_ICONS: Record<PanelIconName, ComponentType<SVGProps<SVGSVGElement>>> = {
  palette: PanelPaletteIcon,
  brush: IconBrush,
  layers: PanelLayersIcon,
  navigator: PanelNavigatorIcon,
};
