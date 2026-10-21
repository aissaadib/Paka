/**
 * Pressure-response curve editor.
 *
 * A small SVG polyline: raw pressure runs left to right, the pressure the brush
 * uses runs bottom to top. Drag a point to shape the response, click the plot to
 * add one, double-click (or Delete) a middle point to remove it. The endpoints
 * stay on the left and right edges; their response is still editable.
 *
 * The component keeps a local draft while a drag is in flight and commits one
 * `setBrush` on release, so a drag does not publish a snapshot per pointermove.
 */

import { useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  addPressureCurvePoint,
  movePressureCurvePoint,
  removePressureCurvePoint,
} from "../../core/brushes/pressureCurve";
import { DEFAULT_PRESSURE_CURVE } from "../../core/brushes/defaults";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import type { PressureCurvePoint } from "../../types/brush";

const WIDTH = 200;
const HEIGHT = 140;
const PAD = 14;
const PLOT_WIDTH = WIDTH - PAD * 2;
const PLOT_HEIGHT = HEIGHT - PAD * 2;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function toSvg(point: PressureCurvePoint): { x: number; y: number } {
  return {
    x: PAD + point.x * PLOT_WIDTH,
    y: PAD + (1 - point.y) * PLOT_HEIGHT,
  };
}

export function PressureCurveEditor() {
  const { actions } = useEditor();
  const { brush } = useEditorState();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [draft, setDraft] = useState<readonly PressureCurvePoint[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const curve = draft ?? brush.pressureCurve;

  const commit = (next: readonly PressureCurvePoint[]) => {
    setDraft(null);
    actions.setBrush({ pressureCurve: next });
  };

  const pointFromClient = (clientX: number, clientY: number): PressureCurvePoint => {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
    }
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    const y = ((clientY - rect.top) / rect.height) * HEIGHT;
    return {
      x: clamp01((x - PAD) / PLOT_WIDTH),
      y: clamp01(1 - (y - PAD) / PLOT_HEIGHT),
    };
  };

  const handlePointDown = (index: number, event: ReactPointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // `preventDefault` suppresses the browser's implicit focus, so move focus
    // here: the arrow keys and Delete act on the focused point.
    event.currentTarget.focus();
    setSelected(index);
    setDragging(index);
    setDraft(curve);
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragging === null || draft === null) {
      return;
    }
    const point = pointFromClient(event.clientX, event.clientY);
    setDraft((current) =>
      current ? movePressureCurvePoint(current, dragging, point.x, point.y) : current,
    );
  };

  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragging === null) {
      return;
    }
    if (draft) {
      // Merge the release position so a coalesced last move is not lost.
      const point = pointFromClient(event.clientX, event.clientY);
      commit(movePressureCurvePoint(draft, dragging, point.x, point.y));
    }
    setDragging(null);
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const addAt = (event: ReactPointerEvent<SVGRectElement>) => {
    const point = pointFromClient(event.clientX, event.clientY);
    const next = addPressureCurvePoint(curve, point.x, point.y);
    if (next !== curve) {
      commit(next);
    }
  };

  const removeSelected = () => {
    if (selected === null) {
      return;
    }
    const next = removePressureCurvePoint(curve, selected);
    if (next !== curve) {
      commit(next);
      setSelected(null);
    }
  };

  const reset = () => {
    commit(DEFAULT_PRESSURE_CURVE);
    setSelected(null);
  };

  const handlePointKey = (index: number, event: ReactKeyboardEvent<SVGCircleElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const next = removePressureCurvePoint(curve, index);
      if (next !== curve) {
        commit(next);
        setSelected(null);
      }
      return;
    }

    const step = event.shiftKey ? 0.05 : 0.01;
    const point = curve[index];
    let x = point.x;
    let y = point.y;
    if (event.key === "ArrowLeft") {
      x -= step;
    } else if (event.key === "ArrowRight") {
      x += step;
    } else if (event.key === "ArrowUp") {
      y += step;
    } else if (event.key === "ArrowDown") {
      y -= step;
    } else {
      return;
    }
    event.preventDefault();
    const next = movePressureCurvePoint(curve, index, x, y);
    commit(next);
  };

  const polyline = curve
    .map((point) => {
      const svg = toSvg(point);
      return `${svg.x},${svg.y}`;
    })
    .join(" ");

  return (
    <div className="pressure-curve" role="group" aria-label="Pressure response curve">
      <svg
        ref={svgRef}
        className="pressure-curve__plot"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-label="Pressure response. Drag points, click the plot to add one, double-click a middle point to delete it."
        onPointerMove={handleMove}
        onPointerUp={finishDrag}
        onPointerCancel={() => {
          setDragging(null);
          setDraft(null);
        }}
      >
        <rect
          className="pressure-curve__surface"
          x={0}
          y={0}
          width={WIDTH}
          height={HEIGHT}
          onPointerDown={addAt}
        />
        {[0.25, 0.5, 0.75].map((fraction) => (
          <g key={fraction} className="pressure-curve__grid">
            <line
              x1={PAD + fraction * PLOT_WIDTH}
              y1={PAD}
              x2={PAD + fraction * PLOT_WIDTH}
              y2={PAD + PLOT_HEIGHT}
            />
            <line
              x1={PAD}
              y1={PAD + fraction * PLOT_HEIGHT}
              x2={PAD + PLOT_WIDTH}
              y2={PAD + fraction * PLOT_HEIGHT}
            />
          </g>
        ))}
        <line
          className="pressure-curve__identity"
          x1={PAD}
          y1={PAD + PLOT_HEIGHT}
          x2={PAD + PLOT_WIDTH}
          y2={PAD}
        />
        <polyline className="pressure-curve__line" points={polyline} />
        {curve.map((point, index) => {
          const svg = toSvg(point);
          const isEndpoint = index === 0 || index === curve.length - 1;
          return (
            <circle
              key={index}
              className={[
                "pressure-curve__point",
                isEndpoint ? "is-endpoint" : "",
                selected === index ? "is-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              cx={svg.x}
              cy={svg.y}
              r={selected === index ? 6 : 5}
              tabIndex={0}
              role="button"
              aria-label={`Point ${index + 1}: ${Math.round(point.x * 100)}% pressure, ${Math.round(
                point.y * 100,
              )}% response${isEndpoint ? ", endpoint" : ""}`}
              onPointerDown={(event) => handlePointDown(index, event)}
              onDoubleClick={() => {
                const next = removePressureCurvePoint(curve, index);
                if (next !== curve) {
                  commit(next);
                  setSelected(null);
                }
              }}
              onKeyDown={(event) => handlePointKey(index, event)}
            />
          );
        })}
      </svg>
      <div className="pressure-curve__actions">
        <span className="pressure-curve__hint">
          {curve.length} point{curve.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          className="pressure-curve__button"
          onClick={removeSelected}
          disabled={
            selected === null || selected === 0 || selected === curve.length - 1
          }
        >
          Delete point
        </button>
        <button type="button" className="pressure-curve__button" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}
