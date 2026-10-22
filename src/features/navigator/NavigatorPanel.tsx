/**
 * Navigator panel: a small overview of the document with the visible area
 * marked, and a way to move the view around.
 *
 * The panel is a *view* of the document, never a second source of truth: it
 * draws the composite the renderer already has (through the engine's cached
 * overview) and marks the rectangle the canvas is showing. Clicking or
 * dragging in it moves the canvas' viewport; it never touches the artwork, so
 * it adds no history step and never marks the document dirty.
 *
 * The rectangle follows the viewport, the zoom and the canvas size because
 * all three are in the engine's snapshot. The panel never writes a viewport
 * in response to a snapshot change, so there is no feedback loop between the
 * two: only a pointer or a key moves the view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Panel } from "../../components/panels/Panel";
import { registerPanel } from "../../core/shell/panelRegistry";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import type { Point, Size } from "../../types/geometry";
import {
  navigatorCorners,
  navigatorGrab,
  navigatorKeyStep,
  navigatorLayout,
  navigatorTargetCenter,
  viewportCenter,
  type NavigatorGrab,
} from "./navigatorGeometry";
import "./navigator.css";

/** The canvas behind the overview: the workspace's own inset colour. */
const NAVIGATOR_BACKGROUND = "#121417";
/** The paper's edge in the overview. */
const NAVIGATOR_PAPER_EDGE = "#5a616b";
/** The accent that marks the visible area. */
const NAVIGATOR_VIEWPORT_EDGE = "#4c8ef7";
/** The wash inside the visible area. */
const NAVIGATOR_VIEWPORT_FILL = "rgba(76, 142, 247, 0.16)";

export function NavigatorPanel() {
  const { engine, actions } = useEditor();
  const { document: drawingDocument, viewport, viewportSize } = useEditorState();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const grabRef = useRef<NavigatorGrab | null>(null);
  const [panelSize, setPanelSize] = useState<Size>({ width: 0, height: 0 });
  const [hasOverview, setHasOverview] = useState(false);
  const [dpr, setDpr] = useState(() =>
    typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1),
  );

  // The device pixel ratio follows the display: moving the window to a
  // monitor with a different ratio has to resize the backing store.
  useEffect(() => {
    const report = () => {
      setDpr(Math.max(1, window.devicePixelRatio || 1));
    };
    window.addEventListener("resize", report);
    return () => {
      window.removeEventListener("resize", report);
    };
  }, []);

  const layout = useMemo(
    () =>
      navigatorLayout(
        { width: drawingDocument.width, height: drawingDocument.height },
        panelSize,
      ),
    [drawingDocument.width, drawingDocument.height, panelSize],
  );

  // The panel's own size, in CSS pixels: the overview is fitted to it, and
  // the canvas' backing store follows the device pixel ratio.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const report = () => {
      const rect = canvas.getBoundingClientRect();
      setPanelSize((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };
    const observer = new ResizeObserver(report);
    observer.observe(canvas);
    report();
    return () => {
      observer.disconnect();
    };
  }, []);

  // Draws the overview and the visible-area rectangle.
  //
  // The overview comes from the engine's cache, so this is a downscale of the
  // composite rather than a second rendering of the document, and a pan or a
  // zoom redraws only the rectangle.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || panelSize.width <= 0 || panelSize.height <= 0) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const pixelWidth = Math.max(1, Math.round(panelSize.width * dpr));
    const pixelHeight = Math.max(1, Math.round(panelSize.height * dpr));
    if (canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
    }
    if (canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, panelSize.width, panelSize.height);
    ctx.fillStyle = NAVIGATOR_BACKGROUND;
    ctx.fillRect(0, 0, panelSize.width, panelSize.height);

    if (layout.scale <= 0) {
      setHasOverview(false);
      return;
    }

    const overview = engine.getOverview(
      Math.round(layout.width * dpr),
      Math.round(layout.height * dpr),
    );
    setHasOverview(overview !== null);

    if (overview) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(overview, layout.offsetX, layout.offsetY, layout.width, layout.height);
    } else {
      // No composite yet (the renderer is not attached): the paper's colour
      // is the honest picture of an empty document.
      ctx.fillStyle = drawingDocument.background;
      ctx.fillRect(layout.offsetX, layout.offsetY, layout.width, layout.height);
    }

    ctx.strokeStyle = NAVIGATOR_PAPER_EDGE;
    ctx.lineWidth = 1 / dpr;
    ctx.strokeRect(layout.offsetX, layout.offsetY, layout.width, layout.height);

    // The visible area. It is drawn as the quadrilateral the canvas really
    // shows, so a turned or mirrored view is marked honestly; the wash is
    // clipped to the paper, because the canvas can show more than the
    // document (or less).
    const corners = navigatorCorners(layout, viewport, viewportSize);
    if (corners.length === 4) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.offsetX, layout.offsetY, layout.width, layout.height);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let index = 1; index < corners.length; index += 1) {
        ctx.lineTo(corners[index].x, corners[index].y);
      }
      ctx.closePath();
      ctx.fillStyle = NAVIGATOR_VIEWPORT_FILL;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let index = 1; index < corners.length; index += 1) {
        ctx.lineTo(corners[index].x, corners[index].y);
      }
      ctx.closePath();
      ctx.strokeStyle = NAVIGATOR_VIEWPORT_EDGE;
      ctx.lineWidth = 1 / dpr;
      ctx.stroke();
    }
  }, [
    dpr,
    drawingDocument.background,
    engine,
    layout,
    panelSize,
    viewport,
    viewportSize,
  ]);

  const pointerPosition = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return { x: 0, y: 0 };
      }
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      event.preventDefault();
      // The position is read *before* the focus: focusing an element can
      // scroll it into view, and a scrolled panel would move the rectangle
      // the pointer coordinates are measured against.
      const point = pointerPosition(event);
      canvas.focus({ preventScroll: true });
      const grab = navigatorGrab(layout, viewport, viewportSize, point.x, point.y);
      grabRef.current = grab;
      // A pointer outside the visible area jumps the view onto it; a pointer
      // inside it grabs the view where it is.
      const target = navigatorTargetCenter(grab, layout, point.x, point.y);
      actions.centerViewportOn(target.x, target.y);
      // Capturing the pointer keeps the drag going when the pointer leaves
      // the panel. It is a courtesy, not a requirement: a pointer that is
      // already gone cannot be captured, and the view has moved either way.
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // No active pointer with that id: nothing to capture.
      }
    },
    [actions, layout, pointerPosition, viewport, viewportSize],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const grab = grabRef.current;
      if (!grab) {
        return;
      }
      event.preventDefault();
      const point = pointerPosition(event);
      const target = navigatorTargetCenter(grab, layout, point.x, point.y);
      actions.centerViewportOn(target.x, target.y);
    },
    [actions, layout, pointerPosition],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    grabRef.current = null;
    if (canvas && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
      const step = navigatorKeyStep(viewport, viewportSize);
      const center = viewportCenter(viewport, viewportSize);
      let dx = 0;
      let dy = 0;
      switch (event.key) {
        case "ArrowLeft":
          dx = -step.x;
          break;
        case "ArrowRight":
          dx = step.x;
          break;
        case "ArrowUp":
          dy = -step.y;
          break;
        case "ArrowDown":
          dy = step.y;
          break;
        default:
          return;
      }
      // The navigator owns the arrow keys while it has the focus: the global
      // shortcut table binds them to nudge the selection.
      event.preventDefault();
      event.stopPropagation();
      actions.centerViewportOn(center.x + dx, center.y + dy);
    },
    [actions, viewport, viewportSize],
  );

  const zoomPercent = `${Math.round(viewport.zoom * 100)}%`;

  return (
    <Panel
      title="Navigator"
      footer={
        <div className="navigator__footer">
          <span className="navigator__zoom">{zoomPercent}</span>
          <div className="navigator__actions">
            <button
              type="button"
              className="navigator__button"
              onClick={actions.zoomToFit}
              title="Fit the document in the canvas"
            >
              Fit
            </button>
            <button
              type="button"
              className="navigator__button"
              onClick={actions.centerViewport}
              title="Centre the document in the canvas"
            >
              Centre
            </button>
          </div>
        </div>
      }
    >
      <div className="navigator">
        <div className="navigator__frame">
          <canvas
            className="navigator__surface"
            ref={canvasRef}
            role="application"
            tabIndex={0}
            aria-label={`Navigator: overview of the document at ${zoomPercent} zoom. Click or drag to move the view, arrow keys to pan.`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={handleKeyDown}
          />
        </div>
        {hasOverview ? null : <p className="navigator__empty">No document to show</p>}
      </div>
    </Panel>
  );
}

registerPanel({
  id: "navigator",
  title: "Navigator",
  slot: "right",
  order: 20,
  icon: "navigator",
  // The overview is drawn from the engine's cached composite and the panel
  // holds no state of its own, so unmounting it costs nothing.
  mounting: "when-visible",
  collapsible: true,
  grow: false,
  description: "An overview of the document, with the visible area marked.",
  render: () => <NavigatorPanel />,
});
