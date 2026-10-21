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
import type { LayerBlendMode, LayerId } from "../core/document/types";
import { ProjectFiles } from "../core/project/projectFiles";
import type { ProjectFileGateway } from "../core/project/projectGateway";
import { createTauriProjectGateway } from "../core/project/tauriGateway";
import type { BrushSettings } from "../types/brush";
import type { ToolId } from "../types/tool";
import type { FlipAxis } from "../types/transform";
import type { Listener } from "../utils/store";

export interface EditorActions {
  setTool(toolId: ToolId): void;
  setBrush(patch: Partial<BrushSettings>): void;
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
  deleteSelection(): void;
  /** Moves the selection by a fixed delta; repeated calls coalesce into one step. */
  nudgeSelection(dx: number, dy: number): void;
  /** Copies the selected strokes above the originals and selects the copies. */
  duplicateSelection(): void;
  /** Reflects the selected strokes about their own centre line. */
  flipSelection(axis: FlipAxis): void;
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
    setShapeFill: (filled) => engine.setShapeFill(filled),
    setShapeSides: (sides) => engine.setShapeSides(sides),
    setShapeInnerRatio: (ratio) => engine.setShapeInnerRatio(ratio),
    setShapeRotation: (degrees) => engine.setShapeRotation(degrees),
    setFillTolerance: (tolerance) => engine.setFillTolerance(tolerance),
    setGradientType: (type) => engine.setGradientType(type),
    setGradientEndColor: (color) => engine.setGradientEndColor(color),
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
    deleteSelection: () => {
      engine.deleteSelection();
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
  };

  return {
    engine,
    actions,
    files,
    getState: () => engine.getState(),
    subscribe: (listener) => engine.subscribe(listener),
  };
}
