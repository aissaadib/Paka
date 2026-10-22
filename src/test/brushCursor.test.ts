/**
 * Brush cursor, size ring and quick resize.
 *
 * The rules are covered as behaviour, not as implementation: the ring's
 * geometry on screen, the drag model that turns pointer travel into a brush
 * size, the rules that decide whether a press may claim the quick resize, and
 * the engine seam where the resize runs.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_RING_CSS_PX,
  brushRingGeometry,
  type BrushCursorReport,
} from "../core/brushes/brushCursor";
import {
  BRUSH_SIZE_GESTURE_DEADZONE,
  BRUSH_SIZE_GESTURE_SCALE,
  brushSizeFromDrag,
  isBrushSizeGestureModifier,
  shouldStartBrushSizeGesture,
  toolUsesBrushSize,
} from "../core/brushes/brushSizeGesture";
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from "../core/brushes/defaults";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { takesTextInput } from "../core/input/ownership";
import type { PointerSample } from "../types/pointer";
import type { ToolId } from "../types/tool";

function createSample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    phase: "move",
    pointerId: 1,
    kind: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: 0,
    docY: 0,
    screenX: 0,
    screenY: 0,
    pressure: 0.5,
    hasPressure: false,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    ...overrides,
  };
}

const RESIZE_MODIFIERS = { shift: false, alt: true, ctrl: true, meta: false };

function createEngine(options: { blocked?: boolean } = {}): DrawingEngine {
  return new DrawingEngine({
    document: createDocument({ name: "Test", width: 400, height: 300 }),
    interactionBlocked: () => options.blocked === true,
  });
}

describe("the brush ring geometry", () => {
  it("draws the ring at the brush size in document pixels, through the zoom", () => {
    const geometry = brushRingGeometry(40, 2, 1);

    expect(geometry.cssDiameter).toBe(80);
    expect(geometry.cssRadius).toBe(40);
    expect(geometry.clamped).toBe(false);
  });

  it("keeps the ring visible for a brush smaller than a few screen pixels", () => {
    // 1 document pixel at 10 % zoom is a tenth of a pixel: invisible.
    const geometry = brushRingGeometry(1, 0.1, 1);

    expect(geometry.cssDiameter).toBe(MIN_RING_CSS_PX);
    expect(geometry.clamped).toBe(true);
  });

  it("describes the same ring in device pixels", () => {
    const geometry = brushRingGeometry(10, 1, 2);

    expect(geometry.deviceDiameter).toBe(geometry.cssDiameter * 2);
  });

  it("draws the outline one device pixel wide, so it stays crisp", () => {
    expect(brushRingGeometry(10, 1, 2).hairlineCss).toBe(0.5);
    expect(brushRingGeometry(10, 1, 1).hairlineCss).toBe(1);
    // Never thinner than half a CSS pixel: below that it stops being a line.
    expect(brushRingGeometry(10, 1, 4).hairlineCss).toBe(0.5);
  });

  it("falls back to a sane ring for impossible inputs", () => {
    // A zoom of zero is treated as 1:1 rather than as an invisible brush.
    expect(brushRingGeometry(10, 0, 1).cssDiameter).toBe(10);
    expect(brushRingGeometry(10, Number.NaN, 1).cssDiameter).toBe(10);
    // A negative size is no size at all, so only the minimum ring is drawn.
    expect(brushRingGeometry(-5, 1, 1).cssDiameter).toBe(MIN_RING_CSS_PX);
    // A ratio of zero is treated as a 1:1 display.
    expect(brushRingGeometry(10, 1, 0).deviceDiameter).toBe(brushRingGeometry(10, 1, 0).cssDiameter);
  });
});

describe("the quick resize drag model", () => {
  it("grows the brush when the pointer travels up and shrinks it downwards", () => {
    const start = 20;

    expect(brushSizeFromDrag(start, -BRUSH_SIZE_GESTURE_SCALE)).toBeGreaterThan(start);
    expect(brushSizeFromDrag(start, BRUSH_SIZE_GESTURE_SCALE)).toBeLessThan(start);
  });

  it("grows the brush by one e-fold after a scale of travel", () => {
    // One e-fold of travel multiplies the size by e.
    expect(brushSizeFromDrag(20, -BRUSH_SIZE_GESTURE_SCALE)).toBe(Math.round(20 * Math.E));
    expect(brushSizeFromDrag(20, BRUSH_SIZE_GESTURE_SCALE)).toBe(Math.round(20 / Math.E));
  });

  it("doubles the brush after about seventy pixels of travel", () => {
    const doubling = -BRUSH_SIZE_GESTURE_SCALE * Math.log(2);

    expect(brushSizeFromDrag(20, doubling)).toBe(40);
  });

  it("ignores a press that did not really travel", () => {
    expect(brushSizeFromDrag(20, 0)).toBe(20);
    expect(brushSizeFromDrag(20, BRUSH_SIZE_GESTURE_DEADZONE)).toBe(20);
    expect(brushSizeFromDrag(20, -BRUSH_SIZE_GESTURE_DEADZONE)).toBe(20);
  });

  it("keeps the size inside the brush's own range", () => {
    expect(brushSizeFromDrag(MAX_BRUSH_SIZE, -10_000)).toBe(MAX_BRUSH_SIZE);
    expect(brushSizeFromDrag(MIN_BRUSH_SIZE, 10_000)).toBe(MIN_BRUSH_SIZE);
  });

  it("never returns a size outside the range, whatever it is given", () => {
    expect(brushSizeFromDrag(Number.NaN, 10)).toBeGreaterThanOrEqual(MIN_BRUSH_SIZE);
    expect(brushSizeFromDrag(20, Number.NaN)).toBe(20);
  });
});

describe("who owns the quick resize", () => {
  const context = { toolId: "brush" as ToolId, blocked: false };

  it("claims a paint press with Ctrl and Alt held", () => {
    expect(
      shouldStartBrushSizeGesture(
        createSample({ phase: "down", modifiers: RESIZE_MODIFIERS }),
        context,
      ),
    ).toBe(true);
  });

  it("leaves a press without the modifiers alone", () => {
    expect(
      shouldStartBrushSizeGesture(
        createSample({ phase: "down", modifiers: { ...RESIZE_MODIFIERS, alt: false } }),
        context,
      ),
    ).toBe(false);
    expect(
      shouldStartBrushSizeGesture(
        createSample({ phase: "down", modifiers: { ...RESIZE_MODIFIERS, ctrl: false } }),
        context,
      ),
    ).toBe(false);
  });

  it("only claims the press, never a move or a release", () => {
    expect(
      shouldStartBrushSizeGesture(
        createSample({ phase: "move", modifiers: RESIZE_MODIFIERS }),
        context,
      ),
    ).toBe(false);
    expect(
      shouldStartBrushSizeGesture(
        createSample({ phase: "up", modifiers: RESIZE_MODIFIERS }),
        context,
      ),
    ).toBe(false);
  });

  it("leaves the middle button alone, because it pans", () => {
    expect(
      shouldStartBrushSizeGesture(
        createSample({ phase: "down", button: 1, modifiers: RESIZE_MODIFIERS }),
        context,
      ),
    ).toBe(false);
  });

  it("does not claim the press for a tool that does not paint with the brush", () => {
    for (const toolId of ["select", "line", "rectangle", "bucket", "picker"] as const) {
      expect(
        shouldStartBrushSizeGesture(
          createSample({ phase: "down", modifiers: RESIZE_MODIFIERS }),
          { toolId, blocked: false },
        ),
      ).toBe(false);
    }
  });

  it("does not take the gesture away from a surface that owns it", () => {
    expect(
      shouldStartBrushSizeGesture(
        createSample({ phase: "down", modifiers: RESIZE_MODIFIERS }),
        { toolId: "brush", blocked: true },
      ),
    ).toBe(false);
  });

  it("uses the brush for the brush and the eraser only", () => {
    expect(toolUsesBrushSize("brush")).toBe(true);
    expect(toolUsesBrushSize("eraser")).toBe(true);
    expect(toolUsesBrushSize("select")).toBe(false);
  });

  it("asks for the gesture with Ctrl and Alt together", () => {
    expect(isBrushSizeGestureModifier(RESIZE_MODIFIERS)).toBe(true);
    expect(isBrushSizeGestureModifier({ ...RESIZE_MODIFIERS, alt: false })).toBe(false);
    expect(isBrushSizeGestureModifier({ ...RESIZE_MODIFIERS, ctrl: false })).toBe(false);
  });
});

describe("a field that takes text", () => {
  it("counts the fields a word is typed into", () => {
    expect(takesTextInput({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(takesTextInput({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(takesTextInput({ tagName: "TEXTAREA" })).toBe(true);
    expect(takesTextInput({ tagName: "SELECT" })).toBe(true);
    expect(takesTextInput({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("does not count the controls that take a value, not a word", () => {
    expect(takesTextInput({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(takesTextInput({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(takesTextInput({ tagName: "INPUT", type: "button" })).toBe(false);
    expect(takesTextInput({ tagName: "DIV" })).toBe(false);
    expect(takesTextInput(null)).toBe(false);
  });
});

describe("the quick resize in the engine", () => {
  it("changes the brush size and paints nothing", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.handlePointerSample(
      createSample({ phase: "down", screenY: 300, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", screenY: 200, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", screenY: 200, modifiers: RESIZE_MODIFIERS }),
    );

    expect(engine.getState().brush.size).toBeGreaterThan(6);
    // The press never reached the brush, so there is no stroke and no history.
    expect(engine.listStrokes(layerId)).toHaveLength(0);
    expect(engine.getState().history.depth).toBe(0);
  });

  it("writes the new size into the shared brush state the next stroke uses", () => {
    const engine = createEngine();
    const layerId = engine.getState().document.activeLayerId as string;

    engine.handlePointerSample(
      createSample({ phase: "down", screenY: 300, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", screenY: 200, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", screenY: 200, modifiers: RESIZE_MODIFIERS }),
    );
    const resized = engine.getState().brush.size;

    // A plain stroke after the resize is drawn with the new size.
    engine.handlePointerSample(createSample({ phase: "down", docX: 10, docY: 10 }));
    engine.handlePointerSample(createSample({ phase: "up", docX: 10, docY: 10 }));

    expect(engine.listStrokes(layerId)).toHaveLength(1);
    expect(engine.listStrokes(layerId)[0].brush.size).toBe(resized);
  });

  it("puts the size back when the resize is cancelled", () => {
    const engine = createEngine();
    const before = engine.getState().brush.size;

    engine.handlePointerSample(
      createSample({ phase: "down", screenY: 300, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", screenY: 100, modifiers: RESIZE_MODIFIERS }),
    );
    expect(engine.getState().brush.size).toBeGreaterThan(before);

    // A lost pointer capture cancels the gesture.
    engine.handlePointerSample(
      createSample({ phase: "cancel", screenY: 100, modifiers: RESIZE_MODIFIERS }),
    );

    expect(engine.getState().brush.size).toBe(before);
  });

  it("puts the size back when Escape cancels the resize", () => {
    const engine = createEngine();
    const before = engine.getState().brush.size;

    engine.handlePointerSample(
      createSample({ phase: "down", screenY: 300, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", screenY: 100, modifiers: RESIZE_MODIFIERS }),
    );

    expect(engine.cancelBrushSizeGesture()).toBe(true);
    expect(engine.getState().brush.size).toBe(before);
    // Nothing is left running, so a second Escape has nothing to cancel.
    expect(engine.cancelBrushSizeGesture()).toBe(false);
  });

  it("keeps the size when the pointer is released outside the canvas", () => {
    const engine = createEngine();

    engine.handlePointerSample(
      createSample({ phase: "down", screenY: 300, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", screenY: 200, modifiers: RESIZE_MODIFIERS }),
    );
    // The pointer left the canvas and was released there: the capture delivers
    // the release, so the resize ends normally and keeps its size.
    engine.handlePointerSample(
      createSample({ phase: "up", screenX: -40, screenY: 200, modifiers: RESIZE_MODIFIERS }),
    );

    expect(engine.getState().brush.size).toBeGreaterThan(6);
    expect(engine.cancelBrushSizeGesture()).toBe(false);
  });

  it("puts the size back when a press finds a resize whose pointer went missing", () => {
    const engine = createEngine();
    const before = engine.getState().brush.size;

    // The resize starts and the pointer is released somewhere the canvas
    // never sees, so the release never arrives.
    engine.handlePointerSample(
      createSample({ phase: "down", screenY: 300, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", screenY: 100, modifiers: RESIZE_MODIFIERS }),
    );
    expect(engine.getState().brush.size).toBeGreaterThan(before);

    // The next press finds the orphaned gesture, puts the size back and is
    // free to start a new one.
    engine.handlePointerSample(
      createSample({ phase: "down", screenY: 100, modifiers: RESIZE_MODIFIERS }),
    );
    expect(engine.getState().brush.size).toBe(before);
  });

  it("leaves the press to the tool when another surface owns the interaction", () => {    const engine = createEngine({ blocked: true });
    const layerId = engine.getState().document.activeLayerId as string;

    engine.handlePointerSample(
      createSample({ phase: "down", docX: 10, docY: 10, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", docX: 40, docY: 10, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", docX: 40, docY: 10, modifiers: RESIZE_MODIFIERS }),
    );

    // The gesture never started, so the press painted as usual and the size
    // is untouched.
    expect(engine.getState().brush.size).toBe(6);
    expect(engine.listStrokes(layerId)).toHaveLength(1);
  });

  it("reports the ring's size, zoom and states to the overlay", () => {
    const engine = createEngine();
    const reports: BrushCursorReport[] = [];
    engine.subscribeBrushCursor((report) => reports.push(report));

    // The first report is the current state, so the overlay is never blank.
    expect(reports).toHaveLength(1);
    expect(reports[0].size).toBe(6);
    expect(reports[0].resizing).toBe(false);
    expect(reports[0].drawing).toBe(false);

    engine.handlePointerSample(
      createSample({ phase: "down", screenY: 300, modifiers: RESIZE_MODIFIERS }),
    );
    const during = reports[reports.length - 1];
    expect(during.resizing).toBe(true);
    expect(during.size).toBe(6);

    engine.handlePointerSample(
      createSample({ phase: "move", screenY: 200, modifiers: RESIZE_MODIFIERS }),
    );
    expect(reports[reports.length - 1].size).toBeGreaterThan(6);

    engine.handlePointerSample(
      createSample({ phase: "up", screenY: 200, modifiers: RESIZE_MODIFIERS }),
    );
    const after = reports[reports.length - 1];
    expect(after.resizing).toBe(false);
    expect(after.size).toBe(engine.getState().brush.size);
  });

  it("follows the zoom, because the ring is a document measurement", () => {
    const engine = createEngine();
    const reports: BrushCursorReport[] = [];
    engine.subscribeBrushCursor((report) => reports.push(report));

    engine.zoomTo(2);

    expect(reports[reports.length - 1].zoom).toBe(2);
  });

  it("never touches the document, so the ring is a view and not content", () => {
    const engine = createEngine();
    const before = engine.serialize();

    engine.handlePointerSample(
      createSample({ phase: "down", screenY: 300, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "move", screenY: 100, modifiers: RESIZE_MODIFIERS }),
    );
    engine.handlePointerSample(
      createSample({ phase: "up", screenY: 100, modifiers: RESIZE_MODIFIERS }),
    );

    // The saved file is byte for byte what it was: the resize is session
    // state, not document state.
    expect(engine.serialize()).toBe(before);
    expect(engine.getState().history.depth).toBe(0);
    expect(engine.getState().file.dirty).toBe(false);
  });
});
