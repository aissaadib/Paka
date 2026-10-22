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

  // The cursor follows the pointer where the tool has something specific to
  // say: the select tool's transform handles ask for a resize cursor. The
  // report is a high-frequency stream, so it is written straight to the DOM.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    return engine.subscribeCursor((report) => {
      canvas.style.cursor = report.cursor;
    });
  }, [engine]);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) {
      return;
    }

    engine.attach(canvas);

    // The viewport is measured from the **canvas element**, not from its
    // frame: the canvas is the box the drawing is shown in, and it is also
    // the rectangle the pointer is mapped against. Measuring the same
    // rectangle for both means the display's backing store always matches the
    // box the pixels are shown in, so the drawing cannot drift away from the
    // pointer - at any zoom and at any device pixel ratio.
    //
    // The surface is sized by CSS (`width: 100%; height: 100%`), so the
    // backing store the renderer writes never changes the observed size and
    // the observer cannot feed back into itself.
    const reportSize = () => {
      const rect = canvas.getBoundingClientRect();
      engine.setViewportSize(rect.width, rect.height);
    };

    const observer = new ResizeObserver(reportSize);
    observer.observe(canvas);
    reportSize();

    // A DPR change (moving the window to another monitor) does not always
    // resize the element, so it is checked on window resize as well. A change
    // that comes without a resize is caught by the engine's own ratio watch.
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
