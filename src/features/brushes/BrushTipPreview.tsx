/**
 * The preview of a brush tip.
 *
 * The swatch is the engine's own picture of the tip: the mask the stamp
 * engine multiplies into a dab's coverage, sampled by the very function the
 * renderer rasterizes with. It is not a drawing of a brush - it is what the
 * brush stamps.
 *
 * The mask is the only thing a tip is, so the swatch shows the mask: a disc
 * for the round tip, a soft pad for the felt one, a diagonal nib for the
 * chisel, a ragged edge for the blot and a set of lanes for the bristles.
 */

import { useEffect, useRef } from "react";
import { brushTipSilhouette } from "../../core/rendering/brushTip";
import { hexToRgb } from "../../utils/color";
import type { BrushTipShape } from "../../types/brush";

/** The swatch's width, in CSS pixels. */
export const TIP_CSS_SIZE = 48;

export interface BrushTipPreviewProps {
  /** The tip the swatch shows. */
  readonly tip: BrushTipShape;
  /** The colour the tip is painted in. */
  readonly color?: string;
  /** What the swatch shows, for a screen reader. */
  readonly label: string;
}

/**
 * Draws the tip's mask.
 *
 * The canvas is sized in device pixels, so the swatch is the same picture on
 * every screen: the mask is sampled on the same grid the renderer works on.
 */
export function BrushTipPreview({ tip, color = "#16181c", label }: BrushTipPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const size = Math.round(TIP_CSS_SIZE * ratio);
    if (canvas.width !== size) {
      canvas.width = size;
    }
    if (canvas.height !== size) {
      canvas.height = size;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    // The mask, in the coverage the engine would stamp with.
    const coverage = brushTipSilhouette(tip, size);
    const rgb = hexToRgb(color) ?? { r: 0, g: 0, b: 0 };
    const image = ctx.createImageData(size, size);
    for (let index = 0; index < size * size; index += 1) {
      image.data[index * 4] = rgb.r;
      image.data[index * 4 + 1] = rgb.g;
      image.data[index * 4 + 2] = rgb.b;
      image.data[index * 4 + 3] = coverage[index];
    }
    ctx.putImageData(image, 0, 0);
  }, [tip, color]);

  return (
    <canvas
      className="brush-tip"
      ref={canvasRef}
      style={{ width: `${TIP_CSS_SIZE}px`, height: `${TIP_CSS_SIZE}px` }}
      role="img"
      aria-label={label}
    />
  );
}
