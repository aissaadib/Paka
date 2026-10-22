/**
 * The overlay pipeline: registered chrome reaches the display canvas and
 * nothing else.
 *
 * The renderer used to draw the grid, the guides and the selection as special
 * cases. The registry turns the rest - rulers, axes, markers - into a list the
 * renderer paints, and this file pins the two halves of that contract:
 *
 *  - an overlay that registers is painted on the display canvas, with the
 *    frame's geometry;
 *  - an overlay's pixels cannot reach `composeDocumentImage`, which is what
 *    PNG export reads, so chrome can never end up in an exported drawing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import { resetRulerOverlayState } from "../core/rendering/rulerOverlay";
import { registerOverlay, resetOverlayRegistry } from "../core/shell/overlayRegistry";
import {
  installRecordingDocument,
  RecordingCanvas,
  type RecordingDocument,
} from "./support/recordingCanvas";

let recording: RecordingDocument;

beforeEach(() => {
  recording = installRecordingDocument();
});

afterEach(() => {
  recording.restore();
  resetOverlayRegistry();
  resetRulerOverlayState();
});

function createRenderer() {
  const display = new RecordingCanvas();
  const renderer = new Canvas2DRenderer({
    canvas: display.asElement(),
    strokeSource: { listStrokes: () => [], listElements: () => [] },
    rasterScale: 1,
    // Never fires: each test calls `render()` explicitly.
    scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
  });
  renderer.setDocument(createDocument({ width: 32, height: 24, background: "#ffffff" }));
  renderer.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
  renderer.setDisplaySize(160, 120, 2);
  return { renderer, display };
}

describe("the overlay pipeline", () => {
  it("paints a registered overlay on the display canvas", () => {
    const paint = vi.fn();
    registerOverlay({ id: "probe", layer: "over", order: 1, paint });
    const { renderer } = createRenderer();

    renderer.render();

    expect(paint).toHaveBeenCalledTimes(1);
  });

  it("hands the overlay the frame's geometry", () => {
    const paint = vi.fn();
    registerOverlay({ id: "probe", layer: "over", order: 1, paint });
    const { renderer } = createRenderer();

    renderer.render();

    const context = paint.mock.calls[0][0];
    expect(context.documentWidth).toBe(32);
    expect(context.documentHeight).toBe(24);
    // The renderer's scale is the device pixel ratio times the zoom.
    expect(context.scale).toBe(2);
    expect(context.devicePixelRatio).toBe(2);
    expect(context.viewport).toMatchObject({ zoom: 1, offsetX: 0, offsetY: 0 });
    expect(context.selectionBounds).toBeNull();
  });

  it("paints the under layer before the over layer", () => {
    const order: string[] = [];
    registerOverlay({ id: "over", layer: "over", order: 1, paint: () => order.push("over") });
    registerOverlay({ id: "under", layer: "under", order: 1, paint: () => order.push("under") });
    const { renderer } = createRenderer();

    renderer.render();

    expect(order).toEqual(["under", "over"]);
  });

  it("never paints an overlay into the export composite", () => {
    const chrome = "#ff00ff";
    registerOverlay({
      id: "chrome",
      layer: "over",
      order: 1,
      paint: ({ ctx }) => {
        ctx.fillStyle = chrome;
        ctx.fillRect(0, 0, 8, 8);
      },
    });
    const { renderer } = createRenderer();

    renderer.render();

    const exported = renderer.composeDocumentImage() as unknown as RecordingCanvas;
    expect(exported.calls.map((call) => call.fillStyle)).not.toContain(chrome);
  });

  it("keeps the selection frame's bounds in reach of the chrome", () => {
    const paint = vi.fn();
    registerOverlay({ id: "probe", layer: "over", order: 1, paint });
    const { renderer } = createRenderer();
    const bounds = { x: 2, y: 3, width: 10, height: 11 };
    renderer.setSelection({ bounds, strokes: [] });

    renderer.render();

    expect(paint.mock.calls[0][0].selectionBounds).toEqual(bounds);
  });
});

describe("the ruler toggle", () => {
  it("shows the rulers without editing the document", () => {
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 64, height: 48 }),
    });

    expect(engine.getState().rulersVisible).toBe(false);

    engine.setRulersVisible(true);

    expect(engine.getState().rulersVisible).toBe(true);
    // Display state: there is nothing to undo, and no step was recorded.
    expect(engine.undo()).toBe(false);
  });

  it("publishes once for a real change and not for a no-op", () => {
    const engine = new DrawingEngine({
      document: createDocument({ name: "Test", width: 64, height: 48 }),
    });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setRulersVisible(true);
    expect(listener).toHaveBeenCalledTimes(1);

    engine.setRulersVisible(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
