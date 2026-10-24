/**
 * The in-page half of the visual-regression harness.
 *
 * It renders a scene through the product's own renderer and reports whether
 * the three renderings of that scene agree:
 *
 *  - **live**     - the scene drawn through the live stroke path
 *                   (`beginStroke` / `extendStroke` / `render`);
 *  - **rebuilt**  - the same scene rasterized from the stored elements
 *                   (`invalidateLayer` / `render`);
 *  - **exported** - the document composite (`composeDocumentImage`), which is
 *                   what a PNG export writes.
 *
 * The agreement between them is the product's central invariant, and this is
 * the only place it can be checked with a real antialiased and blurred edge:
 * the repository's software pixel canvas has neither.
 *
 * The harness reaches the product through its renderer boundary. It does not
 * import a rasterization internal, and it does not depend on the app's
 * animation loop: every render is issued explicitly.
 */
import { Canvas2DRenderer } from "/src/core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "/src/core/rendering/frameScheduler";
import { createDocument } from "/src/core/document/document";
import { DEFAULT_BRUSH } from "/src/core/brushes/defaults";
import {
  createRotateTransform,
  createScaleTransform,
} from "/src/core/document/selectionTransform";
import { isStroke } from "/src/core/document/types";
import type {
  DrawingDocument,
  FillPatchRecord,
  GradientRecord,
  Layer,
  LayerElement,
  LayerId,
  StrokeRecord,
} from "/src/core/document/types";
import type { DrawingRenderer } from "/src/core/rendering/types";
import type { ReferenceImage } from "/src/core/reference/types";
import type { BrushSettings } from "/src/types/brush";
import { isSceneStroke } from "./scene";
import type {
  Scene,
  SceneElement,
  SceneGuide,
  SceneLayer,
  SceneReference,
  SceneTransform,
  SceneVerdict,
} from "./scene";

let elementCounter = 0;

/** The grid settings of a scene that shows no grid. */
const NO_GRID = { visible: false, spacing: 50, snap: false };

function nextId(prefix: string): string {
  elementCounter += 1;
  return `${prefix}-${elementCounter}`;
}

function toBrush(patch: Readonly<Record<string, unknown>> | undefined): BrushSettings {
  return { ...DEFAULT_BRUSH, ...(patch ?? {}) } as BrushSettings;
}

/**
 * Applies a scene's transform to a stroke's samples.
 *
 * The maps are the **product's own**, so the picture the golden pins is the
 * picture a transformed selection really draws. A scale and a rotation about
 * the same centre commute, so the order they are applied in does not matter.
 */
function applyTransform(
  xs: readonly number[],
  ys: readonly number[],
  transform: SceneTransform | undefined,
): { xs: number[]; ys: number[] } {
  if (!transform) {
    return { xs: [...xs], ys: [...ys] };
  }
  const centre = { x: transform.centerX, y: transform.centerY };
  let currentX = [...xs];
  let currentY = [...ys];

  if (transform.scale !== undefined) {
    const map = createScaleTransform(centre, transform.scale);
    const baseX = currentX;
    const baseY = currentY;
    currentX = baseX.map((x, index) => map.mapX(x, baseY[index]));
    currentY = baseY.map((y, index) => map.mapY(baseX[index], y));
  }

  if (transform.rotateDegrees !== undefined) {
    const map = createRotateTransform(centre, (transform.rotateDegrees * Math.PI) / 180);
    const baseX = currentX;
    const baseY = currentY;
    currentX = baseX.map((x, index) => map.mapX(x, baseY[index]));
    currentY = baseY.map((y, index) => map.mapY(baseX[index], y));
  }

  return { xs: currentX, ys: currentY };
}

function toStroke(
  element: Extract<SceneElement, { kind: "stroke" }>,
  layerId: LayerId,
): StrokeRecord {
  const pressures = element.pressures ?? element.xs.map(() => 1);
  const samples = applyTransform(element.xs, element.ys, element.transform);
  return {
    id: nextId("stroke"),
    layerId,
    brush: toBrush(element.brush),
    ...(element.erase ? { erase: true } : {}),
    ...(element.fill ? { fill: true } : {}),
    xs: samples.xs,
    ys: samples.ys,
    pressures: [...pressures],
    times: element.xs.map((_value, index) => index * 16),
    startTime: 0,
  };
}

function toFill(
  element: Extract<SceneElement, { kind: "fill" }>,
  layerId: LayerId,
): FillPatchRecord {
  const size = element.width * element.height;
  const mask =
    element.mask && element.mask.length === size
      ? Uint8Array.from(element.mask)
      : new Uint8Array(size).fill(255);
  return {
    id: nextId("fill"),
    layerId,
    kind: "fill",
    color: element.color,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    mask,
  };
}

function toGradient(
  element: Extract<SceneElement, { kind: "gradient" }>,
  layerId: LayerId,
): GradientRecord {
  return {
    id: nextId("gradient"),
    layerId,
    kind: "gradient",
    type: element.type,
    x1: element.x1,
    y1: element.y1,
    x2: element.x2,
    y2: element.y2,
    stops: element.stops.map((stop) => ({ offset: stop.offset, color: stop.color })),
    opacity: element.opacity ?? 1,
  };
}

function toElements(
  layers: readonly SceneLayer[],
  layerIds: readonly LayerId[],
): Map<LayerId, LayerElement[]> {
  const map = new Map<LayerId, LayerElement[]>();
  layers.forEach((layer, index) => {
    const layerId = layerIds[index];
    map.set(
      layerId,
      (layer.elements ?? []).map((element) => {
        if (element.kind === "stroke") return toStroke(element, layerId);
        if (element.kind === "fill") return toFill(element, layerId);
        return toGradient(element, layerId);
      }),
    );
  });
  return map;
}

/** The paintable leaves of a scene tree, in compositing order. */
function sceneLeaves(layers: readonly SceneLayer[]): SceneLayer[] {
  const leaves: SceneLayer[] = [];
  const visit = (nodes: readonly SceneLayer[]): void => {
    for (const node of nodes) {
      if (node.kind === "group") {
        visit(node.children ?? []);
      } else {
        leaves.push(node);
      }
    }
  };
  visit(layers);
  return leaves;
}

/** A scene node as the document's own layer tree. */
function toLayer(sceneLayer: SceneLayer): Layer {
  return {
    id: sceneLayer.id,
    name: sceneLayer.id,
    visible: sceneLayer.visible ?? true,
    opacity: sceneLayer.opacity ?? 1,
    blendMode: sceneLayer.blendMode ?? "normal",
    kind: sceneLayer.kind ?? "layer",
    children: (sceneLayer.children ?? []).map(toLayer),
  };
}

function buildDocument(
  scene: Scene,
  layers: readonly Layer[],
  guides: readonly SceneGuide[] = [],
  activeLayerId?: LayerId,
  references: readonly ReferenceImage[] = [],
): DrawingDocument {
  const base = createDocument({
    width: scene.width,
    height: scene.height,
    background: scene.background ?? "#ffffff",
  });
  return {
    ...base,
    layers,
    activeLayerId: activeLayerId ?? layers[0]?.id ?? base.activeLayerId,
    guides: guides.map((guide, index) => ({
      id: `guide-${index + 1}`,
      axis: guide.axis,
      position: guide.position,
    })),
    references,
  };
}

/** The document's reference records, in drawing order. */
function toReferences(scene: Scene): ReferenceImage[] {
  return (scene.references ?? []).map((reference, index) => ({
    id: `reference-${index + 1}`,
    name: `reference-${index + 1}`,
    x: reference.x,
    y: reference.y,
    width: reference.width,
    height: reference.height,
    naturalWidth: reference.naturalWidth ?? 64,
    naturalHeight: reference.naturalHeight ?? 64,
    rotation: reference.rotation ?? 0,
    opacity: reference.opacity ?? 1,
    blendMode: reference.blendMode ?? "normal",
    behind: reference.behind ?? false,
    visible: reference.visible ?? true,
  }));
}

/**
 * Builds the picture a scene's reference is drawn from.
 *
 * A real canvas, because that is exactly what `drawImage` receives in the
 * product: the harness must not fake the draw call, only the picture.
 */
function referenceSource(reference: SceneReference): HTMLCanvasElement {
  const width = reference.naturalWidth ?? 64;
  const height = reference.naturalHeight ?? 64;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("the harness needs a 2d context for a reference");
  }
  context.fillStyle = reference.color;
  context.fillRect(0, 0, width, height);
  if (reference.accent) {
    context.fillStyle = reference.accent;
    context.fillRect(0, 0, width / 2, height);
  }
  return canvas;
}

function readPixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("the harness needs a 2d context");
  }
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/**
 * Compares two pixel buffers.
 *
 * `skipBorder` drops the outermost pixel ring, which is where the display
 * canvas draws the document border that the export does not have.
 */
function compare(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  skipBorder: boolean,
): { differing: number; first: { x: number; y: number } | null } {
  let differing = 0;
  let first: { x: number; y: number } | null = null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (skipBorder && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) {
        continue;
      }
      const index = (y * width + x) * 4;
      let differs = false;
      for (let channel = 0; channel < 4; channel += 1) {
        if (a[index + channel] !== b[index + channel]) {
          differs = true;
          break;
        }
      }
      if (differs) {
        differing += 1;
        if (first === null) {
          first = { x, y };
        }
      }
    }
  }
  return { differing, first };
}

/**
 * Renders one scene, reports whether its three renderings agree, and paints
 * the exported picture into `golden` so the test can screenshot it.
 *
 * The display picture is painted into `display` as well: the composition
 * guides are display-only, so they can only be seen there.
 */
export function runScene(
  scene: Scene,
  golden?: HTMLCanvasElement,
  displayCanvas?: HTMLCanvasElement,
): SceneVerdict {
  elementCounter = 0;

  const leaves = sceneLeaves(scene.layers);
  const layers = scene.layers.map(toLayer);
  const layerIds = leaves.map((layer) => layer.id);
  const references = toReferences(scene);
  const drawingDocument = buildDocument(
    scene,
    layers,
    scene.guides ?? [],
    layerIds[0],
    references,
  );
  // The same document without its references: they are not artwork, so this
  // is the picture the export has to agree with.
  const withoutReferencesDocument = buildDocument(
    scene,
    layers,
    scene.guides ?? [],
    layerIds[0],
    [],
  );
  // The same document without its guides: the guides are display-only too, so
  // the difference between the two displays is the guides' own contribution.
  const withoutGuidesDocument = buildDocument(scene, layers, [], layerIds[0], references);
  // Neither guides nor references: the exported artwork.
  const artworkDocument = buildDocument(scene, layers, [], layerIds[0], []);

  // The map the renderer's stroke source reads. It is mutated in place, so the
  // renderer always sees the content the step below asks it to draw.
  const elements = toElements(leaves, layerIds);
  const allElements = new Map(elements);

  const display = document.createElement("canvas");
  const renderer: DrawingRenderer = new Canvas2DRenderer({
    canvas: display,
    strokeSource: {
      listStrokes: (layerId: LayerId) =>
        (elements.get(layerId) ?? []).filter(isStroke),
      listElements: (layerId: LayerId) => elements.get(layerId) ?? [],
    },
    rasterScale: 1,
    // Never fires: every render is issued explicitly, so the harness does not
    // depend on the app's animation loop (and cannot be stalled by a
    // suspended requestAnimationFrame).
    scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
  });
  renderer.setDocument(drawingDocument);
  const referenceSources = new Map<string, CanvasImageSource>();
  references.forEach((reference, index) => {
    const definition = scene.references?.[index];
    if (definition) {
      referenceSources.set(reference.id, referenceSource(definition));
    }
  });
  renderer.setReferenceSources(referenceSources);
  renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
  renderer.setDisplaySize(scene.width, scene.height, 1);
  renderer.setRasterScale(1);
  // The grid is display state: the scene may ask for it, and the harness
  // turns it off again whenever it needs the picture the export must match.
  const gridSettings = scene.grid
    ? { visible: true, spacing: scene.grid.spacing, snap: false }
    : NO_GRID;
  renderer.setGrid(gridSettings);

  const lastLayerIndex = leaves.length - 1;
  const lastLayer = leaves[lastLayerIndex];
  const lastElements = lastLayer?.elements ?? [];
  const lastElement = lastElements[lastElements.length - 1];
  const liveCapable = lastElement !== undefined && isSceneStroke(lastElement);

  const setContent = (source: Map<LayerId, LayerElement[]>): void => {
    elements.clear();
    for (const [layerId, value] of source) {
      elements.set(layerId, value);
    }
    for (const layerId of layerIds) {
      renderer.invalidateLayer(layerId);
    }
    renderer.render();
  };

  // 1. The committed state: every element but the last one.
  const committed = new Map<LayerId, LayerElement[]>();
  for (const [layerId, value] of allElements) {
    committed.set(layerId, [...value]);
  }
  if (lastLayer) {
    const withoutLast = (allElements.get(layerIds[lastLayerIndex]) ?? []).slice(0, -1);
    committed.set(layerIds[lastLayerIndex], withoutLast);
  }
  setContent(committed);

  // 2. Live: the last element drawn through the live stroke path.
  let livePixels: Uint8ClampedArray | null = null;
  if (liveCapable && lastLayer) {
    const stroke = toStroke(lastElement, layerIds[lastLayerIndex]);
    renderer.beginStroke(stroke);
    renderer.extendStroke(stroke, 0);
    renderer.render();
    livePixels = readPixels(display);
    // The gesture ends, exactly as it does in the app. Without this the
    // in-flight preview would still be composited by the rebuild below, and
    // the stroke's coverage would be applied twice.
    renderer.endStroke(stroke);
  }

  // 3. Rebuilt: the whole scene rasterized from the stored elements.
  setContent(allElements);
  const rebuiltPixels = readPixels(display);

  // 4. The same display without the guides. The guides are display-only, so
  // the difference between the two displays is the guides' own contribution.
  renderer.setDocument(withoutGuidesDocument);
  renderer.render();
  const withoutGuidesPixels = readPixels(display);
  renderer.setDocument(drawingDocument);
  renderer.render();

  // 4b. The same display without the references. References are not artwork,
  // so the difference is the references' own contribution.
  renderer.setDocument(withoutReferencesDocument);
  renderer.render();
  const withoutReferencesPixels = readPixels(display);
  renderer.setDocument(drawingDocument);
  renderer.render();

  // 5. The same display without the grid. The grid is display-only too, so
  // the difference between the two displays is the grid's own contribution.
  renderer.setGrid(NO_GRID);
  renderer.render();
  const withoutGridPixels = readPixels(display);
  renderer.setGrid(gridSettings);
  renderer.render();

  // 6. The display of the artwork alone: the picture the export has to agree
  // with, because neither a guide, a grid nor a reference reaches an export.
  renderer.setGrid(NO_GRID);
  renderer.setDocument(artworkDocument);
  renderer.render();
  const plainPixels = readPixels(display);
  renderer.setGrid(gridSettings);
  renderer.setDocument(drawingDocument);
  renderer.render();

  // 7. The display the user sees: the grid, at the scene's zoom.
  if (scene.grid?.zoom !== undefined && scene.grid.zoom !== 1) {
    renderer.setViewport({ zoom: scene.grid.zoom, offsetX: 0, offsetY: 0 });
    renderer.render();
  }

  if (displayCanvas) {
    displayCanvas.width = scene.width;
    displayCanvas.height = scene.height;
    displayCanvas.style.width = `${scene.width}px`;
    displayCanvas.style.height = `${scene.height}px`;
    const context = displayCanvas.getContext("2d");
    if (!context) {
      throw new Error("the harness needs a 2d context");
    }
    context.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
    // The display canvas holds the render with the grid and the guides: the
    // picture the user sees, which is the only place they can be seen.
    context.drawImage(display, 0, 0);
  }

  renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
  renderer.render();

  // 8. Exported: the document composite, which is what a PNG export writes.
  const exported = renderer.composeDocumentImage();
  const exportedPixels = readPixels(exported);

  // The export of the same document without its guides: the two must be the
  // same picture, because a guide never reaches an export.
  renderer.setDocument(withoutGuidesDocument);
  const plainExport = renderer.composeDocumentImage();
  const plainExportPixels = readPixels(plainExport);

  // The export of the same document without its references: the two must be
  // the same picture, because a reference is not artwork.
  renderer.setDocument(withoutReferencesDocument);
  const exportWithoutReferences = renderer.composeDocumentImage();
  const exportWithoutReferencesPixels = readPixels(exportWithoutReferences);
  renderer.setDocument(drawingDocument);

  // The export of the same document with the grid off: it must be the same
  // picture too, because the grid is display-only.
  renderer.setGrid(NO_GRID);
  const exportWithoutGrid = renderer.composeDocumentImage();
  const exportWithoutGridPixels = readPixels(exportWithoutGrid);
  renderer.setGrid(gridSettings);

  if (golden) {
    golden.width = exported.width;
    golden.height = exported.height;
    golden.style.width = `${exported.width}px`;
    golden.style.height = `${exported.height}px`;
    const context = golden.getContext("2d");
    if (!context) {
      throw new Error("the harness needs a 2d context");
    }
    context.clearRect(0, 0, golden.width, golden.height);
    context.drawImage(exported, 0, 0);
  }

  const liveVsRebuilt = livePixels
    ? compare(livePixels, rebuiltPixels, scene.width, scene.height, false)
    : { differing: 0, first: null };
  // The display draws a one-pixel document border that the export does not
  // have, so the export is compared with the display's interior.
  const rebuiltVsExported = compare(
    plainPixels,
    exportedPixels,
    scene.width,
    scene.height,
    true,
  );
  const guidesVisible =
    compare(rebuiltPixels, withoutGuidesPixels, scene.width, scene.height, false).differing > 0;
  const guidesNotExported =
    compare(exportedPixels, plainExportPixels, scene.width, scene.height, false).differing === 0;
  // The grid's own contribution: the display with it and the display without
  // it. It is display-only, so it never reaches the export.
  const gridVisible =
    compare(rebuiltPixels, withoutGridPixels, scene.width, scene.height, false).differing > 0;
  const gridNotExported =
    compare(exportedPixels, exportWithoutGridPixels, scene.width, scene.height, false).differing ===
    0;
  // The references' own contribution, and their exclusion from the export.
  const referencesVisible =
    compare(rebuiltPixels, withoutReferencesPixels, scene.width, scene.height, false).differing > 0;
  const referencesNotExported =
    compare(exportedPixels, exportWithoutReferencesPixels, scene.width, scene.height, false)
      .differing === 0;

  return {
    sceneId: scene.id,
    liveEqualsRebuilt: liveVsRebuilt.differing === 0,
    rebuiltEqualsExported: rebuiltVsExported.differing === 0,
    liveChecked: liveCapable,
    guidesVisible,
    guidesNotExported,
    gridVisible,
    gridNotExported,
    referencesVisible,
    referencesNotExported,
    liveVsRebuiltDiffering: liveVsRebuilt.differing,
    rebuiltVsExportedDiffering: rebuiltVsExported.differing,
    firstDifference: liveVsRebuilt.first ?? rebuiltVsExported.first,
    size: { width: scene.width, height: scene.height },
  };
}

declare global {
  interface Window {
    __pakaVisual?: {
      run(
        scene: Scene,
        golden?: HTMLCanvasElement,
        displayCanvas?: HTMLCanvasElement,
      ): SceneVerdict;
    };
  }
}

export function mount(): void {
  window.__pakaVisual = { run: runScene };
}
