/**
 * Layers panel.
 *
 * Layer metadata lives in the document model; this panel only issues intents.
 * The list is shown top-first (top of the stack at the top), matching how the
 * canvas composites.
 */

import { useMemo } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconPlus,
  IconTrash,
} from "../../components/icons";
import { Panel } from "../../components/panels/Panel";
import { IconButton } from "../../components/toolbar/IconButton";
import { SliderField } from "../../components/toolbar/SliderField";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import { LayerRow } from "./LayerRow";
import "./layers.css";

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
          <SliderField
            label="Opacity"
            min={0}
            max={1}
            step={0.01}
            value={activeLayer.opacity}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(opacity) => actions.setLayerOpacity(activeLayer.id, opacity)}
          />
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
