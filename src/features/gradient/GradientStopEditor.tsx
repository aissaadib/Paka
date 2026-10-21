/**
 * Middle-stop editor for the gradient tool.
 *
 * A gradient's endpoints stay the current brush colour and the "To" colour; this
 * editor manages only the stops between them. Like the other gradient options
 * it describes the *next* drag: a committed gradient keeps the stops it was
 * drawn with, so changing these never rewrites history.
 *
 * Offsets are edited as whole percentages. The engine normalizes the list
 * (sorted, deduplicated, strictly between the endpoints) on every change.
 */

import { useEditor, useEditorState } from "../../hooks/useEditor";
import { MAX_GRADIENT_MID_STOPS } from "../../core/gradient/gradientRecord";
import type { GradientStop } from "../../core/document/types";

/** A neutral colour for a newly added stop; the user picks the real one. */
const NEW_STOP_COLOR = "#808080";

/** The widest gap between existing stops, so "Add" never crowds a neighbour. */
function nextStopOffset(stops: readonly GradientStop[]): number {
  const offsets = [0, ...stops.map((stop) => stop.offset), 1];
  let best = 0.5;
  let bestGap = 0;
  for (let index = 1; index < offsets.length; index += 1) {
    const gap = offsets[index] - offsets[index - 1];
    if (gap > bestGap) {
      bestGap = gap;
      best = (offsets[index] + offsets[index - 1]) / 2;
    }
  }
  return best;
}

function percent(offset: number): number {
  return Math.round(offset * 100);
}

export function GradientStopEditor() {
  const { actions } = useEditor();
  const { brush, gradientEndColor, gradientMidStops } = useEditorState();

  const update = (index: number, patch: Partial<GradientStop>) => {
    actions.setGradientMidStops(
      gradientMidStops.map((stop, stopIndex) =>
        stopIndex === index ? { ...stop, ...patch } : stop,
      ),
    );
  };

  const remove = (index: number) => {
    actions.setGradientMidStops(
      gradientMidStops.filter((_, stopIndex) => stopIndex !== index),
    );
  };

  const add = () => {
    if (gradientMidStops.length >= MAX_GRADIENT_MID_STOPS) {
      return;
    }
    actions.setGradientMidStops([
      ...gradientMidStops,
      { offset: nextStopOffset(gradientMidStops), color: NEW_STOP_COLOR },
    ]);
  };

  const preview = [
    { offset: 0, color: brush.color },
    ...gradientMidStops,
    { offset: 1, color: gradientEndColor },
  ]
    .map((stop) => `${stop.color} ${percent(stop.offset)}%`)
    .join(", ");

  return (
    <div className="gradient-stops" role="group" aria-label="Gradient stops">
      <div
        className="gradient-stops__preview"
        style={{ background: `linear-gradient(to right, ${preview})` }}
        aria-hidden="true"
      />
      <div className="gradient-stops__endpoints">
        <span className="gradient-stops__endpoint">
          <span className="gradient-stops__swatch" style={{ background: brush.color }} />
          Start {brush.color}
        </span>
        <span className="gradient-stops__endpoint">
          <span
            className="gradient-stops__swatch"
            style={{ background: gradientEndColor }}
          />
          End {gradientEndColor}
        </span>
      </div>
      {gradientMidStops.length > 0 ? (
        <ol className="gradient-stops__list">
          {gradientMidStops.map((stop, index) => {
            const value = percent(stop.offset);
            return (
              <li className="gradient-stops__row" key={index}>
                <input
                  type="color"
                  className="gradient-stops__color"
                  aria-label={`Stop ${index + 1} colour`}
                  value={stop.color}
                  onChange={(event) => update(index, { color: event.target.value })}
                />
                <input
                  type="range"
                  className="gradient-stops__range"
                  aria-label={`Stop ${index + 1} position`}
                  min={1}
                  max={99}
                  step={1}
                  value={value}
                  onChange={(event) =>
                    update(index, { offset: Number(event.target.value) / 100 })
                  }
                />
                <output className="gradient-stops__value">{value}%</output>
                <button
                  type="button"
                  className="gradient-stops__remove"
                  aria-label={`Remove stop ${index + 1}`}
                  onClick={() => remove(index)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
      <div className="gradient-stops__actions">
        <button
          type="button"
          className="gradient-stops__add"
          onClick={add}
          disabled={gradientMidStops.length >= MAX_GRADIENT_MID_STOPS}
        >
          Add stop
        </button>
        <button
          type="button"
          className="gradient-stops__add"
          onClick={() => actions.setGradientMidStops([])}
          disabled={gradientMidStops.length === 0}
        >
          Clear stops
        </button>
      </div>
    </div>
  );
}
