/**
 * Pressure dynamics: how a pen's pressure drives the brush.
 *
 * Every property that answers pressure has one *mapping*: whether it is
 * enabled, and the response at no pressure and at full pressure. The shape of
 * the response comes from the brush's pressure curve, which the mappings
 * share - the panel's "Pressure response" button opens the curve and a
 * preview of what it does to the property.
 *
 * The panel never sees a stroke sample: the mappings are brush settings, and
 * the rasterizer applies them to the pressure the stroke stored. A mouse has
 * no pressure, so it draws at the top of every range - which is why the panel
 * says so rather than pretending the device reports one.
 */

import { useState } from "react";
import {
  DEFAULT_PRESSURE_FLOW,
  DEFAULT_PRESSURE_OPACITY,
  DEFAULT_PRESSURE_SIZE,
} from "../../core/brushes/defaults";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import type { PressureMapping } from "../../types/brush";
import { PressureCurveEditor } from "./PressureCurveEditor";

type MappingKey = "pressureSize" | "pressureOpacity" | "pressureFlow";

interface PropertySpec {
  readonly key: MappingKey;
  readonly label: string;
  readonly title: string;
  /** The response the property gets when it is turned on. */
  readonly fallback: PressureMapping;
}

const PROPERTIES: readonly PropertySpec[] = [
  {
    key: "pressureSize",
    label: "Pressure size",
    title: "Pen pressure drives the stroke's width",
    fallback: DEFAULT_PRESSURE_SIZE,
  },
  {
    key: "pressureOpacity",
    label: "Pressure opacity",
    title:
      "Pen pressure drives the stroke's opacity. A stroke is composited once, so the response follows the stroke's mean pressure",
    fallback: DEFAULT_PRESSURE_OPACITY,
  },
  {
    key: "pressureFlow",
    label: "Pressure flow",
    title:
      "Pen pressure drives the ink a dab deposits. Only the stamp engine can vary the ink along a stroke",
    fallback: DEFAULT_PRESSURE_FLOW,
  },
];

/**
 * The mapping a property gets when it is switched on.
 *
 * A mapping whose two ends are the same carries no response at all - it is
 * what a brush carried before the mappings existed, where a strength of `0`
 * meant "the pressure does not touch this property" - so such a mapping
 * starts from the property's default range instead.
 */
function enabledMapping(spec: PropertySpec, mapping: PressureMapping): PressureMapping {
  if (mapping.min === mapping.max) {
    return { ...spec.fallback, enabled: true };
  }
  return { ...mapping, enabled: true };
}

export function PressureDynamics() {
  const { actions } = useEditor();
  const { brush } = useEditorState();
  const [panelOpen, setPanelOpen] = useState(false);

  const update = (key: MappingKey, mapping: PressureMapping) => {
    if (key === "pressureSize") {
      actions.setBrush({ pressureSize: mapping });
    } else if (key === "pressureOpacity") {
      actions.setBrush({ pressureOpacity: mapping });
    } else {
      actions.setBrush({ pressureFlow: mapping });
    }
  };

  const anyEnabled =
    brush.pressureSize.enabled ||
    brush.pressureOpacity.enabled ||
    brush.pressureFlow.enabled;

  return (
    <div className="pressure-dynamics">
      <div className="pressure-dynamics__rows">
        {PROPERTIES.map((spec) => {
          const mapping = brush[spec.key];
          // The flow is only honoured by the stamp engine, so it cannot be
          // switched on while the brush paints plain segments.
          const unavailable = spec.key === "pressureFlow" && !brush.stamp;
          return (
            <div className="pressure-row" key={spec.key}>
              <label className="toggle" title={spec.title}>
                <input
                  type="checkbox"
                  checked={mapping.enabled}
                  disabled={unavailable}
                  onChange={(event) =>
                    update(
                      spec.key,
                      event.target.checked
                        ? enabledMapping(spec, mapping)
                        : { ...mapping, enabled: false },
                    )
                  }
                />
                {spec.label}
              </label>
              {unavailable ? (
                <span className="pressure-row__note">needs the stamp engine</span>
              ) : null}
              {mapping.enabled ? (
                <span className="pressure-row__ends">
                  <label className="pressure-row__end">
                    <span className="pressure-row__end-label">From</span>
                    <input
                      className="pressure-row__range"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={mapping.min}
                      aria-label={`${spec.label} at no pressure`}
                      onChange={(event) =>
                        update(spec.key, {
                          ...mapping,
                          min: Math.min(Number(event.target.value), mapping.max),
                        })
                      }
                    />
                    <span className="pressure-row__value">
                      {Math.round(mapping.min * 100)}%
                    </span>
                  </label>
                  <label className="pressure-row__end">
                    <span className="pressure-row__end-label">To</span>
                    <input
                      className="pressure-row__range"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={mapping.max}
                      aria-label={`${spec.label} at full pressure`}
                      onChange={(event) =>
                        update(spec.key, {
                          ...mapping,
                          max: Math.max(Number(event.target.value), mapping.min),
                        })
                      }
                    />
                    <span className="pressure-row__value">
                      {Math.round(mapping.max * 100)}%
                    </span>
                  </label>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="pressure-curve__toggle"
        aria-expanded={panelOpen}
        title="Shape the curve the raw pen pressure goes through, and see what it does"
        onClick={() => setPanelOpen((open) => !open)}
      >
        Pressure response
      </button>
      {panelOpen ? <PressureCurveEditor /> : null}
      {anyEnabled ? (
        <span className="pressure-dynamics__note">
          A mouse has no pressure: it draws at the top of every range.
        </span>
      ) : null}
    </div>
  );
}
