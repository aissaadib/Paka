/**
 * Engine-level tests for the fixed-step selection transforms.
 *
 * These drive the real `DrawingEngine` through the same paths the Selection
 * menu uses: a marquee picks the strokes, a command is recorded, and the
 * history holds the step. The geometry itself is proved by
 * `selectionTransform.test.ts`; what is proved *here* is that the engine
 * picks the right pivot, builds the right command, and leaves the history and
 * the selection in a consistent state.
 *
 * The strokes used are deliberately **asymmetric and not square**, with
 * distinct points, so that a wrong pivot, a sign error or an unintended
 * translation is visible. A square, symmetric selection would hide all
 * three.
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import {
  FIXED_ROTATION_DEGREES,
  FIXED_SCALE_FACTOR,
  ROTATION_SNAP_DEGREES,
  createRotateTransform,
  createScaleTransform,
} from "../core/document/selectionTransform";
import type { StrokeRecord } from "../core/document/types";
import type { PointerSample } from "../types/pointer";

const DEGREES_TO_RADIANS = Math.PI / 180;

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

/** An engine with no renderer: the transforms never need a canvas. */
function createEngine(): DrawingEngine {
  return new DrawingEngine({ document: createDocument({ name: "Test", width: 400, height: 300 }) });
}

function handle(
  engine: DrawingEngine,
  points: ReadonlyArray<readonly [number, number]>,
  phase: PointerSample["phase"],
): void {
  const first = points[0];
  engine.handlePointerSample(createSample({ phase: "down", docX: first[0], docY: first[1] }));
  for (const point of points.slice(1)) {
    engine.handlePointerSample(createSample({ phase: "move", docX: point[0], docY: point[1] }));
  }
  const last = points[points.length - 1];
  engine.handlePointerSample(createSample({ phase, docX: last[0], docY: last[1] }));
}

/** Paints one stroke with the brush tool. */
function paint(engine: DrawingEngine, points: ReadonlyArray<readonly [number, number]>): void {
  engine.setTool("brush");
  handle(engine, points, "up");
}

/** Selects whole strokes with a marquee. */
function select(engine: DrawingEngine, points: ReadonlyArray<readonly [number, number]>): void {
  engine.setTool("select");
  handle(engine, points, "up");
}

/** A copy of a stroke's samples, taken before anything mutates them. */
function copyOf(stroke: StrokeRecord): { xs: number[]; ys: number[] } {
  return { xs: [...stroke.xs], ys: [...stroke.ys] };
}

/**
 * The centre of the selection's frame: the samples' bounds, widened by each
 * stroke's own half-diameter.
 *
 * This is the pivot the transform uses. It is computed here from the rules,
 * not read out of the engine, so a change in the pivot shows up as a failure
 * rather than as a test that agrees with whatever the code does.
 */
function frameCentre(strokes: ReadonlyArray<StrokeRecord>): { x: number; y: number } {
  const half = (stroke: StrokeRecord): number => stroke.brush.size / 2;
  const minX = Math.min(...strokes.flatMap((stroke) => stroke.xs.map((x) => x - half(stroke))));
  const maxX = Math.max(...strokes.flatMap((stroke) => stroke.xs.map((x) => x + half(stroke))));
  const minY = Math.min(...strokes.flatMap((stroke) => stroke.ys.map((y) => y - half(stroke))));
  const maxY = Math.max(...strokes.flatMap((stroke) => stroke.ys.map((y) => y + half(stroke))));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** The strokes of the active layer, with their samples copied. */
function snapshotStrokes(engine: DrawingEngine): { xs: number[]; ys: number[] }[] {
  const layerId = engine.getState().document.activeLayerId as string;
  return engine.listStrokes(layerId).map(copyOf);
}

describe("the fixed-step scale", () => {
  it("does nothing without a selection", () => {
    const engine = createEngine();
    paint(engine, [
      [100, 80],
      [160, 110],
    ]);
    const depth = engine.getState().history.depth;
    const before = snapshotStrokes(engine);

    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(false);
    expect(engine.rotateSelection(FIXED_ROTATION_DEGREES)).toBe(false);

    expect(engine.getState().history.depth).toBe(depth);
    expect(snapshotStrokes(engine)).toEqual(before);
  });

  it("scales a selected stroke about the centre of its frame", () => {
    const engine = createEngine();
    paint(engine, [
      [100, 80],
      [160, 110],
      [130, 150],
    ]);
    select(engine, [
      [50, 40],
      [250, 200],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const before = copyOf(engine.listStrokes(layerId)[0]);
    const centre = frameCentre(engine.listStrokes(layerId));
    // The stroke is not square and not symmetric about either axis, so a pivot
    // that is off by a few pixels is visible.
    expect(centre.x).not.toBeCloseTo(centre.y, 3);
    const depth = engine.getState().history.depth;

    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(true);

    const scaled = engine.listStrokes(layerId)[0];
    scaled.xs.forEach((x, index) => {
      expect(x).toBeCloseTo(centre.x + (before.xs[index] - centre.x) * FIXED_SCALE_FACTOR, 9);
    });
    scaled.ys.forEach((y, index) => {
      expect(y).toBeCloseTo(centre.y + (before.ys[index] - centre.y) * FIXED_SCALE_FACTOR, 9);
    });
    // One step for the whole command.
    expect(engine.getState().history.depth).toBe(depth + 1);
    expect(engine.getState().history.undoLabel).toBe("Scale 150%");
    // The transform moves the samples and nothing else.
    expect(scaled.pressures).toEqual(engine.listStrokes(layerId)[0].pressures);
    expect(scaled.times).toHaveLength(before.xs.length);
    expect(scaled.id).toBe(engine.listStrokes(layerId)[0].id);
  });

  it("scales about the padded frame's centre, not the samples' centre", () => {
    const engine = createEngine();
    // Two strokes of very different widths: the frame is padded by each
    // stroke's own half-diameter, so the frame's centre is *not* the centre of
    // the samples taken together. A scale that used the samples' centre would
    // move the strokes somewhere else entirely.
    engine.setBrush({ size: 6 });
    paint(engine, [
      [0, 0],
      [100, 0],
    ]);
    engine.setBrush({ size: 60 });
    paint(engine, [
      [0, 0],
      [0, 100],
    ]);
    select(engine, [
      [1, 1],
      [139, 139],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const strokes = engine.listStrokes(layerId);
    expect(strokes).toHaveLength(2);
    const before = strokes.map(copyOf);
    const centre = frameCentre(strokes);
    const samplesCentre = {
      x: (Math.min(...before.flatMap((s) => s.xs)) + Math.max(...before.flatMap((s) => s.xs))) / 2,
      y: (Math.min(...before.flatMap((s) => s.ys)) + Math.max(...before.flatMap((s) => s.ys))) / 2,
    };
    // The x centres are genuinely different, so the test has teeth. The y
    // centres coincide here - the wide stroke's padding is symmetric about
    // its own samples - so x is the axis that carries the difference.
    expect(centre.x).not.toBeCloseTo(samplesCentre.x, 3);

    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(true);

    engine.listStrokes(layerId).forEach((stroke, index) => {
      before[index].xs.forEach((x, sample) => {
        expect(stroke.xs[sample]).toBeCloseTo(
          centre.x + (x - centre.x) * FIXED_SCALE_FACTOR,
          9,
        );
      });
      before[index].ys.forEach((y, sample) => {
        expect(stroke.ys[sample]).toBeCloseTo(
          centre.y + (y - centre.y) * FIXED_SCALE_FACTOR,
          9,
        );
      });
    });
  });

  it("scales every selected stroke", () => {
    const engine = createEngine();
    paint(engine, [
      [60, 60],
      [110, 90],
    ]);
    paint(engine, [
      [150, 120],
      [210, 160],
    ]);
    select(engine, [
      [20, 20],
      [260, 210],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    expect(engine.getState().selectedStrokes).toBe(2);
    const before = snapshotStrokes(engine);
    const centre = frameCentre(engine.listStrokes(layerId));
    const depth = engine.getState().history.depth;

    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(true);

    // One step for both strokes.
    expect(engine.getState().history.depth).toBe(depth + 1);
    engine.listStrokes(layerId).forEach((stroke, index) => {
      before[index].xs.forEach((x, sample) => {
        expect(stroke.xs[sample]).toBeCloseTo(
          centre.x + (x - centre.x) * FIXED_SCALE_FACTOR,
          9,
        );
      });
      before[index].ys.forEach((y, sample) => {
        expect(stroke.ys[sample]).toBeCloseTo(
          centre.y + (y - centre.y) * FIXED_SCALE_FACTOR,
          9,
        );
      });
    });
  });

  it("scales a selection that has negative coordinates", () => {
    const engine = createEngine();
    // A stroke cannot be *painted* outside the document - the press is
    // ignored there - but a transform can push it out, and the document keeps
    // the negative coordinates. This is how a selection reaches them.
    paint(engine, [
      [4, 4],
      [40, 40],
    ]);
    select(engine, [
      [1, 1],
      [60, 60],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(true);
    const pushed = engine.listStrokes(layerId)[0];
    // The stroke now hangs off the top-left corner of the document.
    expect(Math.min(...pushed.xs)).toBeLessThan(0);
    expect(Math.min(...pushed.ys)).toBeLessThan(0);

    // A fixed step on a selection with negative coordinates still pivots on
    // the frame's centre.
    const centre = frameCentre(engine.listStrokes(layerId));
    const after = copyOf(engine.listStrokes(layerId)[0]);
    expect(engine.rotateSelection(FIXED_ROTATION_DEGREES)).toBe(true);
    const turned = engine.listStrokes(layerId)[0];
    const radians = FIXED_ROTATION_DEGREES * DEGREES_TO_RADIANS;
    turned.xs.forEach((x, index) => {
      const dx = after.xs[index] - centre.x;
      const dy = after.ys[index] - centre.y;
      expect(x).toBeCloseTo(centre.x + dx * Math.cos(radians) - dy * Math.sin(radians), 9);
    });
  });

  it("undoes and redoes the scale exactly", () => {
    const engine = createEngine();
    paint(engine, [
      [100, 80],
      [160, 110],
      [130, 150],
    ]);
    select(engine, [
      [50, 40],
      [250, 200],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const before = copyOf(engine.listStrokes(layerId)[0]);
    const centre = frameCentre(engine.listStrokes(layerId));

    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(true);
    expect(engine.listStrokes(layerId)[0].xs).not.toEqual(before.xs);

    // Undo restores the stored originals verbatim, not an approximation.
    engine.undo();
    expect(engine.listStrokes(layerId)[0].xs).toEqual(before.xs);
    expect(engine.listStrokes(layerId)[0].ys).toEqual(before.ys);

    // Redo re-applies the same map to the same originals.
    engine.redo();
    engine.listStrokes(layerId)[0].xs.forEach((x, index) => {
      expect(x).toBeCloseTo(centre.x + (before.xs[index] - centre.x) * FIXED_SCALE_FACTOR, 9);
    });
  });

  it("applies a repeated scale as a repeated factor", () => {
    const engine = createEngine();
    paint(engine, [
      [100, 80],
      [160, 110],
      [130, 150],
    ]);
    select(engine, [
      [50, 40],
      [250, 200],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const before = copyOf(engine.listStrokes(layerId)[0]);
    const centre = frameCentre(engine.listStrokes(layerId));
    const depth = engine.getState().history.depth;

    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(true);
    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(true);

    // Two steps, and the geometry is 1.5 x 1.5, not 1.5.
    expect(engine.getState().history.depth).toBe(depth + 2);
    const scaled = engine.listStrokes(layerId)[0];
    scaled.xs.forEach((x, index) => {
      expect(x).toBeCloseTo(centre.x + (before.xs[index] - centre.x) * 2.25, 9);
    });
    scaled.ys.forEach((y, index) => {
      expect(y).toBeCloseTo(centre.y + (before.ys[index] - centre.y) * 2.25, 9);
    });
  });

  it("does not restore the geometry exactly when a scale is undone by another scale", () => {
    const engine = createEngine();
    paint(engine, [
      [100, 80],
      [160, 110],
      [130, 150],
    ]);
    select(engine, [
      [50, 40],
      [250, 200],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const before = copyOf(engine.listStrokes(layerId)[0]);

    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(true);
    // The reciprocal of 1.5 is not a number binary floating point can hold
    // exactly, so the second scale lands a hair away from where it started.
    expect(engine.scaleSelection(1 / FIXED_SCALE_FACTOR)).toBe(true);

    const restored = engine.listStrokes(layerId)[0];
    // The round trip is close, but it is not the identity.
    expect(restored.xs).not.toEqual(before.xs);
    restored.xs.forEach((x, index) => {
      expect(x).toBeCloseTo(before.xs[index], 9);
    });
    restored.ys.forEach((y, index) => {
      expect(y).toBeCloseTo(before.ys[index], 9);
    });
  });
});

describe("the fixed-step rotation", () => {
  it("turns the selection clockwise", () => {
    const engine = createEngine();
    paint(engine, [
      [100, 80],
      [160, 110],
      [130, 150],
    ]);
    select(engine, [
      [50, 40],
      [250, 200],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const before = copyOf(engine.listStrokes(layerId)[0]);
    const centre = frameCentre(engine.listStrokes(layerId));
    const depth = engine.getState().history.depth;

    expect(engine.rotateSelection(FIXED_ROTATION_DEGREES)).toBe(true);

    const turned = engine.listStrokes(layerId)[0];
    const radians = FIXED_ROTATION_DEGREES * DEGREES_TO_RADIANS;
    turned.xs.forEach((x, index) => {
      const dx = before.xs[index] - centre.x;
      const dy = before.ys[index] - centre.y;
      expect(x).toBeCloseTo(centre.x + dx * Math.cos(radians) - dy * Math.sin(radians), 9);
      expect(turned.ys[index]).toBeCloseTo(centre.y + dx * Math.sin(radians) + dy * Math.cos(radians), 9);
    });

    // The direction, in the user's terms. A point to the **right** of the
    // centre moves **down** when the content turns clockwise, because the
    // document's y axis points down.
    const rightmost = before.xs.indexOf(Math.max(...before.xs));
    expect(turned.ys[rightmost]).toBeGreaterThan(before.ys[rightmost]);
    // A point **above** the centre moves **right**, the other way round.
    const topmost = before.ys.indexOf(Math.min(...before.ys));
    expect(turned.xs[topmost]).toBeGreaterThan(before.xs[topmost]);
    expect(turned.ys[topmost]).toBeLessThan(before.ys[topmost]);

    expect(engine.getState().history.depth).toBe(depth + 1);
    expect(engine.getState().history.undoLabel).toBe("Rotate 15°");
  });

  it("turns the selection counter-clockwise", () => {
    const engine = createEngine();
    paint(engine, [
      [100, 80],
      [160, 110],
      [130, 150],
    ]);
    select(engine, [
      [50, 40],
      [250, 200],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const before = copyOf(engine.listStrokes(layerId)[0]);
    const centre = frameCentre(engine.listStrokes(layerId));

    expect(engine.rotateSelection(-FIXED_ROTATION_DEGREES)).toBe(true);

    const turned = engine.listStrokes(layerId)[0];
    // The opposite way round: a point to the right of the centre moves up.
    const rightmost = before.xs.indexOf(Math.max(...before.xs));
    expect(turned.ys[rightmost]).toBeLessThan(before.ys[rightmost]);
    // A point above the centre moves left.
    const topmost = before.ys.indexOf(Math.min(...before.ys));
    expect(turned.xs[topmost]).toBeLessThan(before.xs[topmost]);

    const radians = -FIXED_ROTATION_DEGREES * DEGREES_TO_RADIANS;
    turned.xs.forEach((x, index) => {
      const dx = before.xs[index] - centre.x;
      const dy = before.ys[index] - centre.y;
      expect(x).toBeCloseTo(centre.x + dx * Math.cos(radians) - dy * Math.sin(radians), 9);
      expect(turned.ys[index]).toBeCloseTo(centre.y + dx * Math.sin(radians) + dy * Math.cos(radians), 9);
    });
    expect(engine.getState().history.undoLabel).toBe("Rotate -15°");
  });

  it("turns every selected stroke", () => {
    const engine = createEngine();
    paint(engine, [
      [60, 60],
      [110, 90],
    ]);
    paint(engine, [
      [150, 120],
      [210, 160],
    ]);
    select(engine, [
      [20, 20],
      [260, 210],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    expect(engine.getState().selectedStrokes).toBe(2);
    const before = snapshotStrokes(engine);
    const centre = frameCentre(engine.listStrokes(layerId));
    const depth = engine.getState().history.depth;

    expect(engine.rotateSelection(FIXED_ROTATION_DEGREES)).toBe(true);

    expect(engine.getState().history.depth).toBe(depth + 1);
    const radians = FIXED_ROTATION_DEGREES * DEGREES_TO_RADIANS;
    engine.listStrokes(layerId).forEach((stroke, index) => {
      before[index].xs.forEach((x, sample) => {
        const dx = x - centre.x;
        const dy = before[index].ys[sample] - centre.y;
        expect(stroke.xs[sample]).toBeCloseTo(
          centre.x + dx * Math.cos(radians) - dy * Math.sin(radians),
          9,
        );
      });
    });
  });

  it("undoes and redoes the rotation exactly", () => {
    const engine = createEngine();
    paint(engine, [
      [100, 80],
      [160, 110],
      [130, 150],
    ]);
    select(engine, [
      [50, 40],
      [250, 200],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const before = copyOf(engine.listStrokes(layerId)[0]);
    const centre = frameCentre(engine.listStrokes(layerId));

    expect(engine.rotateSelection(FIXED_ROTATION_DEGREES)).toBe(true);
    expect(engine.listStrokes(layerId)[0].xs).not.toEqual(before.xs);

    engine.undo();
    expect(engine.listStrokes(layerId)[0].xs).toEqual(before.xs);
    expect(engine.listStrokes(layerId)[0].ys).toEqual(before.ys);

    engine.redo();
    const radians = FIXED_ROTATION_DEGREES * DEGREES_TO_RADIANS;
    engine.listStrokes(layerId)[0].xs.forEach((x, index) => {
      const dx = before.xs[index] - centre.x;
      const dy = before.ys[index] - centre.y;
      expect(x).toBeCloseTo(centre.x + dx * Math.cos(radians) - dy * Math.sin(radians), 9);
    });
  });

  it("does not restore the geometry when a turn is undone by the opposite turn", () => {
    const engine = createEngine();
    paint(engine, [
      [100, 80],
      [160, 110],
      [130, 150],
    ]);
    select(engine, [
      [50, 40],
      [250, 200],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const before = copyOf(engine.listStrokes(layerId)[0]);

    expect(engine.rotateSelection(FIXED_ROTATION_DEGREES)).toBe(true);
    expect(engine.rotateSelection(-FIXED_ROTATION_DEGREES)).toBe(true);

    // The counter-turn is **not** an inverse. A turn moves the selection's
    // frame - the axis-aligned envelope of a turned selection is not centred
    // on the point it turned around - so the second turn is about the new
    // frame's centre, not the first one's. The result is a different drawing,
    // not the original one.
    const turned = engine.listStrokes(layerId)[0];
    const furthest = Math.max(
      ...turned.xs.map((x, index) => Math.hypot(x - before.xs[index], turned.ys[index] - before.ys[index])),
    );
    expect(furthest).toBeGreaterThan(1);
    // Undo is the exact inverse, because it restores the stored originals.
    engine.undo();
    engine.undo();
    expect(engine.listStrokes(layerId)[0].xs).toEqual(before.xs);
    expect(engine.listStrokes(layerId)[0].ys).toEqual(before.ys);
  });

  it("refuses a turn that would move nothing", () => {
    const engine = createEngine();
    // A single dab: the frame is centred on the sample, so a turn about the
    // centre maps it onto itself and there is nothing to record.
    engine.setBrush({ size: 6 });
    paint(engine, [[120, 90]]);
    select(engine, [
      [80, 50],
      [160, 130],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const depth = engine.getState().history.depth;

    expect(engine.rotateSelection(FIXED_ROTATION_DEGREES)).toBe(false);
    expect(engine.getState().history.depth).toBe(depth);
    expect(engine.listStrokes(layerId)[0].xs).toEqual([120]);
  });
});

describe("the fixed-step transforms and the rest of the feature", () => {
  it("refuses a transform while a gesture is in flight", () => {
    const engine = createEngine();
    paint(engine, [
      [100, 80],
      [160, 110],
    ]);
    select(engine, [
      [50, 40],
      [250, 200],
    ]);
    const layerId = engine.getState().document.activeLayerId as string;
    const depth = engine.getState().history.depth;

    // A marquee in flight owns the selection; a transform would fight it for
    // the same coordinates.
    engine.handlePointerSample(createSample({ phase: "down", docX: 50, docY: 40 }));
    engine.handlePointerSample(createSample({ phase: "move", docX: 250, docY: 200 }));

    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(false);
    expect(engine.rotateSelection(FIXED_ROTATION_DEGREES)).toBe(false);
    expect(engine.getState().history.depth).toBe(depth);

    // Once the gesture is over, the same command works.
    engine.handlePointerSample(createSample({ phase: "up", docX: 250, docY: 200 }));
    expect(engine.scaleSelection(FIXED_SCALE_FACTOR)).toBe(true);
    expect(engine.getState().history.depth).toBe(depth + 1);
    expect(engine.listStrokes(layerId)[0].xs.length).toBeGreaterThan(0);
  });

  it("leaves the handle's own transform labels alone", () => {
    // The handle drag is the generic "Scale" and "Rotate"; the fixed steps
    // name themselves so the two are told apart in the history. A transform
    // that forgets to pass a label must still get the generic one.
    const transform = createScaleTransform({ x: 10, y: 10 }, 2);
    expect(transform.label).toBe("Scale");
    const turned = createRotateTransform({ x: 10, y: 10 }, Math.PI / 6);
    expect(turned.label).toBe("Rotate");
  });

  it("uses the same 15-degree step the rotation handle snaps to", () => {
    expect(FIXED_ROTATION_DEGREES).toBe(ROTATION_SNAP_DEGREES);
  });
});
