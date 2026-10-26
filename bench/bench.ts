/**
 * The in-page half of the renderer benchmark.
 *
 * It drives the product's own `Canvas2DRenderer` through the same entry points
 * the engine uses - `beginStroke` / `extendStroke` / `render` / `endStroke`,
 * `replaceStroke`, `invalidateLayer` - and times the work on the main thread.
 * No internal is reached into and nothing is mocked, so the numbers describe
 * the renderer this build actually ships.
 *
 * What it measures, and what it does not:
 *
 *  - `medianMs` is the **main-thread** time of one workload: the JavaScript and
 *    the canvas command submission the pointer handler would pay. That is the
 *    part that blocks the next input event.
 *  - `flushMs` is a separate, clearly labelled measurement: the wall time of
 *    `createImageBitmap(display)` after the workload, which forces the browser
 *    to finish the queued rasterization. It includes the bitmap allocation, so
 *    it is a *relative* signal only - never a claim about a single frame.
 *  - It does **not** measure stylus input, the Tauri webview, GPU time, or a
 *    packaged build. Those need the real app on real hardware and are recorded
 *    as unmeasured in the report.
 *
 * The workloads are deterministic: one seeded PRNG builds the paths, so a
 * before/after run draws exactly the same strokes.
 */

import { Canvas2DRenderer } from "../src/core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../src/core/rendering/frameScheduler";
import { createDocument } from "../src/core/document/document";
import { DEFAULT_BRUSH } from "../src/core/brushes/defaults";
import { isStroke } from "../src/core/document/types";
import type {
  DrawingDocument,
  LayerElement,
  LayerId,
  StrokeRecord,
} from "../src/core/document/types";
import type { BrushSettings } from "../src/types/brush";

/** The CSS size of the display canvas every workload renders into. */
const DISPLAY_WIDTH = 1280;
const DISPLAY_HEIGHT = 800;

/** Samples in a live stroke; a render is issued every `RENDER_EVERY`. */
const LIVE_SAMPLES = 240;
const RENDER_EVERY = 4;

const HARD_BRUSH: BrushSettings = { ...DEFAULT_BRUSH, size: 8, color: "#16181c" };
const SOFT_BRUSH: BrushSettings = { ...DEFAULT_BRUSH, size: 40, hardness: 0.15, color: "#e5484d" };
const TEXTURED_BRUSH: BrushSettings = {
  ...DEFAULT_BRUSH,
  size: 28,
  texture: 0.75,
  color: "#3b82f6",
};
const STAMPED_BRUSH: BrushSettings = {
  ...DEFAULT_BRUSH,
  size: 36,
  stamp: true,
  stampSpacing: 0.15,
  stampHardness: 0.7,
  stampTexture: 0.5,
  tip: "felt",
  color: "#8b5cf6",
};

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

/** A small deterministic PRNG (mulberry32), so every run draws the same paths. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

interface Path {
  readonly xs: number[];
  readonly ys: number[];
  readonly pressures: number[];
  readonly times: number[];
}

/** A wandering path that stays inside the paper, so no workload is clipped away. */
function makePath(samples: number, width: number, height: number, seed: number): Path {
  const random = seededRandom(seed);
  const inset = Math.min(width, height) * 0.08;
  const step = Math.max(2, Math.min(width, height) / (samples * 1.4));
  let x = inset + random() * (width - inset * 2);
  let y = inset + random() * (height - inset * 2);
  let angle = random() * Math.PI * 2;
  const xs: number[] = [];
  const ys: number[] = [];
  const pressures: number[] = [];
  const times: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    angle += (random() - 0.5) * 0.7;
    x = Math.min(width - inset, Math.max(inset, x + Math.cos(angle) * step));
    y = Math.min(height - inset, Math.max(inset, y + Math.sin(angle) * step));
    xs.push(x);
    ys.push(y);
    pressures.push(0.35 + random() * 0.65);
    times.push(index * 8);
  }
  return { xs, ys, pressures, times };
}

interface Target {
  readonly renderer: Canvas2DRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly doc: DrawingDocument;
  readonly layerId: LayerId;
  readonly elements: Map<LayerId, LayerElement[]>;
}

/** A renderer on a document of `size` square, ready for a workload. */
function createTarget(size: number, rasterScale = 1): Target {
  const doc = createDocument({ width: size, height: size });
  const layerId = doc.layers[0].id;
  const elements = new Map<LayerId, LayerElement[]>([[layerId, []]]);
  const canvas = document.createElement("canvas");
  const renderer = new Canvas2DRenderer({
    canvas,
    strokeSource: {
      listStrokes: (id: LayerId) => (elements.get(id) ?? []).filter(isStroke),
      listElements: (id: LayerId) => elements.get(id) ?? [],
    },
    rasterScale,
    // Every render is issued explicitly, so the benchmark never depends on the
    // app's animation loop (or on a background tab's suspended rAF).
    scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
  });
  renderer.setDocument(doc);
  renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
  renderer.setDisplaySize(DISPLAY_WIDTH, DISPLAY_HEIGHT, 1);
  renderer.setRasterScale(rasterScale);
  return { renderer, canvas, doc, layerId, elements };
}

/** A stroke record with one sample, the state `beginStroke` is given. */
function startStroke(brush: BrushSettings, layerId: LayerId, path: Path): StrokeRecord {
  return {
    id: nextId("stroke"),
    layerId,
    brush,
    xs: [path.xs[0]],
    ys: [path.ys[0]],
    pressures: [path.pressures[0]],
    times: [path.times[0]],
    startTime: 0,
  };
}

/**
 * One live stroke, exactly as the engine feeds it: the record's arrays grow in
 * place, `extendStroke` is told where the new samples start, and a frame is
 * rendered every `RENDER_EVERY` samples.
 */
function liveStroke(
  target: Target,
  brush: BrushSettings,
  path: Path,
  renderEvery = RENDER_EVERY,
): StrokeRecord {
  const stroke = startStroke(brush, target.layerId, path);
  target.renderer.beginStroke(stroke);
  let sinceRender = 0;
  for (let index = 1; index < path.xs.length; index += 1) {
    stroke.xs.push(path.xs[index]);
    stroke.ys.push(path.ys[index]);
    stroke.pressures.push(path.pressures[index]);
    stroke.times.push(path.times[index]);
    target.renderer.extendStroke(stroke, index);
    sinceRender += 1;
    if (sinceRender >= renderEvery) {
      target.renderer.render();
      sinceRender = 0;
    }
  }
  target.renderer.render();
  target.renderer.endStroke(stroke);
  target.renderer.render();
  return stroke;
}

/** Commits `count` strokes across the paper and rebuilds the layer once. */
function seedStrokes(target: Target, count: number, brush: BrushSettings): void {
  const committed = target.elements.get(target.layerId);
  if (!committed) {
    return;
  }
  for (let index = 0; index < count; index += 1) {
    const path = makePath(40, target.doc.width, target.doc.height, 1000 + index);
    const stroke = startStroke(brush, target.layerId, path);
    stroke.xs.splice(0, 1, ...path.xs);
    stroke.ys.splice(0, 1, ...path.ys);
    stroke.pressures.splice(0, 1, ...path.pressures);
    stroke.times.splice(0, 1, ...path.times);
    target.renderer.beginStroke(stroke);
    target.renderer.extendStroke(stroke, 1);
    target.renderer.endStroke(stroke);
    committed.push(stroke);
  }
  target.renderer.invalidateLayer(target.layerId);
  target.renderer.render();
}

/** The outline of a rectangle, the way a shape drag replaces its geometry. */
function rectangleOutline(
  left: number,
  top: number,
  width: number,
  height: number,
  corners: number,
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const perSide = Math.max(2, Math.round(corners / 4));
  const cornersXY: readonly (readonly [number, number])[] = [
    [left, top],
    [left + width, top],
    [left + width, top + height],
    [left, top + height],
  ];
  for (let side = 0; side < 4; side += 1) {
    const [x0, y0] = cornersXY[side];
    const [x1, y1] = cornersXY[(side + 1) % 4];
    for (let step = 0; step < perSide; step += 1) {
      const t = step / perSide;
      xs.push(x0 + (x1 - x0) * t);
      ys.push(y0 + (y1 - y0) * t);
    }
  }
  xs.push(cornersXY[0][0]);
  ys.push(cornersXY[0][1]);
  return { xs, ys };
}

interface Workload {
  readonly name: string;
  readonly docSize: number;
  readonly repeats: number;
  readonly run: () => Target;
}

/** The workloads, each building its own renderer so the runs cannot interact. */
const WORKLOADS: readonly Workload[] = [
  {
    name: "stroke-hard-1024",
    docSize: 1024,
    repeats: 7,
    run: () => {
      const target = createTarget(1024);
      liveStroke(target, HARD_BRUSH, makePath(LIVE_SAMPLES, 1024, 1024, 11));
      return target;
    },
  },
  {
    name: "stroke-hard-2048",
    docSize: 2048,
    repeats: 7,
    run: () => {
      const target = createTarget(2048);
      liveStroke(target, HARD_BRUSH, makePath(LIVE_SAMPLES, 2048, 2048, 12));
      return target;
    },
  },
  {
    name: "stroke-hard-4096",
    docSize: 4096,
    repeats: 5,
    run: () => {
      const target = createTarget(4096);
      liveStroke(target, HARD_BRUSH, makePath(LIVE_SAMPLES, 4096, 4096, 13));
      return target;
    },
  },
  {
    name: "stroke-soft-2048",
    docSize: 2048,
    repeats: 5,
    run: () => {
      const target = createTarget(2048);
      liveStroke(target, SOFT_BRUSH, makePath(LIVE_SAMPLES, 2048, 2048, 21));
      return target;
    },
  },
  {
    name: "stroke-textured-2048",
    docSize: 2048,
    repeats: 5,
    run: () => {
      const target = createTarget(2048);
      liveStroke(target, TEXTURED_BRUSH, makePath(LIVE_SAMPLES, 2048, 2048, 31));
      return target;
    },
  },
  {
    name: "stroke-stamp-2048",
    docSize: 2048,
    repeats: 5,
    run: () => {
      const target = createTarget(2048);
      liveStroke(target, STAMPED_BRUSH, makePath(LIVE_SAMPLES, 2048, 2048, 41));
      return target;
    },
  },
  {
    name: "shape-replace-2048",
    docSize: 2048,
    repeats: 5,
    run: () => {
      const target = createTarget(2048);
      // A shape drag replaces its geometry on every move: 120 moves, each a
      // full buffer redraw and a frame.
      for (let move = 0; move < 120; move += 1) {
        const inset = 120 + move * 6;
        const outline = rectangleOutline(inset, inset, 2048 - inset * 2, 1400 - inset, 40);
        const stroke: StrokeRecord = {
          id: nextId("shape"),
          layerId: target.layerId,
          brush: HARD_BRUSH,
          xs: outline.xs,
          ys: outline.ys,
          pressures: outline.xs.map(() => 1),
          times: outline.xs.map((_, index) => index * 8),
          startTime: 0,
        };
        target.renderer.replaceStroke(stroke);
        target.renderer.render();
      }
      return target;
    },
  },
  {
    name: "erase-2048",
    docSize: 2048,
    repeats: 5,
    run: () => {
      const target = createTarget(2048);
      seedStrokes(target, 1, { ...HARD_BRUSH, size: 220 });
      const path = makePath(160, 2048, 2048, 51);
      const stroke = startStroke(HARD_BRUSH, target.layerId, path);
      (stroke as { erase?: boolean }).erase = true;
      target.renderer.beginStroke(stroke);
      for (let index = 1; index < path.xs.length; index += 1) {
        stroke.xs.push(path.xs[index]);
        stroke.ys.push(path.ys[index]);
        stroke.pressures.push(path.pressures[index]);
        stroke.times.push(path.times[index]);
        target.renderer.extendStroke(stroke, index);
        if (index % RENDER_EVERY === 0) {
          target.renderer.render();
        }
      }
      target.renderer.endStroke(stroke);
      target.renderer.render();
      return target;
    },
  },
  {
    name: "render-idle-2048",
    docSize: 2048,
    repeats: 5,
    run: () => {
      const target = createTarget(2048);
      seedStrokes(target, 40, HARD_BRUSH);
      for (let frame = 0; frame < 60; frame += 1) {
        target.renderer.render();
      }
      return target;
    },
  },
];

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

interface WorkloadResult {
  readonly name: string;
  readonly docSize: number;
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly runs: readonly number[];
  readonly flushMs: number | null;
}

/** Times one workload: one warm-up run, then the timed repeats. */
function measureWorkload(workload: Workload): WorkloadResult {
  workload.run();
  const runs: number[] = [];
  for (let repeat = 0; repeat < workload.repeats; repeat += 1) {
    const started = performance.now();
    workload.run();
    runs.push(performance.now() - started);
  }
  return {
    name: workload.name,
    docSize: workload.docSize,
    medianMs: round(median(runs)),
    minMs: round(Math.min(...runs)),
    maxMs: round(Math.max(...runs)),
    runs: runs.map(round),
    flushMs: null,
  };
}

/** Forces the queued rasterization to finish, as a relative throughput signal. */
async function measureFlush(workload: Workload): Promise<number | null> {
  const target = workload.run();
  const started = performance.now();
  try {
    await createImageBitmap(target.canvas);
  } catch {
    return null;
  }
  return round(performance.now() - started);
}

interface MemoryResult {
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly deltaBytes: number;
  readonly strokes: number;
}

interface HeapInfo {
  readonly memory?: { readonly usedJSHeapSize: number };
}

interface GcWindow {
  gc?: () => void;
}

/**
 * Retained-heap growth over repeated draw-and-commit cycles.
 *
 * The growth is measured *after* a forced collection, so it is retained memory
 * rather than garbage the collector has not run for yet. Without
 * `--expose-gc` the collection cannot be forced and the result is `null`: an
 * uncollected number would be noise, not a leak.
 */
function measureMemory(size: number, strokes: number): MemoryResult | null {
  const gc = (window as unknown as GcWindow).gc;
  const heap = (performance as unknown as HeapInfo).memory;
  if (!gc || !heap) {
    return null;
  }
  const target = createTarget(size);
  const committed = target.elements.get(target.layerId);
  if (!committed) {
    return null;
  }
  gc();
  const beforeBytes = heap.usedJSHeapSize;
  for (let index = 0; index < strokes; index += 1) {
    const path = makePath(60, size, size, 7000 + index);
    const stroke = startStroke(HARD_BRUSH, target.layerId, path);
    stroke.xs.splice(0, 1, ...path.xs);
    stroke.ys.splice(0, 1, ...path.ys);
    stroke.pressures.splice(0, 1, ...path.pressures);
    stroke.times.splice(0, 1, ...path.times);
    target.renderer.beginStroke(stroke);
    target.renderer.extendStroke(stroke, 1);
    target.renderer.endStroke(stroke);
    committed.push(stroke);
  }
  target.renderer.invalidateLayer(target.layerId);
  target.renderer.render();
  gc();
  const afterBytes = heap.usedJSHeapSize;
  return {
    beforeBytes,
    afterBytes,
    deltaBytes: afterBytes - beforeBytes,
    strokes,
  };
}

export interface BenchResult {
  readonly label: string;
  readonly userAgent: string;
  readonly hardwareConcurrency: number;
  readonly display: { readonly width: number; readonly height: number };
  readonly workloads: readonly WorkloadResult[];
  readonly memory: MemoryResult | null;
  readonly memoryFlushMs: number | null;
}

async function run(label: string): Promise<BenchResult> {
  const workloads: WorkloadResult[] = [];
  for (const workload of WORKLOADS) {
    const result = measureWorkload(workload);
    workloads.push({ ...result, flushMs: await measureFlush(workload) });
  }
  const memory = measureMemory(2048, 120);
  const memoryTarget = createTarget(2048);
  const memoryStarted = performance.now();
  await createImageBitmap(memoryTarget.canvas);
  return {
    label,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    display: { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT },
    workloads,
    memory,
    memoryFlushMs: round(performance.now() - memoryStarted),
  };
}

declare global {
  interface Window {
    pakaBench: {
      readonly ready: true;
      run: (label: string) => Promise<BenchResult>;
    };
  }
}

window.pakaBench = { ready: true, run };
