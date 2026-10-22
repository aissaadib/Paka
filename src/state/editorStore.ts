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
import type { SelectionShape } from "../core/document/selectionModes";
import type { SymmetryAxisKind, SymmetryMode } from "../core/document/symmetry";
import type { FillMode } from "../core/fill/fillOptions";
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
  /** Whether the next fill is contiguous or matches every pixel of the colour. */
  setFillMode(mode: FillMode): void;
  /** How coarsely the next fill samples the composite (1, 2, 4 or 8). */
  setFillSampleScale(scale: number): void;
  /** Chooses the mirror axes, or `"off"`. */
  setSymmetryMode(mode: SymmetryMode | "off"): void;
  /** Moves one mirror axis to a whole document pixel. */
  setSymmetryAxis(kind: SymmetryAxisKind, position: number): void;
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
  /** Shows or hides the canvas rulers; display state, never exported. */
  setRulersVisible(visible: boolean): void;
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
  selectLayer(layerId: LayerId): void;
  clearSelection(): void;
  /** Selects every stroke on the active layer; no history step. */
  selectAll(): void;
  /** Swaps the selection for the strokes that were not selected. */
  invertSelection(): void;
  /** Chooses the shape the next selection gesture traces. */
  setSelectionShape(shape: SelectionShape): void;
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
    setFillMode: (mode) => engine.setFillMode(mode),
    setFillSampleScale: (scale) => engine.setFillSampleScale(scale),
    setSymmetryMode: (mode) => engine.setSymmetryMode(mode),
    setSymmetryAxis: (kind, position) => engine.setSymmetryAxis(kind, position),
    setGradientType: (type) => engine.setGradientType(type),
    setGradientEndColor: (color) => engine.setGradientEndColor(color),
    setGradientMidStops: (stops) => engine.setGradientMidStops(stops),
    setGridVisible: (visible) => engine.setGridVisible(visible),
    setGridSpacing: (spacing) => engine.setGridSpacing(spacing),
    setGridSnapping: (snap) => engine.setGridSnapping(snap),
    setRulersVisible: (visible) => engine.setRulersVisible(visible),
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
    selectLayer: (layerId) => engine.selectLayer(layerId),
    clearSelection: () => engine.clearSelection(),
    selectAll: () => {
      engine.selectAll();
    },
    invertSelection: () => {
      engine.invertSelection();
    },
    setSelectionShape: (shape) => engine.setSelectionShape(shape),
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
