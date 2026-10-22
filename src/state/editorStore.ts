/**
 * Editor store: the React-facing surface of the drawing engine.
 *
 * The engine owns all editor state; this module exposes it as a
 * `useSyncExternalStore`-compatible store plus a flat list of user intents.
 * Components never mutate engine state directly.
 */

import {
  DrawingEngine,
  type DrawingEngineOptions,
  type EditorSnapshot,
  type NewDocumentOptions,
} from "../core/engine/DrawingEngine";
import type { GradientStop, LayerBlendMode, LayerId } from "../core/document/types";
import { ProjectFiles } from "../core/project/projectFiles";
import type { ProjectFileGateway } from "../core/project/projectGateway";
import { createTauriProjectGateway } from "../core/project/tauriGateway";
import type { BrushPreset } from "../core/brushes/presets";
import type { BrushSettings } from "../types/brush";
import type { ToolId } from "../types/tool";
import type { FlipAxis } from "../types/transform";
import type { Listener } from "../utils/store";

export interface EditorActions {
  setTool(toolId: ToolId): void;
  setBrush(patch: Partial<BrushSettings>): void;
  /** Sets the colour a right-button gesture paints with. */
  setSecondaryColor(color: string): void;
  /** Exchanges the primary and secondary colours. */
  swapColors(): void;
  /** Saves the current brush under a name; `null` when the name is empty. */
  saveBrushPreset(name: string): BrushPreset | null;
  /** Renames a preset; `null` when the id is unknown or the name is empty. */
  renameBrushPreset(id: string, name: string): BrushPreset | null;
  /** Duplicates a preset; `null` when the id is unknown. */
  duplicateBrushPreset(id: string): BrushPreset | null;
  /** Deletes a preset. Editor state only: no history entry, no dirty flag. */
  deleteBrushPreset(id: string): boolean;
  /** Applies a preset through the normal brush setter. */
  applyBrushPreset(id: string): boolean;
  /** Whether the shape tools fill their outline instead of tracing it. */
  setShapeFill(filled: boolean): void;
  /** Sides of the next polygon, and points of the next star (3-24). */
  setShapeSides(sides: number): void;
  /** Inner radius of the next star, as a fraction of its outer radius. */
  setShapeInnerRatio(ratio: number): void;
  /** Rotation of the next polygon or star, in degrees (0-360). */
  setShapeRotation(degrees: number): void;
  /** Bucket-fill colour tolerance in 8-bit sRGB channel units (0-255). */
  setFillTolerance(tolerance: number): void;
  /** Chooses linear or radial for the next gradient drag. */
  setGradientType(type: "linear" | "radial"): void;
  /** Sets the end colour of the next gradient. */
  setGradientEndColor(color: string): void;
  /** Sets the middle stops of the next gradient; endpoints stay the colours above. */
  setGradientMidStops(stops: readonly GradientStop[]): void;
  /** Shows or hides the grid; display state, never exported. */
  setGridVisible(visible: boolean): void;
  /** Distance between grid lines in document pixels (`2..500`). */
  setGridSpacing(spacing: number): void;
  /** Turns snapping to guides and grid lines on or off. */
  setGridSnapping(snap: boolean): void;
  /** Clears a status-bar notice raised by an editor action. */
  dismissNotice(): void;
  undo(): void;
  redo(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomTo(zoom: number): void;
  zoomToFit(): void;
  newDocument(options: NewDocumentOptions): void;
  addLayer(): void;
  duplicateLayer(layerId: LayerId): void;
  removeLayer(layerId: LayerId): void;
  renameLayer(layerId: LayerId, name: string): void;
  toggleLayerVisibility(layerId: LayerId): void;
  setLayerOpacity(layerId: LayerId, opacity: number): void;
  setLayerBlendMode(layerId: LayerId, blendMode: LayerBlendMode): void;
  moveLayer(layerId: LayerId, delta: number): void;
  /**
   * Locks a layer, or takes the lock off.
   *
   * A locked layer keeps its pixels and its place in the stack: nothing may be
   * painted on it, its strokes may not be moved, turned or deleted, and it
   * cannot be reordered or deleted.
   */
  setLayerLocked(layerId: LayerId, locked: boolean): void;
  /** Locks a layer that is unlocked, and unlocks one that is locked. */
  toggleLayerLock(layerId: LayerId): void;
  /**
   * Creates a layer group and returns its id, or `null` when it could not be
   * made.
   *
   * A group is a folder: it holds layers and other groups and has no pixels
   * of its own, so the layers it holds are drawn exactly as they were.
   */
  createLayerGroup(parentId?: string | null, name?: string): string | null;
  /** Renames a layer group. */
  renameLayerGroup(groupId: string, name: string): void;
  /** Folds a group away or opens it again. Display-only. */
  setLayerGroupCollapsed(groupId: string, collapsed: boolean): void;
  /** Moves a group among its siblings. */
  moveLayerGroup(groupId: string, delta: number): void;
  /** Removes a group and keeps the layers that were in it. */
  removeLayerGroup(groupId: string): void;
  /** Moves a layer into a group, or back out to the top level with `null`. */
  moveLayerToGroup(layerId: LayerId, groupId: string | null): void;
  selectLayer(layerId: LayerId): void;
  clearSelection(): void;
  deleteSelection(): void;
  /** Removes the guide the guides tool has selected, as one undoable step. */
  deleteSelectedGuide(): void;
  /** Cancels the guide gesture in flight and clears the guide selection. */
  cancelGuideGesture(): void;
  /** Moves the selection by a fixed delta; repeated calls coalesce into one step. */
  nudgeSelection(dx: number, dy: number): void;
  /** Copies the selected strokes above the originals and selects the copies. */
  duplicateSelection(): void;
  /** Reflects the selected strokes about their own centre line. */
  flipSelection(axis: FlipAxis): void;
  /**
   * Scales the selected strokes about the centre of their frame.
   *
   * The factor is relative: 1.5 makes the selection one and a half times as
   * large, and applying it again makes it two and a quarter times as large.
   */
  scaleSelection(factor: number): void;
  /**
   * Turns the selected strokes about the centre of their frame.
   *
   * A positive angle turns the content clockwise, because the document's y
   * axis points down.
   */
  rotateSelection(degrees: number): void;
}

export interface Editor {
  readonly engine: DrawingEngine;
  readonly actions: EditorActions;
  /**
   * Open/save/export. Separate from `actions` because file operations are
   * asynchronous and report an outcome instead of returning nothing.
   */
  readonly files: ProjectFiles;
  getState(): EditorSnapshot;
  subscribe(listener: Listener): () => void;
}

export interface EditorOptions extends DrawingEngineOptions {
  /** Overrides native file access; used by tests and the browser preview. */
  readonly fileGateway?: ProjectFileGateway;
}

export function createEditor(options: EditorOptions = {}): Editor {
  const engine = new DrawingEngine(options);
  const files = new ProjectFiles(engine, options.fileGateway ?? createTauriProjectGateway());

  const actions: EditorActions = {
    setTool: (toolId) => engine.setTool(toolId),
    setBrush: (patch) => engine.setBrush(patch),
    setSecondaryColor: (color) => engine.setSecondaryColor(color),
    swapColors: () => engine.swapColors(),
    saveBrushPreset: (name) => engine.saveBrushPreset(name),
    renameBrushPreset: (id, name) => engine.renameBrushPreset(id, name),
    duplicateBrushPreset: (id) => engine.duplicateBrushPreset(id),
    deleteBrushPreset: (id) => engine.deleteBrushPreset(id),
    applyBrushPreset: (id) => engine.applyBrushPreset(id),
    setShapeFill: (filled) => engine.setShapeFill(filled),
    setShapeSides: (sides) => engine.setShapeSides(sides),
    setShapeInnerRatio: (ratio) => engine.setShapeInnerRatio(ratio),
    setShapeRotation: (degrees) => engine.setShapeRotation(degrees),
    setFillTolerance: (tolerance) => engine.setFillTolerance(tolerance),
    setGradientType: (type) => engine.setGradientType(type),
    setGradientEndColor: (color) => engine.setGradientEndColor(color),
    setGradientMidStops: (stops) => engine.setGradientMidStops(stops),
    setGridVisible: (visible) => engine.setGridVisible(visible),
    setGridSpacing: (spacing) => engine.setGridSpacing(spacing),
    setGridSnapping: (snap) => engine.setGridSnapping(snap),
    dismissNotice: () => engine.dismissNotice(),
    undo: () => {
      engine.undo();
    },
    redo: () => {
      engine.redo();
    },
    zoomIn: () => engine.zoomIn(),
    zoomOut: () => engine.zoomOut(),
    zoomTo: (zoom) => engine.zoomTo(zoom),
    zoomToFit: () => engine.zoomToFit(),
    newDocument: (documentOptions) => engine.newDocument(documentOptions),
    addLayer: () => engine.addLayer(),
    duplicateLayer: (layerId) => engine.duplicateLayer(layerId),
    removeLayer: (layerId) => engine.removeLayer(layerId),
    renameLayer: (layerId, name) => engine.renameLayer(layerId, name),
    toggleLayerVisibility: (layerId) => engine.toggleLayerVisibility(layerId),
    setLayerOpacity: (layerId, opacity) => engine.setLayerOpacity(layerId, opacity),
    setLayerBlendMode: (layerId, blendMode) => engine.setLayerBlendMode(layerId, blendMode),
    moveLayer: (layerId, delta) => engine.moveLayer(layerId, delta),
    setLayerLocked: (layerId, locked) => engine.setLayerLocked(layerId, locked),
    toggleLayerLock: (layerId) => engine.toggleLayerLock(layerId),
    createLayerGroup: (parentId, name) => engine.createLayerGroup(parentId, name),
    renameLayerGroup: (groupId, name) => engine.renameLayerGroup(groupId, name),
    setLayerGroupCollapsed: (groupId, collapsed) =>
      engine.setLayerGroupCollapsed(groupId, collapsed),
    moveLayerGroup: (groupId, delta) => engine.moveLayerGroup(groupId, delta),
    removeLayerGroup: (groupId) => engine.removeLayerGroup(groupId),
    moveLayerToGroup: (layerId, groupId) => engine.moveLayerToGroup(layerId, groupId),
    selectLayer: (layerId) => engine.selectLayer(layerId),
    clearSelection: () => engine.clearSelection(),
    deleteSelection: () => {
      engine.deleteSelection();
    },
    deleteSelectedGuide: () => {
      engine.deleteSelectedGuide();
    },
    cancelGuideGesture: () => {
      engine.cancelGuideGesture();
      engine.selectGuide(null);
    },
    nudgeSelection: (dx, dy) => {
      engine.nudgeSelection(dx, dy);
    },
    duplicateSelection: () => {
      engine.duplicateSelection();
    },
    flipSelection: (axis) => {
      engine.flipSelection(axis);
    },
    scaleSelection: (factor) => {
      engine.scaleSelection(factor);
    },
    rotateSelection: (degrees) => {
      engine.rotateSelection(degrees);
    },
  };

  return {
    engine,
    actions,
    files,
    getState: () => engine.getState(),
    subscribe: (listener) => engine.subscribe(listener),
  };
}
