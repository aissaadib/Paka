import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH, updateBrushSettings } from "../core/brushes/defaults";
import { MAX_DOCUMENT_PIXELS } from "../core/document/document";
import {
  MAX_STAMP_COVERAGE_WORK,
  MIN_STAMP_SPACING_PX,
  StampCoverage,
  StampDabCursor,
  isRoundTip,
  stampDabCoverage,
  stampDabs,
  stampSpacing,
  stampTextureLaneWidth,
  stampTipCoverage,
  stampTipOf,
  unionStampRect,
  type StampTexture,
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

describe("stamp directional texture", () => {
  /** A 20 px brush whose dabs are 5 px apart and whose lanes are 5 px wide. */
  const TEXTURED = brush({
    size: 20,
    stamp: true,
    stampSpacing: 0.25,
    stampHardness: 1,
    stampTexture: 1,
  });
  const LANE_WIDTH = 5;

  /**
   * The per-dab texture a dab is painted with.
   *
   * The default is the profile every earlier file was written by: the
   * irregular bristles at the default density and crispness.
   */
  function texture(overrides: Partial<StampTexture> = {}): StampTexture {
    return {
      angle: 0,
      laneWidth: LANE_WIDTH,
      strength: 1,
      mode: "bristles",
      contrast: 1,
      ...overrides,
    };
  }

  /** The coverage of a whole map, one byte per pixel, in device pixels. */
  function coverageGrid(
    map: StampCoverage,
    left: number,
    top: number,
    size: number,
  ): Uint8ClampedArray {
    const data = new Uint8ClampedArray(size * size * 4);
    map.writeRect(data, size, { left, top, width: size, height: size }, { r: 0, g: 0, b: 0 });
    const alpha = new Uint8ClampedArray(size * size);
    for (let index = 0; index < size * size; index += 1) {
      alpha[index] = data[index * 4 + 3];
    }
    return alpha;
  }

  /** The coverage of one pixel. */
  function coverageAt(map: StampCoverage, x: number, y: number): number {
    const data = new Uint8ClampedArray(4);
    map.writeRect(data, 1, { left: x, top: y, width: 1, height: 1 }, { r: 0, g: 0, b: 0 });
    return data[3];
  }

  it("lays the lanes out against the brush's own size", () => {
    expect(stampTextureLaneWidth(TEXTURED, 1)).toBe(LANE_WIDTH);
    // The lanes are anchored to the document: at 2x they are twice as wide in
    // device pixels and the same distance apart in document pixels.
    expect(stampTextureLaneWidth(TEXTURED, 2)).toBe(LANE_WIDTH * 2);
  });

  it("packs more lanes when the density rises", () => {
    // The density multiplies the number of lanes across the brush, so the
    // lanes get narrower - and they never get thinner than a device pixel, so
    // a small brush keeps a texture that can still be seen.
    const dense = brush({ size: 20, stampTextureScale: 2 });
    expect(stampTextureLaneWidth(dense, 1)).toBe(LANE_WIDTH / 2);
    const sparse = brush({ size: 20, stampTextureScale: 0.5 });
    expect(stampTextureLaneWidth(sparse, 1)).toBe(LANE_WIDTH * 2);
    const tiny = brush({ size: 1, stampTextureScale: 4 });
    expect(stampTextureLaneWidth(tiny, 1)).toBe(1);
  });

  it("keeps the default texture byte for byte", () => {
    // The regression guard for the whole texture path: the default profile -
    // irregular bristles at the default density and crispness - is the
    // picture every earlier file was written by, so the sum and the checksum
    // of its coverage are pinned here.
    const map = new StampCoverage();
    map.paintDab(20, 20, 10, 1, texture());
    const grid = coverageGrid(map, 0, 0, 48);
    let sum = 0;
    let hash = 2166136261;
    for (const alpha of grid) {
      sum += alpha;
      hash = (hash ^ alpha) >>> 0;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    expect(sum).toBe(51804);
    expect(hash).toBe(2549922865);
  });

  it("gives the ridges a regular profile and the bristles an irregular one", () => {
    // A wide dab, so several lanes are crossed and the two profiles can be
    // compared lane by lane.
    const centre = 60;
    const radius = 30;
    const ridges = new StampCoverage();
    ridges.paintDab(centre, centre, radius, 1, texture({ mode: "ridges" }));
    const bristles = new StampCoverage();
    bristles.paintDab(centre, centre, radius, 1, texture({ mode: "bristles" }));

    // The two profiles are different pictures.
    expect(Array.from(coverageGrid(ridges, 30, 30, 60))).not.toEqual(
      Array.from(coverageGrid(bristles, 30, 30, 60)),
    );

    // The ridge is the same shape in every lane, so the picture repeats from
    // lane to lane.
    let ridgeRepeats = true;
    for (let lane = 0; lane < 4; lane += 1) {
      for (let phase = 0; phase < 5; phase += 1) {
        const y = centre + lane * LANE_WIDTH + phase;
        if (coverageAt(ridges, centre, y) !== coverageAt(ridges, centre, y + LANE_WIDTH)) {
          ridgeRepeats = false;
        }
      }
    }
    expect(ridgeRepeats).toBe(true);

    // And the two profiles are shaped differently: a bristle has a flat top -
    // two neighbouring pixels carry the same value - while a ridge is a
    // rounded bump.
    expect(coverageAt(bristles, centre, 61)).toBe(coverageAt(bristles, centre, 62));
    expect(coverageAt(ridges, centre, 61)).not.toBe(coverageAt(ridges, centre, 62));
  });

  it("softens the texture's edges when the contrast falls", () => {
    const crisp = new StampCoverage();
    crisp.paintDab(20, 20, 10, 1, texture({ contrast: 1 }));
    const soft = new StampCoverage();
    soft.paintDab(20, 20, 10, 1, texture({ contrast: 0 }));

    // The picture changes: a softer edge is a wider ramp.
    expect(Array.from(coverageGrid(soft, 0, 0, 48))).not.toEqual(
      Array.from(coverageGrid(crisp, 0, 0, 48)),
    );
    // And it still only ever takes ink away.
    const plain = new StampCoverage();
    plain.paintDab(20, 20, 10, 1);
    for (let y = 8; y < 33; y += 1) {
      for (let x = 8; x < 33; x += 1) {
        expect(coverageAt(soft, x, y)).toBeLessThanOrEqual(coverageAt(plain, x, y));
      }
    }
  });

  it("leaves the coverage byte-identical when the texture is off", () => {
    const plain = new StampCoverage();
    plain.paintDab(20, 20, 10, 1);
    const off = new StampCoverage();
    off.paintDab(20, 20, 10, 1, texture({ angle: 0, strength: 0 }));
    expect(Array.from(coverageGrid(off, 0, 0, 48))).toEqual(
      Array.from(coverageGrid(plain, 0, 0, 48)),
    );
  });

  it("removes ink in bands that run along the dab's direction", () => {
    const plain = new StampCoverage();
    plain.paintDab(20, 20, 10, 1);
    const textured = new StampCoverage();
    textured.paintDab(20, 20, 10, 1, texture({ angle: 0, strength: 1 }));

    // Across the dab the texture removes ink in bands, so the reduction is not
    // the same at every offset.
    const reductions: number[] = [];
    for (let offset = 0; offset < 12; offset += 1) {
      reductions.push(coverageAt(plain, 20, 20 + offset) - coverageAt(textured, 20, 20 + offset));
    }
    expect(reductions.some((value) => value > 0)).toBe(true);
    expect(new Set(reductions).size).toBeGreaterThan(1);
  });

  it("rotates the lanes with the dab's direction", () => {
    const along = new StampCoverage();
    along.paintDab(20, 20, 10, 1, texture({ angle: 0, strength: 1 }));
    const across = new StampCoverage();
    across.paintDab(20, 20, 10, 1, texture({ angle: Math.PI / 2, strength: 1 }));

    // A quarter turn of the dab turns the pattern a quarter turn with it, so
    // the two coverages are each other's transpose. A texture that ignored the
    // direction would leave both patterns the same and fail this.
    const first = coverageGrid(along, 10, 10, 21);
    const second = coverageGrid(across, 10, 10, 21);
    for (let row = 0; row < 21; row += 1) {
      for (let column = 0; column < 21; column += 1) {
        expect(second[row * 21 + column]).toBe(first[column * 21 + row]);
      }
    }
  });

  it("runs the bands along the path, not across it", () => {
    // A horizontal run of dabs and a vertical run of dabs, the same brush and
    // the same length. The bands run with the path, so the stroke's
    // cross-section - the coverage as it falls away from the centre line - is
    // the same in both cases. A texture that ignored the direction would band
    // the horizontal run across its width and leave the vertical run alone.
    const horizontal = new StampCoverage();
    for (let index = 0; index < 9; index += 1) {
      horizontal.paintDab(20 + index * 5, 20, 10, 1, texture({ angle: 0, strength: 1 }));
    }
    const vertical = new StampCoverage();
    for (let index = 0; index < 9; index += 1) {
      vertical.paintDab(20, 20 + index * 5, 10, 1, texture({ angle: Math.PI / 2, strength: 1 }));
    }

    // Sampled well past the first dab, which carries no direction of its own.
    const acrossHorizontal = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((offset) =>
      coverageAt(horizontal, 55, 20 + offset),
    );
    const acrossVertical = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((offset) =>
      coverageAt(vertical, 20 + offset, 55),
    );
    expect(acrossHorizontal).toEqual(acrossVertical);
    // And the cross-section is not flat: the bands really do vary across it.
    expect(new Set(acrossHorizontal).size).toBeGreaterThan(1);
  });

  it("gives the same picture when the stroke is drawn backwards", () => {
    // The lanes are laid out against the brush's centre line, so which way the
    // stroke was travelling does not change the picture.
    const forward = new StampCoverage();
    forward.paintDab(20, 20, 10, 1, texture({ angle: 0, strength: 1 }));
    const backward = new StampCoverage();
    backward.paintDab(20, 20, 10, 1, texture({ angle: Math.PI, strength: 1 }));
    expect(Array.from(coverageGrid(backward, 0, 0, 48))).toEqual(
      Array.from(coverageGrid(forward, 0, 0, 48)),
    );
  });

  it("can only remove ink, never add it", () => {
    const plain = new StampCoverage();
    plain.paintDab(20, 20, 10, 1);
    const textured = new StampCoverage();
    textured.paintDab(20, 20, 10, 1, texture({ angle: 0, strength: 1 }));
    for (let y = 8; y < 33; y += 1) {
      for (let x = 8; x < 33; x += 1) {
        expect(coverageAt(textured, x, y)).toBeLessThanOrEqual(coverageAt(plain, x, y));
      }
    }
  });

  it("still unions with a maximum, so a textured stroke cannot darken", () => {
    const once = new StampCoverage();
    once.paintDab(20, 20, 10, 0.5, texture({ angle: 0, strength: 1 }));
    const twice = new StampCoverage();
    twice.paintDab(20, 20, 10, 0.5, texture({ angle: 0, strength: 1 }));
    twice.paintDab(20, 20, 10, 0.5, texture({ angle: 0, strength: 1 }));
    for (let y = 8; y < 33; y += 1) {
      for (let x = 8; x < 33; x += 1) {
        expect(coverageAt(twice, x, y)).toBe(coverageAt(once, x, y));
      }
    }
  });

  it("is the same for the same dab", () => {
    const first = new StampCoverage();
    const second = new StampCoverage();
    for (const map of [first, second]) {
      map.paintDab(20, 20, 10, 1, texture({ angle: 0.7, strength: 0.8 }));
      map.paintDab(26, 24, 8, 1, texture({ angle: 0.7, strength: 0.8 }));
    }
    expect(Array.from(coverageGrid(second, 0, 0, 48))).toEqual(
      Array.from(coverageGrid(first, 0, 0, 48)),
    );
  });

  it("textures a stationary dab, which has no direction of its own", () => {
    // The first dab of a stroke carries the angle 0, because the path has not
    // continued yet. It is still textured, along the document's x axis.
    const dabs = stampDabs(path([12], [13]), TEXTURED);
    expect(dabs).toHaveLength(1);
    expect(dabs[0].angle).toBe(0);

    const map = new StampCoverage();
    map.paintDab(12, 13, 10, 1, texture({ angle: dabs[0].angle, strength: 1 }));
    const plain = new StampCoverage();
    plain.paintDab(12, 13, 10, 1);
    expect(coverageAt(map, 12, 18)).toBeLessThan(coverageAt(plain, 12, 18));
  });

  it("survives a path of repeated points", () => {
    const dabs = stampDabs(path([10, 10, 10, 20], [10, 10, 10, 20]), TEXTURED);
    expect(dabs.length).toBeGreaterThan(0);
    for (const dab of dabs) {
      expect(Number.isFinite(dab.angle)).toBe(true);
      expect(Number.isFinite(dab.radius)).toBe(true);
    }

    const map = new StampCoverage();
    for (const dab of dabs) {
      map.paintDab(dab.x, dab.y, dab.radius, 1, texture({ angle: dab.angle, strength: 1 }));
    }
    expect(coverageAt(map, 10, 10)).toBeGreaterThan(0);
  });

  it("costs nothing: the same dabs, the same work and the same area", () => {
    // The texture runs inside the dab's own pixel loop, so it must not change
    // the plan, the number of pixels examined or the area the union touches.
    // A change that made the texture allocate, or take a second pass, would
    // move one of these.
    const xs = Array.from({ length: 200 }, (_, index) => index * 3);
    const dabs = stampDabs(path(xs, xs.map(() => 0)), TEXTURED);
    expect(dabs.length).toBeGreaterThan(50);

    const plain = new StampCoverage();
    const textured = new StampCoverage();
    const plainRects: number[] = [];
    const texturedRects: number[] = [];
    for (const dab of dabs) {
      const one = plain.paintDab(dab.x, dab.y, dab.radius, 1);
      const two = textured.paintDab(dab.x, dab.y, dab.radius, 1, texture({ angle: dab.angle, strength: 1 }));
      if (one) {
        plainRects.push(one.left, one.top, one.width, one.height);
      }
      if (two) {
        texturedRects.push(two.left, two.top, two.width, two.height);
      }
    }

    // The same rectangles: the texture does not widen or move a dab.
    expect(texturedRects).toEqual(plainRects);
    // The same work: the same dabs' bounding boxes, so the same pixels.
    const work = dabs.reduce(
      (total, dab) => total + (dab.radius * 2 + 1) * (dab.radius * 2 + 1),
      0,
    );
    expect(work).toBeLessThanOrEqual(MAX_STAMP_COVERAGE_WORK);
  });

  it("does not move the work budget, whatever the texture does", () => {
    // The fixture the budget test uses: a 512 px brush at the tightest dab
    // spacing on a very long path. The planner truncates it, and the texture
    // is not part of the plan, so the truncation is the same either way.
    const settings = brush({ size: 512, stampSpacing: 0.02, stampTexture: 1 });
    const xs = Array.from({ length: 4000 }, (_, index) => index * 10);
    const dabs = stampDabs(path(xs, xs.map(() => 0)), settings);
    expect(dabs.length).toBeGreaterThan(0);
    expect(dabs.length).toBeLessThan(xs.length / 10);

    const work = dabs.reduce(
      (total, dab) => total + (dab.radius * 2 + 1) * (dab.radius * 2 + 1),
      0,
    );
    expect(work).toBeLessThanOrEqual(MAX_DOCUMENT_PIXELS);
  });

  it("rotates the lanes with the path, not just with the dab", () => {
    // A dab's coverage is a function of the perpendicular offset in the dab's
    // own frame, so turning the frame turns the picture: the coverage at a
    // point under a quarter-turned dab is the coverage at the point turned
    // back by a quarter. A quarter turn maps the pixel grid onto itself, so
    // the law can be asserted exactly, pixel for pixel.
    const along = new StampCoverage();
    along.paintDab(40, 40, 12, 1, texture({ angle: 0, strength: 1 }));
    const turned = new StampCoverage();
    turned.paintDab(40, 40, 12, 1, texture({ angle: Math.PI / 2, strength: 1 }));

    // The dab's centre is (40, 40), so the pixel (x, y) under the turned dab
    // corresponds to the pixel (y, 79 - x) under the unturned one.
    for (let x = 30; x <= 50; x += 1) {
      for (let y = 30; y <= 50; y += 1) {
        expect(coverageAt(turned, x, y)).toBe(coverageAt(along, y, 79 - x));
      }
    }
  });

  it("gives a diagonal path its own direction", () => {
    // A path that is not axis-aligned: the dabs carry its direction, and the
    // lanes follow it, so the picture is not the axis-aligned one.
    const dabs = stampDabs(path([0, 50, 100], [0, 50, 100]), TEXTURED);
    expect(dabs.length).toBeGreaterThan(1);
    // The first dab has no direction yet - the path has not continued, and a
    // dab's direction must not depend on samples that arrive later.
    expect(dabs[0].angle).toBe(0);
    for (const dab of dabs.slice(1)) {
      expect(dab.angle).toBeCloseTo(Math.PI / 4, 6);
    }

    const diagonal = new StampCoverage();
    diagonal.paintDab(40, 40, 12, 1, texture({ angle: Math.PI / 4, strength: 1 }));
    const flat = new StampCoverage();
    flat.paintDab(40, 40, 12, 1, texture({ angle: 0, strength: 1 }));
    // The two pictures are not the same: the lanes point different ways.
    const diagonalGrid = coverageGrid(diagonal, 20, 20, 40);
    const flatGrid = coverageGrid(flat, 20, 20, 40);
    expect(Array.from(diagonalGrid)).not.toEqual(Array.from(flatGrid));
  });

  it("works on fractional coordinates", () => {
    // The dab plan interpolates, so a dab's centre is rarely a whole pixel.
    const dabs = stampDabs(path([6.5, 16.25, 26.75], [6.25, 14.5, 6.75]), TEXTURED);
    expect(dabs.length).toBeGreaterThan(0);

    const map = new StampCoverage();
    const plain = new StampCoverage();
    for (const dab of dabs) {
      map.paintDab(dab.x, dab.y, dab.radius, 1, texture({ angle: dab.angle, strength: 1 }));
      plain.paintDab(dab.x, dab.y, dab.radius, 1);
    }
    // The coverage is a whole-pixel grid either way, and the texture only
    // ever takes ink away.
    let removed = 0;
    for (let y = 0; y < 30; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        const value = coverageAt(map, x, y);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeLessThanOrEqual(coverageAt(plain, x, y));
        if (value < coverageAt(plain, x, y)) {
          removed += 1;
        }
      }
    }
    // The texture really did something on a fractional path.
    expect(removed).toBeGreaterThan(0);
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

describe("stamp tips", () => {
  /** Reads the coverage of one device pixel. */
  function coverageAt(map: StampCoverage, x: number, y: number): number {
    const data = new Uint8ClampedArray(4);
    map.writeRect(data, 1, { left: x, top: y, width: 1, height: 1 }, { r: 0, g: 0, b: 0 });
    return data[3];
  }

  /** The dab's centre, on a pixel boundary so the geometry is exact. */
  const CENTRE = 20.5;
  const RADIUS = 10;

  it("keeps the round tip the plain disc, byte for byte", () => {
    // The tip is additive: a brush with no tip is the disc the stamp engine
    // has always painted, so every stroke drawn before the tip existed keeps
    // its exact pixels.
    const plain = new StampCoverage();
    plain.paintDab(CENTRE, CENTRE, RADIUS, 1);
    const round = new StampCoverage();
    round.paintDab(CENTRE, CENTRE, RADIUS, 1, null, { kind: "round", aspect: 1 });
    const wide = new StampCoverage();
    wide.paintDab(CENTRE, CENTRE, RADIUS, 1, null, { kind: "ellipse", aspect: 1 });

    for (let y = 0; y < 48; y += 1) {
      for (let x = 0; x < 48; x += 1) {
        expect(coverageAt(round, x, y)).toBe(coverageAt(plain, x, y));
        // An ellipse as wide as it is long is a disc, and takes the same path.
        expect(coverageAt(wide, x, y)).toBe(coverageAt(plain, x, y));
      }
    }
  });

  it("reads a tip off the brush, and nothing for a round one", () => {
    expect(stampTipOf(brush())).toBeNull();
    expect(stampTipOf(brush({ stampTip: "round" }))).toBeNull();
    expect(stampTipOf(brush({ stampTip: "ellipse", stampAspect: 0.4 }))).toEqual({
      kind: "ellipse",
      aspect: 0.4,
    });
    expect(isRoundTip(null)).toBe(true);
    expect(isRoundTip({ kind: "round", aspect: 1 })).toBe(true);
    expect(isRoundTip({ kind: "ellipse", aspect: 1 })).toBe(true);
    expect(isRoundTip({ kind: "ellipse", aspect: 0.5 })).toBe(false);
    expect(isRoundTip({ kind: "square", aspect: 1 })).toBe(false);
  });

  it("stretches the ellipse along its major axis and stops at the minor one", () => {
    const map = new StampCoverage();
    map.paintDab(CENTRE, CENTRE, RADIUS, 1, null, { kind: "ellipse", aspect: 0.5 });

    // Along the major axis the dab is as long as its radius says.
    expect(coverageAt(map, 29, 20)).toBe(255);
    // Across the minor axis it is half as wide: the boundary is at five
    // pixels, so the pixel on it is half covered and the one beyond is bare.
    expect(coverageAt(map, 20, 25)).toBeGreaterThan(0);
    expect(coverageAt(map, 20, 25)).toBeLessThan(255);
    expect(coverageAt(map, 20, 26)).toBe(0);
    // The plain disc reaches all of that.
    const disc = new StampCoverage();
    disc.paintDab(CENTRE, CENTRE, RADIUS, 1);
    expect(coverageAt(disc, 20, 26)).toBe(255);
  });

  it("turns the tip with its angle", () => {
    const turned = new StampCoverage();
    turned.paintDab(CENTRE, CENTRE, RADIUS, 1, null, { kind: "ellipse", aspect: 0.5 }, Math.PI / 2);

    // A quarter turn puts the long axis across the path.
    expect(coverageAt(turned, 20, 29)).toBe(255);
    expect(coverageAt(turned, 26, 20)).toBe(0);
    // And the other way round it is the other way.
    const flat = new StampCoverage();
    flat.paintDab(CENTRE, CENTRE, RADIUS, 1, null, { kind: "ellipse", aspect: 0.5 });
    expect(coverageAt(flat, 29, 20)).toBe(255);
    expect(coverageAt(flat, 20, 29)).toBe(0);
  });

  it("gives the square tip corners a disc does not have", () => {
    const square = new StampCoverage();
    square.paintDab(CENTRE, CENTRE, RADIUS, 1, null, { kind: "square", aspect: 1 });
    const disc = new StampCoverage();
    disc.paintDab(CENTRE, CENTRE, RADIUS, 1);

    // The pixel on the square's corner is on its boundary, so it is half
    // covered; the disc's own edge is well inside that.
    expect(coverageAt(square, 30, 30)).toBeGreaterThan(0);
    expect(coverageAt(disc, 30, 30)).toBe(0);
  });

  it("paints the same coverage the reference says it should", () => {
    // The painter's fast path and the reference function have to agree pixel
    // for pixel: a change to only one of them would show up here.
    for (const kind of ["ellipse", "square"] as const) {
      const aspect = 0.5;
      const angle = 0.6;
      const map = new StampCoverage();
      map.paintDab(CENTRE, CENTRE, RADIUS, 1, null, { kind, aspect }, angle);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      for (let y = 8; y < 34; y += 1) {
        for (let x = 8; x < 34; x += 1) {
          const dx = x + 0.5 - CENTRE;
          const dy = y + 0.5 - CENTRE;
          const along = dx * cos + dy * sin;
          const across = -dx * sin + dy * cos;
          const expected = Math.round(
            stampTipCoverage(along, across, RADIUS, RADIUS * aspect, kind === "square", 1) * 255,
          );
          expect(coverageAt(map, x, y)).toBe(expected);
        }
      }
    }
  });

  it("keeps the union a maximum, so a tipped stroke cannot darken", () => {
    const once = new StampCoverage();
    once.paintDab(CENTRE, CENTRE, RADIUS, 0.5, null, { kind: "ellipse", aspect: 0.5 });
    const twice = new StampCoverage();
    twice.paintDab(CENTRE, CENTRE, RADIUS, 0.5, null, { kind: "ellipse", aspect: 0.5 });
    twice.paintDab(CENTRE, CENTRE, RADIUS, 0.5, null, { kind: "ellipse", aspect: 0.5 });
    for (let y = 8; y < 34; y += 1) {
      for (let x = 8; x < 34; x += 1) {
        expect(coverageAt(twice, x, y)).toBe(coverageAt(once, x, y));
      }
    }
  });

  it("points the tip along the path when the tip follows it", () => {
    const settings = brush({ stampTip: "ellipse", stampAngleFollow: true, stampAngle: 0 });
    const dabs = stampDabs(path([0, 50, 100], [0, 50, 100]), settings);
    expect(dabs.length).toBeGreaterThan(1);
    // The first dab has no direction yet - the path has not continued - so it
    // carries the offset on its own.
    expect(dabs[0].tipAngle).toBe(0);
    for (const dab of dabs.slice(1)) {
      expect(dab.tipAngle).toBeCloseTo(Math.PI / 4, 6);
    }
  });

  it("keeps a fixed tip at its own angle, whatever the path does", () => {
    const settings = brush({
      stampTip: "ellipse",
      stampAngleFollow: false,
      stampAngle: 30,
    });
    const dabs = stampDabs(path([0, 50, 100], [0, 50, 100]), settings);
    expect(dabs.length).toBeGreaterThan(1);
    for (const dab of dabs) {
      expect(dab.tipAngle).toBeCloseTo((30 * Math.PI) / 180, 6);
    }
  });

  it("turns the tip by the brush's offset when it follows the path", () => {
    const settings = brush({ stampTip: "ellipse", stampAngleFollow: true, stampAngle: 90 });
    const dabs = stampDabs(path([0, 50, 100], [0, 50, 100]), settings);
    for (const dab of dabs.slice(1)) {
      expect(dab.tipAngle).toBeCloseTo(Math.PI / 4 + Math.PI / 2, 6);
    }
  });

  it("places the dabs of a tipped stroke exactly where a plain one goes", () => {
    // The tip is a mask, not a placement: the dabs are still placed by the
    // path, so a tipped stroke covers the same stretch of the path.
    const settings = brush({ stampTip: "ellipse", stampAspect: 0.4 });
    const plain = stampDabs(path([0, 100], [0, 0]), brush({ size: 100, stampSpacing: 0.25 }));
    const tipped = stampDabs(path([0, 100], [0, 0]), { ...settings, size: 100, stampSpacing: 0.25 });
    expect(tipped.map((dab) => [dab.x, dab.y, dab.radius])).toEqual(
      plain.map((dab) => [dab.x, dab.y, dab.radius]),
    );
  });
});
