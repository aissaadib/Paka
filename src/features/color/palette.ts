/**
 * The app's fixed palette.
 *
 * It lives in its own module because two places read it: the toolbar's swatch
 * buttons and the colour panel's nearest-swatch readout. One list, so the
 * readout names the swatches the user can actually pick.
 *
 * The palette is a list of hex strings, not of parsed colours: the swatches
 * are written straight back into the brush, and the readout parses them
 * through the same path it parses the brush colour with.
 */

export const PALETTE: readonly string[] = [
  "#16181c",
  "#ffffff",
  "#e5484d",
  "#e8a33d",
  "#3fb950",
  "#3b82f6",
  "#8b5cf6",
  "#d946a0",
];
