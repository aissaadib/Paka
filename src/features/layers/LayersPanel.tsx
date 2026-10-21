/**
 * Layers panel.
 *
 * Layer metadata lives in the document model; this panel only issues intents.
 * The list is shown top-first (top of the stack at the top), matching how the
 * canvas composites.
 */

import { useMemo } from "react";
import type { LayerBlendMode } from "../../core/document/types";
import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconPlus,
  IconTrash,
} from "../../components/icons";
import { Panel } from "../../components/panels/Panel";
import { IconButton } from "../../components/toolbar/IconButton";
import { SliderField } from "../../components/toolbar/SliderField";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { LayerRow } from "./LayerRow";
import "./layers.css";

const BLEND_MODE_OPTIONS: readonly { readonly value: LayerBlendMode; readonly label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "soft-light", label: "Soft light" },
  { value: "hard-light", label: "Hard light" },
  { value: "color-dodge", label: "Color dodge" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
];

export function LayersPanel() {
  const { actions } = useEditor();
  const { document: drawingDocument } = useEditorState();
  const layers = drawingDocument.layers;

  const activeIndex = layers.findIndex((layer) => layer.id === drawingDocument.activeLayerId);
  const activeLayer = activeIndex >= 0 ? layers[activeIndex] : undefined;
  const topFirst = useMemo(() => [...layers].reverse(), [layers]);

  const canDelete = layers.length > 1;
  const canMoveUp = activeIndex >= 0 && activeIndex < layers.length - 1;
  const canMoveDown = activeIndex > 0;

  return (
    <Panel
      title="Layers"
      actions={
        <>
          <IconButton label="Add layer" size="sm" onClick={actions.addLayer}>
            <IconPlus />
          </IconButton>
          <IconButton
            label="Duplicate layer"
            size="sm"
            disabled={!activeLayer}
            onClick={() => {
              if (activeLayer) {
                actions.duplicateLayer(activeLayer.id);
              }
            }}
          >
            <IconCopy />
          </IconButton>
          <IconButton
            label="Delete layer"
            size="sm"
            disabled={!canDelete || !activeLayer}
            onClick={() => {
              if (activeLayer) {
                actions.removeLayer(activeLayer.id);
              }
            }}
          >
            <IconTrash />
          </IconButton>
          <IconButton
            label="Move layer up"
            size="sm"
            disabled={!canMoveUp || !activeLayer}
            onClick={() => {
              if (activeLayer) {
                actions.moveLayer(activeLayer.id, 1);
              }
            }}
          >
            <IconArrowUp />
          </IconButton>
          <IconButton
            label="Move layer down"
            size="sm"
            disabled={!canMoveDown || !activeLayer}
            onClick={() => {
              if (activeLayer) {
                actions.moveLayer(activeLayer.id, -1);
              }
            }}
          >
            <IconArrowDown />
          </IconButton>
        </>
      }
      footer={
        activeLayer ? (
          <div className="layer-properties">
            <label className="layer-blend">
              <span className="layer-blend__label">Blend</span>
              <select
                className="layer-blend__select"
                value={activeLayer.blendMode}
                aria-label="Layer blend mode"
                onChange={(event) => {
                  const option = BLEND_MODE_OPTIONS.find(
                    (candidate) => candidate.value === event.target.value,
                  );
                  if (option) {
                    actions.setLayerBlendMode(activeLayer.id, option.value);
                  }
                }}
              >
                {BLEND_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <SliderField
              label="Opacity"
              min={0}
              max={1}
              step={0.01}
              value={activeLayer.opacity}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(opacity) => actions.setLayerOpacity(activeLayer.id, opacity)}
            />
          </div>
        ) : null
      }
    >
      <ul className="layer-list">
        {topFirst.map((layer) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            active={layer.id === drawingDocument.activeLayerId}
            onSelect={() => actions.selectLayer(layer.id)}
            onToggleVisibility={() => actions.toggleLayerVisibility(layer.id)}
            onRename={(name) => actions.renameLayer(layer.id, name)}
          />
        ))}
      </ul>
    </Panel>
  );
}
