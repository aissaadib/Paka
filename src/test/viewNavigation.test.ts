/**
 * View navigation: the zoom, the view's orientation and what they may touch.
 *
 * The rules under test:
 *
 *  - a zoom is bounded: the canvas cannot show a zoom the viewport does not
 *    support, and the field that takes a typed zoom clamps rather than
 *    refuses;
 *  - the mapping between the screen and the document stays true under a
 *    rotation and a mirror, and a zoom keeps the point under the cursor;
 *  - a view action is **view only**: it moves the canvas, never the document,
 *    so it adds no history step and never marks the file unsaved;
 *  - a reset puts the view back the way it was found.
 */

import { describe, expect, it } from "vitest";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import type { DrawingRenderer } from "../core/rendering/types";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  docToScreen,
  screenToDoc,
  viewTransformOf,
  zoomAt,
} from "../core/rendering/viewport";
import {
  describeViewTransform,
  formatZoomPercent,
  parseZoomPercent,
  zoomPercentText,
} from "../features/view/viewNavigation";
import type { Size } from "../types/geometry";
import type { PointerPhase, PointerSample } from "../types/pointer";

const documentSize: Size = { width: 1600, height: 1200 };
const viewportSize: Size = { width: 800, height: 600 };

/**
 * A renderer that answers every call with a no-op.
 *
 * A proxy rather than a literal, so the spy does not have to be updated
 * whenever the renderer interface grows.
 */
function createSpyRenderer(): DrawingRenderer {
  const base = { kind: "canvas2d" as const };
  return new Proxy(base, {
    get(target, property, receiver) {
      if (typeof property === "symbol") {
        return Reflect.get(target, property, receiver);
      }
      if (property in target) {
        return Reflect.get(target, property, receiver);
      }
      return () => undefined;
    },
  }) as unknown as DrawingRenderer;
}

function createEngine() {
  const engine = new DrawingEngine({
    renderer: createSpyRenderer(),
    document: {
      id: "doc-1",
      name: "Test",
      width: documentSize.width,
      height: documentSize.height,
      background: "#ffffff",
      layers: [
        {
          id: "layer-1",
          name: "Layer 1",
          visible: true,
          opacity: 1,
          blendMode: "normal" as const,
        },
      ],
      activeLayerId: "layer-1",
      guides: [],
    },
  });
  engine.setViewportSize(viewportSize.width, viewportSize.height);
  return engine;
}

/** A pointer sample at a canvas position, as the input binder would send it. */
function pointerAt(
  screenX: number,
  screenY: number,
  phase: PointerPhase = "move",
  button = 0,
): PointerSample {
  return {
    phase,
    pointerId: 1,
    kind: "mouse",
    isPrimary: true,
    button,
    buttons: phase === "up" ? 0 : 1,
    docX: screenX,
    docY: screenY,
    screenX,
    screenY,
    pressure: 1,
    hasPressure: false,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

describe("the zoom field", () => {
  it("reads the three ways a zoom is written", () => {
    expect(parseZoomPercent("150")).toBeCloseTo(1.5, 9);
    expect(parseZoomPercent("150%")).toBeCloseTo(1.5, 9);
    expect(parseZoomPercent(" 150 % ")).toBeCloseTo(1.5, 9);
    expect(parseZoomPercent("1.5x")).toBeCloseTo(1.5, 9);
    expect(parseZoomPercent("1.5X")).toBeCloseTo(1.5, 9);
    expect(parseZoomPercent("100")).toBeCloseTo(1, 9);
  });

  it("refuses text that is not a zoom", () => {
    expect(parseZoomPercent("")).toBeNull();
    expect(parseZoomPercent("   ")).toBeNull();
    expect(parseZoomPercent("abc")).toBeNull();
    expect(parseZoomPercent("%")).toBeNull();
    expect(parseZoomPercent("0")).toBeNull();
    expect(parseZoomPercent("-50")).toBeNull();
  });

  it("clamps a zoom to the range the canvas supports", () => {
    expect(parseZoomPercent("100000")).toBe(MAX_ZOOM);
    expect(parseZoomPercent("0.001")).toBe(MIN_ZOOM);
    expect(parseZoomPercent("100000x")).toBe(MAX_ZOOM);
  });

  it("shows the zoom the canvas really has", () => {
    expect(formatZoomPercent(1)).toBe("100%");
    expect(formatZoomPercent(1.5)).toBe("150%");
    expect(formatZoomPercent(0.125)).toBe("12.5%");
    expect(formatZoomPercent(0.02)).toBe("2%");
    // The field holds a plain number; the unit sits beside it.
    expect(zoomPercentText(1)).toBe("100");
    expect(zoomPercentText(1.5)).toBe("150");
    expect(zoomPercentText(0.125)).toBe("12.5");
  });
});

describe("the engine's zoom", () => {
  it("clamps a zoom to the supported range", () => {
    const engine = createEngine();
    engine.zoomTo(1000);
    expect(engine.getState().viewport.zoom).toBe(MAX_ZOOM);
    engine.zoomTo(0.0001);
    expect(engine.getState().viewport.zoom).toBe(MIN_ZOOM);
  });

  it("keeps the point under the pointer where it is", () => {
    const engine = createEngine();
    engine.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
    // The pointer is over the canvas at (300, 200), so that is the point a
    // zoom has to keep where it is.
    engine.handlePointerSample(pointerAt(300, 200));
    const before = screenToDoc(engine.getState().viewport, 300, 200);

    engine.zoomTo(2.5);
    const after = screenToDoc(engine.getState().viewport, 300, 200);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("zooms around the middle of the window when the pointer is elsewhere", () => {
    const engine = createEngine();
    engine.setViewport({ zoom: 1, offsetX: 0, offsetY: 0 });
    const before = screenToDoc(engine.getState().viewport, 400, 300);

    engine.zoomTo(2.5);
    const after = screenToDoc(engine.getState().viewport, 400, 300);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe("the screen-to-document mapping", () => {
  it("round-trips a point through a turned and mirrored view", () => {
    const engine = createEngine();
    engine.rotateView(90);
    engine.toggleViewMirror();
    const viewport = engine.getState().viewport;

    for (const [x, y] of [
      [0, 0],
      [120, 340],
      [1600, 1200],
    ] as const) {
      const screen = docToScreen(viewport, x, y);
      const doc = screenToDoc(viewport, screen.x, screen.y);
      expect(doc.x).toBeCloseTo(x, 6);
      expect(doc.y).toBeCloseTo(y, 6);
    }
  });

  it("keeps the middle of the window where it was when the view turns", () => {
    const engine = createEngine();
    engine.setViewport({ zoom: 1.5, offsetX: -120, offsetY: 40 });
    const before = screenToDoc(engine.getState().viewport, 400, 300);

    engine.rotateView(90);
    const after = screenToDoc(engine.getState().viewport, 400, 300);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("keeps the point under the cursor where it is when the view is zoomed", () => {
    const viewport = { zoom: 1, offsetX: 0, offsetY: 0 };
    const anchor = screenToDoc(viewport, 250, 180);
    const zoomed = zoomAt(viewport, 250, 180, 3);
    const screen = docToScreen(zoomed, anchor.x, anchor.y);
    expect(screen.x).toBeCloseTo(250, 9);
    expect(screen.y).toBeCloseTo(180, 9);
  });
});

describe("a view action is view only", () => {
  it("leaves the document, the history and the dirty flag alone", () => {
    const engine = createEngine();
    const document = engine.getState().document;

    engine.zoomTo(2);
    engine.zoomIn();
    engine.zoomOut();
    engine.panViewportBy(120, -40);
    engine.rotateView(90);
    engine.toggleViewMirror();
    engine.resetView();

    const state = engine.getState();
    expect(state.document).toBe(document);
    expect(state.history.depth).toBe(0);
    expect(state.history.canUndo).toBe(false);
    expect(state.file.dirty).toBe(false);
  });

  it("does not dirty a document that was already saved", () => {
    const engine = createEngine();
    // A file that has been written is clean; a view change must not make it
    // look edited.
    engine.markSaved("/tmp/test.paka");
    expect(engine.getState().file.dirty).toBe(false);

    engine.rotateView(90);
    engine.toggleViewMirror();
    expect(engine.getState().file.dirty).toBe(false);
    expect(engine.getState().file.path).toBe("/tmp/test.paka");
  });
});

describe("panning the view", () => {
  it("pans instead of drawing while the modifier is held", () => {
    const engine = createEngine();
    const before = engine.getState().viewport;

    engine.setPanModifier(true);
    engine.handlePointerSample(pointerAt(100, 100, "down"));
    engine.handlePointerSample(pointerAt(160, 140, "move"));
    engine.handlePointerSample(pointerAt(160, 140, "up"));

    const after = engine.getState().viewport;
    expect(after.offsetX).toBe(before.offsetX + 60);
    expect(after.offsetY).toBe(before.offsetY + 40);
    // Nothing was drawn: the modifier changed the gesture, not the document.
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.listStrokes("layer-1")).toHaveLength(0);
    expect(engine.getState().file.dirty).toBe(false);
  });

  it("pans on a middle-button drag whatever the modifier says", () => {
    const engine = createEngine();
    const before = engine.getState().viewport;

    engine.handlePointerSample(pointerAt(100, 100, "down", 1));
    engine.handlePointerSample(pointerAt(120, 100, "move", 1));
    engine.handlePointerSample(pointerAt(120, 100, "up", 1));

    const after = engine.getState().viewport;
    expect(after.offsetX).toBe(before.offsetX + 20);
    expect(engine.listStrokes("layer-1")).toHaveLength(0);
  });

  it("does not interrupt a stroke that is already in flight", () => {
    const engine = createEngine();
    const before = engine.getState().viewport;
    engine.handlePointerSample(pointerAt(100, 100, "down"));
    // The modifier is pressed in the middle of the stroke: the stroke has to
    // finish as a stroke, not turn into a pan.
    engine.setPanModifier(true);
    engine.handlePointerSample(pointerAt(200, 150, "move"));
    engine.handlePointerSample(pointerAt(200, 150, "up"));

    const viewport = engine.getState().viewport;
    expect(viewport.offsetX).toBe(before.offsetX);
    expect(viewport.offsetY).toBe(before.offsetY);
    expect(engine.listStrokes("layer-1")).toHaveLength(1);
  });
});

describe("resetting the view", () => {
  it("puts the document back upright, unmirrored and fitted", () => {
    const engine = createEngine();
    engine.rotateView(90);
    engine.toggleViewMirror();
    engine.zoomTo(8);

    engine.resetView();

    const viewport = engine.getState().viewport;
    const transform = viewTransformOf(viewport);
    expect(transform.rotation).toBe(0);
    expect(transform.mirrored).toBe(false);
    // The whole 1600x1200 document fits in 800x600 with 32 px of padding.
    expect(viewport.zoom).toBeCloseTo(Math.min(736 / 1600, 536 / 1200), 9);
    // And it is centred.
    const centre = screenToDoc(viewport, viewportSize.width / 2, viewportSize.height / 2);
    expect(centre.x).toBeCloseTo(documentSize.width / 2, 6);
    expect(centre.y).toBeCloseTo(documentSize.height / 2, 6);
  });

  it("names the view's orientation only when it is not the default", () => {
    expect(describeViewTransform({ rotation: 0, mirrored: false })).toBe("upright");
    expect(describeViewTransform({ rotation: Math.PI / 2, mirrored: false })).toBe("rotated 90°");
    expect(describeViewTransform({ rotation: 0, mirrored: true })).toBe("mirrored");
  });
});
