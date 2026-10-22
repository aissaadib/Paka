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
import type { SymmetryMode } from "../core/document/symmetry";
import type { Point } from "../types/geometry";
import type { FillReferenceMode } from "../core/fill/fillOptions";
import { PresetLibraryFiles } from "../core/brushes/presetLibraryFiles";
import { ReferenceImageStore } from "../core/reference/store";
import { DocumentSessionRegistry } from "../core/documents/sessionRegistry";
import { DocumentWorkspace } from "../core/documents/documentWorkspace";
import { RecentFilesStore } from "../core/documents/recentFiles";
import type { ProjectFileGateway } from "../core/project/projectGateway";
import { createTauriProjectGateway } from "../core/project/tauriGateway";
import type { BrushPreset } from "../core/brushes/presets";
import type { BrushSettings } from "../types/brush";
import type { ToolId } from "../types/tool";
import type { FlipAxis } from "../types/transform";
import type { ViewId } from "../types/viewport";
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
  /** Stores the live brush in a preset; `null` when the id is unknown. */
  updateBrushPreset(id: string): BrushPreset | null;
  /** Deletes a preset. Editor state only: no history entry, no dirty flag. */
  deleteBrushPreset(id: string): boolean;
  /** Applies a preset through the normal brush setter. */
  applyBrushPreset(id: string): boolean;
  /** Stars or unstars a preset; `false` when the id is unknown. */
  toggleBrushPresetFavorite(id: string): boolean;
  /** Adds presets to the library; the number that were added. */
  importBrushPresets(entries: readonly BrushPreset[]): number;
  /** Says which preset the live brush is based on; `null` for a custom brush. */
  setActivePreset(id: string | null): void;
  /** Restores the brush to the values of the preset it came from. */
  resetBrush(): void;
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
  /** Sets what the bucket measures its region against. */
  setFillReference(reference: FillReferenceMode): void;
  /** Sets the layer the bucket samples in the `layer` reference mode. */
  setFillReferenceLayer(layerId: LayerId | null): void;
  /** Sets how far the bucket grows (positive) or shrinks (negative) a region. */
  setFillExpand(expand: number): void;
  /** Sets how wide the bucket's soft edge is, in document pixels. */
  setFillAntialias(antialias: number): void;
  /** Sets how wide a passage the bucket seals, in document pixels. */
  setFillCloseGaps(closeGaps: number): void;
  /** Chooses linear or radial for the next gradient drag. */
  setGradientType(type: "linear" | "radial"): void;
  /** Sets the end colour of the next gradient. */
  setGradientEndColor(color: string): void;
  /** Sets the middle stops of the next gradient; endpoints stay the colours above. */
  setGradientMidStops(stops: readonly GradientStop[]): void;
  /** Moves the selected gradient's focused handle by a fixed delta. */
  nudgeGradientHandle(dx: number, dy: number): void;
  /** Moves the selected gradient's focused handle to an absolute position. */
  setGradientHandlePosition(x: number, y: number): void;
  /** Cancels the gradient gesture in flight and clears the selection. */
  cancelGradientGesture(): void;
  /** Shows or hides the grid; display state, never exported. */
  setGridVisible(visible: boolean): void;
  /** Distance between grid lines in document pixels (`2..500`). */
  setGridSpacing(spacing: number): void;
  /** Turns snapping to guides and grid lines on or off. */
  setGridSnapping(snap: boolean): void;
  /** Shows or hides the ruler strips; display state, never exported. */
  setRulersVisible(visible: boolean): void;
  /** Turns the symmetry on or off; it describes the next stroke. */
  setSymmetryEnabled(enabled: boolean): void;
  /** Chooses the symmetry the copies use. */
  setSymmetryMode(mode: SymmetryMode): void;
  /** Sets how many copies the radial symmetry draws (`2..12`). */
  setSymmetryCount(count: number): void;
  /** Moves the symmetry centre, in document pixels. */
  setSymmetryCenter(center: Point): void;
  /** Puts the symmetry centre back in the middle of the paper. */
  resetSymmetryCenter(): void;
  /** Clears a status-bar notice raised by an editor action. */
  dismissNotice(): void;
  undo(): void;
  redo(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomTo(zoom: number): void;
  zoomToFit(): void;
  /** Turns the view clockwise by `degrees`; view-only, never an edit. */
  rotateView(degrees: number): void;
  /** Mirrors the view left to right; view-only, never an edit. */
  toggleViewMirror(): void;
  /** Upright, unmirrored, 100 % and centred on the paper. */
  resetView(): void;
  /**
   * Moves the view so that a document point sits in the middle of the canvas.
   *
   * View state: no history entry, no dirty flag, the zoom does not change.
   */
  centerViewportOn(docX: number, docY: number): void;
  /** Moves the view so that the whole document sits in the middle of the canvas. */
  centerViewport(): void;
  /**
   * Opens or closes the second view of the canvas.
   *
   * The second view is another window on the *same* document: the artwork,
   * the history and the dirty flag are shared, and only the transform is the
   * second view's own. View-only: it never reaches a project file and never
   * makes the drawing unsaved.
   */
  toggleSecondaryView(): void;
  /** Closes the second view of the canvas. */
  closeSecondaryView(): void;
  /**
   * Makes a view the active one.
   *
   * The active view is the one the commands act on: the zoom, the fit and the
   * rotation turn the view the user is working in.
   */
  focusView(viewId: ViewId): void;
  /**
   * Fits one view to its own window, and makes it the active one.
   */
  fitView(viewId: ViewId): void;
  /**
   * Puts one view at 100 %, and makes it the active one.
   */
  actualSizeView(viewId: ViewId): void;
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
  /** Selects every stroke on the active layer. Not an edit: nothing enters history. */
  selectAll(): void;
  deleteSelection(): void;
  /** Removes the guide the guides tool has selected, as one undoable step. */
  deleteSelectedGuide(): void;
  /** Removes every guide, as one undoable step. */
  clearGuides(): void;
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
  /**
   * The engine of the **active** document.
   *
   * It changes when the user switches tab: every open document has an engine
   * of its own, and this is the one the canvas is showing.
   */
  readonly engine: DrawingEngine;
  /**
   * The open documents.
   *
   * The tab strip reads its state and switches between the sessions through
   * it. It is the one place that knows how many documents are open.
   */
  readonly sessions: DocumentSessionRegistry;
  /** The paths of the documents that were opened lately. */
  readonly recentFiles: RecentFilesStore;
  readonly actions: EditorActions;
  /**
   * Open/save/export. Separate from `actions` because file operations are
   * asynchronous and report an outcome instead of returning nothing.
   *
   * The workspace is session-aware: opening a file adds a tab instead of
   * replacing the drawing that is on screen.
   */
  readonly files: DocumentWorkspace;
  /**
   * Exporting and importing the brush library. Separate from `actions` for
   * the same reason: a file operation reports an outcome.
   */
  readonly presetLibrary: PresetLibraryFiles;
  /**
   * The reference images the artist keeps beside the canvas.
   *
   * Separate from the engine on purpose: a reference is not document state.
   * It never reaches a project file, never enters the history and never makes
   * a document dirty, so it has a store of its own rather than a place in the
   * editor's snapshot.
   */
  readonly references: ReferenceImageStore;
  getState(): EditorSnapshot;
  subscribe(listener: Listener): () => void;
}

export interface EditorOptions extends DrawingEngineOptions {
  /** Overrides native file access; used by tests and the browser preview. */
  readonly fileGateway?: ProjectFileGateway;
  /** Overrides the reference store; used by tests. */
  readonly referenceStore?: ReferenceImageStore;
  /** Overrides the recent-files list; used by tests. */
  readonly recentFilesStore?: RecentFilesStore;
}

export function createEditor(options: EditorOptions = {}): Editor {
  const references = options.referenceStore ?? new ReferenceImageStore();
  const recentFiles = options.recentFilesStore ?? new RecentFilesStore();
  const gateway = options.fileGateway ?? createTauriProjectGateway();
  const presetLibrary = new PresetLibraryFiles(gateway);

  // The preferences live in an engine of their own, so they have one stable
  // home while the active document changes underneath them. It is never a
  // document: nothing is ever drawn on it.
  const preferencesEngine = new DrawingEngine({
    ...options,
    document: undefined,
    renderer: undefined,
    referenceSource: references,
  });

  // One engine per open document. The first session inherits the editor's
  // initial document; the rest start empty and are filled by the file that is
  // opened into them.
  const sessions = new DocumentSessionRegistry({
    createEngine: (index) =>
      new DrawingEngine({
        ...options,
        document: index === 0 ? options.document : undefined,
        renderer: index === 0 ? options.renderer : undefined,
        referenceSource: references,
      }),
    preferencesEngine,
  });
  sessions.create();

  // The actions below talk to the active document's engine. The variable is
  // updated when the active session changes, so an action always reaches the
  // document the user is looking at.
  let engine = sessions.active.engine;
  sessions.subscribeActive(() => {
    engine = sessions.active.engine;
  });

  const files = new DocumentWorkspace(sessions, gateway, recentFiles);

  const actions: EditorActions = {
    setTool: (toolId) => engine.setTool(toolId),
    setBrush: (patch) => engine.setBrush(patch),
    setSecondaryColor: (color) => engine.setSecondaryColor(color),
    swapColors: () => engine.swapColors(),
    saveBrushPreset: (name) => engine.saveBrushPreset(name),
    renameBrushPreset: (id, name) => engine.renameBrushPreset(id, name),
    duplicateBrushPreset: (id) => engine.duplicateBrushPreset(id),
    updateBrushPreset: (id) => engine.updateBrushPreset(id),
    deleteBrushPreset: (id) => engine.deleteBrushPreset(id),
    applyBrushPreset: (id) => engine.applyBrushPreset(id),
    toggleBrushPresetFavorite: (id) => engine.toggleBrushPresetFavorite(id),
    importBrushPresets: (entries) => engine.importBrushPresets(entries),
    setActivePreset: (id) => engine.setActivePreset(id),
    resetBrush: () => engine.resetBrush(),
    setShapeFill: (filled) => engine.setShapeFill(filled),
    setShapeSides: (sides) => engine.setShapeSides(sides),
    setShapeInnerRatio: (ratio) => engine.setShapeInnerRatio(ratio),
    setShapeRotation: (degrees) => engine.setShapeRotation(degrees),
    setFillTolerance: (tolerance) => engine.setFillTolerance(tolerance),
    setFillReference: (reference) => engine.setFillReference(reference),
    setFillReferenceLayer: (layerId) => engine.setFillReferenceLayer(layerId),
    setFillExpand: (expand) => engine.setFillExpand(expand),
    setFillAntialias: (antialias) => engine.setFillAntialias(antialias),
    setFillCloseGaps: (closeGaps) => engine.setFillCloseGaps(closeGaps),
    setGradientType: (type) => engine.setGradientType(type),
    setGradientEndColor: (color) => engine.setGradientEndColor(color),
    setGradientMidStops: (stops) => engine.setGradientMidStops(stops),
    nudgeGradientHandle: (dx, dy) => {
      engine.nudgeGradientHandle(dx, dy);
    },
    setGradientHandlePosition: (x, y) => {
      engine.setGradientHandlePosition(x, y);
    },
    cancelGradientGesture: () => {
      engine.cancelGradientGesture();
    },
    setGridVisible: (visible) => engine.setGridVisible(visible),
    setGridSpacing: (spacing) => engine.setGridSpacing(spacing),
    setGridSnapping: (snap) => engine.setGridSnapping(snap),
    setRulersVisible: (visible) => engine.setRulersVisible(visible),
    setSymmetryEnabled: (enabled) => engine.setSymmetryEnabled(enabled),
    setSymmetryMode: (mode) => engine.setSymmetryMode(mode),
    setSymmetryCount: (count) => engine.setSymmetryCount(count),
    setSymmetryCenter: (center) => engine.setSymmetryCenter(center),
    resetSymmetryCenter: () => engine.resetSymmetryCenter(),
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
    rotateView: (degrees) => engine.rotateView(degrees),
    toggleViewMirror: () => engine.toggleViewMirror(),
    resetView: () => engine.resetView(),
    centerViewportOn: (docX, docY) => engine.centerViewportOn(docX, docY),
    centerViewport: () => engine.centerViewport(),
    toggleSecondaryView: () => engine.toggleSecondaryView(),
    closeSecondaryView: () => engine.closeSecondaryView(),
    focusView: (viewId) => engine.focusView(viewId),
    fitView: (viewId) => engine.fitView(viewId),
    actualSizeView: (viewId) => engine.actualSizeView(viewId),
    newDocument: (documentOptions) => files.newDocument(documentOptions),
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
    deleteSelection: () => {
      engine.deleteSelection();
    },
    deleteSelectedGuide: () => {
      engine.deleteSelectedGuide();
    },
    clearGuides: () => {
      engine.clearGuides();
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
    // The active document's engine. A getter, because the active document
    // changes when the user switches tab.
    get engine() {
      return sessions.active.engine;
    },
    sessions,
    recentFiles,
    actions,
    files,
    presetLibrary,
    references,
    getState: () => sessions.active.engine.getState(),
    subscribe: (listener) => sessions.subscribeActive(listener),
  };
}
