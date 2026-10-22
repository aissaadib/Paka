/**
 * Brush cursor overlay.
 *
 * A DOM overlay positioned imperatively from the engine's cursor stream: no
 * React state is involved per pointer move. The overlay draws two things:
 *
 *  - a **ring** whose diameter is the active brush's diameter in document
 *    pixels, mapped through the viewport zoom. It is the brush's real
 *    footprint, so it never claims a size the brush does not have.
 *  - a **readout** with the current size in pixels, shown while the quick
 *    resize gesture runs.
 *
 * The overlay is a *view*, never content: it is a sibling of the canvas, not
 * a layer of it, so it cannot reach a layer surface, a PNG export, the
 * document history or the project file. Being a separate compositing layer,
 * it also cannot flicker with the artwork underneath it.
 *
 * The size, the zoom and the two states that change how the ring is drawn all
 * come from the engine, so the overlay has one source of truth.
 *
 * The cursor belongs to a *view*: the pointer is over one canvas at a time,
 * and every view's ring only answers the reports of its own view.
 */

import { useEffect, useRef } from "react";
import { brushRingGeometry } from "../../core/brushes/brushCursor";
import { useEditor, useEditorState, useEditorToolId } from "../../hooks/useEditor";
import { PRIMARY_VIEW_ID, type ViewId } from "../../types/viewport";

/** The device pixel ratio, or 1 where there is no window. */
function readDevicePixelRatio(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export interface BrushCursorProps {
  /** The view this outline belongs to. */
  readonly viewId?: ViewId;
}

export function BrushCursor({ viewId = PRIMARY_VIEW_ID }: BrushCursorProps) {
  const { engine } = useEditor();
  const { viewport, views } = useEditorState();
  const toolId = useEditorToolId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const announcementRef = useRef<HTMLSpanElement | null>(null);
  const resizingRef = useRef(false);

  // The zoom of *this* view: the ring is a screen-space hint, so it follows
  // the view it is drawn in, not the active one.
  const zoom = views.find((view) => view.id === viewId)?.zoom ?? viewport.zoom;

  // Position follows the pointer, straight from the engine.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    return engine.subscribeCursor((report) => {
      if (report.viewId !== viewId) {
        return;
      }
      if (!report.inside) {
        root.style.visibility = "hidden";
        return;
      }
      root.style.visibility = "visible";
      root.style.transform = `translate3d(${report.screenX}px, ${report.screenY}px, 0)`;
    });
  }, [engine, viewId]);

  // The ring's size, the readout and the ring's states follow the engine.
  useEffect(() => {
    const ring = ringRef.current;
    const readout = readoutRef.current;
    if (!ring || !readout) {
      return;
    }
    return engine.subscribeBrushCursor((report) => {
      const geometry = brushRingGeometry(report.size, zoom, readDevicePixelRatio());
      ring.style.width = `${geometry.cssDiameter}px`;
      ring.style.height = `${geometry.cssDiameter}px`;
      // One device pixel, so the ring stays a hairline on any display.
      ring.style.borderWidth = `${geometry.hairlineCss}px`;
      ring.classList.toggle("is-resizing", report.resizing);
      ring.classList.toggle("is-drawing", report.drawing);
      readout.textContent = `${Math.round(report.size)} px`;
      readout.classList.toggle("is-visible", report.resizing);

      // The live value is a visual duplicate of the size the toolbar's slider
      // already exposes, so the ring stays out of the accessibility tree. The
      // final value is announced once, when the gesture ends.
      if (resizingRef.current && !report.resizing) {
        const announcement = announcementRef.current;
        if (announcement) {
          announcement.textContent = `Brush size ${Math.round(report.size)} pixels`;
        }
      }
      resizingRef.current = report.resizing;
    });
  }, [engine, zoom]);

  // Visibility follows the active tool.
  useEffect(() => {
    const root = rootRef.current;
    if (root) {
      // The eraser has the same footprint as the brush, so the same ring tells
      // the user how much paper one pass will remove.
      root.style.display = toolId === "brush" || toolId === "eraser" ? "block" : "none";
    }
  }, [toolId]);

  return (
    <>
      <div className="brush-cursor" ref={rootRef} aria-hidden="true">
        <div className="brush-cursor__ring" ref={ringRef} />
        <div className="brush-cursor__readout" ref={readoutRef} />
      </div>
      <span className="visually-hidden" role="status" aria-live="polite" ref={announcementRef} />
    </>
  );
}
