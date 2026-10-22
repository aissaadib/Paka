/**
 * The pressure response preview.
 *
 * A small plot that answers one question: *what does the pressure do to this
 * property?* The horizontal axis is the pressure the device reports, the
 * vertical axis is the property's response - a fraction of the property's own
 * value, so the size response runs from 0 % to 100 % of the brush's diameter.
 *
 * The dashed line is the brush's pressure curve, which is what bends the
 * pressure before the property sees it, and the solid line is the response the
 * property actually gets. Both come from the same functions the rasterizer
 * uses, so the preview cannot drift away from the picture.
 */

import { useState } from "react";
import { evaluatePressureCurve } from "../../core/brushes/pressureCurve";
import { pressureResponse } from "../../core/brushes/pressureMapping";
import { useEditorState } from "../../hooks/useEditor";
import type { BrushSettings, PressureMapping } from "../../types/brush";

const WIDTH = 200;
const HEIGHT = 120;
const PAD = 14;
const PLOT_WIDTH = WIDTH - PAD * 2;
const PLOT_HEIGHT = HEIGHT - PAD * 2;

/** How many points the response line is drawn with. */
const SAMPLES = 21;

type MappingKey = "pressureSize" | "pressureOpacity" | "pressureFlow";

interface PreviewTarget {
  readonly key: MappingKey;
  readonly label: string;
  readonly mapping: PressureMapping;
  /** What the response is a fraction of, for the caption. */
  readonly subject: string;
}

function targetsOf(brush: BrushSettings): PreviewTarget[] {
  const targets: PreviewTarget[] = [];
  if (brush.pressureSize.enabled) {
    targets.push({
      key: "pressureSize",
      label: "Size",
      mapping: brush.pressureSize,
      subject: `of ${Math.round(brush.size)} px`,
    });
  }
  if (brush.pressureOpacity.enabled) {
    targets.push({
      key: "pressureOpacity",
      label: "Opacity",
      mapping: brush.pressureOpacity,
      subject: `of ${Math.round(brush.opacity * 100)}%`,
    });
  }
  if (brush.pressureFlow.enabled) {
    targets.push({
      key: "pressureFlow",
      label: "Flow",
      mapping: brush.pressureFlow,
      subject: "of a full dab",
    });
  }
  return targets;
}

export function PressureResponsePreview() {
  const { brush } = useEditorState();
  const targets = targetsOf(brush);
  const [selected, setSelected] = useState<MappingKey | null>(null);
  const target = targets.find((entry) => entry.key === selected) ?? targets[0] ?? null;

  if (!target) {
    return (
      <div className="pressure-preview">
        <p className="pressure-preview__empty">
          No property answers the pressure yet. Turn one on to see its response.
        </p>
      </div>
    );
  }

  const points: string[] = [];
  const curvePoints: string[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    const pressure = index / (SAMPLES - 1);
    const curve = evaluatePressureCurve(brush.pressureCurve, pressure);
    const response = pressureResponse(brush, target.mapping, pressure);
    curvePoints.push(`${PAD + pressure * PLOT_WIDTH},${PAD + (1 - curve) * PLOT_HEIGHT}`);
    points.push(`${PAD + pressure * PLOT_WIDTH},${PAD + (1 - response) * PLOT_HEIGHT}`);
  }

  const from = Math.round(target.mapping.min * 100);
  const to = Math.round(target.mapping.max * 100);

  return (
    <div className="pressure-preview">
      <div className="pressure-preview__tabs" role="group" aria-label="Response property">
        {targets.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={entry.key === target.key}
            className={
              entry.key === target.key
                ? "pressure-preview__tab is-selected"
                : "pressure-preview__tab"
            }
            onClick={() => setSelected(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <svg
        className="pressure-preview__plot"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${target.label} response: ${from}% at no pressure, ${to}% at full pressure`}
      >
        <line
          className="pressure-curve__identity"
          x1={PAD}
          y1={PAD + PLOT_HEIGHT}
          x2={PAD + PLOT_WIDTH}
          y2={PAD}
        />
        <polyline className="pressure-preview__line" points={curvePoints.join(" ")} />
        <polyline className="pressure-preview__response" points={points.join(" ")} />
      </svg>
      <p className="pressure-preview__caption">
        {target.label}: {from}% → {to}% {target.subject}, from no pressure to full pressure.
      </p>
    </div>
  );
}
