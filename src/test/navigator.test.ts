import { describe, expect, it, vi } from "vitest";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import {
  OverviewCache,
  actualSizeViewport,
  centerViewOn,
  fitSelectionView,
  sameOverviewKey,
} from "../core/engine/canvasViews";
import type { DrawingRenderer } from "../core/rendering/types";
import { docToScreen, screenToDoc } from "../core/rendering/viewport";
import { viewportFromState, viewportStateFrom } from "../core/shell/viewportState";
import {
  boundsOf,
  clipToDocument,
  documentToNavigator,
  navigatorCorners,
  navigatorGrab,
  navigatorKeyStep,
  navigatorLayout,
  navigatorTargetCenter,
  navigatorToDocument,
  pointInPolygon,
  viewportCenter,
  viewportRect,
} from "../features/navigator/navigatorGeometry";
import {
  centerOnPoint,
  resolveViewNavigation,
  zoomToActualSize,
  zoomToFit,
  zoomToSelection,
} from "../features/view/viewNavigation";
import type { Size } from "../types/geometry";
import type { PointerSample } from "../types/pointer";
import type { Viewport } from "../types/viewport";

const documentSize: Size = { width: 1600, height: 1200 };
const panelSize: Size = { width: 200, height: 150 };
const viewportSize: Size = { width: 800, height: 600 };

/** A pointer sample, in the shape the engine's gestures take. */
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

  it("boxes the visible area and clips it to the paper", () => {
    const layout = navigatorLayout(documentSize, panelSize);
    const viewport: Viewport = { zoom: 1, offsetX: -100, offsetY: -50 };
    const rect = viewportRect(layout, viewport, viewportSize);
    expect(rect.x).toBeCloseTo(100 * layout.scale, 9);
    expect(rect.width).toBeCloseTo(800 * layout.scale, 9);

    // A rectangle that reaches past the paper is clipped to it.
    const clipped = clipToDocument(layout, { x: -50, y: -50, width: 500, height: 500 });
    expect(clipped.x).toBeCloseTo(layout.offsetX, 9);
    expect(clipped.y).toBeCloseTo(layout.offsetY, 9);
    expect(clipped.width).toBeLessThanOrEqual(layout.width);
    expect(clipped.height).toBeLessThanOrEqual(layout.height);
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
    const screen = docToScreen(
      state.viewport,
      documentSize.width / 2,
      documentSize.height / 2,
    );
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

  it("zooms to the selection when there is one", () => {
    const { engine } = createEngine();
    // Nothing is selected, so the view stays where it is.
    const before = engine.getState().viewport;
    engine.zoomToSelection();
    expect(engine.getState().viewport).toBe(before);
  });

  it("shows the whole selection when the view is zoomed to it", () => {
    const { engine } = createEngine();
    // A stroke in the top-left corner of the document.
    engine.setTool("brush");
    engine.beginStroke(createSample({ docX: 100, docY: 100 }));
    engine.extendStroke(createSample({ docX: 200, docY: 150 }));
    engine.finishStroke();

    engine.setTool("select");
    engine.handlePointerSample(createSample({ phase: "down", docX: 50, docY: 50 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 300, docY: 250 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 300, docY: 250 }));
    expect(engine.getState().selectedStrokes).toBe(1);

    engine.zoomToSelection();
    const state = engine.getState();
    // The stroke is now in the middle of the canvas.
    const screen = docToScreen(state.viewport, 150, 125);
    expect(screen.x).toBeCloseTo(viewportSize.width / 2, 6);
    expect(screen.y).toBeCloseTo(viewportSize.height / 2, 6);
    // The whole selection fits: its corners are on the canvas.
    const topLeft = docToScreen(state.viewport, 100, 100);
    const bottomRight = docToScreen(state.viewport, 200, 150);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(viewportSize.width);
    expect(bottomRight.y).toBeLessThanOrEqual(viewportSize.height);
  });

  it("publishes the new size when the canvas is resized", () => {
    const { engine } = createEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setViewportSize(1200, 400);
    expect(engine.getState().viewportSize).toEqual({ width: 1200, height: 400 });
    expect(listener).toHaveBeenCalled();
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

  it("has no overview without a renderer", () => {
    const engine = new DrawingEngine();
    expect(engine.getOverview(100, 80)).toBeNull();
  });
});

describe("the overview cache itself", () => {
  it("hands the value back while the key matches", () => {
    const cache = new OverviewCache<string>();
    const key = { document: {}, revision: 1, width: 10, height: 10 };
    expect(cache.read(key, () => "first")).toBe("first");
    expect(cache.read(key, () => "second")).toBe("first");
    expect(cache.buildCount).toBe(1);
  });

  it("rebuilds when the document, the revision or the size changes", () => {
    const cache = new OverviewCache<string>();
    const document = {};
    const key = { document, revision: 1, width: 10, height: 10 };
    cache.read(key, () => "first");

    expect(cache.read({ ...key, revision: 2 }, () => "second")).toBe("second");
    expect(cache.read({ ...key, document: {} }, () => "third")).toBe("third");
    expect(cache.read({ ...key, width: 20 }, () => "fourth")).toBe("fourth");
    expect(cache.buildCount).toBe(4);
  });

  it("compares keys by the document's identity", () => {
    const document = {};
    expect(
      sameOverviewKey(
        { document, revision: 1, width: 10, height: 10 },
        { document, revision: 1, width: 10, height: 10 },
      ),
    ).toBe(true);
    expect(
      sameOverviewKey(
        { document, revision: 1, width: 10, height: 10 },
        { document: {}, revision: 1, width: 10, height: 10 },
      ),
    ).toBe(false);
  });

  it("peeks without building and forgets a value that could not be made", () => {
    const cache = new OverviewCache<string>();
    const key = { document: {}, revision: 1, width: 10, height: 10 };
    expect(cache.peek()).toBeNull();
    expect(cache.read(key, () => null)).toBeNull();
    expect(cache.peek()).toBeNull();
    expect(cache.buildCount).toBe(1);
  });
});

describe("the view navigation intents", () => {
  it("fits the whole document into the canvas", () => {
    const fitted = zoomToFit(viewportSize, documentSize);
    const topLeft = docToScreen(fitted, 0, 0);
    const bottomRight = docToScreen(fitted, documentSize.width, documentSize.height);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(viewportSize.width);
    expect(bottomRight.y).toBeLessThanOrEqual(viewportSize.height);
  });

  it("shows a point at actual size", () => {
    const view = zoomToActualSize(viewportSize, 400, 300);
    expect(view.zoom).toBe(1);
    const screen = docToScreen(view, 400, 300);
    expect(screen.x).toBeCloseTo(viewportSize.width / 2, 9);
    expect(screen.y).toBeCloseTo(viewportSize.height / 2, 9);
  });

  it("fits a selection into the canvas", () => {
    const view = zoomToSelection(viewportSize, { x: 100, y: 100, width: 200, height: 100 });
    expect(view).not.toBeNull();
    // The width is the limit: 736 / 200 is smaller than 536 / 100? No: the
    // height is 536 / 100 = 5.36, the width 736 / 200 = 3.68.
    expect(view?.zoom).toBeCloseTo(3.68, 6);
    const centre = docToScreen(view!, 200, 150);
    expect(centre.x).toBeCloseTo(viewportSize.width / 2, 6);
    expect(centre.y).toBeCloseTo(viewportSize.height / 2, 6);
  });

  it("has no view for an empty selection", () => {
    expect(zoomToSelection(viewportSize, null)).toBeNull();
    expect(zoomToSelection(viewportSize, { x: 10, y: 10, width: 0, height: 0 })).toBeNull();
  });

  it("centres on a point at the zoom it already had", () => {
    const viewport: Viewport = { zoom: 2, offsetX: 0, offsetY: 0 };
    const view = centerOnPoint(viewport, viewportSize, 640, 480);
    expect(view.zoom).toBe(2);
    const screen = docToScreen(view, 640, 480);
    expect(screen.x).toBeCloseTo(viewportSize.width / 2, 9);
    expect(screen.y).toBeCloseTo(viewportSize.height / 2, 9);
  });

  it("resolves an intent into a view", () => {
    const context = {
      viewport: { zoom: 1, offsetX: 0, offsetY: 0 } as Viewport,
      viewportSize,
      documentSize,
    };
    const fitted = resolveViewNavigation({ kind: "fit" }, context);
    expect(fitted).not.toBeNull();

    const centred = resolveViewNavigation(
      { kind: "point", point: { x: 200, y: 300 } },
      context,
    );
    expect(centred).not.toBeNull();
    const screen = docToScreen(centred!, 200, 300);
    expect(screen.x).toBeCloseTo(viewportSize.width / 2, 9);

    expect(
      resolveViewNavigation({ kind: "selection", bounds: null }, context),
    ).toBeNull();
  });
});

describe("the engine's view geometry", () => {
  it("centres a view on a document point", () => {
    const view = centerViewOn({ zoom: 2, offsetX: 0, offsetY: 0 }, viewportSize, 100, 50);
    expect(view.zoom).toBe(2);
    expect(view.offsetX).toBeCloseTo(viewportSize.width / 2 - 200, 9);
    expect(view.offsetY).toBeCloseTo(viewportSize.height / 2 - 100, 9);
  });

  it("shows a point at actual size", () => {
    const view = actualSizeViewport(viewportSize, 0, 0);
    expect(view.zoom).toBe(1);
    expect(view.offsetX).toBeCloseTo(viewportSize.width / 2, 9);
  });

  it("has no view for a selection with no area", () => {
    expect(fitSelectionView(viewportSize, { x: 5, y: 5, width: 0, height: 10 })).toBeNull();
  });
});

describe("the navigator and the remembered viewport agree", () => {
  it("reads the centred point back as the same centre", () => {
    const { engine } = createEngine();
    engine.centerViewportOn(800, 600);

    const state = engine.getState();
    const remembered = viewportStateFrom(state.viewport, viewportSize);
    expect(remembered.centerX).toBeCloseTo(800, 6);
    expect(remembered.centerY).toBeCloseTo(600, 6);
  });

  it("rebuilds the same view from the remembered state", () => {
    const { engine } = createEngine();
    engine.centerViewportOn(800, 600);
    const state = engine.getState();

    const remembered = viewportStateFrom(state.viewport, viewportSize);
    const rebuilt = viewportFromState(remembered, viewportSize, documentSize);
    expect(rebuilt.zoom).toBeCloseTo(state.viewport.zoom, 9);
    expect(rebuilt.offsetX).toBeCloseTo(state.viewport.offsetX, 6);
    expect(rebuilt.offsetY).toBeCloseTo(state.viewport.offsetY, 6);
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
    const underCentre = screenToDoc(
      state.viewport,
      viewportSize.width / 2,
      viewportSize.height / 2,
    );
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
