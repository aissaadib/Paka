/**
 * The glyphs the catalogued panels are drawn with.
 *
 * Hand-drawn in the same house style as the shared icon set - a 16 px
 * viewBox, a single stroke and `currentColor` - so the panel manager does
 * not depend on the icon set growing a glyph for every panel. The brush
 * glyph is the one the shared icon set already has.
 */

import type { SVGProps } from "react";

type PanelGlyphProps = SVGProps<SVGSVGElement>;

function PanelGlyph({ children, ...props }: PanelGlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A painter's palette with three colours on it. */
export function PanelPaletteIcon(props: PanelGlyphProps) {
  return (
    <PanelGlyph {...props}>
      <path d="M8 2.6c-3 0-5.4 2.3-5.4 5.1 0 2.8 2.4 5.2 5.4 5.2.8 0 1.3-.5 1.3-1.1 0-.3-.1-.5-.3-.7-.2-.2-.3-.4-.3-.7 0-.6.5-1.1 1.1-1.1h1.3c1.4 0 2.5-1.1 2.5-2.5 0-2.4-2.4-4.2-5.6-4.2Z" />
      <path d="M5.2 6.7h.01M7.6 5.3h.01M9.9 6.7h.01" />
    </PanelGlyph>
  );
}

/** Three sheets of paper, stacked. */
export function PanelLayersIcon(props: PanelGlyphProps) {
  return (
    <PanelGlyph {...props}>
      <path d="M8 2.6 14 5.5 8 8.4 2 5.5z" />
      <path d="M2.7 8 8 10.6 13.3 8" />
      <path d="M2.7 10.6 8 13.2l5.3-2.6" />
    </PanelGlyph>
  );
}

/** A frame with the visible area marked inside it. */
export function PanelNavigatorIcon(props: PanelGlyphProps) {
  return (
    <PanelGlyph {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.2" />
      <rect x="5" y="5.6" width="4.6" height="3.6" rx="0.6" />
    </PanelGlyph>
  );
}
