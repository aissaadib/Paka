/**
 * Brush outline cursor.
 *
 * A DOM overlay positioned imperatively from the engine's cursor stream: no
 * React state is involved per pointer move. The outline is a visual hint of
 * the effective brush size in screen pixels, so it is clipped to a minimum
 * radius where a 1 px brush would be invisible.
 */

import { useEffect, useRef } from "react";
import { useEditor, useEditorState } from "../../hooks/useEditor";

const MIN_OUTLINE_SIZE = 4;

export function BrushCursor() {
  const { engine } = useEditor();
  const { brush, viewport, toolId } = useEditorState();
  const elementRef = useRef<HTMLDivElement | null>(null);

  // Outline size follows brush size and zoom.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    const size = Math.max(MIN_OUTLINE_SIZE, brush.size * viewport.zoom);
    element.style.width = `${size}px`;
    element.style.height = `${size}px`;
  }, [brush.size, viewport.zoom]);

  // Visibility follows the active tool.
  useEffect(() => {
    const element = elementRef.current;
    if (element) {
      element.style.display = toolId === "brush" ? "block" : "none";
    }
  }, [toolId]);

  // Position follows the pointer, straight from the engine.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    return engine.subscribeCursor((report) => {
      if (!report.inside) {
        element.style.visibility = "hidden";
        return;
      }
      element.style.visibility = "visible";
      element.style.transform = `translate3d(${report.screenX}px, ${report.screenY}px, 0) translate(-50%, -50%)`;
    });
  }, [engine]);

  return <div className="brush-cursor" ref={elementRef} aria-hidden="true" />;
}
