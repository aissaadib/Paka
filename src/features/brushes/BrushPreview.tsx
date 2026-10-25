/**
 * The live brush preview.
 *
 * A small swatch that shows what the current brush will draw. It is redrawn
 * when the brush changes and at no other time: the stroke it shows is a fixed
 * synthetic one, so a pointer sample never reaches it and the document is
 * never re-rendered to keep it up to date.
 *
 * The swatch is zoomed so the brush fits it, so it shows the *shape* of the
 * mark rather than its size; the size is read from the number box beside it.
 *
 * The React part is a shell: the stroke, the fit and the painting all live in
 * `core/rendering/brushPreview.ts`, which is where the rules that make the
 * preview agree with the real rasterizer are tested.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  PREVIEW_CSS_HEIGHT,
  PREVIEW_CSS_WIDTH,
  buildPreviewStroke,
  renderBrushPreview,
} from "../../core/rendering/brushPreview";
import { useEditorState } from "../../hooks/useEditor";
import "./brushPreview.css";

export function BrushPreview() {
  const { brush, document: drawingDocument } = useEditorState();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = Math.round(PREVIEW_CSS_WIDTH * ratio);
    const height = Math.round(PREVIEW_CSS_HEIGHT * ratio);
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    renderBrushPreview(ctx, buildPreviewStroke(brush), {
      pixelRatio: ratio,
      // The stroke is shown on the document's own paper, so the preview and
      // the canvas agree about what the colour will look like.
      background: drawingDocument.background,
    });
  }, [brush, drawingDocument.background]);

  useEffect(() => {
    draw();
  }, [draw]);

  // A window move to a screen with another pixel ratio changes the backing
  // store, so the swatch is redrawn on a resize as well.
  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  return (
    <canvas
      className="brush-preview"
      ref={canvasRef}
      style={{ width: `${PREVIEW_CSS_WIDTH}px`, height: `${PREVIEW_CSS_HEIGHT}px` }}
      role="img"
      aria-label="Preview of the current brush"
      title="What the current brush draws, on the document's paper"
    />
  );
}
