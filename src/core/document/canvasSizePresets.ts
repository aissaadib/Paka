/**
 * The canvas sizes the New Document dialog offers as one click.
 *
 * These are presets, not a second size policy: every entry stays inside the
 * document model's own limits (`isValidDocumentSize`). The list deliberately
 * reaches the largest square the raster budget allows, plus the widest shape
 * that still fits, so "bigger" is not a matter of guessing the width and
 * height by hand.
 *
 * The dimensions are document pixels. A print preset is the size of the paper
 * at 300 dpi, not a physical unit: the editor has no dpi concept and adding
 * one here would put a second meaning on the same two numbers.
 */

export interface CanvasSizePreset {
  /** Stable id for tests and analytics; never shown. */
  readonly id: string;
  /** The short name on the button. */
  readonly label: string;
  /** Document width in pixels. */
  readonly width: number;
  /** Document height in pixels. */
  readonly height: number;
}

/**
 * Ordered from the common screen sizes to the largest shapes the budget
 * allows. The final square is the document cap, not an arbitrary 4K label.
 */
export const CANVAS_SIZE_PRESETS: readonly CanvasSizePreset[] = [
  { id: "full-hd", label: "Full HD", width: 1920, height: 1080 },
  { id: "qhd", label: "QHD", width: 2560, height: 1440 },
  { id: "uhd-4k", label: "4K UHD", width: 3840, height: 2160 },
  { id: "a4-300", label: "A4 300 dpi", width: 2480, height: 3508 },
  { id: "panorama", label: "Panorama", width: 8192, height: 2048 },
  { id: "square-max", label: "Square max", width: 4096, height: 4096 },
];

/**
 * True when the current fields exactly describe this preset.
 *
 * The dialog keeps its own width/height strings while the user types, so the
 * comparison rounds first: typing `1920.4` should select Full HD, not leave
 * every preset looking idle.
 */
export function isCanvasSizePresetSelected(
  preset: CanvasSizePreset,
  width: number,
  height: number,
): boolean {
  return preset.width === Math.round(width) && preset.height === Math.round(height);
}

/** The preset with these dimensions, or `undefined` for a custom size. */
export function findCanvasSizePreset(
  width: number,
  height: number,
): CanvasSizePreset | undefined {
  return CANVAS_SIZE_PRESETS.find((preset) =>
    isCanvasSizePresetSelected(preset, width, height),
  );
}
