/**
 * A preset's tip, drawn by the engine's own renderer.
 *
 * The swatch is not a picture of a brush: it is the *same* picture the live
 * preview draws, rendered by the same code, from the preset's own brush
 * settings. A property that changes a stroke changes the swatch, because
 * both come from the renderer's primitives.
 *
 * The live preview draws at a fixed size, so the swatch renders into a canvas
 * of that size and scales it down. The brush is therefore shown the way it
 * would look, not the way it would measure.
 */

import { useEffect, useRef } from "react";
import {
  PREVIEW_CSS_HEIGHT,
  PREVIEW_CSS_WIDTH,
  buildPreviewStroke,
  renderBrushPreview,
} from "../../core/rendering/brushPreview";
import type { BrushSettings } from "../../types/brush";

/** The swatch's width, in CSS pixels. */
export const TIP_CSS_WIDTH = 60;

/** The swatch's height, in CSS pixels. */
export const TIP_CSS_HEIGHT = 20;

export interface BrushTipPreviewProps {
  readonly brush: BrushSettings;
  /** The colour painted behind the stroke: the document's paper. */
  readonly background: string;
  /** What the swatch shows, for a screen reader. */
  readonly label: string;
}

export function BrushTipPreview({ brush, background, label }: BrushTipPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = Math.round(TIP_CSS_WIDTH * ratio);
    const height = Math.round(TIP_CSS_HEIGHT * ratio);
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }

    // The live preview's own size, drawn off screen and scaled into the
    // swatch: the swatch is the live preview, smaller.
    const source = document.createElement("canvas");
    source.width = Math.round(PREVIEW_CSS_WIDTH * ratio);
    source.height = Math.round(PREVIEW_CSS_HEIGHT * ratio);
    const sourceCtx = source.getContext("2d");
    const ctx = canvas.getContext("2d");
    if (!sourceCtx || !ctx) {
      return;
    }
    renderBrushPreview(sourceCtx, buildPreviewStroke(brush), { pixelRatio: ratio, background });

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
  }, [brush, background]);

  return (
    <canvas
      className="brush-tip"
      ref={canvasRef}
      style={{ width: `${TIP_CSS_WIDTH}px`, height: `${TIP_CSS_HEIGHT}px` }}
      role="img"
      aria-label={label}
    />
  );
}
