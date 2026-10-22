/**
 * The glyphs the registered panels are drawn with.
 *
 * The registry names an icon so it can stay free of React; this map is where
 * the name becomes a glyph. A name without an entry here would draw nothing,
 * so an unknown name falls back to a neutral panel glyph.
 */

import type { ComponentType, SVGProps } from "react";
import {
  IconBrush,
  IconImage,
  IconLayers,
  IconNavigator,
  IconPanel,
  IconPalette,
} from "../icons";

export const PANEL_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  palette: IconPalette,
  brush: IconBrush,
  image: IconImage,
  layers: IconLayers,
  navigator: IconNavigator,
};

/** The glyph a panel is drawn with, or a neutral one for an unknown name. */
export function panelIcon(
  name: string | undefined,
): ComponentType<SVGProps<SVGSVGElement>> {
  if (name === undefined) {
    return IconPanel;
  }
  return PANEL_ICONS[name] ?? IconPanel;
}
