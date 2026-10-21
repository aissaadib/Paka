import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH, updateBrushSettings } from "../core/brushes/defaults";
import { MAX_DOCUMENT_PIXELS } from "../core/document/document";
import {
  MAX_STAMP_COVERAGE_WORK,
  MIN_STAMP_SPACING_PX,
  StampCoverage,
  StampDabCursor,
  stampDabCoverage,
  stampDabs,
  stampSpacing,
  unionStampRect,
} from "../core/rendering/stampCoverage";
import type { BrushSettings } from "../types/brush";

function brush(patch: Partial<BrushSettings> = {}): BrushSettings {
  return updateBrushSettings(DEFAULT_BRUSH, patch);
}

function path(
  xs: number[],
  ys: number[],
  pressures: number[] = xs.map(() => 1),
): { xs: number[]; ys: number[]; pressures: number[] } {
  return { xs, ys, pressures };
}

describe("stamp spacing", () => {
  it("measures the dab distance against the brush's nominal size", () => {
    expect(stampSpacing(brush({ size: 100, stampSpacing: 0.25 }))).toBe(25);
    expect(stampSpacing(brush({ size: 100, stampSpacing: 0.1 }))).toBe(10);
  });

  it("caps the distance at the brush's own diameter", () => {
    // Above the diameter the dabs no longer touch, and the stroke stops being
    // a stroke, so the setting stops there.
    expect(stampSpacing(brush({ size: 10, stampSpacing: 3 }))).toBe(10);
    expect(stampSpacing(brush({ size: 10, stampSpacing: 1 }))).toBe(10);
  });

  it("keeps a floor, so a stroke can never place dabs on top of each other", () => {
    expect(stampSpacing(brush({ size: 1, stampSpacing: 0.02 }))).toBe(MIN_STAMP_SPACING_PX);
  });
});

describe("stamp dab placement", () => {
  it("puts the first dab on the first sample", () => {
    const dabs = stampDabs(path([7, 20], [9, 20]), brush({ size: 10, stampSpacing: 0.5 }));
    expect(dabs[0].x).toBe(7);
    expect(dabs[0].y).toBe(9);
  });

  it("places one dab per spacing of arc length along the path", () => {
    const dabs = stampDabs(path([0, 100], [0, 0]), brush({ size: 100, stampSpacing: 0.25 }));
    // 100 px of path, 25 px apart: the dabs sit at 0, 25, 50, 75 and 100.
    expect(dabs).toHaveLength(5);
    expect(dabs.map((dab) => dab.x)).toEqual([0, 25, 50, 75, 100]);
  });

  it("places the dabs evenly, whatever the samples are", () => {
    const dabs = stampDabs(path([0, 100], [0, 0]), brush({ size: 100, stampSpacing: 0.25 }));
    for (let index = 1; index < dabs.length; index += 1) {
      expect(dabs[index].x - dabs[index - 1].x).toBeCloseTo(25, 6);
    }
  });

  it("follows a bent path by arc length, not by the sample grid", () => {
    // A right angle: 50 px right, then 50 px down.
    const dabs = stampDabs(
      path([0, 50, 50], [0, 0, 50]),
      brush({ size: 100, stampSpacing: 0.25 }),
    );
    expect(dabs).toHaveLength(5);
    expect(dabs[2]).toMatchObject({ x: 50, y: 0 });
    // The dab after the corner is on the vertical leg, 25 px along it.
    expect(dabs[3]).toMatchObject({ x: 50, y: 25 });
    expect(dabs[4]).toMatchObject({ x: 50, y: 50 });
  });

  it("gives each dab the direction of the path at that point", () => {
    const dabs = stampDabs(
      path([0, 50, 50], [0, 0, 50]),
      brush({ size: 100, stampSpacing: 0.25 }),
    );
    // The dabs on the first leg point along it, the ones after the corner
    // point down it: the dabs follow the path, not the sample grid.
    expect(dabs[1].angle).toBeCloseTo(0, 6);
    expect(dabs[3].angle).toBeCloseTo(Math.PI / 2, 6);
    // The first dab carries no direction: the path has not continued yet.
    expect(dabs[0].angle).toBe(0);
  });

  it("does not depend on the sample density, so the sample spacing cannot change the look", () => {
    const sparse = stampDabs(path([0, 50, 100], [0, 0, 0]), brush({ size: 100, stampSpacing: 0.25 }));
    const dense = stampDabs(
      path([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      brush({ size: 100, stampSpacing: 0.25 }),
    );
    expect(dense.map((dab) => dab.x)).toEqual(sparse.map((dab) => dab.x));
  });

  it("deposits exactly one dab for a press without movement", () => {
    const dabs = stampDabs(path([12], [13]), brush({ size: 10, stampSpacing: 0.5 }));
    expect(dabs).toHaveLength(1);
    expect(dabs[0]).toMatchObject({ x: 12, y: 13 });
    // The dab carries the brush's diameter at full pressure.
    expect(dabs[0].radius).toBe(5);
  });

  it("follows the pressure for the dab's radius", () => {
    const dabs = stampDabs(
      path([0, 50], [0, 0], [1, 0.25]),
      brush({ size: 100, stampSpacing: 0.5, pressureSize: 1, minSizeRatio: 0.1 }),
    );
    expect(dabs[0].radius).toBe(50);
    // The second dab sits at the far end, where the pressure is 0.25.
    expect(dabs[1].radius).toBeCloseTo(12.5, 6);
  });

  it("places no dab for a stroke without samples", () => {
    expect(stampDabs(path([], []), brush())).toEqual([]);
  });
});

describe("stamp dab cursor", () => {
  it("places the same dabs incrementally as it does in one go", () => {
    const settings = brush({ size: 100, stampSpacing: 0.25 });
    const xs = [0, 17, 40, 61, 100];
    const ys = [0, 5, 9, 9, 3];
    const pressures = [1, 0.8, 0.6, 0.7, 1];

    const cursor = new StampDabCursor(settings);
    const incremental: ReturnType<typeof stampDabs> = [];
    for (let end = 1; end <= xs.length; end += 1) {
      incremental.push(
        ...cursor.advance({
          xs: xs.slice(0, end),
          ys: ys.slice(0, end),
          pressures: pressures.slice(0, end),
        }),
      );
    }

    // The cursor is an accelerator, not a second source of truth.
    expect(incremental).toEqual(
      stampDabs({ xs, ys, pressures }, settings),
    );
  });

  it("starts over when it is reset", () => {
    const settings = brush({ size: 100, stampSpacing: 0.25 });
    const xs = [0, 50, 100];
    const cursor = new StampDabCursor(settings);
    const first = cursor.advance({ xs, ys: [0, 0, 0], pressures: [1, 1, 1] });
    cursor.reset();
    const second = cursor.advance({ xs, ys: [0, 0, 0], pressures: [1, 1, 1] });
    expect(second).toEqual(first);
  });
});

describe("stamp coverage budget", () => {
  /**
   * The fixture: a 512 px brush at the tightest dab spacing on a very long
   * path. One dab covers a 513 x 513 box, so the untruncated walk would place
   * about 3,900 dabs and ask for about 1.03 x 10^9 document pixels of work.
   */
  const BUDGET_SAMPLES = 4000;
  const BUDGET_STEP = 10;

  it("stops placing dabs once the stroke's work budget is spent", () => {
    // A huge brush on a very long path: the union of each dab would cost a
    // million document pixels, so the planner has to stop.
    const settings = brush({ size: 512, stampSpacing: 0.02 });
    const xs = Array.from({ length: BUDGET_SAMPLES }, (_, index) => index * BUDGET_STEP);
    const ys = xs.map(() => 0);
    const dabs = stampDabs({ xs, ys, pressures: xs.map(() => 1) }, settings);

    expect(dabs.length).toBeGreaterThan(0);
    expect(dabs.length).toBeLessThan(xs.length);

    // The work is the document pixels the dabs' bounding boxes cover - the same
    // quantity the planner accumulates (see `dabWork`).
    const work = dabs.reduce(
      (total, dab) => total + (dab.radius * 2 + 1) * (dab.radius * 2 + 1),
      0,
    );

    // The bound is the *document's* pixel budget, not the stamp engine's own
    // constant. The contract is a resource-safety one: a single stroke may
    // never consider more document pixels than the whole document is allowed
    // to have. The coverage map is bounded by the stroke's footprint and the
    // documented peak raster model (58 bytes per document pixel for three
    // surfaces plus a scan buffer) has no room for a stroke that covers more
    // than the document itself.
    //
    // Asserting against a *second, unrelated* constant is what makes this a
    // regression test. An assertion that compared the work with
    // `MAX_STAMP_COVERAGE_WORK` would be satisfied by construction: raising or
    // removing that constant would move the expected value with it, and the
    // test would stay green while the protection was gone.
    expect(work).toBeLessThanOrEqual(MAX_DOCUMENT_PIXELS);

    // The budget is the reason the walk stopped. The path is long enough for
    // thousands of dabs and the planner placed a small fraction of them. This
    // holds whatever the budget's value is, so it survives a deliberate change
    // to the constant - but it fails the moment the guard stops working.
    expect(dabs.length).toBeLessThan(BUDGET_SAMPLES / 10);
  });

  it("keeps the dab-work budget inside the document's own pixel budget", () => {
    // The constant is bound by the same contract, so weakening it - or
    // removing it - is a test failure rather than a silent loss of the
    // protection. Without this, the budget's value could be raised (or the
    // guard deleted) and the suite would still pass, because the only other
    // assertion compared the work with the constant itself.
    expect(MAX_STAMP_COVERAGE_WORK).toBeLessThanOrEqual(MAX_DOCUMENT_PIXELS);
  });

  it("cuts at a lattice index, so the live and rebuild paths truncate alike", () => {
    const settings = brush({ size: 512, stampSpacing: 0.02 });
    const xs = Array.from({ length: 4000 }, (_, index) => index * 10);
    const ys = xs.map(() => 0);
    const pressures = xs.map(() => 1);

    // The full walk, and the same path delivered in three pieces.
    const whole = stampDabs({ xs, ys, pressures }, settings);
    const cursor = new StampDabCursor(settings);
    const pieces: ReturnType<typeof stampDabs> = [];
    for (const end of [10, 2000, xs.length]) {
      pieces.push(
        ...cursor.advance({
          xs: xs.slice(0, end),
          ys: ys.slice(0, end),
          pressures: pressures.slice(0, end),
        }),
      );
    }

    expect(pieces).toEqual(whole);
    expect(whole.length).toBeLessThan(xs.length);
  });
});

describe("stamp dab coverage", () => {
  it("is opaque inside a hard dab and empty outside it", () => {
    expect(stampDabCoverage(0, 10, 1)).toBe(1);
    expect(stampDabCoverage(9, 10, 1)).toBe(1);
    expect(stampDabCoverage(11, 10, 1)).toBe(0);
  });

  it("keeps a one-pixel antialiased rim on a hard dab", () => {
    expect(stampDabCoverage(9.6, 10, 1)).toBeGreaterThan(0);
    expect(stampDabCoverage(9.6, 10, 1)).toBeLessThan(1);
  });

  it("thins a soft dab out towards its centre instead of blurring it", () => {
    // A dab with hardness 0 has no opaque core at all.
    expect(stampDabCoverage(0, 10, 0)).toBeLessThan(1);
    expect(stampDabCoverage(9, 10, 0)).toBeLessThan(stampDabCoverage(1, 10, 0));
  });

  it("keeps the falloff inside the dab's radius", () => {
    // The rim reaches half a pixel past the radius, and no further.
    expect(stampDabCoverage(10.4, 10, 0)).toBeLessThan(0.01);
    expect(stampDabCoverage(10.6, 10, 0)).toBe(0);
  });
});

describe("stamp coverage map", () => {
  /** Reads the coverage of one device pixel. */
  function coverageAt(map: StampCoverage, x: number, y: number): number {
    const data = new Uint8ClampedArray(4);
    map.writeRect(data, 1, { left: x, top: y, width: 1, height: 1 }, { r: 0, g: 0, b: 0 });
    return data[3];
  }

  it("matches the dab's own coverage", () => {
    const map = new StampCoverage();
    map.paintDab(20, 20, 10, 1);
    expect(coverageAt(map, 20, 20)).toBe(255);
    expect(coverageAt(map, 27, 20)).toBe(255);
    expect(coverageAt(map, 32, 20)).toBe(0);
  });

  it("unions overlapping dabs instead of adding them", () => {
    const single = new StampCoverage();
    single.paintDab(20, 20, 10, 0.5);
    const twice = new StampCoverage();
    twice.paintDab(20, 20, 10, 0.5);
    twice.paintDab(20, 20, 10, 0.5);

    // The soft rim of one dab: about 96 of 255.
    const softEdge = coverageAt(single, 28, 20);
    expect(softEdge).toBeGreaterThan(0);
    expect(softEdge).toBeLessThan(255);
    // Painting the same dab again cannot raise it: a maximum, not a sum.
    expect(coverageAt(twice, 28, 20)).toBe(softEdge);
  });

  it("keeps the larger of a soft edge and a neighbour's opaque core", () => {
    const map = new StampCoverage();
    map.paintDab(20, 20, 10, 0.5);
    const softEdge = coverageAt(map, 28, 20);
    // A small opaque core right where the soft rim was.
    map.paintDab(28, 20, 3, 1);
    expect(coverageAt(map, 28, 20)).toBe(255);
    expect(softEdge).toBeLessThan(255);
  });

  it("reports the rectangle a dab can reach", () => {
    const map = new StampCoverage();
    const rect = map.paintDab(20, 20, 10, 1);
    expect(rect).not.toBeNull();
    expect(rect?.left).toBeLessThanOrEqual(10);
    expect((rect?.left ?? 0) + (rect?.width ?? 0)).toBeGreaterThanOrEqual(31);
  });

  it("writes the colour and the coverage into an RGBA buffer", () => {
    const map = new StampCoverage();
    map.paintDab(20, 20, 10, 1);
    const data = new Uint8ClampedArray(4 * 4 * 4);
    map.writeRect(data, 4, { left: 19, top: 19, width: 4, height: 4 }, { r: 10, g: 20, b: 30 });
    // The centre pixel is covered and carries the brush colour.
    expect(data[(1 * 4 + 1) * 4 + 3]).toBe(255);
    expect(data[(1 * 4 + 1) * 4]).toBe(10);
    expect(data[(1 * 4 + 1) * 4 + 1]).toBe(20);
    expect(data[(1 * 4 + 1) * 4 + 2]).toBe(30);
  });

  it("releases its tiles, so the map can be reused", () => {
    const map = new StampCoverage();
    map.paintDab(20, 20, 10, 1);
    expect(coverageAt(map, 20, 20)).toBe(255);
    map.clear();
    expect(coverageAt(map, 20, 20)).toBe(0);
  });

  it("is deterministic: the same dabs produce the same coverage", () => {
    const first = new StampCoverage();
    const second = new StampCoverage();
    for (const map of [first, second]) {
      map.paintDab(20, 20, 10, 0.4);
      map.paintDab(26, 24, 10, 0.4);
    }
    const data = new Uint8ClampedArray(64 * 64);
    const other = new Uint8ClampedArray(64 * 64);
    first.writeRect(data, 64, { left: 0, top: 0, width: 64, height: 64 }, { r: 0, g: 0, b: 0 });
    second.writeRect(other, 64, { left: 0, top: 0, width: 64, height: 64 }, { r: 0, g: 0, b: 0 });
    expect(Array.from(data)).toEqual(Array.from(other));
  });
});

describe("stamp rectangle union", () => {
  it("keeps the first rectangle when there is nothing to merge", () => {
    const rect = { left: 1, top: 2, width: 3, height: 4 };
    expect(unionStampRect(null, rect)).toEqual(rect);
  });

  it("covers both rectangles", () => {
    const merged = unionStampRect(
      { left: 10, top: 10, width: 5, height: 5 },
      { left: 20, top: 4, width: 5, height: 5 },
    );
    expect(merged).toEqual({ left: 10, top: 4, width: 15, height: 11 });
  });
});
