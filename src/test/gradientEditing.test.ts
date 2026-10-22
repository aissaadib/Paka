/**
 * On-canvas gradient editing.
 *
 * A gradient is geometry plus stops, so editing it is a matter of moving two
 * points. These tests pin the rules that make that editing safe:
 *
 *  - the handles are the gradient's own points, and only the nearest one
 *    within the grab radius is grabbed;
 *  - a drag previews the new geometry on the layer and records **one** undo
 *    step on the release, never one per pointer sample;
 *  - a cancel restores the committed gradient **exactly** and records nothing;
 *  - the overlay that shows the handles is display-only: it never reaches an
 *    export, and it never reaches the project file.
 *
 * The suite runs in plain Node, so Canvas 2D is faked with the recording
 * canvas, exactly as the renderer suite does.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGradientEditCommand } from "../core/commands/gradientEditCommand";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import { createDocument } from "../core/document/document";
import type { GradientRecord, LayerElement } from "../core/document/types";
import { isGradient } from "../core/document/types";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import {
  findGradientHandle,
  gradientGeometryHit,
  gradientHandles,
  moveGradientHandle,
} from "../core/gradient/gradientHandles";
import { parseProject } from "../core/project/projectFormat";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import type {
  DrawingRenderer,
  RendererGradientOverlay,
  RendererSelection,
  Rgb,
  StrokeSource,
} from "../core/rendering/types";
import type { PointerSample } from "../types/pointer";
import {
  installRecordingDocument,
  RecordingCanvas,
  type RecordingDocument,
} from "./support/recordingCanvas";

function createSample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    phase: "move",
    pointerId: 1,
    kind: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: 0,
    docY: 0,
    screenX: 0,
    screenY: 0,
    pressure: 0.7,
    hasPressure: true,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    ...overrides,
  };
}

function createGradient(overrides: Partial<GradientRecord> = {}): GradientRecord {
  return {
    id: "gradient-1",
    layerId: "layer-a",
    kind: "gradient",
    type: "linear",
    x1: 10,
    y1: 10,
    x2: 30,
    y2: 10,
    stops: [
      { offset: 0, color: "#112233" },
      { offset: 1, color: "#ddeeff" },
    ],
    opacity: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------- pure geometry

describe("gradient handles", () => {
  it("puts the handles on the gradient's own points", () => {
    const handles = gradientHandles(createGradient());
    expect(handles.start).toEqual({ x: 10, y: 10 });
    expect(handles.end).toEqual({ x: 30, y: 10 });
  });

  it("grabs the nearest handle within the radius and none outside it", () => {
    const handles = gradientHandles(createGradient());
    expect(findGradientHandle(handles, 11, 12, 5)).toBe("start");
    expect(findGradientHandle(handles, 29, 11, 5)).toBe("end");
    expect(findGradientHandle(handles, 20, 30, 5)).toBeNull();
  });

  it("moves only the handle that was grabbed", () => {
    const gradient = createGradient();
    const moved = moveGradientHandle(gradient, "end", 40, 50);
    expect(moved).toMatchObject({ x1: 10, y1: 10, x2: 40, y2: 50 });
    // The stops and the opacity are untouched: only the geometry moves.
    expect(moved.stops).toEqual(gradient.stops);
    expect(moved.opacity).toBe(gradient.opacity);
    // A move that changes nothing returns the same record.
    expect(moveGradientHandle(gradient, "end", 30, 10)).toBe(gradient);
  });

  it("keeps a radial radius handle off the centre", () => {
    const radial = createGradient({ type: "radial", x1: 10, y1: 10, x2: 20, y2: 10 });
    const moved = moveGradientHandle(radial, "end", 10, 10);
    // The pointer is on the centre: the radius keeps its direction and its
    // minimum length, so the gradient still draws something.
    expect(Math.hypot(moved.x2 - moved.x1, moved.y2 - moved.y1)).toBeGreaterThan(0);
    expect(moved.y2).toBeCloseTo(moved.y1, 6);
  });

  it("hits the axis of a linear gradient and the circle of a radial one", () => {
    const linear = createGradient();
    expect(gradientGeometryHit(linear, 20, 10, 2)).toBe(true);
    expect(gradientGeometryHit(linear, 20, 30, 2)).toBe(false);

    const radial = createGradient({ type: "radial", x1: 10, y1: 10, x2: 30, y2: 10 });
    // The circle of radius 20 around the centre.
    expect(gradientGeometryHit(radial, 30, 10, 2)).toBe(true);
    expect(gradientGeometryHit(radial, 25, 10, 2)).toBe(false);
    // The centre is a handle of its own, so it is a target too.
    expect(gradientGeometryHit(radial, 10, 10, 2)).toBe(true);
  });
});

describe("createGradientEditCommand", () => {
  function createHost() {
    const elements: LayerElement[] = [];
    const refreshed: string[] = [];
    return {
      elements,
      refreshed,
      host: {
        replace(element: LayerElement) {
          const index = elements.findIndex((entry) => entry.id === element.id);
          if (index === -1) {
            elements.push(element);
            return;
          }
          elements[index] = element;
        },
        refresh(layerId: string) {
          refreshed.push(layerId);
        },
      },
    };
  }

  it("swaps the record on apply and puts the original back on revert", () => {
    const { host, elements, refreshed } = createHost();
    const original = createGradient();
    const next = createGradient({ x2: 44, y2: 55 });
    elements.push(original);

    const command = createGradientEditCommand(original, next, host);
    command.apply();
    expect(elements[0]).toBe(next);
    expect(refreshed).toEqual(["layer-a"]);

    command.revert();
    expect(elements[0]).toBe(original);
    expect(refreshed).toEqual(["layer-a", "layer-a"]);
  });

  it("merges a run of edits into one step that spans the whole run", () => {
    const { host, elements } = createHost();
    const original = createGradient();
    elements.push(original);

    const first = createGradientEditCommand(original, createGradient({ x2: 31 }), host, "run");
    const second = createGradientEditCommand(
      createGradient({ x2: 31 }),
      createGradient({ x2: 32 }),
      host,
      "run",
    );
    const merged = first.mergeWith?.(second);
    expect(merged).toBeDefined();

    merged?.apply();
    expect(elements[0]).toMatchObject({ x2: 32 });
    merged?.revert();
    // The merged step goes back to where the run started.
    expect(elements[0]).toBe(original);
  });
});

// ------------------------------------------------------------------- the engine

interface SpyRenderer {
  readonly renderer: DrawingRenderer;
  readonly overlays: Array<RendererGradientOverlay | null>;
  readonly invalidated: string[];
}

function createSpyRenderer(): SpyRenderer {
  const overlays: Array<RendererGradientOverlay | null> = [];
  const invalidated: string[] = [];
  const renderer = {
    kind: "canvas2d",
    setDocument: () => {},
    setViewport: () => {},
    setDisplaySize: () => {},
    setRasterScale: () => {},
    invalidateLayer: (layerId: string) => {
      invalidated.push(layerId);
    },
    beginStroke: () => {},
    extendStroke: () => {},
    replaceStroke: () => {},
    endStroke: () => {},
    cancelStroke: () => {},
    setSelection: (_selection: RendererSelection | null) => {},
    setGradientOverlay: (overlay: RendererGradientOverlay | null) => {
      overlays.push(overlay);
    },
    setSelectedGuide: () => {},
    setGrid: () => {},
    setRulers: () => {},
    setSymmetry: () => {},
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    renderOverview: () => null,
    readCompositePixel: (): Rgb | null => null,
    readCompositeImage: (): ImageData | null => null,
    render: () => {},
    requestRender: () => {},
    destroy: () => {},
  } as unknown as DrawingRenderer;
  return { renderer, overlays, invalidated };
}

function createGradientEngine() {
  const spy = createSpyRenderer();
  const engine = new DrawingEngine({
    document: createDocument({ name: "Test", width: 100, height: 100 }),
    renderer: spy.renderer,
    brush: { ...DEFAULT_BRUSH, color: "#ff0000" },
  });
  engine.setTool("gradient");
  return { engine, spy };
}

/** Draws a gradient and leaves it committed and selected. */
function drawGradient(
  engine: DrawingEngine,
  from: { x: number; y: number },
  to: { x: number; y: number },
): GradientRecord {
  engine.handlePointerSample(
    createSample({ phase: "down", docX: from.x, docY: from.y, button: 0, buttons: 1 }),
  );
  engine.handlePointerSample(
    createSample({ phase: "up", docX: to.x, docY: to.y, button: 0, buttons: 0 }),
  );
  const layerId = engine.getState().document.activeLayerId as string;
  const element = engine.listElements(layerId)[0];
  if (!isGradient(element)) {
    throw new Error("expected a gradient");
  }
  return element;
}

describe("DrawingEngine gradient editing", () => {
  it("selects a gradient when the press lands on its geometry", () => {
    const { engine, spy } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    const layerId = engine.getState().document.activeLayerId as string;
    const gradient = engine.listElements(layerId)[0];

    // A press on the axis selects the gradient and shows its handles.
    engine.handlePointerSample(
      createSample({ phase: "down", docX: 50, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 50, docY: 50, button: 0, buttons: 0 }),
    );

    expect(engine.getState().selectedGradient).toMatchObject({
      id: isGradient(gradient) ? gradient.id : "",
      type: "linear",
      x1: 20,
      y1: 50,
      x2: 80,
      y2: 50,
    });
    const overlay = spy.overlays[spy.overlays.length - 1];
    expect(overlay).toMatchObject({ type: "linear", start: { x: 20, y: 50 } });
  });

  it("previews a dragged handle and records one undo step on the release", () => {
    const { engine, spy } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    const layerId = engine.getState().document.activeLayerId as string;
    // The gradient is on disk now, so the drag is the only change from here.
    engine.markSaved("/tmp/gradient.paka");
    const before = engine.getState().history.depth;

    // Grab the end handle and drag it.
    engine.handlePointerSample(
      createSample({ phase: "down", docX: 80, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 60, docY: 20, button: 0, buttons: 1 }),
    );

    // The preview is on the layer already, but nothing entered history.
    const preview = engine.listElements(layerId)[0];
    expect(preview).toMatchObject({ x2: 60, y2: 20 });
    expect(engine.getState().history.depth).toBe(before);
    expect(engine.getState().file.dirty).toBe(false);
    expect(spy.invalidated).toContain(layerId);

    engine.handlePointerSample(
      createSample({ phase: "up", docX: 60, docY: 20, button: 0, buttons: 0 }),
    );

    // The release records exactly one step.
    expect(engine.getState().history.depth).toBe(before + 1);
    expect(engine.getState().file.dirty).toBe(true);
    expect(engine.listElements(layerId)[0]).toMatchObject({ x2: 60, y2: 20 });
  });

  it("restores the committed gradient exactly when the drag is cancelled", () => {
    const { engine } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    const layerId = engine.getState().document.activeLayerId as string;
    const committed = engine.listElements(layerId)[0];
    const depth = engine.getState().history.depth;

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 80, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 30, docY: 90, button: 0, buttons: 1 }),
    );
    expect(engine.listElements(layerId)[0]).toMatchObject({ x2: 30, y2: 90 });

    engine.handlePointerSample(
      createSample({ phase: "cancel", docX: 30, docY: 90, button: 0, buttons: 0 }),
    );

    // The very same record is back, with its stops and its opacity.
    expect(engine.listElements(layerId)[0]).toBe(committed);
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("restores the committed gradient when the drag is abandoned with Escape", () => {
    const { engine } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    const layerId = engine.getState().document.activeLayerId as string;
    const committed = engine.listElements(layerId)[0];

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 80, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 40, docY: 40, button: 0, buttons: 1 }),
    );

    engine.cancelGradientGesture();

    expect(engine.listElements(layerId)[0]).toBe(committed);
    expect(engine.getState().selectedGradient).toBeNull();
  });

  it("undoes and redoes the edited geometry", () => {
    const { engine } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 80, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 40, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 40, docY: 50, button: 0, buttons: 0 }),
    );
    expect(engine.listElements(layerId)[0]).toMatchObject({ x2: 40 });

    expect(engine.undo()).toBe(true);
    expect(engine.listElements(layerId)[0]).toMatchObject({ x2: 80 });

    expect(engine.redo()).toBe(true);
    expect(engine.listElements(layerId)[0]).toMatchObject({ x2: 40 });
  });

  it("records nothing when the handle ends where it started", () => {
    const { engine } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    const layerId = engine.getState().document.activeLayerId as string;
    const depth = engine.getState().history.depth;

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 80, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 60, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 80, docY: 50, button: 0, buttons: 0 }),
    );

    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.listElements(layerId)[0]).toMatchObject({ x2: 80 });
  });

  it("nudges the focused handle with the arrow keys and coalesces the run", () => {
    const { engine } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    const layerId = engine.getState().document.activeLayerId as string;

    // Focus the end handle by pressing it.
    engine.handlePointerSample(
      createSample({ phase: "down", docX: 80, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 80, docY: 50, button: 0, buttons: 0 }),
    );
    expect(engine.getState().selectedGradient?.handle).toBe("end");
    const depth = engine.getState().history.depth;

    expect(engine.nudgeGradientHandle(1, 0)).toBe(true);
    expect(engine.nudgeGradientHandle(0, 2)).toBe(true);

    expect(engine.listElements(layerId)[0]).toMatchObject({ x2: 81, y2: 52 });
    // Two nudges of the same handle are one history step.
    expect(engine.getState().history.depth).toBe(depth + 1);

    engine.undo();
    expect(engine.listElements(layerId)[0]).toMatchObject({ x2: 80, y2: 50 });
  });

  it("drops the selection when the tool changes", () => {
    const { engine, spy } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });

    engine.setTool("brush");

    expect(engine.getState().selectedGradient).toBeNull();
    expect(spy.overlays[spy.overlays.length - 1]).toBeNull();
  });

  it("restores the committed gradient when a handle lands on its partner", () => {
    const { engine } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    const layerId = engine.getState().document.activeLayerId as string;
    const committed = engine.listElements(layerId)[0];
    const depth = engine.getState().history.depth;

    // Drag the end handle onto the start handle: the gradient would draw
    // nothing, so the committed one stands.
    engine.handlePointerSample(
      createSample({ phase: "down", docX: 80, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 20, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 20, docY: 50, button: 0, buttons: 0 }),
    );

    expect(engine.listElements(layerId)[0]).toBe(committed);
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("drops the selection when the active layer changes", () => {
    const { engine } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    expect(engine.getState().selectedGradient).not.toBeNull();

    engine.addLayer();

    expect(engine.getState().selectedGradient).toBeNull();
  });

  it("drops the selection when an undo removes the gradient", () => {
    const { engine } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    expect(engine.getState().selectedGradient).not.toBeNull();

    expect(engine.undo()).toBe(true);

    expect(engine.getState().selectedGradient).toBeNull();
  });

  it("drops the selection when a new document replaces the drawing", () => {
    const { engine } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    expect(engine.getState().selectedGradient).not.toBeNull();

    engine.newDocument({ width: 100, height: 100 });

    expect(engine.getState().selectedGradient).toBeNull();
  });

  it("keeps the committed gradient's stops through a geometry edit", () => {
    const { engine } = createGradientEngine();
    // The middle stops of the *next* gradient are editor state; the committed
    // gradient carries its own stops.
    engine.setGradientMidStops([{ offset: 0.5, color: "#00ff00" }]);
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });
    const layerId = engine.getState().document.activeLayerId as string;
    const committed = engine.listElements(layerId)[0];
    const stops = isGradient(committed) ? committed.stops : [];

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 80, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 40, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 40, docY: 50, button: 0, buttons: 0 }),
    );

    const edited = engine.listElements(layerId)[0];
    expect(isGradient(edited) ? edited.stops : []).toEqual(stops);
    // The editor's own state is untouched: selecting and editing a committed
    // gradient never rewrites the next drag's stops.
    expect(engine.getState().gradientMidStops).toEqual([
      { offset: 0.5, color: "#00ff00" },
    ]);
  });

  it("keeps the edited geometry through a save and reopen", () => {
    const { engine } = createGradientEngine();
    drawGradient(engine, { x: 20, y: 50 }, { x: 80, y: 50 });

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 80, docY: 50, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 35, docY: 15, button: 0, buttons: 1 }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 35, docY: 15, button: 0, buttons: 0 }),
    );

    const json = engine.serialize();
    const parsed = parseProject(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const element = parsed.project.elements[0];
    expect(isGradient(element)).toBe(true);
    if (isGradient(element)) {
      expect(element).toMatchObject({ x1: 20, y1: 50, x2: 35, y2: 15 });
    }
  });
});

// ------------------------------------------------------------------ the renderer

describe("Canvas2DRenderer gradient overlay", () => {
  let recording: RecordingDocument;

  beforeEach(() => {
    recording = installRecordingDocument();
  });

  afterEach(() => {
    recording.restore();
  });

  function createHarness() {
    const display = new RecordingCanvas();
    const strokeSource: StrokeSource = {
      listStrokes: () => [],
      listElements: () => [],
    };
    const renderer = new Canvas2DRenderer({
      canvas: display.asElement(),
      strokeSource,
      scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
    });
    return {
      renderer,
      display,
      composeDocument: () => renderer.composeDocumentImage() as unknown as RecordingCanvas,
    };
  }

  it("draws the axis and the handles on the display canvas only", () => {
    const doc = createDocument({ width: 100, height: 80 });
    const harness = createHarness();
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.setGradientOverlay({
      type: "linear",
      start: { x: 10, y: 40 },
      end: { x: 60, y: 40 },
      activeHandle: null,
    });
    harness.display.calls.length = 0;
    harness.renderer.render();

    // The axis: one stroked line between the two handles.
    const lines = harness.display.named("stroke");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].strokeStyle).toBe("#8a6bff");

    // The handles: a square on each end, eight device pixels wide.
    const fills = harness.display.named("fillRect").filter((call) => call.args[2] === 8);
    expect(fills).toHaveLength(2);
    expect(fills[0].args).toEqual([6, 36, 8, 8]);

    // And none of it reaches the export.
    const composed = harness.composeDocument();
    expect(composed.named("fillRect").filter((call) => call.args[2] === 8)).toHaveLength(0);
  });

  it("draws the circle of a radial gradient", () => {
    const doc = createDocument({ width: 100, height: 80 });
    const harness = createHarness();
    harness.renderer.setDocument(doc);
    harness.renderer.setDisplaySize(100, 80, 1);
    harness.renderer.setGradientOverlay({
      type: "radial",
      start: { x: 50, y: 40 },
      end: { x: 80, y: 40 },
      activeHandle: "end",
    });
    harness.display.calls.length = 0;
    harness.renderer.render();

    const arcs = harness.display.named("arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0].args).toEqual([50, 40, 30, 0, Math.PI * 2]);

    // The dragged handle is filled with the accent, the other one is white.
    const fills = harness.display.named("fillRect").filter((call) => call.args[2] === 8);
    expect(fills).toHaveLength(2);
    expect(fills[1].fillStyle).toBe("#8a6bff");
    expect(fills[0].fillStyle).toBe("#ffffff");
  });
});
