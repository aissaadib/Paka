/**
 * QA check: the pixel effect of the N6 placement defect (the composited
 * region floored instead of ceiled) on the STAMP path, in a real browser.
 *
 * This mutation passes the repository's whole test suite (112/112), so the
 * question is whether it actually changes the picture.
 */
import { Canvas2DRenderer as CurrentRenderer } from "/qa/current/Canvas2DRenderer";
import { Canvas2DRenderer as MutantRenderer } from "/qa/mutant-n6/Canvas2DRenderer";
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

let idCounter = 0;
const nextId = (prefix: string): string => `${prefix}-${(idCounter += 1)}`;

function stroke(xs: number[], ys: number[], patch: Partial<typeof DEFAULT_BRUSH>): any {
  return {
    id: nextId("stroke"),
    layerId: "L0",
    brush: { ...DEFAULT_BRUSH, color: "#000000", ...patch },
    xs,
    ys,
    pressures: xs.map(() => 1),
    times: xs.map((_v, index) => index * 16),
    startTime: 0,
  };
}

function renderDocument(Renderer: Any, width: number, height: number, elements: any[]) {
  const doc = buildDoc(width, height, elements);
  const canvas = document.createElement("canvas");
  const renderer = new Renderer({ canvas, strokeSource, rasterScale: 1 });
  renderer.setDocument(doc);
  renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
  renderer.setDisplaySize(width, height, 1);
  renderer.render();
  const exported = renderer.composeDocumentImage();
  return exported.getContext("2d").getImageData(0, 0, exported.width, exported.height).data;
}

function compare(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number) {
  let differing = 0;
  let maxDelta = 0;
  let first: Any = null;
  for (let index = 0; index < a.length; index += 4) {
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
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

export async function runN6Check(): Promise<Any> {
  const cases: Any[] = [
    {
      name: "stamped stroke, fractional coordinates",
      width: 160,
      height: 120,
      elements: [stroke([20.5, 60.25, 100.75], [20.5, 60.25, 20.5], { size: 12, stamp: true, stampSpacing: 0.1 })],
    },
    {
      name: "stamped stroke, integer coordinates",
      width: 160,
      height: 120,
      elements: [stroke([20, 60, 100], [20, 60, 20], { size: 12, stamp: true, stampSpacing: 0.1 })],
    },
    {
      name: "legacy stroke, fractional coordinates",
      width: 160,
      height: 120,
      elements: [stroke([20.5, 60.25, 100.75], [20.5, 60.25, 20.5], { size: 12 })],
    },
    {
      name: "stamped eraser over a painted stroke",
      width: 160,
      height: 120,
      elements: [
        stroke([20, 140], [60, 60], { size: 24, stamp: true, stampSpacing: 0.1 }),
        { ...stroke([60, 62], [60, 60], { size: 24, stamp: true, stampSpacing: 0.1 }), erase: true },
      ],
    },
    {
      name: "soft stamped eraser over a painted stroke",
      width: 160,
      height: 120,
      elements: [
        stroke([20, 140], [60, 60], { size: 24 }),
        { ...stroke([60, 62], [60, 60], { size: 24, hardness: 0.4 }), erase: true },
      ],
    },
    {
      name: "legacy eraser over a painted stroke",
      width: 160,
      height: 120,
      elements: [
        stroke([20, 140], [60, 60], { size: 24 }),
        { ...stroke([60, 62], [60, 60], { size: 24 }), erase: true },
      ],
    },
  ];
  const results = cases.map((testCase) => {
    const current = renderDocument(CurrentRenderer, testCase.width, testCase.height, testCase.elements);
    const mutant = renderDocument(MutantRenderer, testCase.width, testCase.height, testCase.elements);
    return { name: testCase.name, ...compare(current, mutant, testCase.width, testCase.height) };
  });
  return { at: new Date().toISOString(), results };
}

(window as any).__qaN6 = { runN6Check };
