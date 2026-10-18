/**
 * Central drawing workspace.
 *
 * The canvas element is the render target; the engine binds to it directly
 * (renderer + DOM input listeners) and the surrounding container reports its
 * CSS size, so resizing never changes the document's logical dimensions.
 *
 * The brush outline overlay is updated through the engine's cursor stream, so
 * pointer movement does not re-render this component.
 */

import { useEffect, useRef } from "react";
import { useEditor, useEditorToolId } from "../../hooks/useEditor";
import { BrushCursor } from "./BrushCursor";

export function CanvasStage() {
  const { engine } = useEditor();
  const toolId = useEditorToolId();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // The cursor belongs to the active tool: "none" while the brush draws its own
  // outline overlay, "grab" for panning. Applied imperatively so the tool id is
  // the only reason this component ever re-renders.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = engine.getCursor();
    }
  }, [engine, toolId]);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) {
      return;
    }

    engine.attach(canvas);

    const reportSize = () => {
      const rect = frame.getBoundingClientRect();
      engine.setViewportSize(rect.width, rect.height);
    };

    const observer = new ResizeObserver(reportSize);
    observer.observe(frame);
    reportSize();

    // A DPR change (moving the window to another monitor) does not always
    // resize the element, so it is checked on window resize as well.
    window.addEventListener("resize", reportSize);

    return () => {
      window.removeEventListener("resize", reportSize);
      observer.disconnect();
      engine.detach();
    };
  }, [engine]);

  return (
    <div className="canvas-stage" ref={frameRef}>
      <canvas className="canvas-stage__surface" ref={canvasRef} />
      <BrushCursor />
    </div>
  );
}
