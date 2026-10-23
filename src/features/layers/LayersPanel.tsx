/**
 * Layers panel.
 *
 * Layer metadata lives in the document model; this panel only issues intents.
 * The list is a **tree**, shown top-first (top of the stack at the top) and
 * indented by depth, matching how the canvas composites. A group row carries a
 * folder mark, a child count and a chevron; its children follow it until the
 * group is collapsed.
 *
 * The panel owns four pieces of *view* state - the row being dragged, the row
 * being renamed, the row the keyboard is on and which groups are collapsed -
 * and nothing else. Collapsing is deliberately not document data: it never
 * dirties a file and never reaches the project format. Every change to the
 * drawing goes through an engine command, so it is undoable, and a group can
 * never lose its children by accident: a non-empty group is confirmed with the
 * number of layers inside it.
 *
 * The rules the panel follows live in pure modules, because the React layer has
 * no automated tests: `layerTreeDrag.ts` (where a drop lands),
 * `layerDeletion.ts` (when a deletion has to be confirmed) and
 * `layerKeyboard.ts` (what a key press means). This file is the shell over
 * them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import {
  canDeleteNode,
  groupDeletionPrompt,
  layerDeletionPrompt,
  type LayerDeletionPrompt,
} from "../../core/document/layerDeletion";
import {
  findLayer,
  findLayerPath,
  isAncestor,
  layerLocation,
  layerTreeRows,
  paintableLayers,
} from "../../core/document/layerGroups";
import { layerPanelAction } from "../../core/document/layerKeyboard";
import {
  layerDropPosition,
  movableParentGroups,
  resolveLayerDrop,
  type LayerDropPosition,
} from "../../core/document/layerTreeDrag";
import { nextRowIndex } from "../../core/document/layerOrdering";
import { isTextEntryTarget, type TextEntryTargetLike } from "../../core/actions/keyboard";
import type { Layer, LayerBlendMode, LayerId } from "../../core/document/types";
import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconFolderPlus,
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
  /**
   * The row that keeps the keyboard when the deleted row takes the focus with
   * it: the row below it, or the one above when it was the last.
   */
  readonly focusAfter: LayerId | null;
}

/** Where a drag in flight would land, for the marker and the highlight. */
interface DropTarget {
  readonly layerId: LayerId;
  readonly position: LayerDropPosition;
}

export function LayersPanel() {
  const { actions, engine } = useEditor();
  const { document: drawingDocument } = useEditorState();
  const layers = drawingDocument.layers;

  /** The groups whose children are hidden in the panel. View state only. */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<LayerId>>(
    () => new Set(),
  );
  /** The row being dragged, and the row a drop would land on. */
  const [dragLayerId, setDragLayerId] = useState<LayerId | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  /** The row being renamed, and the name being typed. */
  const [renamingLayerId, setRenamingLayerId] = useState<LayerId | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  /** The row the keyboard is on. Focus is not the same as the active layer. */
  const [focusedLayerId, setFocusedLayerId] = useState<LayerId | null>(null);
  /** A deletion waiting for the user's answer. */
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const nameButtons = useRef(new Map<LayerId, HTMLButtonElement>());
  const cancelDeleteButton = useRef<HTMLButtonElement | null>(null);
  const confirmDeleteButton = useRef<HTMLButtonElement | null>(null);
  /** The element that had the focus before the question was asked. */
  const focusBeforeDialog = useRef<HTMLElement | null>(null);
  /** Guards the rename against a second commit (Enter *and* the blur). */
  const renameCommitted = useRef(false);

  const rows = useMemo(
    () =>
      layerTreeRows(layers, drawingDocument.activeLayerId, {
        topFirst: true,
        collapsed: collapsedGroups,
      }),
    [layers, drawingDocument.activeLayerId, collapsedGroups],
  );

  const activeLayer =
    drawingDocument.activeLayerId === null
      ? undefined
      : findLayer(layers, drawingDocument.activeLayerId);
  const activeLocation =
    activeLayer === undefined ? undefined : layerLocation(layers, activeLayer.id);
  const activeParent =
    activeLocation?.parentId === null || activeLocation === undefined
      ? undefined
      : findLayer(layers, activeLocation.parentId);
  const activeSiblings = activeParent ? activeParent.children : layers;

  const canDelete = activeLayer !== undefined && canDeleteNode(drawingDocument, activeLayer.id);
  const canMoveUp =
    activeLocation !== undefined && activeLocation.index < activeSiblings.length - 1;
  const canMoveDown = activeLocation !== undefined && activeLocation.index > 0;

  const parentGroups = useMemo(
    () => (activeLayer === undefined ? [] : movableParentGroups(layers, activeLayer.id)),
    [activeLayer, layers],
  );

  /** The element count a row shows: a group counts everything it holds. */
  const countElements = useCallback(
    (layer: Layer): number =>
      paintableLayers([layer]).reduce(
        (total, paintable) => total + engine.listElements(paintable.id).length,
        0,
      ),
    [engine],
  );

  /** True when an ancestor group is hidden, so this row cannot composite. */
  const hasHiddenAncestor = useCallback(
    (layerId: LayerId): boolean => {
      const path = findLayerPath(layers, layerId);
      return path?.slice(0, -1).some((ancestor) => !ancestor.visible) ?? false;
    },
    [layers],
  );

  /** Forgets the drag, whether it ended in a drop or was cancelled. */
  const clearDrag = useCallback(() => {
    setDragLayerId(null);
    setDropTarget(null);
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

  /** Expands every group above `layerId`, so a newly created row is visible. */
  const revealLayer = useCallback(
    (layerId: LayerId) => {
      // Read the live document: a node created by the engine a moment ago is
      // not in this render's `layers` closure yet.
      const path = findLayerPath(engine.getState().document.layers, layerId);
      if (!path || path.length < 2) {
        return;
      }
      const ancestors = new Set(path.slice(0, -1).map((node) => node.id));
      setCollapsedGroups((previous) => {
        if (![...ancestors].some((id) => previous.has(id))) {
          return previous;
        }
        const next = new Set(previous);
        for (const id of ancestors) {
          next.delete(id);
        }
        return next;
      });
    },
    [engine],
  );

  // --------------------------------------------------------------- renaming

  const startRename = useCallback((layer: Layer) => {
    renameCommitted.current = false;
    setFocusedLayerId(layer.id);
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
    const layer = findLayer(layers, layerId);
    if (layer && trimmed !== "" && trimmed !== layer.name) {
      if (layer.kind === "group") {
        actions.renameGroup(layerId, trimmed);
      } else {
        actions.renameLayer(layerId, trimmed);
      }
    }
  }, [actions, layers, renameDraft, renamingLayerId]);

  const cancelRename = useCallback(() => {
    renameCommitted.current = true;
    setRenamingLayerId(null);
    setRenameDraft("");
  }, []);

  // -------------------------------------------------------------- creating

  /**
   * Creates an empty group directly above the active node, at the same level,
   * then starts renaming it.
   *
   * Starting the rename is the second half of the action: a row called
   * "Group 1" is not yet a meaningful container, and making the name editable
   * immediately is the difference between a control that works and a row the
   * artist has to discover how to change.
   */
  const createGroup = useCallback(() => {
    const groupId = actions.createGroup();
    if (groupId === null) {
      return;
    }
    const created = findLayer(engine.getState().document.layers, groupId);
    if (!created) {
      return;
    }
    revealLayer(groupId);
    setFocusedLayerId(groupId);
    startRename(created);
  }, [actions, engine, revealLayer, startRename]);

  const toggleExpanded = useCallback(
    (layer: Layer) => {
      const collapsed = collapsedGroups.has(layer.id);
      if (!collapsed && focusedLayerId !== null && isAncestor(layers, layer.id, focusedLayerId)) {
        // The focused child is about to disappear; the group keeps the focus.
        setFocusedLayerId(layer.id);
      }
      setCollapsedGroups((previous) => {
        const next = new Set(previous);
        if (next.has(layer.id)) {
          next.delete(layer.id);
        } else {
          next.add(layer.id);
        }
        return next;
      });
    },
    [collapsedGroups, focusedLayerId, layers],
  );

  // -------------------------------------------------------------- deleting

  /**
   * Deletes a node, asking first when it holds content.
   *
   * A layer is judged by its own elements. A group is judged by the paintable
   * layers inside it: deleting a group removes every drawing in the subtree,
   * so the question names the number of layers that go with the container. An
   * empty group is removed without a question - there is nothing to lose.
   *
   * The last paintable layer is never deleted. The rule is checked before the
   * question, so the panel never asks about a deletion the document model
   * would refuse.
   */
  const requestDelete = useCallback(
    (layer: Layer) => {
      if (!canDeleteNode(drawingDocument, layer.id)) {
        return;
      }
      // The row that keeps the keyboard when the deleted row goes: the one
      // below it, or the one above when the deleted row was the last.
      const index = rows.findIndex((row) => row.layer.id === layer.id);
      const focusAfter = rows[index + 1]?.layer.id ?? rows[index - 1]?.layer.id ?? null;
      const count =
        layer.kind === "group"
          ? paintableLayers([layer]).length
          : engine.listElements(layer.id).length;
      const prompt =
        layer.kind === "group"
          ? groupDeletionPrompt(layer.name, count)
          : layerDeletionPrompt(layer.name, count);
      if (prompt === null) {
        // Nothing inside the container and nothing on the layer: the row goes
        // without a question, and the focus moves with it right away.
        actions.removeLayer(layer.id);
        if (focusAfter !== null) {
          setFocusedLayerId(focusAfter);
          focusRow(focusAfter);
        }
        return;
      }
      focusBeforeDialog.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingDelete({ layerId: layer.id, prompt, focusAfter });
    },
    [actions, drawingDocument, engine, focusRow, rows],
  );

  /** Closes the question and gives the keyboard back where it was. */
  const closeDelete = useCallback(() => {
    setPendingDelete(null);
    const previous = focusBeforeDialog.current;
    focusBeforeDialog.current = null;
    previous?.focus?.();
  }, []);

  const confirmDelete = useCallback(() => {
    if (pendingDelete !== null) {
      actions.removeLayer(pendingDelete.layerId);
      if (pendingDelete.focusAfter !== null) {
        // The deleted row takes the focus with it, so the next row keeps it:
        // the panel stays drivable without another click.
        setFocusedLayerId(pendingDelete.focusAfter);
        focusRow(pendingDelete.focusAfter);
      }
    }
    focusBeforeDialog.current = null;
    setPendingDelete(null);
  }, [actions, focusRow, pendingDelete]);

  // The dialog takes the focus when it opens, so the keyboard is in the
  // dialog rather than in the list behind it.
  useEffect(() => {
    if (pendingDelete !== null) {
      cancelDeleteButton.current?.focus();
    }
  }, [pendingDelete]);

  // A row can disappear under the focus (a collapse, an undo, a move into a
  // collapsed group). The active row is the fallback, so the keyboard is never
  // left on a row that no longer exists.
  useEffect(() => {
    if (
      focusedLayerId !== null &&
      !rows.some((row) => row.layer.id === focusedLayerId)
    ) {
      setFocusedLayerId(rows.find((row) => row.active)?.layer.id ?? null);
    }
  }, [focusedLayerId, rows]);

  // -------------------------------------------------------------- reordering

  const handleDragStart = useCallback(
    (layerId: LayerId) => (event: DragEvent<HTMLElement>) => {
      setDragLayerId(layerId);
      setDropTarget(null);
      event.dataTransfer.effectAllowed = "move";
      // Firefox refuses to start a drag with an empty data store.
      event.dataTransfer.setData("text/plain", layerId);
    },
    [],
  );

  const handleDragOver = useCallback(
    (layer: Layer) => (event: DragEvent<HTMLElement>) => {
      if (dragLayerId === null) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const position = layerDropPosition(
        event.clientY,
        rect.top,
        rect.height,
        layer.kind === "group",
      );
      const target = resolveLayerDrop(layers, dragLayerId, layer.id, position);
      if (!target || !target.changes) {
        setDropTarget(null);
        return;
      }
      // The drop is only allowed when it would actually move the node.
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDropTarget({ layerId: layer.id, position });
    },
    [dragLayerId, layers],
  );

  const handleDrop = useCallback(
    (layer: Layer) => (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const draggedId = dragLayerId;
      if (draggedId === null) {
        clearDrag();
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const position = layerDropPosition(
        event.clientY,
        rect.top,
        rect.height,
        layer.kind === "group",
      );
      const target = resolveLayerDrop(layers, draggedId, layer.id, position);
      clearDrag();
      if (!target || !target.changes) {
        // The row is exactly where it already is: no move, no history step.
        return;
      }
      if (position === "into") {
        // A drop into a collapsed group shows the result, rather than putting
        // the layer somewhere the artist cannot see.
        setCollapsedGroups((previous) => {
          if (!previous.has(layer.id)) {
            return previous;
          }
          const next = new Set(previous);
          next.delete(layer.id);
          return next;
        });
      }
      actions.moveLayerToParent(draggedId, target.parentId, target.index);
      setFocusedLayerId(draggedId);
    },
    [actions, clearDrag, dragLayerId, layers],
  );

  // --------------------------------------------------------------- keyboard

  const handleListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      // While a row is being renamed the input owns the keyboard.
      if (renamingLayerId !== null) {
        return;
      }
      // The rules live in a pure module, so they can be tested without a DOM.
      const action = layerPanelAction({
        key: event.key,
        mod: event.ctrlKey || event.metaKey,
        // A field owns its own keys: Backspace in the opacity field has to
        // clear the number, not ask the engine to delete the layer.
        textEntry: isTextEntryTarget(event.target as TextEntryTargetLike | null),
        dragging: dragLayerId !== null,
      });
      if (action === null) {
        return;
      }
      // The panel owns these keys while it has the focus: the global nudge
      // must not fire at the same time.
      event.preventDefault();
      event.stopPropagation();

      const focusedIndex =
        focusedLayerId === null
          ? -1
          : rows.findIndex((row) => row.layer.id === focusedLayerId);
      const focusedRow = focusedIndex >= 0 ? rows[focusedIndex] : undefined;

      switch (action.kind) {
        case "focus": {
          const next = nextRowIndex(focusedIndex, action.offset, rows.length);
          if (next !== null) {
            focusRow(rows[next].layer.id);
          }
          return;
        }
        case "focusEdge": {
          const row = action.edge === "first" ? rows[0] : rows[rows.length - 1];
          if (row !== undefined) {
            focusRow(row.layer.id);
          }
          return;
        }
        case "rename": {
          if (focusedRow !== undefined) {
            startRename(focusedRow.layer);
          }
          return;
        }
        case "delete": {
          if (focusedRow !== undefined) {
            requestDelete(focusedRow.layer);
          }
          return;
        }
        case "move": {
          if (focusedRow !== undefined) {
            actions.moveLayer(focusedRow.layer.id, action.delta);
          }
          return;
        }
        case "collapse": {
          if (focusedRow === undefined) {
            return;
          }
          if (focusedRow.isGroup && !collapsedGroups.has(focusedRow.layer.id)) {
            toggleExpanded(focusedRow.layer);
            return;
          }
          if (focusedRow.parentId !== null) {
            focusRow(focusedRow.parentId);
          }
          return;
        }
        case "expand": {
          if (focusedRow === undefined) {
            return;
          }
          if (focusedRow.isGroup) {
            if (collapsedGroups.has(focusedRow.layer.id)) {
              toggleExpanded(focusedRow.layer);
              return;
            }
            const child = rows[focusedIndex + 1];
            if (child !== undefined && child.parentId === focusedRow.layer.id) {
              focusRow(child.layer.id);
            }
          }
          return;
        }
        case "cancelDrag": {
          // Cancels a drag in flight. The browser cancels the drag itself, and
          // the marker goes with it.
          clearDrag();
          return;
        }
      }
    },
    [
      actions,
      clearDrag,
      collapsedGroups,
      dragLayerId,
      focusRow,
      focusedLayerId,
      renamingLayerId,
      requestDelete,
      rows,
      startRename,
      toggleExpanded,
    ],
  );

  const parentValue = activeLocation?.parentId ?? "";

  return (
    <Panel
      title="Layers"
      actions={
        <>
          <IconButton label="Add layer" size="sm" onClick={actions.addLayer}>
            <IconPlus />
          </IconButton>
          <IconButton label="New group" size="sm" onClick={createGroup}>
            <IconFolderPlus />
          </IconButton>
          <IconButton
            label="Duplicate layer"
            size="sm"
            disabled={!activeLayer || activeLayer.kind === "group"}
            onClick={() => {
              if (activeLayer && activeLayer.kind !== "group") {
                actions.duplicateLayer(activeLayer.id);
              }
            }}
          >
            <IconCopy />
          </IconButton>
          <IconButton
            label={activeLayer?.kind === "group" ? "Delete group" : "Delete layer"}
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
              <div className="layer-property-row">
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
                <label className="layer-parent">
                  <span className="layer-parent__label">Inside</span>
                  <select
                    className="layer-parent__select"
                    value={parentValue}
                    aria-label="Layer group"
                    onChange={(event) => {
                      const nextParent = event.target.value === "" ? null : event.target.value;
                      if (nextParent === (activeLocation?.parentId ?? null)) {
                        return;
                      }
                      const destination =
                        nextParent === null
                          ? layers
                          : (findLayer(layers, nextParent)?.children ?? []);
                      // The accessible counterpart of a drop: it lands at the top
                      // of the chosen container, which is predictable and one
                      // command.
                      actions.moveLayerToParent(activeLayer.id, nextParent, destination.length);
                      if (nextParent !== null) {
                        // The row just moved into a container that may be
                        // collapsed; showing it is the point of the move.
                        setCollapsedGroups((previous) => {
                          if (!previous.has(nextParent)) {
                            return previous;
                          }
                          const next = new Set(previous);
                          next.delete(nextParent);
                          return next;
                        });
                      }
                    }}
                  >
                    <option value="">Root</option>
                    {parentGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <SliderField
                label="Opacity"
                min={0}
                max={1}
                step={0.01}
                value={activeLayer.opacity}
                format={(value) => `${Math.round(value * 100)}%`}
                onChange={(opacity) => actions.setLayerOpacity(activeLayer.id, opacity)}
              />
              {activeLayer.kind === "group" || activeParent !== undefined ? (
                <div className="layer-context-actions">
                  {activeLayer.kind === "group" ? (
                    <button
                      type="button"
                      className="layer-context-button"
                      onClick={() => actions.dissolveGroup(activeLayer.id)}
                    >
                      Ungroup
                    </button>
                  ) : null}
                  {activeParent !== undefined && activeLocation !== undefined ? (
                    <button
                      type="button"
                      className="layer-context-button"
                      onClick={() => {
                        const groupLocation = layerLocation(layers, activeParent.id);
                        actions.moveLayerToParent(
                          activeLayer.id,
                          groupLocation?.parentId ?? null,
                          (groupLocation?.index ?? 0) + 1,
                        );
                      }}
                    >
                      Move out of group
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="layer-properties__hint">Select a layer to change its blend and opacity.</p>
          )}
          {activeLayer?.kind === "group" ? (
            <p className="layer-hint">
              Group selected. It holds layers; choose one to draw. Ungroup removes the container
              and keeps its layers.
            </p>
          ) : (
            <p className="layer-hint">
              Up/Down focus · Left/Right group · F2 rename · Delete removes
            </p>
          )}
        </>
      }
    >
      {layers.length === 0 ? (
        <p className="layer-empty">
          This document has no layers yet. Add one to start drawing.
        </p>
      ) : (
        <ul className="layer-list" aria-label="Layers" onKeyDown={handleListKeyDown}>
          {rows.map((row) => {
            const collapsed = collapsedGroups.has(row.layer.id);
            return (
              <LayerRow
                key={row.layer.id}
                layer={row.layer}
                depth={row.depth}
                active={row.active}
                focused={row.layer.id === focusedLayerId}
                dragging={row.layer.id === dragLayerId}
                renaming={row.layer.id === renamingLayerId}
                draft={renameDraft}
                isGroup={row.isGroup}
                collapsed={collapsed}
                childCount={row.layer.children.length}
                elementCount={countElements(row.layer)}
                inheritedHidden={hasHiddenAncestor(row.layer.id)}
                dropPosition={
                  dropTarget?.layerId === row.layer.id ? dropTarget.position : null
                }
                onSelect={() => actions.selectLayer(row.layer.id)}
                onToggleVisibility={() => actions.toggleLayerVisibility(row.layer.id)}
                onToggleExpanded={() => toggleExpanded(row.layer)}
                onFocus={() => setFocusedLayerId(row.layer.id)}
                onBlur={(event) => {
                  // The focus may move to another control in the same row; the
                  // row is only left when the focus leaves it entirely.
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setFocusedLayerId(null);
                  }
                }}
                onStartRename={() => startRename(row.layer)}
                onDraftChange={setRenameDraft}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
                onOpacityChange={(opacity) => actions.setLayerOpacity(row.layer.id, opacity)}
                onDragStart={handleDragStart(row.layer.id)}
                onDragEnd={clearDrag}
                onDragOver={handleDragOver(row.layer)}
                onDrop={handleDrop(row.layer)}
                registerNameButton={registerNameButton(row.layer.id)}
              />
            );
          })}
        </ul>
      )}
      {pendingDelete === null ? null : (
        <div
          className="dialog-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDelete();
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
                closeDelete();
                return;
              }
              if (event.key === "Tab") {
                // The question is modal: the focus stays inside it, so the
                // keyboard cannot reach the panel behind the dialog.
                event.preventDefault();
                if (document.activeElement === cancelDeleteButton.current) {
                  confirmDeleteButton.current?.focus();
                } else {
                  cancelDeleteButton.current?.focus();
                }
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
                onClick={closeDelete}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button--primary"
                ref={confirmDeleteButton}
                onClick={confirmDelete}
              >
                {pendingDelete.prompt.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
