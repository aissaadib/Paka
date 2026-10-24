/**
 * Editing native shapes through the engine.
 *
 * These tests drive the real pointer entry point, not the pure helpers: they
 * pin down the promises the editable-shape workflow makes to the artist.
 *
 *  - a shape is created as one native record and one history step;
 *  - selecting, moving, resizing, rotating, editing and deleting are each one
 *    undoable step, and undo/redo restore the exact record;
 *  - a cancelled or lost gesture restores the press-time shape and leaves no
 *    history entry;
 *  - the selection overlay is display-only and never enters the document.
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import {
  shapeRecordFrame,
  shapeRecordOutline,
} from "../core/document/shapeRecord";
import type { ShapeRecord } from "../core/document/types";
import { isShape, isStroke } from "../core/document/types";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { parseProject } from "../core/project/projectFormat";
import type {
  DrawingRenderer,
  RendererSelection,
} from "../core/rendering/types";
import type { PointerSample } from "../types/pointer";

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

/** A renderer that records what the engine asks of it. */
function createSpyRenderer() {
  const invalidated: string[] = [];
  const replaced: Array<{ xs: number[]; ys: number[] }> = [];
  const selections: Array<RendererSelection | null> = [];
  let cancelled = 0;

  const renderer: DrawingRenderer = {
    kind: "canvas2d",
    setDocument: () => {},
    setViewport: () => {},
    setDisplaySize: () => {},
    setRasterScale: () => {},
    invalidateLayer: (layerId) => {
      invalidated.push(layerId);
    },
    beginStroke: () => {},
    extendStroke: () => {},
    replaceStroke: (stroke) => {
      replaced.push({ xs: [...stroke.xs], ys: [...stroke.ys] });
    },
    endStroke: () => {},
    cancelStroke: () => {
      cancelled += 1;
    },
    setSelection: (selection) => {
      selections.push(selection);
    },
    setSelectedGuide: () => {},
    setReferenceSources: () => {},
    setSelectedReference: () => {},
    setGrid: () => {},
    composeDocumentImage: () => {
      throw new Error("composeDocumentImage is not used in these tests.");
    },
    readCompositePixel: () => null,
    readCompositeImage: () => null,
    render: () => {},
    requestRender: () => {},
    destroy: () => {},
  };

  return {
    renderer,
    invalidated,
    replaced,
    selections,
    getCancelled: () => cancelled,
  };
}

function createEditor() {
  const spy = createSpyRenderer();
  const engine = new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
    renderer: spy.renderer,
  });
  return { engine, spy, layerId: engine.getState().document.activeLayerId as string };
}

function shapesOf(engine: DrawingEngine, layerId: string): ShapeRecord[] {
  return engine.listElements(layerId).filter(isShape);
}

/** Drags the active shape tool from one point to another and releases. */
function drag(
  engine: DrawingEngine,
  from: readonly [number, number],
  to: readonly [number, number],
  modifiers: Partial<PointerSample["modifiers"]> = {},
): void {
  const held = { shift: false, alt: false, ctrl: false, meta: false, ...modifiers };
  engine.handlePointerSample(
    createSample({ phase: "down", docX: from[0], docY: from[1], modifiers: held }),
  );
  engine.handlePointerSample(
    createSample({ phase: "move", docX: to[0], docY: to[1], modifiers: held }),
  );
  engine.handlePointerSample(
    createSample({ phase: "up", docX: to[0], docY: to[1], modifiers: held }),
  );
}

/** Draws a rectangle from (100,100) to (200,150) on the active layer. */
function drawRectangle(engine: DrawingEngine): void {
  engine.setTool("rectangle");
  drag(engine, [100, 100], [200, 150]);
}

/** Selects the rectangle with a click on its top edge, away from handles. */
function selectRectangle(engine: DrawingEngine): void {
  engine.setTool("shapeEdit");
  engine.handlePointerSample(createSample({ phase: "down", docX: 150, docY: 100 }));
  engine.handlePointerSample(createSample({ phase: "up", docX: 150, docY: 100 }));
}

describe("creating native shapes", () => {
  it("commits every primitive as one native record and one history step", () => {
    const { engine, layerId } = createEditor();
    const cases = [
      ["line", { shape: "line", x1: 10, y1: 10, x2: 110, y2: 60 }],
      ["rectangle", { shape: "rectangle", x: 10, y: 10, width: 100, height: 50 }],
      ["ellipse", { shape: "ellipse", x: 10, y: 10, width: 100, height: 50 }],
      ["polygon", { shape: "polygon", x: 10, y: 10, width: 100, height: 50 }],
      ["star", { shape: "star", x: 10, y: 10, width: 100, height: 50 }],
    ] as const;

    for (const [tool, geometry] of cases) {
      const before = shapesOf(engine, layerId).length;
      engine.setTool(tool);
      drag(engine, [10, 10], [110, 60]);
      const shapes = shapesOf(engine, layerId);
      expect(shapes).toHaveLength(before + 1);
      expect(shapes[shapes.length - 1].geometry).toMatchObject(geometry);
    }
    expect(engine.getState().history.depth).toBe(cases.length);
  });

  it("previews in the stroke buffer, then commits that exact outline", () => {
    const { engine, spy, layerId } = createEditor();
    engine.setTool("rectangle");
    engine.handlePointerSample(createSample({ phase: "down", docX: 100, docY: 100 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 200, docY: 150 }));

    // Mid-drag there is a preview and nothing else.
    expect(spy.replaced).toHaveLength(1);
    expect(shapesOf(engine, layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);

    engine.handlePointerSample(createSample({ phase: "up", docX: 200, docY: 150 }));

    const committed = shapesOf(engine, layerId)[0];
    const outline = shapeRecordOutline(committed);
    expect(spy.replaced[0].xs).toEqual(outline.map((point) => point.x));
    expect(spy.replaced[0].ys).toEqual(outline.map((point) => point.y));
    // The preview was cancelled, not composited: the record is the authority.
    expect(spy.getCancelled()).toBe(1);
  });

  it("discards a click that never moved, and a press outside the document", () => {
    const { engine, layerId } = createEditor();
    engine.setTool("rectangle");
    drag(engine, [100, 100], [100, 100]);
    expect(shapesOf(engine, layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);

    drag(engine, [-10, -10], [50, 50]);
    expect(shapesOf(engine, layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("keeps the modifiers' geometry: Shift squares, Alt centres, Shift snaps a line", () => {
    const { engine, layerId } = createEditor();

    engine.setTool("rectangle");
    drag(engine, [100, 100], [200, 140], { shift: true });
    expect(shapesOf(engine, layerId)[0].geometry).toMatchObject({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });

    engine.setTool("ellipse");
    drag(engine, [150, 150], [200, 180], { alt: true });
    expect(shapesOf(engine, layerId)[1].geometry).toMatchObject({
      x: 100,
      y: 120,
      width: 100,
      height: 60,
    });

    engine.setTool("line");
    drag(engine, [0, 0], [100, 10], { shift: true });
    const line = shapesOf(engine, layerId)[2].geometry;
    expect(line.shape).toBe("line");
    if (line.shape === "line") {
      expect(line.y2).toBeCloseTo(0, 9);
      expect(line.x2).toBeCloseTo(Math.hypot(100, 10), 6);
    }
  });
});

describe("finding a shape", () => {
  it("returns the top-most shape, and only on the active layer", () => {
    const { engine, layerId } = createEditor();
    engine.setShapeFill(true);
    engine.setTool("rectangle");
    drag(engine, [100, 100], [200, 200]);
    drag(engine, [150, 150], [250, 250]);

    const top = engine.findShapeAt(175, 175);
    expect(top).not.toBeNull();
    expect(top?.id).toBe(shapesOf(engine, layerId)[1].id);

    engine.addLayer();
    const secondLayer = engine.getState().document.activeLayerId as string;
    engine.setTool("rectangle");
    drag(engine, [300, 250], [350, 290]);
    engine.selectLayer(layerId);

    // The shape on the second layer is not the active layer's business.
    expect(engine.findShapeAt(325, 270)).toBeNull();
    expect(engine.findShapeAt(175, 175)?.layerId).toBe(layerId);
    expect(secondLayer).not.toBe(layerId);
  });

  it("uses the brush half-width and the screen grab radius as tolerance", () => {
    const { engine } = createEditor();
    drawRectangle(engine);
    // The rectangle's top edge is at y=100. The grab radius is 10 px at zoom 1.
    expect(engine.findShapeAt(150, 108)).not.toBeNull();
    expect(engine.findShapeAt(150, 111)).toBeNull();
  });
});

describe("moving, resizing and rotating", () => {
  it("selects on press and moves in one history step, with exact undo and redo", () => {
    const { engine, layerId } = createEditor();
    drawRectangle(engine);
    const before = structuredClone(shapesOf(engine, layerId)[0].geometry);

    selectRectangle(engine);
    expect(engine.getState().selectedShapeId).toBe(shapesOf(engine, layerId)[0].id);
    expect(engine.getState().history.depth).toBe(1);

    engine.handlePointerSample(createSample({ phase: "down", docX: 150, docY: 100 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 170, docY: 120 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 170, docY: 120 }));

    const moved = structuredClone(shapesOf(engine, layerId)[0].geometry);
    expect(moved).toMatchObject({ x: 120, y: 120 });
    expect(engine.getState().history.depth).toBe(2);
    expect(engine.getState().file.dirty).toBe(true);

    expect(engine.undo()).toBe(true);
    expect(shapesOf(engine, layerId)[0].geometry).toEqual(before);
    expect(engine.redo()).toBe(true);
    expect(shapesOf(engine, layerId)[0].geometry).toEqual(moved);
  });

  it("resizes from a corner handle, keeping the opposite corner fixed", () => {
    const { engine, layerId } = createEditor();
    drawRectangle(engine);
    selectRectangle(engine);

    engine.handlePointerSample(createSample({ phase: "down", docX: 200, docY: 150 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 250, docY: 200 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 250, docY: 200 }));

    expect(shapesOf(engine, layerId)[0].geometry).toMatchObject({
      x: 100,
      y: 100,
      width: 150,
      height: 100,
    });
    expect(engine.getState().history.depth).toBe(2);

    engine.undo();
    expect(shapesOf(engine, layerId)[0].geometry).toMatchObject({
      width: 100,
      height: 50,
    });
  });

  it("keeps the aspect ratio under Shift", () => {
    const { engine, layerId } = createEditor();
    drawRectangle(engine);
    selectRectangle(engine);

    const shift = { shift: true, alt: false, ctrl: false, meta: false };
    engine.handlePointerSample(createSample({ phase: "down", docX: 200, docY: 150 }));
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 250, docY: 160, modifiers: shift }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 250, docY: 160, modifiers: shift }),
    );

    // The larger extent is 150, so both sides become 150.
    expect(shapesOf(engine, layerId)[0].geometry).toMatchObject({
      width: 150,
      height: 150,
    });
  });

  it("rotates from the rotation handle and snaps to 15 degrees under Shift", () => {
    const { engine, layerId } = createEditor();
    drawRectangle(engine);
    selectRectangle(engine);

    // The rotation handle is 24 document pixels above the top edge's midpoint.
    const shift = { shift: true, alt: false, ctrl: false, meta: false };
    engine.handlePointerSample(createSample({ phase: "down", docX: 150, docY: 76 }));
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 174, docY: 100, modifiers: shift }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 174, docY: 100, modifiers: shift }),
    );

    expect(shapesOf(engine, layerId)[0].geometry).toMatchObject({ rotation: 45 });
    expect(engine.getState().history.depth).toBe(2);

    engine.undo();
    expect(shapesOf(engine, layerId)[0].geometry).toMatchObject({ rotation: 0 });
  });

  it("commits nothing when a gesture ends where it started", () => {
    const { engine } = createEditor();
    drawRectangle(engine);
    selectRectangle(engine);

    engine.handlePointerSample(createSample({ phase: "down", docX: 150, docY: 100 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 150, docY: 100 }));
    expect(engine.getState().history.depth).toBe(1);
  });

  it("clears the selection on a press on empty canvas, without history", () => {
    const { engine } = createEditor();
    drawRectangle(engine);
    selectRectangle(engine);
    expect(engine.getState().selectedShapeId).not.toBeNull();

    engine.handlePointerSample(createSample({ phase: "down", docX: 350, docY: 280 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 350, docY: 280 }));

    expect(engine.getState().selectedShapeId).toBeNull();
    expect(engine.getState().history.depth).toBe(1);
  });

  it("refuses undo and redo while a gesture is in flight", () => {
    const { engine } = createEditor();
    drawRectangle(engine);
    selectRectangle(engine);
    engine.handlePointerSample(createSample({ phase: "down", docX: 150, docY: 100 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 170, docY: 120 }));

    expect(engine.undo()).toBe(false);
    expect(engine.redo()).toBe(false);
    expect(engine.getState().history.depth).toBe(1);

    engine.handlePointerSample(createSample({ phase: "cancel" }));
  });
});

describe("cancelling a gesture", () => {
  function startMove(engine: DrawingEngine): void {
    selectRectangle(engine);
    engine.handlePointerSample(createSample({ phase: "down", docX: 150, docY: 100 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 190, docY: 140 }));
  }

  function expectRestored(engine: DrawingEngine, layerId: string): void {
    expect(shapesOf(engine, layerId)[0].geometry).toMatchObject({
      x: 100,
      y: 100,
      width: 100,
      height: 50,
    });
    expect(engine.getState().history.depth).toBe(1);
    expect(engine.getState().selectedShapeId).toBeNull();
  }

  it("restores the press-time shape on Escape", () => {
    const { engine, layerId } = createEditor();
    drawRectangle(engine);
    startMove(engine);
    // The preview has already moved the record.
    expect(shapesOf(engine, layerId)[0].geometry).toMatchObject({ x: 140, y: 140 });

    engine.cancelShapeGesture();
    expectRestored(engine, layerId);
  });

  it("restores the press-time shape when the capture is lost", () => {
    const { engine, layerId } = createEditor();
    drawRectangle(engine);
    startMove(engine);

    engine.handlePointerSample(createSample({ phase: "cancel" }));
    expectRestored(engine, layerId);
  });

  it("restores the press-time shape when the tool changes mid-gesture", () => {
    const { engine, layerId } = createEditor();
    drawRectangle(engine);
    startMove(engine);

    engine.setTool("brush");
    expectRestored(engine, layerId);
  });
});

describe("deleting a shape", () => {
  it("removes it in one step and puts it back at the same index on undo", () => {
    const { engine, layerId } = createEditor();
    engine.setTool("rectangle");
    drag(engine, [10, 10], [60, 60]);
    drag(engine, [100, 100], [200, 150]);
    const before = shapesOf(engine, layerId).map((shape) => shape.id);

    engine.setTool("shapeEdit");
    engine.handlePointerSample(createSample({ phase: "down", docX: 150, docY: 100 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 150, docY: 100 }));
    expect(engine.deleteSelectedShape()).toBe(true);

    expect(shapesOf(engine, layerId).map((shape) => shape.id)).toEqual([before[0]]);
    expect(engine.getState().selectedShapeId).toBeNull();
    expect(engine.getState().history.depth).toBe(3);

    engine.undo();
    expect(shapesOf(engine, layerId).map((shape) => shape.id)).toEqual(before);
    engine.redo();
    expect(shapesOf(engine, layerId).map((shape) => shape.id)).toEqual([before[0]]);
  });

  it("does nothing without a selection", () => {
    const { engine } = createEditor();
    drawRectangle(engine);
    expect(engine.deleteSelectedShape()).toBe(false);
    expect(engine.getState().history.depth).toBe(1);
  });
});

describe("editing a shape's parameters", () => {
  it("edits fill, sides, inner radius, rotation and size as model changes", () => {
    const { engine, layerId } = createEditor();
    engine.setTool("star");
    drag(engine, [100, 100], [200, 200]);
    selectRectangle(engine);

    expect(engine.setSelectedShapeFill(true)).toBe(true);
    expect(engine.setSelectedShapeSides(7)).toBe(true);
    expect(engine.setSelectedShapeInnerRatio(0.25)).toBe(true);
    expect(engine.setSelectedShapeRotation(30)).toBe(true);
    expect(engine.setSelectedShapeWidth(150)).toBe(true);
    expect(engine.setSelectedShapeHeight(80)).toBe(true);

    const edited = shapesOf(engine, layerId)[0];
    expect(edited.fill).toBe(true);
    expect(edited.geometry).toMatchObject({
      shape: "star",
      sides: 7,
      innerRatio: 0.25,
      rotation: 30,
      width: 150,
      height: 80,
    });
    expect(engine.getState().history.depth).toBe(7);
  });

  it("coalesces a slider run of one field into one step", () => {
    const { engine, layerId } = createEditor();
    drawRectangle(engine);
    selectRectangle(engine);
    const depth = engine.getState().history.depth;

    engine.setSelectedShapeRotation(10);
    engine.setSelectedShapeRotation(20);
    engine.setSelectedShapeRotation(30);
    expect(shapesOf(engine, layerId)[0].geometry).toMatchObject({ rotation: 30 });
    expect(engine.getState().history.depth).toBe(depth + 1);

    // A different field starts a new step.
    engine.setSelectedShapeFill(true);
    expect(engine.getState().history.depth).toBe(depth + 2);
  });

  it("patches the appearance, forces the stamp off and coalesces per field", () => {
    const { engine, layerId } = createEditor();
    engine.setTool("star");
    drag(engine, [100, 100], [200, 200]);
    selectRectangle(engine);
    const depth = engine.getState().history.depth;

    engine.setSelectedShapeBrush({ size: 12 });
    engine.setSelectedShapeBrush({ size: 16 });
    expect(engine.getState().history.depth).toBe(depth + 1);

    engine.setSelectedShapeBrush({ color: "#ff0000" });
    expect(engine.getState().history.depth).toBe(depth + 2);

    const brush = shapesOf(engine, layerId)[0].brush;
    expect(brush).toMatchObject({ size: 16, color: "#ff0000", stamp: false });
  });

  it("pushes nothing for a no-op edit, and nothing without a selection", () => {
    const { engine } = createEditor();
    drawRectangle(engine);
    selectRectangle(engine);
    const depth = engine.getState().history.depth;

    expect(engine.setSelectedShapeRotation(0)).toBe(false);
    expect(engine.setSelectedShapeFill(false)).toBe(false);
    expect(engine.setSelectedShapeWidth(100)).toBe(false);
    expect(engine.getState().history.depth).toBe(depth);

    engine.selectShape(null);
    expect(engine.setSelectedShapeRotation(30)).toBe(false);
    expect(engine.setSelectedShapeBrush({ size: 20 })).toBe(false);
    expect(engine.getState().history.depth).toBe(depth);
  });

  it("starts a new merge run when the selection changes", () => {
    const { engine, layerId } = createEditor();
    engine.setTool("rectangle");
    drag(engine, [10, 10], [60, 60]);
    drag(engine, [100, 100], [200, 150]);
    const [first, second] = shapesOf(engine, layerId);

    engine.selectShape(first.id);
    engine.setSelectedShapeRotation(10);
    engine.selectShape(second.id);
    engine.setSelectedShapeRotation(20);

    // Two shapes, two steps: the run did not fold across the selection.
    expect(engine.getState().history.depth).toBe(4);
    expect(shapesOf(engine, layerId)[0].geometry).toMatchObject({ rotation: 10 });
    expect(shapesOf(engine, layerId)[1].geometry).toMatchObject({ rotation: 20 });
  });
});

describe("the shape selection overlay", () => {
  it("carries the outline, frame and handles while selected, and clears after", () => {
    const { engine, spy } = createEditor();
    drawRectangle(engine);
    selectRectangle(engine);

    const overlay = spy.selections[spy.selections.length - 1];
    expect(overlay).not.toBeNull();
    const shape = engine.getState().selectedShape as ShapeRecord;
    expect(overlay?.outline).toEqual(shapeRecordOutline(shape));
    expect(overlay?.frame).toEqual(shapeRecordFrame(shape));
    expect(overlay?.handles).not.toBeNull();
    // The overlay is display-only: no stroke is selected, and the document
    // holds exactly the one shape that was drawn.
    expect(overlay?.strokes).toEqual([]);

    engine.selectShape(null);
    expect(spy.selections[spy.selections.length - 1]).toBeNull();
  });

  it("does not dirty the file to select or clear a shape", () => {
    const { engine } = createEditor();
    drawRectangle(engine);
    engine.markSaved("drawing.paka");
    expect(engine.getState().file.dirty).toBe(false);

    selectRectangle(engine);
    expect(engine.getState().file.dirty).toBe(false);
    engine.selectShape(null);
    expect(engine.getState().file.dirty).toBe(false);
  });
});

describe("shapes, layers and persistence", () => {
  it("saves and reopens shapes with their identity, geometry and order", () => {
    const { engine, layerId } = createEditor();
    engine.setTool("rectangle");
    drag(engine, [10, 10], [60, 60]);
    engine.setTool("star");
    engine.setShapeFill(true);
    drag(engine, [100, 100], [200, 200]);

    const text = engine.serialize();
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const reopened = new DrawingEngine({
      document: createDocument({ name: "Other", width: 100, height: 100 }),
    });
    reopened.loadProject(parsed.project, null);
    const reopenedLayer = reopened.getState().document.activeLayerId as string;
    const shapes = reopened.listElements(reopenedLayer).filter(isShape);
    expect(shapes.map((shape) => shape.id)).toEqual(
      shapesOf(engine, layerId).map((shape) => shape.id),
    );
    expect(shapes).toEqual(shapesOf(engine, layerId));
  });

  it("keeps each shape on its own layer, in layer order", () => {
    const { engine, layerId } = createEditor();
    engine.setTool("rectangle");
    drag(engine, [10, 10], [60, 60]);

    engine.addLayer();
    const secondLayer = engine.getState().document.activeLayerId as string;
    drag(engine, [100, 100], [150, 150]);

    const elements = engine.listElements(secondLayer);
    expect(elements.filter(isShape)).toHaveLength(1);
    expect(shapesOf(engine, layerId)).toHaveLength(1);

    const parsed = parseProject(engine.serialize());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const first = parsed.project.elements.find((element) => element.layerId === layerId);
    const second = parsed.project.elements.find(
      (element) => element.layerId === secondLayer,
    );
    expect(first !== undefined && isShape(first)).toBe(true);
    expect(second !== undefined && isShape(second)).toBe(true);
  });

  it("carries a shape through a group unchanged", () => {
    const { engine, layerId } = createEditor();
    engine.setTool("rectangle");
    drag(engine, [10, 10], [60, 60]);

    const groupId = engine.createGroup();
    expect(groupId).not.toBeNull();
    if (groupId === null) {
      return;
    }
    engine.moveLayerToParent(layerId, groupId, 0);

    const parsed = parseProject(engine.serialize());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const group = parsed.project.document.layers.find((layer) => layer.id === groupId);
    expect(group?.children.map((child) => child.id)).toContain(layerId);
    expect(parsed.project.elements.filter(isShape)).toHaveLength(1);
  });

  it("keeps a hidden layer's shape in the document", () => {
    const { engine, layerId } = createEditor();
    drawRectangle(engine);
    engine.setLayerVisibility(layerId, false);

    const parsed = parseProject(engine.serialize());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.elements.filter(isShape)).toHaveLength(1);
    expect(parsed.project.document.layers[0].visible).toBe(false);
  });

  it("never writes a stroke in place of a shape", () => {
    const { engine, layerId } = createEditor();
    drawRectangle(engine);
    const elements = engine.listElements(layerId);
    expect(elements.filter(isStroke)).toHaveLength(0);
    expect(elements.filter(isShape)).toHaveLength(1);
  });
});
