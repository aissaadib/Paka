/**
 * Layer blend modes.
 *
 * The renderer does not composite these channel-by-channel in JavaScript: it
 * maps each mode to the matching Canvas 2D `globalCompositeOperation`, and the
 * browser applies the W3C compositing formula in sRGB with straight-alpha
 * source pixels. This module is the single source of truth for *which* modes a
 * layer may carry, and it holds the same separable blend formulas as plain
 * functions. The functions are used by the tests as an independent oracle and
 * document the exact boundary behaviour (`0`, `1`, partial alpha) the canvas
 * operation must have; they do not replace the native fast path at runtime.
 */

import type { LayerBlendMode } from "./types";

/** Every persisted layer blend mode, in the order the layer menu presents them. */
export const LAYER_BLEND_MODES: readonly LayerBlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "color-dodge",
  "darken",
  "lighten",
  "difference",
  "exclusion",
];

export function isLayerBlendMode(value: string): value is LayerBlendMode {
  return (LAYER_BLEND_MODES as readonly string[]).includes(value);
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * The W3C separable blend function `B(Cb, Cs)` for one channel.
 *
 * `backdrop` is `Cb` and `source` is `Cs`, both straight (unpremultiplied)
 * channels normalised to `[0, 1]`. Inputs outside the range are clamped, so a
 * caller cannot smuggle a premultiplied value in by accident.
 */
export function blendChannel(
  mode: LayerBlendMode,
  backdrop: number,
  source: number,
): number {
  const b = clampChannel(backdrop);
  const s = clampChannel(source);
  switch (mode) {
    case "normal":
      return s;
    case "multiply":
      return b * s;
    case "screen":
      return b + s - b * s;
    case "overlay":
      // Hard-light with the operands swapped: the backdrop decides the branch.
      return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case "soft-light": {
      if (s <= 0.5) {
        return b - (1 - 2 * s) * b * (1 - b);
      }
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return b + (2 * s - 1) * (d - b);
    }
    case "hard-light":
      return s <= 0.5 ? 2 * s * b : 1 - 2 * (1 - s) * (1 - b);
    case "color-dodge":
      if (b === 0) {
        return 0;
      }
      if (s === 1) {
        return 1;
      }
      return Math.min(1, b / (1 - s));
    case "darken":
      return Math.min(b, s);
    case "lighten":
      return Math.max(b, s);
    case "difference":
      return Math.abs(b - s);
    case "exclusion":
      return b + s - 2 * b * s;
  }
}

/**
 * The composited colour of one channel for a blend mode over a backdrop.
 *
 * Straight-alpha inputs and outputs, matching the renderer's layer surfaces and
 * `ImageData`. This is the W3C equation
 *
 *   `Co = (αs(1-αb)Cs + αsαbB(Cb,Cs) + (1-αs)αbCb) / αo`
 *   `αo = αs + αb(1-αs)`
 *
 * so `sourceAlpha = 0` leaves the backdrop untouched and an opaque source
 * reduces to `B(Cb, Cs)`.
 */
export function compositeBlendChannel(
  mode: LayerBlendMode,
  backdrop: number,
  source: number,
  backdropAlpha: number,
  sourceAlpha: number,
): number {
  const b = clampChannel(backdrop);
  const s = clampChannel(source);
  const ba = clampChannel(backdropAlpha);
  const sa = clampChannel(sourceAlpha);
  const outAlpha = sa + ba * (1 - sa);
  if (outAlpha <= 0) {
    return 0;
  }
  const blended = blendChannel(mode, b, s);
  return (
    (sa * (1 - ba) * s + sa * ba * blended + (1 - sa) * ba * b) / outAlpha
  );
}
