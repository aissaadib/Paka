/**
 * Central drawing workspace.
 *
 * The canvas element is the render target; the engine binds to it directly
 * (renderer + DOM input listeners) and the surrounding container reports its
 * CSS size, so resizing never changes the document's logical dimensions.
 *
 * The brush outline overlay is updated through the engine's cursor stream, so
 * pointer movement does not re-render this component.
 *
 * The frame also answers the platform's context-menu request: a right-button
 * click opens the canvas menu, while a right-drag paints with the secondary
 * colour and is left alone.
 */

import { useEffect, useRef, useState } from "react";
import { isClickGesture } from "../../core/input/clickGesture";
import { useActiveEngine, useEditorToolId } from "../../hooks/useEditor";
import { CanvasContextMenu } from "../commands/CanvasContextMenu";
import { BrushCursor } from "./BrushCursor";

export function CanvasStage() {
  // The engine of the *active* document: switching tab rebinds the canvas to
  // the other document's engine, with its own renderer and its own history.
  const engine = useActiveEngine();
  const toolId = useEditorToolId();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Where the right button went down, so a click can be told from a drag.
  const rightPressRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      rightPressRef.current =
        event.button === 2 ? { x: event.clientX, y: event.clientY } : null;
    };
    frame.addEventListener("pointerdown", handlePointerDown);
    return () => frame.removeEventListener("pointerdown", handlePointerDown);
  }, []);

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

  /**
   * Answers the platform's context-menu request.
   *
   * The engine already keeps the operating system's menu away from the
   * canvas, so this is where Paka's own menu opens. A right-drag is not a
   * menu gesture - it paints with the secondary colour - so the press is
   * compared with the position the request carries.
   */
  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const press = rightPressRef.current;
    rightPressRef.current = null;
    if (
      press !== null &&
      !isClickGesture(press, { x: event.clientX, y: event.clientY })
    ) {
      return;
    }
    setMenu({ x: event.clientX, y: event.clientY });
  };

  return (
    <div className="canvas-stage" ref={frameRef} onContextMenu={handleContextMenu}>
      <canvas className="canvas-stage__surface" ref={canvasRef} />
      <BrushCursor />
      {menu === null ? null : (
        <CanvasContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
