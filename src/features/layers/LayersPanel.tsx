/**
 * Layers panel.
 *
 * Layer metadata lives in the document model; this panel only issues intents.
 * The list is shown top-first (top of the stack at the top), matching how the
 * canvas composites.
 *
 * The panel owns three pieces of *view* state - the row being dragged, the row
 * being renamed and the row the keyboard is on - and nothing else. Every
 * change to the drawing goes through an engine command, so it is undoable,
 * and the panel can never lose a layer by accident: a layer that holds content
 * is confirmed before it is deleted.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import {
  dropSlot,
  isAboveRowMidpoint,
  markerIndex,
  moveDeltaForSlot,
  nextRowIndex,
  topFirstLayers,
} from "../../core/document/layerOrdering";
import { layerDeletionPrompt, type LayerDeletionPrompt } from "../../core/document/layerDeletion";
import type { Layer, LayerBlendMode, LayerId } from "../../core/document/types";
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

/** A deletion the user has been asked about and has not answered yet. */
interface PendingDelete {
  readonly layerId: LayerId;
  readonly prompt: LayerDeletionPrompt;
}

export function LayersPanel() {
  const { actions, engine } = useEditor();
  const { document: drawingDocument } = useEditorState();
  const layers = drawingDocument.layers;
  const topFirst = useMemo(() => topFirstLayers(layers), [layers]);

  /** The row being dragged, and the slot it would land in. */
  const [dragLayerId, setDragLayerId] = useState<LayerId | null>(null);
  const [dropSlotIndex, setDropSlotIndex] = useState<number | null>(null);
  /** The row being renamed, and the name being typed. */
  const [renamingLayerId, setRenamingLayerId] = useState<LayerId | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  /** The row the keyboard is on. Focus is not the same as the active layer. */
  const [focusedLayerId, setFocusedLayerId] = useState<LayerId | null>(null);
  /** A deletion waiting for the user's answer. */
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const nameButtons = useRef(new Map<LayerId, HTMLButtonElement>());
  const cancelDeleteButton = useRef<HTMLButtonElement | null>(null);
  /** Guards the rename against a second commit (Enter *and* the blur). */
  const renameCommitted = useRef(false);

  const activeIndex = layers.findIndex((layer) => layer.id === drawingDocument.activeLayerId);
  const activeLayer = activeIndex >= 0 ? layers[activeIndex] : undefined;

  const canDelete = layers.length > 1;
  const canMoveUp = activeIndex >= 0 && activeIndex < layers.length - 1;
  const canMoveDown = activeIndex > 0;

  const draggedIndex = dragLayerId === null ? -1 : topFirst.findIndex((l) => l.id === dragLayerId);
  const markerAt =
    draggedIndex >= 0 && dropSlotIndex !== null ? markerIndex(draggedIndex, dropSlotIndex) : -1;

  /** Forgets the drag, whether it ended in a drop or was cancelled. */
  const clearDrag = useCallback(() => {
    setDragLayerId(null);
    setDropSlotIndex(null);
  }, []);

  const focusRow = useCallback((layerId: LayerId) => {
    nameButtons.current.get(layerId)?.focus();
  }, []);

  const registerNameButton = useCallback(
    (layerId: LayerId) => (element: HTMLButtonElement | null) => {
      if (element) {
        nameButtons.current.set(layerId, element);
      } else {
        nameButtons.current.delete(layerId);
      }
    },
    [],
  );

  // --------------------------------------------------------------- renaming

  const startRename = useCallback((layer: Layer) => {
    renameCommitted.current = false;
    setRenamingLayerId(layer.id);
    setRenameDraft(layer.name);
  }, []);

  const commitRename = useCallback(() => {
    if (renameCommitted.current) {
      return;
    }
    renameCommitted.current = true;
    const layerId = renamingLayerId;
    setRenamingLayerId(null);
    if (layerId === null) {
      return;
    }
    const trimmed = renameDraft.trim();
    const layer = layers.find((candidate) => candidate.id === layerId);
    if (layer && trimmed !== "" && trimmed !== layer.name) {
      actions.renameLayer(layerId, trimmed);
    }
  }, [actions, layers, renameDraft, renamingLayerId]);

  const cancelRename = useCallback(() => {
    renameCommitted.current = true;
    setRenamingLayerId(null);
    setRenameDraft("");
  }, []);

  // -------------------------------------------------------------- deleting

  /**
   * Deletes a layer, asking first when the layer holds content.
   *
   * The count comes from the engine's element list, so the question is asked
   * about the layer's *actual* content and not about a flag that could drift.
   */
  const requestDelete = useCallback(
    (layer: Layer) => {
      const prompt = layerDeletionPrompt(layer.name, engine.listElements(layer.id).length);
      if (prompt === null) {
        actions.removeLayer(layer.id);
        return;
      }
      setPendingDelete({ layerId: layer.id, prompt });
    },
    [actions, engine],
  );

  const confirmDelete = useCallback(() => {
    if (pendingDelete !== null) {
      actions.removeLayer(pendingDelete.layerId);
    }
    setPendingDelete(null);
  }, [actions, pendingDelete]);

  // The dialog takes the focus when it opens, so the keyboard is in the
  // dialog rather than in the list behind it.
  useEffect(() => {
    if (pendingDelete !== null) {
      cancelDeleteButton.current?.focus();
    }
  }, [pendingDelete]);

  // -------------------------------------------------------------- reordering

  const handleDragStart = useCallback(
    (layerId: LayerId) => (event: DragEvent<HTMLElement>) => {
      setDragLayerId(layerId);
      setDropSlotIndex(null);
      event.dataTransfer.effectAllowed = "move";
      // Firefox refuses to start a drag with an empty data store.
      event.dataTransfer.setData("text/plain", layerId);
    },
    [],
  );

  const handleDragOver = useCallback(
    (rowLayerId: LayerId) => (event: DragEvent<HTMLElement>) => {
      if (dragLayerId === null) {
        return;
      }
      // The drop is only allowed inside the list, and the marker follows the
      // pointer: the upper half of a row inserts above it, the lower half
      // below it.
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const row = event.currentTarget;
      const rect = row.getBoundingClientRect();
      const above = isAboveRowMidpoint(event.clientY, rect.top, rect.height);
      const rowIndex = topFirst.findIndex((layer) => layer.id === rowLayerId);
      const dragged = topFirst.findIndex((layer) => layer.id === dragLayerId);
      if (rowIndex < 0 || dragged < 0) {
        return;
      }
      setDropSlotIndex(dropSlot(rowIndex, above, dragged));
    },
    [dragLayerId, topFirst],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const draggedId = dragLayerId;
      const slot = dropSlotIndex;
      clearDrag();
      if (draggedId === null || slot === null) {
        return;
      }
      const dragged = topFirst.findIndex((layer) => layer.id === draggedId);
      if (dragged < 0) {
        return;
      }
      const delta = moveDeltaForSlot(dragged, slot);
      if (delta === 0) {
        // The layer lands where it already is: no move, and no history step.
        return;
      }
      // One engine command, so the whole drag is one undo step.
      actions.moveLayer(draggedId, delta);
    },
    [actions, clearDrag, dragLayerId, dropSlotIndex, topFirst],
  );

  // --------------------------------------------------------------- keyboard

  const handleListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      // While a row is being renamed the input owns the keyboard.
      if (renamingLayerId !== null) {
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      const focusedIndex =
        focusedLayerId === null ? -1 : topFirst.findIndex((layer) => layer.id === focusedLayerId);
      const focusedLayer = focusedIndex >= 0 ? topFirst[focusedIndex] : undefined;

      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp": {
          // The panel owns the arrow keys while it has the focus: the global
          // nudge must not fire at the same time.
          event.preventDefault();
          event.stopPropagation();
          if (mod) {
            if (focusedLayer !== undefined) {
              actions.moveLayer(focusedLayer.id, event.key === "ArrowUp" ? 1 : -1);
            }
            return;
          }
          const next = nextRowIndex(
            focusedIndex,
            event.key === "ArrowDown" ? 1 : -1,
            topFirst.length,
          );
          if (next !== null) {
            focusRow(topFirst[next].id);
          }
          return;
        }
        case "Home":
        case "End": {
          event.preventDefault();
          event.stopPropagation();
          const index = event.key === "Home" ? 0 : topFirst.length - 1;
          const layer = topFirst[index];
          if (layer !== undefined) {
            focusRow(layer.id);
          }
          return;
        }
        case "F2": {
          if (focusedLayer !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            startRename(focusedLayer);
          }
          return;
        }
        case "Delete":
        case "Backspace": {
          if (focusedLayer !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            requestDelete(focusedLayer);
          }
          return;
        }
        case "Escape": {
          // Cancels a drag in flight. The browser cancels the drag itself, and
          // the marker goes with it.
          if (dragLayerId !== null) {
            event.preventDefault();
            event.stopPropagation();
            clearDrag();
          }
          return;
        }
        default:
          return;
      }
    },
    [
      actions,
      clearDrag,
      dragLayerId,
      focusRow,
      focusedLayerId,
      requestDelete,
      renamingLayerId,
      startRename,
      topFirst,
    ],
  );

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
                requestDelete(activeLayer);
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
        <>
          {activeLayer ? (
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
          ) : (
            <p className="layer-properties__hint">Select a layer to change its blend and opacity.</p>
          )}
          <p className="layer-hint">
            Up/Down focus a layer, F2 renames it, Ctrl+Up/Down reorders it, Delete removes it.
          </p>
        </>
      }
    >
      {layers.length === 0 ? (
        <p className="layer-empty">
          This document has no layers yet. Add one to start drawing.
        </p>
      ) : (
        <ul className="layer-list" aria-label="Layers" onKeyDown={handleListKeyDown}>
          {topFirst.map((layer, index) => (
            <Fragment key={layer.id}>
              {index === markerAt ? (
                <li className="layer-marker" aria-hidden="true" />
              ) : null}
              <LayerRow
                layer={layer}
                active={layer.id === drawingDocument.activeLayerId}
                focused={layer.id === focusedLayerId}
                dragging={layer.id === dragLayerId}
                renaming={layer.id === renamingLayerId}
                draft={renameDraft}
                elementCount={engine.listElements(layer.id).length}
                onSelect={() => actions.selectLayer(layer.id)}
                onToggleVisibility={() => actions.toggleLayerVisibility(layer.id)}
                onFocus={() => setFocusedLayerId(layer.id)}
                onBlur={(event) => {
                  // The focus may move to another control in the same row; the
                  // row is only left when the focus leaves it entirely.
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setFocusedLayerId(null);
                  }
                }}
                onStartRename={() => startRename(layer)}
                onDraftChange={setRenameDraft}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
                onOpacityChange={(opacity) => actions.setLayerOpacity(layer.id, opacity)}
                onDragStart={handleDragStart(layer.id)}
                onDragEnd={clearDrag}
                onDragOver={handleDragOver(layer.id)}
                onDrop={handleDrop}
                registerNameButton={registerNameButton(layer.id)}
              />
            </Fragment>
          ))}
          {markerAt === topFirst.length ? <li className="layer-marker" aria-hidden="true" /> : null}
        </ul>
      )}
      {pendingDelete === null ? null : (
        <div
          className="dialog-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setPendingDelete(null);
            }
          }}
        >
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="layer-delete-title"
            aria-describedby="layer-delete-note"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setPendingDelete(null);
              }
            }}
          >
            <h2 className="dialog__title" id="layer-delete-title">
              {pendingDelete.prompt.title}
            </h2>
            <p className="dialog__note" id="layer-delete-note">
              {pendingDelete.prompt.body}
            </p>
            <div className="dialog__actions">
              <button
                type="button"
                className="button"
                ref={cancelDeleteButton}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button type="button" className="button button--primary" onClick={confirmDelete}>
                {pendingDelete.prompt.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
