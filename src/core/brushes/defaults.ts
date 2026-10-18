/** Default brush configuration and validation. */

import type { BrushSettings } from "../../types/brush";
import { clamp } from "../../utils/math";

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 512;
export const MIN_SPACING = 0.02;
export const MAX_SPACING = 2;

/**
 * Defaults are tuned for mouse and pen input on a white document:
 * a small dark stroke whose width follows pressure when a pen provides it.
 */
export const DEFAULT_BRUSH: BrushSettings = {
  size: 6,
  opacity: 1,
  color: "#16181c",
  pressureSize: 0.6,
  pressureOpacity: 0,
  minSizeRatio: 0.12,
  spacing: 0.12,
};

/** Clamps and validates a brush configuration. */
export function normalizeBrush(brush: BrushSettings): BrushSettings {
  return {
    size: clamp(brush.size, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE),
    opacity: clamp(brush.opacity, 0, 1),
    color: brush.color.trim() === "" ? DEFAULT_BRUSH.color : brush.color,
    pressureSize: clamp(brush.pressureSize, 0, 1),
    pressureOpacity: clamp(brush.pressureOpacity, 0, 1),
    minSizeRatio: clamp(brush.minSizeRatio, 0.02, 1),
    spacing: clamp(brush.spacing, MIN_SPACING, MAX_SPACING),
  };
}

export function updateBrushSettings(
  current: BrushSettings,
  patch: Partial<BrushSettings>,
): BrushSettings {
  return normalizeBrush({ ...current, ...patch });
}

/** Field-wise comparison, used to skip no-op updates and their re-renders. */
export function brushSettingsEqual(a: BrushSettings, b: BrushSettings): boolean {
  return (
    a.size === b.size &&
    a.opacity === b.opacity &&
    a.color === b.color &&
    a.pressureSize === b.pressureSize &&
    a.pressureOpacity === b.pressureOpacity &&
    a.minSizeRatio === b.minSizeRatio &&
    a.spacing === b.spacing
  );
}

/**
 * Steps the brush size for the `[` / `]` shortcuts: one pixel for small
 * brushes, ten percent for larger ones, so the step stays useful at both ends.
 */
export function stepBrushSize(current: number, direction: 1 | -1): number {
  const step = current < 10 ? 1 : Math.max(1, Math.round(current * 0.1));
  return clamp(current + direction * step, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
}
