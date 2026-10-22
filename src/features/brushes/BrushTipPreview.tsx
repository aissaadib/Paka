/**
 * A preset's tip, drawn by the engine's own renderer.
 *
 * The swatch is not a picture of a brush: it is the *same* picture the live
 * preview draws, rendered by the same code, from the preset's own brush
 * settings. A property that changes a stroke changes the swatch.
 *
 * The live preview draws at a fixed size, so the swatch renders into a canvas
 * of that size and scales it down. The brush is therefore shown the way it
 * would look, not the way it would measure - with one exception: the swatch
 * draws the mark **at the size it deserves**, so a hairline pen reads as a
 * hairline and a broad airbrush fills the box. A list of brushes that all
 * look the same size is not a list you can choose from.
 */

import { useEffect, useRef } from "react";
import {
  PREVIEW_CSS_HEIGHT,
  PREVIEW_CSS_WIDTH,
  buildPreviewStroke,
  previewFit,
  renderBrushPreview,
} from "../../core/rendering/brushPreview";
import type { BrushSettings } from "../../types/brush";

/** The swatch's width, in CSS pixels. */
export const TIP_CSS_WIDTH = 44;

/** The swatch's height, in CSS pixels. */
export const TIP_CSS_HEIGHT = 18;

/**
 * The brush that fills the swatch.
 *
 * It is the reference the list is read against: a brush this wide fills the
 * box, a wider one is drawn as wide as the box allows, and a narrower one is
 * drawn narrower.
 */
const REFERENCE_SIZE = 24;

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

    // How tall the mark is in the source, in CSS pixels, and how tall it
    // should be in the swatch: the brush's own width against the reference.
    const markHeight = Math.max(0.5, brush.size * previewFit(brush));
    const wanted = TIP_CSS_HEIGHT * Math.min(1, brush.size / REFERENCE_SIZE);
    const scale = wanted / markHeight;

    ctx.clearRect(0, 0, width, height);
    const drawnWidth = source.width * scale;
    const drawnHeight = source.height * scale;
    ctx.drawImage(
      source,
      0,
      0,
      source.width,
      source.height,
      (width - drawnWidth) / 2,
      (height - drawnHeight) / 2,
      drawnWidth,
      drawnHeight,
    );
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
