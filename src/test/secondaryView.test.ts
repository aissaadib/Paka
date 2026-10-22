/**
 * The second view of the canvas.
 *
 * A view is a *window* on the document, not a copy of it. These tests pin
 * down the three things that make that true and that a "second canvas" could
 * easily get wrong:
 *
 *  - **one document**: the second view shows the same document object, so it
 *    cannot drift away from the first one;
 *  - **one history and one dirty flag**: a stroke drawn in either view is one
 *    undo step, and opening or closing a view is not an edit;
 *  - **independent transforms**: the views have their own zoom, pan, rotation
 *    and mirror, and moving one leaves the other exactly where it was.
 *
 * The renderer is checked too: the two views are two display targets of the
 * *same* renderer, so they share the rasterized pixels instead of holding two
 * copies of the artwork.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import type { LayerId } from "../core/document/types";
import {
  CanvasViewRegistry,
  PRIMARY_VIEW_ID,
  SECONDARY_VIEW_ID,
  createCanvasView,
  sameViewSummaries,
  summarizeView,
  viewOrientation,
} from "../core/engine/canvasViews";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import type { StrokeSource } from "../core/rendering/types";
import type { PointerSample } from "../types/pointer";
import { installRecordingDocument, RecordingCanvas } from "./support/recordingCanvas";

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

function createEngine() {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
  });
}

/** A stroke drawn with the brush tool, from a press to a release. */
function drawStroke(engine: DrawingEngine, viewId: "primary" | "secondary" = "primary") {
  engine.handlePointerSample(
    createSample({ phase: "down", docX: 10, docY: 10, screenX: 10, screenY: 10 }),
    viewId,
  );
  engine.handlePointerSample(
    createSample({ phase: "move", docX: 40, docY: 30, screenX: 40, screenY: 30 }),
    viewId,
  );
  engine.handlePointerSample(
    createSample({ phase: "up", docX: 40, docY: 30, screenX: 40, screenY: 30 }),
    viewId,
  );
}

describe("the view registry", () => {
  it("keeps the views and the active one", () => {
    const registry = new CanvasViewRegistry();
    registry.add(createCanvasView(PRIMARY_VIEW_ID, { zoom: 1, offsetX: 0, offsetY: 0 }));
    registry.add(createCanvasView(SECONDARY_VIEW_ID, { zoom: 2, offsetX: 5, offsetY: 5 }));

    expect(registry.all()).toHaveLength(2);
    expect(registry.activeId).toBe(PRIMARY_VIEW_ID);
    expect(registry.setActive(SECONDARY_VIEW_ID)).toBe(true);
    expect(registry.activeId).toBe(SECONDARY_VIEW_ID);
    expect(registry.active.viewport.zoom).toBe(2);
  });

  it("refuses to focus a view that is not there", () => {
    const registry = new CanvasViewRegistry();
    registry.add(createCanvasView(PRIMARY_VIEW_ID, { zoom: 1, offsetX: 0, offsetY: 0 }));
    expect(registry.setActive(SECONDARY_VIEW_ID)).toBe(false);
    expect(registry.activeId).toBe(PRIMARY_VIEW_ID);
  });

  it("falls back to the primary view when the active one is removed", () => {
    const registry = new CanvasViewRegistry();
    registry.add(createCanvasView(PRIMARY_VIEW_ID, { zoom: 1, offsetX: 0, offsetY: 0 }));
    registry.add(createCanvasView(SECONDARY_VIEW_ID, { zoom: 2, offsetX: 0, offsetY: 0 }));
    registry.setActive(SECONDARY_VIEW_ID);

    registry.remove(SECONDARY_VIEW_ID);

    expect(registry.has(SECONDARY_VIEW_ID)).toBe(false);
    expect(registry.activeId).toBe(PRIMARY_VIEW_ID);
  });

  it("describes a view without handing out its transform", () => {
    const view = createCanvasView(PRIMARY_VIEW_ID, {
      zoom: 3,
      offsetX: 10,
      offsetY: 20,
      transform: { rotation: Math.PI / 2, mirrored: true },
    });
    view.size = { width: 800, height: 600 };

    expect(summarizeView(view)).toEqual({
      id: PRIMARY_VIEW_ID,
      zoom: 3,
      rotation: Math.PI / 2,
      mirrored: true,
      width: 800,
      height: 600,
    });
  });

  it("reads a view with no transform as upright and unmirrored", () => {
    expect(viewOrientation({ zoom: 1, offsetX: 0, offsetY: 0 })).toEqual({
      rotation: 0,
      mirrored: false,
    });
  });

  it("reports the same summaries for the same views", () => {
    const left = [summarizeView(createCanvasView(PRIMARY_VIEW_ID, { zoom: 1, offsetX: 0, offsetY: 0 }))];
    const right = [summarizeView(createCanvasView(PRIMARY_VIEW_ID, { zoom: 1, offsetX: 0, offsetY: 0 }))];
    expect(sameViewSummaries(left, right)).toBe(true);
  });
});

describe("the second view of the canvas", () => {
  it("shows the same document, not a copy of it", () => {
    const engine = createEngine();
    const before = engine.getState().document;

    engine.openSecondaryView();

    expect(engine.getState().document).toBe(before);
    expect(engine.secondaryViewOpen).toBe(true);
  });

  it("is not an edit: opening and closing it leaves the history and the dirty flag alone", () => {
    const engine = createEngine();
    const depth = engine.getState().history.depth;
    const dirty = engine.getState().file.dirty;

    engine.openSecondaryView();
    engine.closeSecondaryView();

    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.getState().file.dirty).toBe(dirty);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("keeps the document, the history and the dirty flag when it is closed", () => {
    const engine = createEngine();
    drawStroke(engine);
    const document = engine.getState().document;
    const depth = engine.getState().history.depth;

    engine.openSecondaryView();
    engine.closeSecondaryView();

    expect(engine.getState().document).toBe(document);
    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.getState().file.dirty).toBe(true);
  });

  it("records a stroke drawn in the second view as one undo step", () => {
    const engine = createEngine();
    engine.openSecondaryView();

    drawStroke(engine, SECONDARY_VIEW_ID);

    expect(engine.getState().history.depth).toBe(1);
    expect(engine.getState().file.dirty).toBe(true);
    const layerId = engine.getState().document.activeLayerId as LayerId;
    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });

  it("undoes a stroke drawn in the second view from the first one", () => {
    const engine = createEngine();
    engine.openSecondaryView();
    drawStroke(engine, SECONDARY_VIEW_ID);

    engine.undo();

    const layerId = engine.getState().document.activeLayerId as LayerId;
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("gives the two views their own transform", () => {
    const engine = createEngine();
    engine.setViewportSize(800, 600);
    engine.openSecondaryView();
    engine.setSecondaryViewSize(400, 300);

    const primaryBefore = engine.getState().viewport;
    engine.focusView(SECONDARY_VIEW_ID);
    engine.zoomTo(2);

    expect(engine.getState().viewport.zoom).toBe(2);
    expect(engine.getState().views.find((view) => view.id === SECONDARY_VIEW_ID)?.zoom).toBe(2);
    // The first view did not move: it is a different window, not a mirror of
    // the second one.
    expect(primaryBefore.zoom).toBe(engine.getState().views.find((view) => view.id === PRIMARY_VIEW_ID)?.zoom);
  });

  it("follows the view a press happened in", () => {
    const engine = createEngine();
    engine.openSecondaryView();
    expect(engine.getState().activeViewId).toBe(PRIMARY_VIEW_ID);

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 10, docY: 10, screenX: 10, screenY: 10 }),
      SECONDARY_VIEW_ID,
    );

    expect(engine.getState().activeViewId).toBe(SECONDARY_VIEW_ID);
  });

  it("reports both views, and only the open ones", () => {
    const engine = createEngine();
    expect(engine.getState().views.map((view) => view.id)).toEqual([PRIMARY_VIEW_ID]);

    engine.openSecondaryView();

    expect(engine.getState().views.map((view) => view.id)).toEqual([
      PRIMARY_VIEW_ID,
      SECONDARY_VIEW_ID,
    ]);
  });

  it("keeps the summary list stable when nothing changed", () => {
    const engine = createEngine();
    engine.openSecondaryView();
    const first = engine.getState().views;

    engine.setTool("eraser");

    expect(engine.getState().views).toBe(first);
  });

  it("turns the view of a wheel over the second view, and only that one", () => {
    const engine = createEngine();
    engine.setViewportSize(800, 600);
    engine.openSecondaryView();
    engine.setSecondaryViewSize(400, 300);
    const primaryZoom = engine.getState().views.find((view) => view.id === PRIMARY_VIEW_ID)?.zoom;
    const secondaryZoom =
      engine.getState().views.find((view) => view.id === SECONDARY_VIEW_ID)?.zoom ?? 1;

    engine.handleWheel(
      {
        screenX: 10,
        screenY: 10,
        deltaX: 0,
        deltaY: -100,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      },
      SECONDARY_VIEW_ID,
    );

    const secondary = engine.getState().views.find((view) => view.id === SECONDARY_VIEW_ID);
    const primary = engine.getState().views.find((view) => view.id === PRIMARY_VIEW_ID);
    expect(secondary?.zoom).toBeGreaterThan(secondaryZoom);
    expect(primary?.zoom).toBe(primaryZoom);
  });
});

describe("the renderer with two display targets", () => {
  let recording: ReturnType<typeof installRecordingDocument>;

  beforeEach(() => {
    recording = installRecordingDocument();
  });

  afterEach(() => {
    recording.restore();
  });

  function createRenderer() {
    const strokeSource: StrokeSource = {
      listStrokes: () => [],
      listElements: () => [],
    };
    const display = new RecordingCanvas();
    const renderer = new Canvas2DRenderer({
      canvas: display.asElement(),
      strokeSource,
      rasterScale: 1,
      scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
    });
    return { renderer, display };
  }

  it("paints every target it is given", () => {
    const { renderer, display } = createRenderer();
    const second = new RecordingCanvas();
    renderer.addDisplayTarget?.({
      id: SECONDARY_VIEW_ID,
      canvas: second.asElement(),
      viewport: { zoom: 1, offsetX: 0, offsetY: 0 },
    });
    renderer.setDisplaySize(400, 300, 1);
    renderer.setDisplayTargetSize?.(SECONDARY_VIEW_ID, 400, 300, 1);

    renderer.render();

    expect(display.calls.length).toBeGreaterThan(0);
    expect(second.calls.length).toBeGreaterThan(0);
  });

  it("shares the rasterized pixels between the targets", () => {
    const { renderer } = createRenderer();
    renderer.setDocument(createDocument({ name: "Test", width: 400, height: 300 }));
    renderer.setDisplaySize(400, 300, 1);
    renderer.render();
    const afterTheFirst = recording.allocated.length;

    const second = new RecordingCanvas();
    renderer.addDisplayTarget?.({
      id: SECONDARY_VIEW_ID,
      canvas: second.asElement(),
      viewport: { zoom: 1, offsetX: 0, offsetY: 0 },
    });
    renderer.setDisplayTargetSize?.(SECONDARY_VIEW_ID, 400, 300, 1);
    renderer.render();

    // The second view did not rasterize the artwork again: it reads the layer
    // surfaces the first view already built.
    expect(recording.allocated.length).toBe(afterTheFirst);
  });

  it("keeps painting the other target when one is removed", () => {
    const { renderer, display } = createRenderer();
    const second = new RecordingCanvas();
    renderer.addDisplayTarget?.({
      id: SECONDARY_VIEW_ID,
      canvas: second.asElement(),
      viewport: { zoom: 1, offsetX: 0, offsetY: 0 },
    });
    renderer.setDisplaySize(400, 300, 1);
    renderer.setDisplayTargetSize?.(SECONDARY_VIEW_ID, 400, 300, 1);

    renderer.removeDisplayTarget?.(SECONDARY_VIEW_ID);
    display.calls.length = 0;
    second.calls.length = 0;
    renderer.render();

    expect(display.calls.length).toBeGreaterThan(0);
    expect(second.calls.length).toBe(0);
  });
});
