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
import { createDocument, createLayer } from "/src/core/document/document";
import { DEFAULT_BRUSH } from "/src/core/brushes/defaults";
import { isStroke } from "/src/core/document/types";
import type {
  DrawingDocument,
  FillPatchRecord,
  GradientRecord,
  LayerElement,
  LayerId,
  StrokeRecord,
} from "/src/core/document/types";
import type { DrawingRenderer } from "/src/core/rendering/types";
import type { BrushSettings } from "/src/types/brush";
import { isSceneStroke } from "./scene";
import type { Scene, SceneElement, SceneLayer, SceneVerdict } from "./scene";

let elementCounter = 0;

function nextId(prefix: string): string {
  elementCounter += 1;
  return `${prefix}-${elementCounter}`;
}

function toBrush(patch: Readonly<Record<string, unknown>> | undefined): BrushSettings {
  return { ...DEFAULT_BRUSH, ...(patch ?? {}) } as BrushSettings;
}

function toStroke(
  element: Extract<SceneElement, { kind: "stroke" }>,
  layerId: LayerId,
): StrokeRecord {
  const pressures = element.pressures ?? element.xs.map(() => 1);
  return {
    id: nextId("stroke"),
    layerId,
    brush: toBrush(element.brush),
    ...(element.erase ? { erase: true } : {}),
    xs: [...element.xs],
    ys: [...element.ys],
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
      layer.elements.map((element) => {
        if (element.kind === "stroke") return toStroke(element, layerId);
        if (element.kind === "fill") return toFill(element, layerId);
        return toGradient(element, layerId);
      }),
    );
  });
  return map;
}

function buildDocument(
  scene: Scene,
  layers: ReturnType<typeof createLayer>[],
): DrawingDocument {
  const base = createDocument({
    width: scene.width,
    height: scene.height,
    background: scene.background ?? "#ffffff",
  });
  return { ...base, layers, activeLayerId: layers[0]?.id ?? base.activeLayerId };
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
 */
export function runScene(scene: Scene, golden?: HTMLCanvasElement): SceneVerdict {
  elementCounter = 0;

  const layers = scene.layers.map((layer) => {
    const created = createLayer(layer.id);
    created.opacity = layer.opacity ?? 1;
    created.blendMode = layer.blendMode ?? "normal";
    created.visible = layer.visible ?? true;
    return created;
  });
  const layerIds = layers.map((layer) => layer.id);
  const drawingDocument = buildDocument(scene, layers);

  // The map the renderer's stroke source reads. It is mutated in place, so the
  // renderer always sees the content the step below asks it to draw.
  const elements = toElements(scene.layers, layerIds);
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
  renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
  renderer.setDisplaySize(scene.width, scene.height, 1);
  renderer.setRasterScale(1);

  const lastLayerIndex = scene.layers.length - 1;
  const lastLayer = scene.layers[lastLayerIndex];
  const lastElement = lastLayer?.elements[lastLayer.elements.length - 1];
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

  // 4. Exported: the document composite, which is what a PNG export writes.
  const exported = renderer.composeDocumentImage();
  const exportedPixels = readPixels(exported);

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
    rebuiltPixels,
    exportedPixels,
    scene.width,
    scene.height,
    true,
  );

  return {
    sceneId: scene.id,
    liveEqualsRebuilt: liveVsRebuilt.differing === 0,
    rebuiltEqualsExported: rebuiltVsExported.differing === 0,
    liveChecked: liveCapable,
    liveVsRebuiltDiffering: liveVsRebuilt.differing,
    rebuiltVsExportedDiffering: rebuiltVsExported.differing,
    firstDifference: liveVsRebuilt.first ?? rebuiltVsExported.first,
    size: { width: scene.width, height: scene.height },
  };
}

declare global {
  interface Window {
    __pakaVisual?: {
      run(scene: Scene, golden?: HTMLCanvasElement): SceneVerdict;
    };
  }
}

export function mount(): void {
  window.__pakaVisual = { run: runScene };
}
