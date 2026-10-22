/**
 * Brush outline cursor.
 *
 * A DOM overlay positioned imperatively from the engine's cursor stream: no
 * React state is involved per pointer move. The outline is a visual hint of
 * the effective brush size in screen pixels, so it is clipped to a minimum
 * radius where a 1 px brush would be invisible.
 *
 * The cursor belongs to a *view*: the pointer is over one canvas at a time,
 * and every view's outline only answers the reports of its own view.
 */

import { useEffect, useRef } from "react";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { PRIMARY_VIEW_ID, type ViewId } from "../../types/viewport";

const MIN_OUTLINE_SIZE = 4;

export interface BrushCursorProps {
  /** The view this outline belongs to. */
  readonly viewId?: ViewId;
}

export function BrushCursor({ viewId = PRIMARY_VIEW_ID }: BrushCursorProps) {
  const { engine } = useEditor();
  const { brush, viewport, toolId, views } = useEditorState();
  const elementRef = useRef<HTMLDivElement | null>(null);

  // The zoom of *this* view: the outline is a screen-space hint, so it follows
  // the view it is drawn in, not the active one.
  const zoom = views.find((view) => view.id === viewId)?.zoom ?? viewport.zoom;

  // Outline size follows brush size and zoom.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    const size = Math.max(MIN_OUTLINE_SIZE, brush.size * zoom);
    element.style.width = `${size}px`;
    element.style.height = `${size}px`;
  }, [brush.size, zoom]);

  // Visibility follows the active tool.
  useEffect(() => {
    const element = elementRef.current;
    if (element) {
      // The eraser has the same footprint as the brush, so the same outline
      // tells the user how much paper one pass will remove.
      element.style.display = toolId === "brush" || toolId === "eraser" ? "block" : "none";
    }
  }, [toolId]);

  // Position follows the pointer, straight from the engine.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    return engine.subscribeCursor((report) => {
      if (report.viewId !== viewId) {
        return;
      }
      if (!report.inside) {
        element.style.visibility = "hidden";
        return;
      }
      element.style.visibility = "visible";
      element.style.transform = `translate3d(${report.screenX}px, ${report.screenY}px, 0) translate(-50%, -50%)`;
    });
  }, [engine, viewId]);

  return <div className="brush-cursor" ref={elementRef} aria-hidden="true" />;
}
