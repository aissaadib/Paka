/**
 * QA verification of the stamp-brush slice (S1), against the frozen copy of
 * the working tree renderer (qa/frozen) and the committed renderer (qa/head).
 *
 * Every check maps to an acceptance criterion from
 * docs/acceptance-criteria.json.
 */
import { Canvas2DRenderer as FrozenRenderer } from "/qa/current/Canvas2DRenderer";
import { Canvas2DRenderer as HeadRenderer } from "/qa/head/Canvas2DRenderer";
import { Canvas2DRenderer as PreR1Renderer } from "/qa/preR1/Canvas2DRenderer";
import { stampDabs, stampSpacing, stampDabCoverage, StampCoverage } from "/qa/current/stampCoverage";
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

function readCanvas(canvas: any): Uint8ClampedArray {
  const ctx = canvas.getContext("2d");
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(data.slice(index, index + 4));
}

interface Diff {
  identical: boolean;
  pixelsCompared: number;
  pixelsDiffering: number;
  maxChannelDelta: number;
  firstDifference: { x: number; y: number; expected: number[]; actual: number[] } | null;
}

function comparePixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  ignoreBorder = 0,
): Diff {
  const result: Diff = {
    identical: a.length === b.length && a.length > 0,
    pixelsCompared: a.length / 4,
    pixelsDiffering: 0,
    maxChannelDelta: 0,
    firstDifference: null,
  };
  if (a.length !== b.length) {
    result.identical = false;
    return result;
  }
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
    result.pixelsDiffering += 1;
    if (delta > result.maxChannelDelta) {
      result.maxChannelDelta = delta;
    }
    if (!result.firstDifference) {
      result.firstDifference = {
        x,
        y,
        expected: Array.from(a.slice(index, index + 4)),
        actual: Array.from(b.slice(index, index + 4)),
      };
    }
  }
  result.identical = result.pixelsDiffering === 0;
  return result;
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

/* --------------------------------------------------------------- rendering */

function renderDocument(
  Renderer: Any,
  width: number,
  height: number,
  elements: any[],
  rasterScale = 1,
): { display: Uint8ClampedArray; exported: Uint8ClampedArray; renderer: Any; canvas: any } {
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
    renderer,
    canvas,
  };
}

/* ------------------------------------------------------------------ checks */

const results: any[] = [];
const record = (id: string, name: string, data: any): void => {
  results.push({ id, name, ...data });
};

/**
 * AC-01 / AC-02: a brush that is not stamped must render exactly as the
 * committed renderer renders it. Compared over the whole canvas.
 */
function checkLegacyParity(): void {
  const cases: { name: string; elements: any[] }[] = [
    { name: "hard", elements: [stroke([10, 60, 110], [10, 40, 10], { size: 8, hardness: 1 })] },
    { name: "soft", elements: [stroke([10, 60, 110], [10, 40, 10], { size: 12, hardness: 0.3 })] },
    { name: "grain", elements: [stroke([10, 60, 110], [10, 40, 10], { size: 12, texture: 1 })] },
    { name: "opacity", elements: [stroke([10, 60, 110], [10, 40, 10], { size: 10, opacity: 0.5 })] },
    {
      name: "stamp-off-but-stamp-spacing-set",
      elements: [stroke([10, 60, 110], [10, 40, 10], { size: 8, stamp: false, stampSpacing: 0.5 })],
    },
  ];
  for (const testCase of cases) {
    const committed = renderDocument(HeadRenderer, 160, 120, testCase.elements);
    const frozen = renderDocument(FrozenRenderer, 160, 120, testCase.elements);
    const preR1 = renderDocument(PreR1Renderer, 160, 120, testCase.elements);
    record("AC-01", `legacy parity (${testCase.name})`, {
      headVsFrozen: comparePixels(committed.display, frozen.display, 160, 120, 2),
      headVsPreR1: comparePixels(committed.display, preR1.display, 160, 120, 2),
      exportVsFrozen: comparePixels(committed.exported, frozen.exported, 160, 120, 2),
    });
  }
}

/**
 * AC-05 / AC-14: live, commit, rebuild and export must agree for a stamped
 * stroke, pixel for pixel.
 */
function checkStampedAgreement(): void {
  const brushes = [
    { name: "hard-stamp", patch: { size: 10, stamp: true, stampSpacing: 0.1, stampHardness: 1 } },
    { name: "soft-dab", patch: { size: 10, stamp: true, stampSpacing: 0.1, stampHardness: 0.3 } },
    { name: "wide-spacing", patch: { size: 10, stamp: true, stampSpacing: 0.5, stampHardness: 1 } },
    { name: "stamped-and-textured", patch: { size: 10, stamp: true, stampSpacing: 0.15, texture: 1 } },
  ];
  for (const entry of brushes) {
    const stored = stroke([20, 60, 100], [20, 60, 20], entry.patch);
    const doc = buildDoc(160, 120, []);
    const layerId = doc.layers[0].id;
    const liveStroke = { ...stored, id: nextId("live"), layerId };
    const canvas = document.createElement("canvas");
    const renderer = new FrozenRenderer({ canvas, strokeSource, rasterScale: 1 });
    renderer.setDocument(doc);
    renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
    renderer.setDisplaySize(160, 120, 1);
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

    record("AC-05", `stamped paths agree (${entry.name})`, {
      liveVsCommitted: comparePixels(live, committed, 160, 120, 2),
      committedVsRebuilt: comparePixels(committed, rebuilt, 160, 120, 2),
      rebuiltVsExport: comparePixels(rebuilt, exported, 160, 120, 2),
      samplePixel: pixelAt(rebuilt, 160, 60, 60),
    });
  }
}

/**
 * AC-03: a self-crossing stamped stroke must not darken at the crossing.
 */
function checkUnionNoDarkening(): void {
  const crossing = stroke([20, 100, 20], [60, 60, 60], {
    size: 12,
    opacity: 0.5,
    stamp: true,
    stampSpacing: 0.1,
  });
  const rendered = renderDocument(FrozenRenderer, 160, 120, [crossing]);
  const atCrossing = pixelAt(rendered.exported, 160, 60, 60);
  const offCrossing = pixelAt(rendered.exported, 160, 30, 60);
  record("AC-03", "self-crossing stamped stroke does not darken", {
    crossingPixel: atCrossing,
    singlePassPixel: offCrossing,
    // Black at 50 % over white paper is 128; stacking twice would be 64.
    pass: atCrossing[0] === 128 && atCrossing[0] === offCrossing[0],
  });
}

/**
 * AC-04: the union is per stroke, not per layer: two strokes of the same
 * colour still build up where they overlap.
 */
function checkPerStrokeUnion(): void {
  const first = stroke([20, 140], [60, 60], { size: 16, opacity: 0.5, stamp: true, stampSpacing: 0.1 });
  const second = stroke([20, 140], [60, 60], { size: 16, opacity: 0.5, stamp: true, stampSpacing: 0.1 });
  const rendered = renderDocument(FrozenRenderer, 160, 120, [first, second]);
  const overlap = pixelAt(rendered.exported, 160, 80, 60);
  const single = renderDocument(FrozenRenderer, 160, 120, [first]);
  const singlePixel = pixelAt(single.exported, 160, 80, 60);
  record("AC-04", "two strokes of the same colour build up where they overlap", {
    overlapPixel: overlap,
    singleStrokePixel: singlePixel,
    pass: overlap[0] < singlePixel[0],
  });
}

/**
 * AC-07: the dab plan must not depend on the sample density.
 */
function checkSampleDensityIndependence(): void {
  // The two captures must describe the *same* geometric path: the dab lattice
  // is placed along the polyline, so a different polyline is a different path.
  const dense = stroke([20, 30, 40, 50, 60, 70, 80, 90, 100], [20, 20, 20, 20, 20, 20, 20, 20, 20], {
    size: 10,
    stamp: true,
    stampSpacing: 0.1,
  });
  const sparse = stroke([20, 60, 100], [20, 20, 20], {
    size: 10,
    stamp: true,
    stampSpacing: 0.1,
  });
  const denseRender = renderDocument(FrozenRenderer, 160, 120, [dense]);
  const sparseRender = renderDocument(FrozenRenderer, 160, 120, [sparse]);
  record("AC-07", "dab plan is independent of the sample density", {
    denseVsSparse: comparePixels(denseRender.exported, sparseRender.exported, 160, 120, 2),
    denseDabs: stampDabs(dense, dense.brush).length,
    sparseDabs: stampDabs(sparse, sparse.brush).length,
  });
}

/**
 * AC-08 / AC-09: the dab lattice, a press without movement, and an empty path.
 */
function checkDabGeometry(): void {
  const path = { xs: [0, 100], ys: [0, 0], pressures: [1, 1] };
  const stampBrush = brush({ size: 10, stamp: true, stampSpacing: 0.1 });
  const dabs = stampDabs(path, stampBrush);
  const spacing = stampSpacing(stampBrush);
  const expectedCount = Math.ceil(100 / spacing) + 1;
  const single = stampDabs({ xs: [5], ys: [5], pressures: [1] }, stampBrush);
  const empty = stampDabs({ xs: [], ys: [], pressures: [] }, stampBrush);
  const positions = dabs.map((dab: any) => Number(dab.x.toFixed(6)));
  const steps = positions.slice(1).map((value: number, index: number) => value - positions[index]);
  record("AC-08", "dabs sit on an arc-length lattice", {
    spacing,
    dabCount: dabs.length,
    expectedCount,
    countMatches: dabs.length === expectedCount,
    firstDabAtStart: positions[0] === 0,
    stepMin: Math.min(...steps),
    stepMax: Math.max(...steps),
    stepMatchesSpacing: Math.max(...steps.map((s: number) => Math.abs(s - spacing))) < 1e-9,
  });
  record("AC-09", "a press without movement deposits one dab, an empty path none", {
    singleDabCount: single.length,
    emptyDabCount: empty.length,
  });
}

/**
 * AC-16: the eraser subtracts the union of the dabs, and a self-crossing
 * eraser stroke erases once.
 */
function checkEraser(): void {
  const painted = stroke([20, 140], [60, 60], { size: 24, stamp: true, stampSpacing: 0.1 });
  const eraser = stroke([60, 60], [60, 60], { size: 24, stamp: true, stampSpacing: 0.1 }, { erase: true });
  const selfCrossingEraser = stroke([40, 80, 40], [60, 60, 60], { size: 24, stamp: true, stampSpacing: 0.1 }, { erase: true });
  const withEraser = renderDocument(FrozenRenderer, 160, 120, [painted, eraser]);
  const withCrossing = renderDocument(FrozenRenderer, 160, 120, [painted, selfCrossingEraser]);
  const paintedOnly = renderDocument(FrozenRenderer, 160, 120, [painted]);
  record("AC-16", "eraser subtracts the union of the dabs", {
    paintedOnlyAtCentre: pixelAt(paintedOnly.exported, 160, 60, 60),
    afterEraseAtCentre: pixelAt(withEraser.exported, 160, 60, 60),
    afterSelfCrossingEraseAtCentre: pixelAt(withCrossing.exported, 160, 60, 60),
    erasedOnce:
      pixelAt(withEraser.exported, 160, 60, 60)[3] === 0 &&
      pixelAt(withCrossing.exported, 160, 60, 60)[3] === 0,
    // The eraser must not erase outside its own footprint either.
    untouchedPixel: pixelAt(withEraser.exported, 160, 30, 60),
    untouchedPixelPainted: pixelAt(paintedOnly.exported, 160, 30, 60),
  });
}

/**
 * AC-17: a shape keeps the segment path even when the brush is stamped.
 */
function checkShapePath(): void {
  const rectangle = [20, 100, 100, 20, 20];
  const ys = [20, 20, 80, 80, 20];
  const plain = stroke(rectangle, ys, { size: 6 });
  // The engine strips the stamp flag from a shape's brush (DrawingEngine
  // `shapeBrush`), so this is the record the engine actually writes.
  const asTheEngineWritesIt = stroke(rectangle, ys, {
    size: 6,
    stamp: false,
    stampSpacing: 0.5,
    stampHardness: 0.2,
  });
  // A record that still carries the stamp flag (only a hand-edited file can
  // produce one) - the renderer honours the record.
  const stampedRecord = stroke(rectangle, ys, { size: 6, stamp: true, stampSpacing: 0.1 });
  const plainRender = renderDocument(FrozenRenderer, 160, 120, [plain]);
  const engineRender = renderDocument(FrozenRenderer, 160, 120, [asTheEngineWritesIt]);
  const stampedRender = renderDocument(FrozenRenderer, 160, 120, [stampedRecord]);
  record("AC-17", "a shape record written by the engine keeps the segment path", {
    plainVsEngineShape: comparePixels(plainRender.exported, engineRender.exported, 160, 120, 2),
    plainVsStampedRecord: comparePixels(plainRender.exported, stampedRender.exported, 160, 120, 2),
  });
}

/**
 * AC-18: the result must agree across rasterScale.
 */
function checkResolutionIndependence(): void {
  const stamped = stroke([20, 60, 100], [20, 60, 20], {
    size: 10,
    stamp: true,
    stampSpacing: 0.1,
  });
  const atOne = renderDocument(FrozenRenderer, 160, 120, [stamped], 1);
  const atTwo = renderDocument(FrozenRenderer, 160, 120, [stamped], 2);
  const diff = comparePixels(atOne.exported, atTwo.exported, 160, 120, 2);
  record("AC-18", "a stamped stroke agrees across rasterScale", {
    exportVsExport: diff,
    oneScalePixel: pixelAt(atOne.exported, 160, 60, 60),
    twoScalePixel: pixelAt(atTwo.exported, 160, 60, 60),
    note: "both exports are document-sized; the tolerance is antialiasing only",
  });
}

/**
 * AC-19: the dab plan must have a growth guard, and the *paint* cost of a
 * hostile path must stay bounded.
 */
function checkDabBudget(): void {
  const stampBrush = brush({ size: 512, stamp: true, stampSpacing: 0.02 });
  const path = { xs: [0, 8192], ys: [0, 0], pressures: [1, 1] };
  const started = performance.now();
  const dabs = stampDabs(path, stampBrush);
  const planMs = performance.now() - started;

  // The paint cost: how long does the coverage map take to union these dabs?
  const coverage = new StampCoverage();
  const paintStart = performance.now();
  for (const dab of dabs) {
    coverage.paintDab(dab.x, dab.y, dab.radius, stampBrush.stampHardness);
  }
  const paintMs = performance.now() - paintStart;

  // The same, at rasterScale 2 (the HiDPI case).
  const coverage2 = new StampCoverage();
  const paintStart2 = performance.now();
  for (const dab of dabs) {
    coverage2.paintDab(dab.x * 2, dab.y * 2, dab.radius * 2, stampBrush.stampHardness);
  }
  const paintMs2 = performance.now() - paintStart2;

  record("AC-19", "a hostile path does not produce an unbounded dab plan", {
    dabCount: dabs.length,
    spacing: stampSpacing(stampBrush),
    planMs: Number(planMs.toFixed(1)),
    paintMsAtScale1: Number(paintMs.toFixed(1)),
    paintMsAtScale2: Number(paintMs2.toFixed(1)),
    truncated: false,
    note: "no per-stroke dab budget or truncation exists in the implementation",
  });
}

/**
 * AC-23: the live preview of a stamped stroke is composited inside the
 * stroke's own layer, honouring that layer's visibility, opacity and blend.
 */
function checkPreviewInLayer(): void {
  for (const layer of [
    { name: "opacity 0.5", opacity: 0.5, blendMode: "normal" },
    { name: "multiply", opacity: 1, blendMode: "multiply" },
    { name: "hidden", opacity: 1, blendMode: "normal", visible: false },
  ]) {
    const stored = stroke([20, 60, 100], [20, 60, 20], {
      size: 10,
      stamp: true,
      stampSpacing: 0.1,
    });
    const doc = createDocument({ width: 160, height: 120 });
    doc.layers.length = 0;
    const created = createLayer("Layer 1") as any;
    created.visible = layer.visible !== false;
    created.opacity = layer.opacity;
    created.blendMode = layer.blendMode;
    doc.layers.push(created);
    currentSource.clear();
    currentSource.set(created.id, []);
    doc.activeLayerId = created.id;

    const liveStroke = { ...stored, layerId: created.id, id: nextId("live") };
    const canvas = document.createElement("canvas");
    const renderer = new FrozenRenderer({ canvas, strokeSource, rasterScale: 1 });
    renderer.setDocument(doc);
    renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
    renderer.setDisplaySize(160, 120, 1);
    renderer.render();

    renderer.beginStroke(liveStroke);
    renderer.extendStroke(liveStroke, 0);
    renderer.render();
    const live = readCanvas(canvas);
    renderer.endStroke(liveStroke);
    renderer.render();
    const committed = readCanvas(canvas);

    record("AC-23", `stamped preview honours the layer (${layer.name})`, {
      liveVsCommitted: comparePixels(live, committed, 160, 120, 2),
    });
  }
}

/**
 * AC-18, compared fairly: the same comparison for the legacy segment path,
 * so the stamped path is measured against the bar the product already sets.
 */
function checkResolutionFairness(): void {
  const stamped = stroke([20, 60, 100], [20, 60, 20], {
    size: 10,
    stamp: true,
    stampSpacing: 0.1,
  });
  const legacy = stroke([20, 60, 100], [20, 60, 20], { size: 10 });
  const stampedDiff = comparePixels(
    renderDocument(FrozenRenderer, 160, 120, [stamped], 1).exported,
    renderDocument(FrozenRenderer, 160, 120, [stamped], 2).exported,
    160,
    120,
    2,
  );
  const legacyDiff = comparePixels(
    renderDocument(FrozenRenderer, 160, 120, [legacy], 1).exported,
    renderDocument(FrozenRenderer, 160, 120, [legacy], 2).exported,
    160,
    120,
    2,
  );
  record("AC-18", "resolution difference of the stamped path vs the legacy path", {
    stamped: { differing: stampedDiff.pixelsDiffering, max: stampedDiff.maxChannelDelta },
    legacy: { differing: legacyDiff.pixelsDiffering, max: legacyDiff.maxChannelDelta },
    stampedNoWorseThanLegacy:
      stampedDiff.maxChannelDelta <= legacyDiff.maxChannelDelta &&
      stampedDiff.pixelsDiffering <= legacyDiff.pixelsDiffering * 2,
  });
}

export async function runStampChecks(): Promise<any> {
  results.length = 0;
  checkLegacyParity();
  checkStampedAgreement();
  checkUnionNoDarkening();
  checkPerStrokeUnion();
  checkSampleDensityIndependence();
  checkDabGeometry();
  checkEraser();
  checkShapePath();
  checkResolutionIndependence();
  checkResolutionFairness();
  checkPreviewInLayer();
  checkDabBudget();
  return { at: new Date().toISOString(), results };
}

(window as any).__qaStamp = { runStampChecks };
