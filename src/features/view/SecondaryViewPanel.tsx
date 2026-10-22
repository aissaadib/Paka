/**
 * The second view of the canvas.
 *
 * A second window on the *same* document: it shares the artwork, the history
 * and the dirty flag with the main canvas, and it has a transform of its own.
 * The panel owns the DOM side of that view - the canvas element, the size it
 * reports and the buttons that act on it - and nothing else. The engine owns
 * the document, and the second view is a projection of it.
 *
 * The panel never copies anything: it hands the canvas to the engine, and the
 * engine registers it as another display target of the *same* renderer, so the
 * two views read the same rasterized pixels.
 */

import { useEffect, useRef } from "react";
import {
  IconActualSize,
  IconFit,
  IconMirrorView,
  IconRotateView,
} from "../../components/icons";
import { IconButton } from "../../components/toolbar/IconButton";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { SECONDARY_VIEW_ID } from "../../types/viewport";
import { BrushCursor } from "../canvas/BrushCursor";
import { VIEW_ROTATION_DEGREES, formatZoomPercent } from "./viewNavigation";
import "./secondaryView.css";

export function SecondaryViewPanel() {
  const { engine, actions } = useEditor();
  const { views, activeViewId, toolId } = useEditorState();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const summary = views.find((view) => view.id === SECONDARY_VIEW_ID);

  // The cursor belongs to the tool: "none" while the brush draws its own
  // outline, "grab" for panning. It is applied imperatively, so the tool id is
  // the only reason this component ever re-renders.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = engine.getCursor();
    }
  }, [engine, toolId]);

  // The cursor under the pointer, written straight to the DOM: the report is a
  // high-frequency stream and must not go through React.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    return engine.subscribeCursor((report) => {
      if (report.viewId === SECONDARY_VIEW_ID) {
        canvas.style.cursor = report.cursor;
      }
    });
  }, [engine]);

  // The canvas is the engine's to draw into. It is handed over on mount and
  // taken back on unmount, so a closed view leaves nothing behind.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    engine.attachSecondaryView(canvas);
    return () => {
      engine.detachSecondaryView();
    };
  }, [engine]);

  // The size of the view: the engine needs it to fit the paper and to size
  // the canvas' backing store.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const reportSize = () => {
      const rect = frame.getBoundingClientRect();
      engine.setSecondaryViewSize(rect.width, rect.height);
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
    };
  }, [engine]);

  return (
    <section className="secondary-view" aria-label="Second view of the canvas">
      <header className="secondary-view__bar">
        <span className="secondary-view__title">View 2</span>
        <span className="secondary-view__zoom">{formatZoomPercent(summary?.zoom ?? 1)}</span>
        <span className="secondary-view__spacer" />
        <IconButton
          label="Fit this view to the window"
          onClick={() => actions.fitView(SECONDARY_VIEW_ID)}
        >
          <IconFit />
        </IconButton>
        <IconButton
          label="Show this view at 100 %"
          onClick={() => actions.actualSizeView(SECONDARY_VIEW_ID)}
        >
          <IconActualSize />
        </IconButton>
        <IconButton
          label={`Turn this view ${VIEW_ROTATION_DEGREES}° clockwise`}
          onClick={() => {
            actions.focusView(SECONDARY_VIEW_ID);
            actions.rotateView(VIEW_ROTATION_DEGREES);
          }}
        >
          <IconRotateView />
        </IconButton>
        <IconButton
          label="Mirror this view left to right"
          onClick={() => {
            actions.focusView(SECONDARY_VIEW_ID);
            actions.toggleViewMirror();
          }}
        >
          <IconMirrorView />
        </IconButton>
        <IconButton
          label="Close the second view"
          onClick={() => actions.closeSecondaryView()}
        >
          ✕
        </IconButton>
      </header>
      <div
        className="secondary-view__frame"
        ref={frameRef}
        data-active={activeViewId === SECONDARY_VIEW_ID ? "true" : "false"}
      >
        <canvas className="secondary-view__surface" ref={canvasRef} />
        <BrushCursor viewId={SECONDARY_VIEW_ID} />
      </div>
    </section>
  );
}
