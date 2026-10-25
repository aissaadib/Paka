/**
 * QA verification of the G1 stamp engine's resource bounds.
 *
 * Reference implementations:
 *   /qa/current/  - the working tree (tiled upload, bounded planner)
 *   /qa/frozen/   - the earlier working tree (single-rect upload, unbounded planner)
 *   /qa/head/     - the committed renderer (the legacy segment path)
 *
 * Every check runs against the real Canvas2DRenderer in a real browser.
 */
import { Canvas2DRenderer as CurrentRenderer } from "/qa/current/Canvas2DRenderer";
import { Canvas2DRenderer as SingleRectRenderer } from "/qa/frozen/Canvas2DRenderer";
import { Canvas2DRenderer as HeadRenderer } from "/qa/head/Canvas2DRenderer";
import {
  stampDabs,
  stampSpacing,
  StampCoverage,
  MAX_STAMP_COVERAGE_WORK,
  COVERAGE_TILE_SIZE,
} from "/qa/current/stampCoverage";
import { createDocument, createLayer } from "/src/core/document/document";
import { DEFAULT_BRUSH } from "/src/core/brushes/defaults";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const currentSource = new Map<string, any[]>();
const strokeSource = {
  listStrokes: (layerId: string): any[] =>
    (currentSource.get(layerId) ?? []).filter((element) => element.kind === undefined),
  listElements: (layerId: string): any[] => currentSource.get(layerId) ?? [],
};

function buildDoc(width: number, height: number, elements: any[]): any {
  currentSource.clear();
  const doc = createDocument({ width, height });
  doc.layers.length = 0;
  const layer = createLayer("Layer 1") as any;
  layer.visible = true;
  layer.opacity = 1;
  layer.blendMode = "normal";
  doc.layers.push(layer);
  currentSource.set(layer.id, elements.map((element) => ({ ...element, layerId: layer.id })));
  doc.activeLayerId = layer.id;
  return doc;
}

const brush = (patch: Partial<typeof DEFAULT_BRUSH>): any => ({
  ...DEFAULT_BRUSH,
  color: "#000000",
  ...patch,
});

let idCounter = 0;
const nextId = (prefix: string): string => `${prefix}-${(idCounter += 1)}`;

function stroke(
  xs: number[],
  ys: number[],
  patch: Partial<typeof DEFAULT_BRUSH> = {},
  extra: Record<string, unknown> = {},
): any {
  return {
    id: nextId("stroke"),
    layerId: "L0",
    brush: brush(patch),
    xs,
    ys,
    pressures: xs.map(() => 1),
    times: xs.map((_v, index) => index * 16),
    startTime: 0,
    ...extra,
  };
}

function readCanvas(canvas: any): Uint8ClampedArray {
  const ctx = canvas.getContext("2d");
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function comparePixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  ignoreBorder = 0,
): Any {
  let differing = 0;
  let maxDelta = 0;
  let first: Any = null;
  for (let index = 0; index < a.length; index += 4) {
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (
      ignoreBorder > 0 &&
      (x < ignoreBorder || y < ignoreBorder || x >= width - ignoreBorder || y >= height - ignoreBorder)
    ) {
      continue;
    }
    let differs = false;
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(a[index + channel] - b[index + channel]);
      if (difference > 0) {
        differs = true;
      }
      if (difference > delta) {
        delta = difference;
      }
    }
    if (!differs) {
      continue;
    }
    differing += 1;
    if (delta > maxDelta) {
      maxDelta = delta;
    }
    if (!first) {
      first = {
        x,
        y,
        expected: Array.from(a.slice(index, index + 4)),
        actual: Array.from(b.slice(index, index + 4)),
      };
    }
  }
  return { identical: differing === 0, differing, maxDelta, first };
}

/* ------------------------------------------------------- upload instrument */

interface UploadRecord {
  imageDataSizes: { width: number; height: number }[];
  putImageDataCalls: { x: number; y: number; width: number; height: number }[];
}

/**
 * Records every ImageData the stamp path creates and every putImageData call
 * it makes, per canvas.
 */
function installUploadInstrument(): {
  restore: () => void;
  records: Map<any, UploadRecord>;
  canvases: any[];
} {
  const records = new Map<any, UploadRecord>();
  const canvases: any[] = [];
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patched(this: any, type: string, ...rest: any[]) {
    const context = originalGetContext.call(this, type, ...rest);
    if (type !== "2d" || !context || (context as any).__qaUploadInstrumented) {
      return context;
    }
    (context as any).__qaUploadInstrumented = true;
    const record: UploadRecord = { imageDataSizes: [], putImageDataCalls: [] };
    records.set(this, record);
    canvases.push(this);
    const originalCreate = context.createImageData.bind(context);
    context.createImageData = (width: number, height: number) => {
      record.imageDataSizes.push({ width, height });
      return originalCreate(width, height);
    };
    const originalPut = context.putImageData.bind(context);
    context.putImageData = (image: any, x: number, y: number) => {
      record.putImageDataCalls.push({ x, y, width: image.width, height: image.height });
      return originalPut(image, x, y);
    };
    return context;
  };
  return {
    restore: () => {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    },
    records,
    canvases,
  };
}

function renderDocument(
  Renderer: Any,
  width: number,
  height: number,
  elements: any[],
  rasterScale = 1,
): { display: Uint8ClampedArray; exported: Uint8ClampedArray } {
  const doc = buildDoc(width, height, elements);
  const canvas = document.createElement("canvas");
  const renderer = new Renderer({ canvas, strokeSource, rasterScale });
  renderer.setDocument(doc);
  renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
  renderer.setDisplaySize(width, height, 1);
  renderer.render();
  return {
    display: readCanvas(canvas),
    exported: readCanvas(renderer.composeDocumentImage()),
  };
}

/* --------------------------------------------------------------- the checks */

const results: Any[] = [];
const record = (id: string, name: string, data: Any): void => {
  results.push({ id, name, ...data });
};

/**
 * AC-28: the upload is tiled - one reused 64x64 ImageData per tile, never a
 * document-sized buffer - and the tiled upload produces the same bytes as the
 * earlier single-rect upload.
 */
function checkTiledUpload(): void {
  // A stroke that covers several tiles: 200 px wide, 40 px brush.
  const stamped = stroke([20, 220], [60, 60], { size: 40, stamp: true, stampSpacing: 0.1 });

  const instrument = installUploadInstrument();
  let current: Any;
  try {
    const doc = buildDoc(200, 120, [stamped]);
    const canvas = document.createElement("canvas");
    const renderer = new CurrentRenderer({ canvas, strokeSource, rasterScale: 1 });
    renderer.setDocument(doc);
    renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
    renderer.setDisplaySize(200, 120, 1);
    renderer.render();
    // Canvas 0 = the display, 1 = the stroke buffer, 2 = the layer surface.
    const bufferRecord = instrument.records.get(instrument.canvases[1]);
    current = {
      imageDataSizes: bufferRecord?.imageDataSizes ?? [],
      putImageDataCalls: bufferRecord?.putImageDataCalls ?? [],
    };
  } finally {
    instrument.restore();
  }

  const largest = current.imageDataSizes.reduce(
    (max: number, size: Any) => Math.max(max, size.width * size.height),
    0,
  );
  const nonTile = current.imageDataSizes.filter(
    (size: Any) => size.width > COVERAGE_TILE_SIZE || size.height > COVERAGE_TILE_SIZE,
  );
  const tileOrigins = new Set(
    current.putImageDataCalls.map((call: Any) => `${call.x},${call.y}`),
  );

  record("AC-28", "the coverage upload is tiled, one 64x64 ImageData per tile", {
    imageDataSizes: current.imageDataSizes,
    putImageDataCalls: current.putImageDataCalls.length,
    largestImageDataPixels: largest,
    tileSize: COVERAGE_TILE_SIZE,
    nonTileImageData: nonTile,
    distinctTileOrigins: tileOrigins.size,
    allUploadsAreTiles: nonTile.length === 0,
    oneUploadPerTile: current.putImageDataCalls.length === tileOrigins.size,
  });

  // The tiled upload must produce the same bytes as the single-rect upload.
  const tiled = renderDocument(CurrentRenderer, 200, 120, [stamped]);
  const single = renderDocument(SingleRectRenderer, 200, 120, [stamped]);
  record("AC-28", "the tiled upload and the single-rect upload produce identical bytes", {
    display: comparePixels(tiled.display, single.display, 200, 120, 2),
    export: comparePixels(tiled.exported, single.exported, 200, 120, 2),
  });
}

/**
 * Tile edges and clipping: a stroke that crosses the 64 px tile grid, one at
 * the document edge, one that starts off-document, and one that ends
 * off-document. The tiled upload must not shift, duplicate or drop coverage.
 */
function checkTileEdgesAndClipping(): void {
  const cases: { name: string; width: number; height: number; elements: any[] }[] = [
    {
      name: "crosses many tile boundaries",
      width: 200,
      height: 120,
      elements: [stroke([10, 190], [30, 90], { size: 24, stamp: true, stampSpacing: 0.1 })],
    },
    {
      name: "starts on a tile corner",
      width: 200,
      height: 120,
      elements: [stroke([64, 128], [64, 64], { size: 18, stamp: true, stampSpacing: 0.1 })],
    },
    {
      name: "at the right and bottom edge",
      width: 130,
      height: 70,
      elements: [stroke([100, 129], [50, 69], { size: 30, stamp: true, stampSpacing: 0.1 })],
    },
    {
      name: "starts off-document",
      width: 130,
      height: 70,
      elements: [stroke([-40, 60], [30, 30], { size: 24, stamp: true, stampSpacing: 0.1 })],
    },
    {
      name: "ends off-document",
      width: 130,
      height: 70,
      elements: [stroke([40, 200], [30, 30], { size: 24, stamp: true, stampSpacing: 0.1 })],
    },
    {
      name: "entirely off-document",
      width: 130,
      height: 70,
      elements: [stroke([-90, -50], [-90, -50], { size: 24, stamp: true, stampSpacing: 0.1 })],
    },
  ];
  for (const testCase of cases) {
    const tiled = renderDocument(CurrentRenderer, testCase.width, testCase.height, testCase.elements);
    const single = renderDocument(
      SingleRectRenderer,
      testCase.width,
      testCase.height,
      testCase.elements,
    );
    record("AC-28", `tile edges and clipping (${testCase.name})`, {
      display: comparePixels(tiled.display, single.display, testCase.width, testCase.height, 2),
      export: comparePixels(tiled.exported, single.exported, testCase.width, testCase.height, 2),
    });
  }
}

/**
 * AC-29: hostile input is planned in bounded time and bounded memory.
 */
function checkHostileInput(): void {
  const hostile = brush({ size: 512, stamp: true, stampSpacing: 0.02 });

  // 1. Coordinates far outside any document.
  const farStart = performance.now();
  const farDabs = stampDabs({ xs: [-1e9, 1e9], ys: [-1e9, 1e9], pressures: [1, 1] }, hostile);
  const farMs = performance.now() - farStart;

  // 2. A very long path: 500,000 samples.
  const longXs = new Float64Array(500_000);
  const longYs = new Float64Array(500_000);
  const longPressures = new Float64Array(500_000).fill(1);
  for (let index = 0; index < longXs.length; index += 1) {
    longXs[index] = index * 0.01;
    longYs[index] = 0;
  }
  const longStart = performance.now();
  const longDabs = stampDabs(
    { xs: longXs as unknown as number[], ys: longYs as unknown as number[], pressures: longPressures as unknown as number[] },
    hostile,
  );
  const longMs = performance.now() - longStart;

  // 3. Non-finite coordinates (the parser rejects them, the renderer must not hang).
  const nanStart = performance.now();
  const nanDabs = stampDabs(
    { xs: [0, Number.NaN, 10], ys: [0, 5, 10], pressures: [1, 1, 1] },
    hostile,
  );
  const nanMs = performance.now() - nanStart;

  const work = (dabs: Any[]) =>
    dabs.reduce((total: number, dab: Any) => total + (dab.radius * 2 + 1) * (dab.radius * 2 + 1), 0);

  record("AC-29", "hostile input is planned in bounded time and bounded memory", {
    farCoordinates: { dabs: farDabs.length, ms: Number(farMs.toFixed(1)), work: work(farDabs) },
    longPath: {
      samples: longXs.length,
      dabs: longDabs.length,
      ms: Number(longMs.toFixed(1)),
      work: work(longDabs),
    },
    nonFinite: { dabs: nanDabs.length, ms: Number(nanMs.toFixed(1)) },
    budget: MAX_STAMP_COVERAGE_WORK,
    workWithinBudget:
      work(farDabs) <= MAX_STAMP_COVERAGE_WORK &&
      work(longDabs) <= MAX_STAMP_COVERAGE_WORK,
  });
}

/**
 * AC-19 / AC-31: the work budget bounds the paint cost of the worst case, and
 * the budget is actually reached (not merely respected by a trivial plan).
 */
function checkBudgetEffect(): void {
  const hostile = brush({ size: 512, stamp: true, stampSpacing: 0.02 });
  const xs = Array.from({ length: 4000 }, (_value, index) => index * 10);
  const ys = xs.map(() => 0);
  const dabs = stampDabs({ xs, ys, pressures: xs.map(() => 1) }, hostile);
  const spacing = stampSpacing(hostile);
  const work = dabs.reduce(
    (total: number, dab: Any) => total + (dab.radius * 2 + 1) * (dab.radius * 2 + 1),
    0,
  );
  // The dabs the spacing would ask for, without the budget.
  const unbounded = Math.ceil((xs[xs.length - 1] - xs[0]) / spacing) + 1;

  const paintStart = performance.now();
  const coverage = new StampCoverage();
  for (const dab of dabs) {
    coverage.paintDab(dab.x, dab.y, dab.radius, hostile.stampHardness);
  }
  const paintMs = performance.now() - paintStart;

  record("AC-19", "the work budget bounds the worst case and is actually reached", {
    dabsPlaced: dabs.length,
    dabsWithoutBudget: unbounded,
    truncated: dabs.length < unbounded,
    work: work,
    budget: MAX_STAMP_COVERAGE_WORK,
    budgetUsedFraction: Number((work / MAX_STAMP_COVERAGE_WORK).toFixed(3)),
    paintMs: Number(paintMs.toFixed(1)),
  });
}

/**
 * AC-32: the bounds are reachable from the live path, the rebuild path and
 * the export path alike - a stroke that is truncated paints the same truncated
 * picture everywhere.
 */
function checkTruncationConsistency(): void {
  const hostile = brush({ size: 512, stamp: true, stampSpacing: 0.02 });
  const xs = Array.from({ length: 3000 }, (_value, index) => index * 10);
  const ys = xs.map(() => 0);
  const stored = stroke(xs, ys, { size: 512, stamp: true, stampSpacing: 0.02 });

  const doc = buildDoc(200, 120, []);
  const layerId = doc.layers[0].id;
  const liveStroke = { ...stored, layerId, id: nextId("live") };
  const canvas = document.createElement("canvas");
  const renderer = new CurrentRenderer({ canvas, strokeSource, rasterScale: 1 });
  renderer.setDocument(doc);
  renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
  renderer.setDisplaySize(200, 120, 1);
  renderer.render();

  currentSource.set(layerId, []);
  renderer.invalidateLayer(layerId);
  renderer.render();
  renderer.beginStroke(liveStroke);
  renderer.extendStroke(liveStroke, 0);
  renderer.render();
  const live = readCanvas(canvas);
  renderer.endStroke(liveStroke);
  renderer.render();
  const committed = readCanvas(canvas);
  currentSource.set(layerId, [liveStroke]);
  renderer.invalidateLayer(layerId);
  renderer.render();
  const rebuilt = readCanvas(canvas);
  const exported = readCanvas(renderer.composeDocumentImage());

  record("AC-32", "a truncated stroke paints the same picture on every path", {
    liveVsCommitted: comparePixels(live, committed, 200, 120, 2),
    committedVsRebuilt: comparePixels(committed, rebuilt, 200, 120, 2),
    rebuiltVsExport: comparePixels(rebuilt, exported, 200, 120, 2),
    dabCount: stampDabs(liveStroke, liveStroke.brush).length,
  });
}

/**
 * AC-01: the legacy path is still byte-identical to the committed renderer.
 */
function checkLegacyStillIdentical(): void {
  const cases: Any[] = [
    { name: "hard", elements: [stroke([10, 60, 110], [10, 40, 10], { size: 8, hardness: 1 })] },
    { name: "soft", elements: [stroke([10, 60, 110], [10, 40, 10], { size: 12, hardness: 0.3 })] },
    { name: "grain", elements: [stroke([10, 60, 110], [10, 40, 10], { size: 12, texture: 1 })] },
    {
      name: "stamped-but-off",
      elements: [stroke([10, 60, 110], [10, 40, 10], { size: 8, stamp: false, stampSpacing: 0.5 })],
    },
  ];
  for (const testCase of cases) {
    const committed = renderDocument(HeadRenderer, 160, 120, testCase.elements);
    const current = renderDocument(CurrentRenderer, 160, 120, testCase.elements);
    record("AC-01", `legacy parity (${testCase.name})`, {
      display: comparePixels(committed.display, current.display, 160, 120, 2),
      export: comparePixels(committed.exported, current.exported, 160, 120, 2),
    });
  }
}

export async function runG1Checks(): Promise<Any> {
  results.length = 0;
  checkLegacyStillIdentical();
  checkTiledUpload();
  checkTileEdgesAndClipping();
  checkHostileInput();
  checkBudgetEffect();
  checkTruncationConsistency();
  return { at: new Date().toISOString(), results };
}

(window as any).__qaG1 = { runG1Checks };
