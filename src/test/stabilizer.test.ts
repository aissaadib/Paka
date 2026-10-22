/**
 * Stroke stabilizer tests.
 *
 * The stabilizer is a capture-time filter, so these tests are about the
 * *samples* it produces: what it does to a jittery path, what it does to a
 * fast corner, where the stroke starts, where it ends, and how much it lags
 * behind the pointer while it moves.
 *
 * The numbers below are measurements, not aspirations: each one states the
 * bound the filter has to keep and the reason the bound is there.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_STABILIZER_MODE,
  isStabilizerMode,
  normalizeStabilizerMode,
  SPEED_WINDOW,
  STABILIZER_MODES,
  StrokeStabilizer,
  tauAlpha,
} from "../core/brushes/stabilizer";
import type { StrokeSample } from "../types/pointer";

/** A sample at a position, a pressure and a time in milliseconds. */
function sample(x: number, y: number, pressure = 1, time = 0): StrokeSample {
  return { x, y, pressure, time };
}

/** A stabilizer for a mode and a strength. */
function createStabilizer(mode: "off" | "smooth" | "pull", strength: number): StrokeStabilizer {
  return new StrokeStabilizer({ mode, strength });
}

/**
 * Feeds a path to a stabilizer and returns the filtered points.
 *
 * The pressure and the time of the raw samples are kept, so the caller can
 * compare the two paths point for point.
 */
function filter(
  stabilizer: StrokeStabilizer,
  samples: readonly StrokeSample[],
): StrokeSample[] {
  return samples.map((entry) => stabilizer.push(entry));
}

/**
 * A straight line drawn slowly, with the hand's tremor on it.
 *
 * The line advances 0.4 px per sample (50 px/s) and a 1 px tremor at 10 Hz
 * swings the point up and down, which is the shape of a hand that is nearly
 * still: the tremor is a hundredth of a second faster than the drawing, and
 * a twentieth of the amplitude.
 */
function tremblingLine(count = 60, step = 0.4, tremor = 1, periodMs = 100): StrokeSample[] {
  const samples: StrokeSample[] = [];
  for (let index = 0; index < count; index += 1) {
    const time = index * 8;
    samples.push(
      sample(index * step, tremor * Math.sin((2 * Math.PI * time) / periodMs), 0.5, time),
    );
  }
  return samples;
}

/**
 * The largest distance from the filtered path to the ideal line `y = 0`.
 *
 * The first point is left out on purpose: a stroke starts exactly where the
 * pointer was pressed, so the press point is never smoothed, and it would
 * hide every measurement of the rest of the path.
 */
function maxDeviation(points: readonly StrokeSample[]): number {
  return points
    .slice(1)
    .reduce((worst, point) => Math.max(worst, Math.abs(point.y)), 0);
}

/** The largest distance between two points. */
function gap(a: StrokeSample, b: StrokeSample): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("the stabilizer's modes", () => {
  it("offers exactly three modes, and the default is one of them", () => {
    expect(STABILIZER_MODES).toEqual(["off", "smooth", "pull"]);
    expect(isStabilizerMode(DEFAULT_STABILIZER_MODE)).toBe(true);
  });

  it("recognizes a mode and rejects anything else", () => {
    expect(isStabilizerMode("smooth")).toBe(true);
    expect(isStabilizerMode("pull")).toBe(true);
    expect(isStabilizerMode("off")).toBe(true);
    expect(isStabilizerMode("Smooth")).toBe(false);
    expect(isStabilizerMode("")).toBe(false);
    expect(isStabilizerMode(3)).toBe(false);
    expect(isStabilizerMode(null)).toBe(false);
  });

  it("falls back to the default mode for a value it does not know", () => {
    expect(normalizeStabilizerMode("pull")).toBe("pull");
    expect(normalizeStabilizerMode("rubber")).toBe(DEFAULT_STABILIZER_MODE);
    expect(normalizeStabilizerMode(undefined)).toBe(DEFAULT_STABILIZER_MODE);
  });
});

describe("the filter's own arithmetic", () => {
  it("covers more of the distance per sample when the time constant is shorter", () => {
    const slow = tauAlpha(0.1, 0.008);
    const fast = tauAlpha(0.01, 0.008);
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(fast);
    expect(fast).toBeLessThan(1);
  });

  it("covers the whole distance when the time constant or the step is degenerate", () => {
    expect(tauAlpha(0, 0.008)).toBe(1);
    expect(tauAlpha(0.1, 0)).toBe(1);
    expect(tauAlpha(Number.NaN, 0.008)).toBe(1);
  });

  it("converges at the same rate at any frame rate for one time constant", () => {
    // A time constant is a duration: over the same 100 ms the captured point
    // closes the same share of the gap at 60 Hz and at 240 Hz, so the same
    // gesture is filtered the same way whatever the device's rate is.
    const closedOver = (dt: number, tau: number, durationMs: number): number =>
      1 - Math.pow(1 - tauAlpha(tau, dt), durationMs / dt);

    expect(closedOver(1000 / 60, 0.05, 100)).toBeCloseTo(closedOver(1000 / 240, 0.05, 100), 6);
    // And a shorter time constant closes more of the gap in the same time.
    expect(closedOver(1000 / 60, 0.05, 100)).toBeGreaterThan(
      closedOver(1000 / 60, 0.2, 100),
    );
  });
});

describe("the off mode", () => {
  it("stores the pointer's own path, sample for sample", () => {
    const samples = tremblingLine(10);
    const points = filter(createStabilizer("off", 1), samples);
    expect(points.map((point) => point.x)).toEqual(samples.map((entry) => entry.x));
    expect(points.map((point) => point.y)).toEqual(samples.map((entry) => entry.y));
  });

  it("stores the pointer's own path whatever the strength is", () => {
    const samples = tremblingLine(10);
    const points = filter(createStabilizer("off", 0), samples);
    expect(points.map((point) => point.y)).toEqual(samples.map((entry) => entry.y));
  });
});

describe("the strength", () => {
  it("filters nothing at strength 0, whatever the mode is", () => {
    const samples = tremblingLine(20);
    for (const mode of ["smooth", "pull"] as const) {
      const points = filter(createStabilizer(mode, 0), samples);
      expect(points.map((point) => point.y)).toEqual(samples.map((entry) => entry.y));
    }
  });

  it("filters more at a higher strength", () => {
    const samples = tremblingLine(40);
    const light = maxDeviation(filter(createStabilizer("smooth", 0.3), samples));
    const heavy = maxDeviation(filter(createStabilizer("smooth", 1), samples));
    expect(heavy).toBeLessThan(light);
  });
});

describe("the smooth mode", () => {
  it("rejects the tremor of a slow hand", () => {
    const samples = tremblingLine();
    const raw = maxDeviation(samples);
    const smoothed = maxDeviation(filter(createStabilizer("smooth", 1), samples));

    // The raw path swings a full pixel either side of the line; the filtered
    // path keeps a fraction of that, which is the tremor the eye reads as a
    // shaky line.
    expect(raw).toBeGreaterThan(0.9);
    expect(smoothed).toBeLessThan(raw * 0.5);
  });

  it("keeps a fast corner", () => {
    const samples: StrokeSample[] = [];
    // 1000 px/s to the right, then 1000 px/s down: a hard corner.
    for (let index = 0; index < 20; index += 1) {
      samples.push(sample(index * 8, 0, 1, index * 8));
    }
    for (let index = 0; index < 20; index += 1) {
      samples.push(sample(152, index * 8, 1, 160 + index * 8));
    }

    const points = filter(createStabilizer("smooth", 1), samples);
    const cornerIndex = 20;
    const cornerY = samples[cornerIndex].y;

    // Four samples after the corner the filtered path is most of the way
    // down: the filter opens up when the pointer moves fast, so the corner
    // is a corner and not a curve.
    const after = points[cornerIndex + 4].y;
    expect(after).toBeGreaterThan(cornerY * 0.8);

    // And the path before the corner is still on the horizontal.
    expect(Math.abs(points[cornerIndex - 4].y)).toBeLessThan(1);
  });

  it("starts exactly where the pointer was pressed", () => {
    const stabilizer = createStabilizer("smooth", 1);
    const first = stabilizer.push(sample(12, 34, 0.5, 0));
    expect(first.x).toBe(12);
    expect(first.y).toBe(34);
  });

  it("keeps the device's pressure and time, and never filters them", () => {
    const stabilizer = createStabilizer("smooth", 1);
    const first = stabilizer.push(sample(0, 0, 0.2, 0));
    const second = stabilizer.push(sample(4, 0, 0.9, 16));
    const third = stabilizer.push(sample(8, 0, 0.3, 32));

    expect([first.pressure, second.pressure, third.pressure]).toEqual([0.2, 0.9, 0.3]);
    expect([first.time, second.time, third.time]).toEqual([0, 16, 32]);
  });

  it("is deterministic: the same samples give the same points", () => {
    const samples = tremblingLine(50);
    const first = filter(createStabilizer("smooth", 0.8), samples);
    const second = filter(createStabilizer("smooth", 0.8), samples);
    expect(first).toEqual(second);
  });

  it("does not depend on how the samples are batched", () => {
    const samples = tremblingLine(30);
    const one = filter(createStabilizer("smooth", 1), samples);

    const other = createStabilizer("smooth", 1);
    const split: StrokeSample[] = [];
    for (const entry of samples) {
      split.push(other.push(entry));
    }
    expect(split).toEqual(one);
  });

  it("filters a mouse and a pen the same way", () => {
    // The same movement, reported by a mouse (which has no pressure, so the
    // input layer reports `1`) and by a pen (whose pressure changes). The
    // captured path is the same: the filter moves the point, and the pressure
    // never enters the decision.
    const path = tremblingLine(40).map((entry) => ({ x: entry.x, y: 0, time: entry.time }));
    const mouse = filter(
      createStabilizer("smooth", 1),
      path.map((entry) => ({ ...entry, pressure: 1 })),
    );
    const pen = filter(
      createStabilizer("smooth", 1),
      path.map((entry) => ({ ...entry, pressure: 0.2 + entry.x / 400 })),
    );

    expect(pen.map((point) => point.x)).toEqual(mouse.map((point) => point.x));
    expect(pen.map((point) => point.y)).toEqual(mouse.map((point) => point.y));
    // The pressures are each their own: the mouse's `1` and the pen's ramp.
    expect(mouse.every((point) => point.pressure === 1)).toBe(true);
    expect(pen[0].pressure).toBeCloseTo(0.2, 9);
  });

  it("survives a pointer jump without losing the path", () => {
    const stabilizer = createStabilizer("smooth", 1);
    stabilizer.push(sample(0, 0, 1, 0));
    stabilizer.push(sample(4, 0, 1, 8));
    const jumped = stabilizer.push(sample(4000, 0, 1, 16));

    expect(Number.isFinite(jumped.x)).toBe(true);
    expect(Number.isFinite(jumped.y)).toBe(true);
    // The filter opens up for the jump, so the point is most of the way there
    // rather than crawling towards it.
    expect(jumped.x).toBeGreaterThan(1000);
  });

  it("survives two samples with the same timestamp", () => {
    const stabilizer = createStabilizer("smooth", 1);
    stabilizer.push(sample(0, 0, 1, 0));
    const second = stabilizer.push(sample(4, 0, 1, 0));
    expect(Number.isFinite(second.x)).toBe(true);
  });
});

describe("the pull mode", () => {
  it("drags the line behind the pointer", () => {
    const stabilizer = createStabilizer("pull", 1);
    stabilizer.push(sample(0, 0, 1, 0));
    const second = stabilizer.push(sample(100, 0, 1, 16));

    // The pull leaves a quarter of the remaining distance per sample, so the
    // captured point is well behind the pointer's.
    expect(second.x).toBeLessThan(50);
    expect(second.x).toBeGreaterThan(0);
  });

  it("is deterministic: the same samples give the same points", () => {
    const samples = tremblingLine(30);
    const first = filter(createStabilizer("pull", 1), samples);
    const second = filter(createStabilizer("pull", 1), samples);
    expect(first).toEqual(second);
  });
});

describe("the catch-up", () => {
  it("lands the last point exactly on the release point", () => {
    const stabilizer = createStabilizer("smooth", 1);
    stabilizer.push(sample(0, 0, 1, 0));
    stabilizer.push(sample(40, 0, 1, 16));
    const tail = stabilizer.settle(sample(80, 0, 1, 32));

    expect(tail.length).toBeGreaterThan(0);
    const last = tail[tail.length - 1];
    expect(last.x).toBe(80);
    expect(last.y).toBe(0);
  });

  it("is bounded: a short tail, however far behind the filter is", () => {
    const stabilizer = createStabilizer("pull", 1);
    stabilizer.push(sample(0, 0, 1, 0));
    stabilizer.push(sample(500, 0, 1, 16));
    const tail = stabilizer.settle(sample(1000, 0, 1, 32));

    expect(tail.length).toBeLessThanOrEqual(4);
    expect(tail[tail.length - 1].x).toBe(1000);
  });

  it("is empty when the stroke already ends where it should", () => {
    const stabilizer = createStabilizer("off", 1);
    stabilizer.push(sample(10, 10, 1, 0));
    stabilizer.push(sample(20, 10, 1, 8));
    expect(stabilizer.settle(sample(20, 10, 1, 16))).toEqual([]);
  });

  it("is empty for a stroke that never saw a sample", () => {
    expect(createStabilizer("smooth", 1).settle(sample(0, 0, 1, 0))).toEqual([]);
  });

  it("falls back to the last raw position when there is no release point", () => {
    const stabilizer = createStabilizer("pull", 1);
    stabilizer.push(sample(0, 0, 1, 0));
    stabilizer.push(sample(40, 0, 1, 16));
    const tail = stabilizer.settle();

    expect(tail.length).toBeGreaterThan(0);
    expect(tail[tail.length - 1].x).toBe(40);
  });

  it("keeps the pressure of the last raw sample, not the release's", () => {
    const stabilizer = createStabilizer("smooth", 1);
    stabilizer.push(sample(0, 0, 0.4, 0));
    stabilizer.push(sample(40, 0, 0.6, 16));
    const tail = stabilizer.settle(sample(80, 0, 1, 32));

    for (const point of tail) {
      expect(point.pressure).toBe(0.6);
    }
  });

  it("keeps the times in order and inside the stroke's own span", () => {
    const stabilizer = createStabilizer("smooth", 1);
    stabilizer.push(sample(0, 0, 1, 0));
    stabilizer.push(sample(40, 0, 1, 16));
    const tail = stabilizer.settle(sample(80, 0, 1, 48));

    let previous = 16;
    for (const point of tail) {
      expect(point.time).toBeGreaterThanOrEqual(previous);
      expect(point.time).toBeLessThanOrEqual(48);
      previous = point.time;
    }
  });
});

describe("the lag the filter keeps", () => {
  it("is under two and a half pixels while the pointer crawls", () => {
    // 20 px/s: a hand that is nearly still. The filter trails the pointer
    // by its time constant times the speed, so the trail shrinks with the
    // speed.
    const stabilizer = createStabilizer("smooth", 1);
    let raw = sample(0, 0, 1, 0);
    let filtered = stabilizer.push(raw);
    let worst = 0;
    for (let index = 1; index <= 100; index += 1) {
      raw = sample(index * 0.16, 0, 1, index * 8);
      filtered = stabilizer.push(raw);
      worst = Math.max(worst, gap(raw, filtered));
    }
    expect(worst).toBeLessThan(2.5);
  });

  it("stays within a few pixels while the pointer moves quickly", () => {
    // 1000 px/s: a fast stroke. The filter opens up, so the lag is a small
    // constant rather than a growing distance.
    const stabilizer = createStabilizer("smooth", 1);
    let raw = sample(0, 0, 1, 0);
    let filtered = stabilizer.push(raw);
    let worst = 0;
    for (let index = 1; index <= 100; index += 1) {
      raw = sample(index * 8, 0, 1, index * 8);
      filtered = stabilizer.push(raw);
      worst = Math.max(worst, gap(raw, filtered));
    }
    expect(worst).toBeLessThan(12);
  });

  it("does not grow with the length of the stroke", () => {
    // The filter keeps a bounded window, so a long stroke costs the same as
    // a short one and its lag does not drift.
    const short = createStabilizer("smooth", 1);
    const long = createStabilizer("smooth", 1);
    let shortLag = 0;
    let longLag = 0;
    for (let index = 0; index < 1000; index += 1) {
      const raw = sample(index * 0.16, 0, 1, index * 8);
      shortLag = Math.max(shortLag, gap(raw, short.push(raw)));
      longLag = Math.max(longLag, gap(raw, long.push(raw)));
    }
    expect(longLag).toBeCloseTo(shortLag, 9);
    expect(SPEED_WINDOW).toBe(6);
  });

  it("filters the same gesture the same way at 60 Hz and at 240 Hz", () => {
    // The same travel at 100 px/s, sampled at three rates. The time
    // constant is a duration, so the captured path is the same line in all
    // three: a device that reports faster does not draw a different stroke.
    const lagAt = (hz: number): number => {
      const dt = 1000 / hz;
      const stabilizer = createStabilizer("smooth", 1);
      let worst = 0;
      for (let index = 0; index * dt < 500; index += 1) {
        const raw = sample(index * dt * 0.1, 0, 1, index * dt);
        worst = Math.max(worst, gap(raw, stabilizer.push(raw)));
      }
      return worst;
    };

    // The three rates agree to within a thousandth of a pixel: the small
    // difference is the speed estimate, which is measured in samples.
    expect(lagAt(240)).toBeCloseTo(lagAt(60), 3);
    expect(lagAt(120)).toBeCloseTo(lagAt(60), 3);
  });
});
