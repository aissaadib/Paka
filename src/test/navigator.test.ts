import { describe, expect, it, vi } from "vitest";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import type { DrawingRenderer } from "../core/rendering/types";
import {
  docToScreen,
  rotateView,
  screenToDoc,
  toggleViewMirror,
} from "../core/rendering/viewport";
import {
  boundsOf,
  documentToNavigator,
  navigatorCorners,
  navigatorGrab,
  navigatorKeyStep,
  navigatorLayout,
  navigatorTargetCenter,
  navigatorToDocument,
  pointInPolygon,
  viewportCenter,
} from "../features/navigator/navigatorGeometry";
import type { Size } from "../types/geometry";
import type { Viewport } from "../types/viewport";

const documentSize: Size = { width: 1600, height: 1200 };
const panelSize: Size = { width: 200, height: 150 };
const viewportSize: Size = { width: 800, height: 600 };

/**
 * A renderer that records what the engine asks of it.
 *
 * The spy answers every call with a no-op, so it does not have to be updated
 * whenever the renderer interface grows: only the calls this file cares about
 * - the overview - are implemented for real.
 */
function createSpyRenderer() {
  let overviews = 0;
  const base = {
    kind: "canvas2d" as const,
    renderOverview: (width: number, height: number) => {
      overviews += 1;
      return { width, height } as unknown as HTMLCanvasElement;
    },
  };
  const renderer = new Proxy(base, {
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
  return { renderer, getOverviews: () => overviews };
}

function createEngine() {
  const spy = createSpyRenderer();
  const engine = new DrawingEngine({
    renderer: spy.renderer,
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
          blendMode: "normal",
        },
      ],
      activeLayerId: "layer-1",
      guides: [],
    },
  });
  engine.setViewportSize(viewportSize.width, viewportSize.height);
  return { engine, ...spy };
}

describe("navigator layout", () => {
  it("fits the document into the panel and keeps its aspect ratio", () => {
    const layout = navigatorLayout(documentSize, panelSize);
    // The height is the limit: 150 / 1200 = 0.125.
    expect(layout.scale).toBeCloseTo(0.125, 9);
    expect(layout.height).toBeCloseTo(150, 9);
    expect(layout.width).toBeCloseTo(200, 9);
    // The document exactly fills the panel in this case.
    expect(layout.offsetX).toBeCloseTo(0, 9);
    expect(layout.offsetY).toBeCloseTo(0, 9);
  });

  it("centres a document that does not fill the panel", () => {
    const layout = navigatorLayout({ width: 1000, height: 1000 }, panelSize);
    // The height is the limit: 150 / 1000 = 0.15, so the square document is
    // 150 x 150 in a 200 x 150 panel and is centred horizontally.
    expect(layout.width).toBeCloseTo(150, 9);
    expect(layout.height).toBeCloseTo(150, 9);
    expect(layout.offsetX).toBeCloseTo(25, 9);
    expect(layout.offsetY).toBeCloseTo(0, 9);
  });

  it("survives an empty document or an empty panel", () => {
    expect(navigatorLayout({ width: 0, height: 0 }, panelSize).scale).toBe(0);
    expect(navigatorLayout(documentSize, { width: 0, height: 0 }).scale).toBe(0);
  });

  it("round-trips a document point through the navigator", () => {
    const layout = navigatorLayout(documentSize, panelSize);
    const nav = documentToNavigator(layout, 800, 600);
    expect(nav.x).toBeCloseTo(100, 9);
    expect(nav.y).toBeCloseTo(75, 9);

    const doc = navigatorToDocument(layout, nav.x, nav.y);
    expect(doc.x).toBeCloseTo(800, 9);
    expect(doc.y).toBeCloseTo(600, 9);
  });
});

describe("the navigator's view of the viewport", () => {
  it("marks the visible area where the canvas really is", () => {
    const layout = navigatorLayout(documentSize, panelSize);
    const viewport: Viewport = { zoom: 1, offsetX: -100, offsetY: -50 };
    const corners = navigatorCorners(layout, viewport, viewportSize);

    // The canvas shows document x 100..900 and y 50..650.
    expect(corners[0].x).toBeCloseTo(100 * layout.scale, 9);
    expect(corners[0].y).toBeCloseTo(50 * layout.scale, 9);
    expect(corners[2].x).toBeCloseTo(900 * layout.scale, 9);
    expect(corners[2].y).toBeCloseTo(650 * layout.scale, 9);
  });

  it("reports the centre of the visible area in document coordinates", () => {
    const viewport: Viewport = { zoom: 2, offsetX: -100, offsetY: -50 };
    const center = viewportCenter(viewport, viewportSize);
    // The canvas centre (400, 300) is document (250, 175) at this zoom.
    expect(center.x).toBeCloseTo(250, 9);
    expect(center.y).toBeCloseTo(175, 9);
  });

  it("grows and shrinks with the zoom", () => {
    const layout = navigatorLayout(documentSize, panelSize);
    const near = boundsOf(
      navigatorCorners(layout, { zoom: 1, offsetX: 0, offsetY: 0 }, viewportSize),
    );
    const far = boundsOf(
      navigatorCorners(layout, { zoom: 4, offsetX: 0, offsetY: 0 }, viewportSize),
    );
    expect(near.width).toBeCloseTo(far.width * 4, 6);
    expect(near.height).toBeCloseTo(far.height * 4, 6);
  });

  it("marks the tilted area a turned view really shows", () => {
    const layout = navigatorLayout(documentSize, panelSize);
    const turned = rotateView({ zoom: 1, offsetX: 0, offsetY: 0 }, viewportSize, Math.PI / 4);
    const bounds = boundsOf(navigatorCorners(layout, turned, viewportSize));

    // A canvas of 800 x 600 document pixels turned by 45 degrees covers a
    // square whose side is (800 + 600) / sqrt(2) document pixels.
    const side = ((viewportSize.width + viewportSize.height) / Math.SQRT2) * layout.scale;
    expect(bounds.width).toBeCloseTo(side, 6);
    expect(bounds.height).toBeCloseTo(side, 6);
  });

  it("mirrors the marked area with the view", () => {
    const layout = navigatorLayout(documentSize, panelSize);
    const plain = { zoom: 1, offsetX: -100, offsetY: -50 };
    const mirrored = toggleViewMirror(plain, viewportSize);
    const plainCorners = navigatorCorners(layout, plain, viewportSize);
    const mirroredCorners = navigatorCorners(layout, mirrored, viewportSize);

    // The mirror flips the view left to right, so the marked area's top-left
    // corner is the upright view's top-right corner.
    expect(mirroredCorners[0].x).toBeCloseTo(plainCorners[1].x, 6);
    expect(mirroredCorners[0].y).toBeCloseTo(plainCorners[1].y, 6);
    expect(mirroredCorners[2].x).toBeCloseTo(plainCorners[3].x, 6);
  });
});

describe("pointing in the navigator", () => {
  const layout = navigatorLayout(documentSize, panelSize);
  const viewport: Viewport = { zoom: 1, offsetX: -100, offsetY: -50 };

  it("knows whether the pointer is inside the visible area", () => {
    // The canvas shows document 100..900 x 50..650, which in the navigator is
    // 12.5..112.5 x 6.25..81.25.
    const inside = navigatorGrab(layout, viewport, viewportSize, 50, 40);
    expect(inside.inside).toBe(true);

    const outside = navigatorGrab(layout, viewport, viewportSize, 150, 120);
    expect(outside.inside).toBe(false);
  });

  it("jumps the view onto a pointer outside the visible area", () => {
    const grab = navigatorGrab(layout, viewport, viewportSize, 150, 120);
    const target = navigatorTargetCenter(grab, layout, 150, 120);
    // The pointer is over document (1200, 960), so the view centres there.
    expect(target.x).toBeCloseTo(1200, 9);
    expect(target.y).toBeCloseTo(960, 9);
  });

  it("keeps the grabbed offset while the pointer drags the view", () => {
    const grab = navigatorGrab(layout, viewport, viewportSize, 50, 40);
    // The pointer is over document (400, 320) and the view's centre is at
    // (500, 350), so it was grabbed 100 pixels to the left of the centre.
    expect(grab.offset.x).toBeCloseTo(-100, 6);
    expect(grab.offset.y).toBeCloseTo(-30, 6);

    const target = navigatorTargetCenter(grab, layout, 60, 40);
    // The view followed the pointer: the centre is still 100 pixels to the
    // right of the document point under the pointer.
    const moved = navigatorToDocument(layout, 60, 40);
    expect(target.x).toBeCloseTo(moved.x + 100, 6);
    expect(target.y).toBeCloseTo(moved.y + 30, 6);
  });

  it("does not move the view when a pointer inside it is only pressed", () => {
    const grab = navigatorGrab(layout, viewport, viewportSize, 50, 40);
    const target = navigatorTargetCenter(grab, layout, 50, 40);
    expect(target.x).toBeCloseTo(viewportCenter(viewport, viewportSize).x, 6);
    expect(target.y).toBeCloseTo(viewportCenter(viewport, viewportSize).y, 6);
  });

  it("steps a fraction of the visible area for an arrow key", () => {
    const step = navigatorKeyStep(viewport, viewportSize);
    // The canvas shows 800 x 600 document pixels; a tenth of that.
    expect(step.x).toBeCloseTo(80, 6);
    expect(step.y).toBeCloseTo(60, 6);
  });

  it("tests a point against a polygon", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
  });
});

describe("the engine's navigator intents", () => {
  it("centres a document point in the canvas", () => {
    const { engine } = createEngine();
    engine.centerViewportOn(800, 600);

    const state = engine.getState();
    const screen = docToScreen(state.viewport, 800, 600);
    expect(screen.x).toBeCloseTo(viewportSize.width / 2, 9);
    expect(screen.y).toBeCloseTo(viewportSize.height / 2, 9);
  });

  it("centres the whole document without changing the zoom", () => {
    const { engine } = createEngine();
    const zoom = engine.getState().viewport.zoom;
    engine.centerViewport();

    const state = engine.getState();
    expect(state.viewport.zoom).toBe(zoom);
    const screen = docToScreen(state.viewport, documentSize.width / 2, documentSize.height / 2);
    expect(screen.x).toBeCloseTo(viewportSize.width / 2, 9);
    expect(screen.y).toBeCloseTo(viewportSize.height / 2, 9);
  });

  it("keeps a rotated view's point in the middle of the canvas", () => {
    const { engine } = createEngine();
    // The view is turned and mirrored through the viewport's own pure
    // functions, so the test does not depend on how the transform is spelled.
    const turned = rotateView(engine.getState().viewport, viewportSize, Math.PI / 4);
    engine.setViewport(toggleViewMirror(turned, viewportSize));
    engine.centerViewportOn(400, 300);

    const state = engine.getState();
    const screen = docToScreen(state.viewport, 400, 300);
    expect(screen.x).toBeCloseTo(viewportSize.width / 2, 9);
    expect(screen.y).toBeCloseTo(viewportSize.height / 2, 9);
  });

  it("is view state: no history step, no dirty flag", () => {
    const { engine } = createEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.centerViewportOn(100, 100);
    engine.centerViewport();

    const state = engine.getState();
    expect(state.history.depth).toBe(0);
    expect(state.history.canUndo).toBe(false);
    expect(state.file.dirty).toBe(false);
    // The view did move, so the snapshot was published.
    expect(listener).toHaveBeenCalled();
  });

  it("publishes the canvas size so the navigator knows what is visible", () => {
    const { engine } = createEngine();
    expect(engine.getState().viewportSize).toEqual(viewportSize);
  });
});

describe("the engine's overview cache", () => {
  it("reuses the overview while nothing changes", () => {
    const { engine, getOverviews } = createEngine();
    const first = engine.getOverview(100, 80);
    const second = engine.getOverview(100, 80);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(getOverviews()).toBe(1);
  });

  it("rebuilds the overview for a different size", () => {
    const { engine, getOverviews } = createEngine();
    engine.getOverview(100, 80);
    engine.getOverview(200, 160);
    expect(getOverviews()).toBe(2);
  });

  it("rebuilds the overview when the document changes", () => {
    const { engine, getOverviews } = createEngine();
    const first = engine.getOverview(100, 80);
    expect(first).not.toBeNull();

    engine.newDocument({ name: "Other", width: 800, height: 600 });
    const second = engine.getOverview(100, 80);
    expect(second).not.toBe(first);
    expect(getOverviews()).toBe(2);
  });

  it("keeps the overview while only the view moves", () => {
    const { engine, getOverviews } = createEngine();
    const first = engine.getOverview(100, 80);

    engine.panViewportBy(120, -40);
    engine.zoomTo(2);
    engine.centerViewportOn(400, 300);

    expect(engine.getOverview(100, 80)).toBe(first);
    expect(getOverviews()).toBe(1);
  });

  it("does not dirty the document", () => {
    const { engine } = createEngine();
    engine.getOverview(100, 80);
    engine.getOverview(100, 80);
    expect(engine.getState().file.dirty).toBe(false);
    expect(engine.getState().history.depth).toBe(0);
  });
});

describe("the navigator's mapping agrees with the canvas", () => {
  it("puts the navigator's document point under the pointer in the middle", () => {
    const { engine } = createEngine();
    const layout = navigatorLayout(documentSize, panelSize);
    const navX = 123;
    const navY = 45;

    const doc = navigatorToDocument(layout, navX, navY);
    engine.centerViewportOn(doc.x, doc.y);

    const state = engine.getState();
    const screen = docToScreen(state.viewport, doc.x, doc.y);
    expect(screen.x).toBeCloseTo(viewportSize.width / 2, 9);
    expect(screen.y).toBeCloseTo(viewportSize.height / 2, 9);

    // The document point under the canvas centre is the one that was picked.
    const underCentre = screenToDoc(state.viewport, viewportSize.width / 2, viewportSize.height / 2);
    expect(underCentre.x).toBeCloseTo(doc.x, 6);
    expect(underCentre.y).toBeCloseTo(doc.y, 6);
  });

  it("keeps the mapping right after the canvas is resized", () => {
    const { engine } = createEngine();
    engine.setViewportSize(1200, 400);
    const layout = navigatorLayout(documentSize, panelSize);
    const doc = navigatorToDocument(layout, 200, 300);
    engine.centerViewportOn(doc.x, doc.y);

    const state = engine.getState();
    expect(state.viewportSize).toEqual({ width: 1200, height: 400 });
    const screen = docToScreen(state.viewport, doc.x, doc.y);
    expect(screen.x).toBeCloseTo(600, 9);
    expect(screen.y).toBeCloseTo(200, 9);
  });
});
