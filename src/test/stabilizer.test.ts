/**
 * The stabilizer's model.
 *
 * The filter itself runs in `core/brushes/strokeBuilder`. The model in
 * `core/brushes/stabilizer` describes it - the follow rule, the lag limit
 * and the release settle - and these tests hold the two together: the model
 * is not allowed to disagree with the builder about a single stored sample.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  STABILIZER_MAX_LAG as BUILDER_STABILIZER_MAX_LAG,
  StrokeBuilder,
  createStrokeRecord,
} from "../core/brushes/strokeBuilder";
import {
  DEFAULT_STABILIZER_MODE,
  MIN_STABILIZER_SEGMENT,
  STABILIZER_MAX_LAG,
  createStabilizerState,
  filterStabilizerSample,
  isStabilizerMode,
  normalizeStabilizerMode,
  settleStabilizerSample,
  stabilizerFollow,
  stabilizerIsActive,
  type StabilizerState,
} from "../core/brushes/stabilizer";
import type { StrokeSample } from "../types/pointer";

function sample(x: number, y: number, pressure = 1, time = 0): StrokeSample {
  return { x, y, pressure, time };
}

/** The samples the model stores for a path, settle included. */
function modelSamples(path: readonly StrokeSample[], strength: number): StrokeSample[] {
  let state: StabilizerState = createStabilizerState();
  const stored: StrokeSample[] = [];
  for (const raw of path) {
    const result = filterStabilizerSample(state, raw, strength);
    state = result.state;
    if (result.point !== null) {
      stored.push(result.point);
    }
  }
  const settle = settleStabilizerSample(state, strength);
  if (settle !== null) {
    stored.push(settle);
  }
  return stored;
}

/**
 * The samples the builder stores for a path.
 *
 * The brush is given a large size and a wide spacing so the builder never
 * interpolates: the comparison is then between the filter's samples and
 * nothing else.
 */
function builderSamples(path: readonly StrokeSample[], strength: number): StrokeSample[] {
  const builder = new StrokeBuilder(
    createStrokeRecord("layer-1", {
      ...DEFAULT_BRUSH,
      size: 200,
      spacing: 2,
      stabilizer: strength,
    }),
  );
  for (const raw of path) {
    builder.addSample(raw);
  }
  builder.finish();
  const { xs, ys, pressures, times } = builder.stroke;
  return xs.map((x, index) => ({
    x,
    y: ys[index],
    pressure: pressures[index],
    time: times[index],
  }));
}

const straightPath: StrokeSample[] = [
  sample(0, 0, 0, 0),
  sample(10, 0, 1, 10),
  sample(20, 0, 1, 20),
  sample(30, 0, 1, 30),
];

describe("the lag limit", () => {
  it("is the same number the builder uses", () => {
    expect(STABILIZER_MAX_LAG).toBe(BUILDER_STABILIZER_MAX_LAG);
    expect(STABILIZER_MAX_LAG).toBe(0.75);
  });

  it("is the fraction of the distance the filter leaves behind at full strength", () => {
    expect(stabilizerFollow(1)).toBe(0.25);
    expect(stabilizerFollow(0.5)).toBe(0.625);
  });

  it("covers the whole distance when the stabilizer is off", () => {
    expect(stabilizerFollow(0)).toBe(1);
  });

  it("clamps a strength that is out of range", () => {
    expect(stabilizerFollow(2)).toBe(0.25);
    expect(stabilizerFollow(-1)).toBe(1);
    expect(stabilizerFollow(Number.NaN)).toBe(1);
  });

  it("is off only at a strength of zero", () => {
    expect(stabilizerIsActive(0)).toBe(false);
    expect(stabilizerIsActive(0.01)).toBe(true);
    expect(stabilizerIsActive(Number.NaN)).toBe(false);
  });
});

describe("the model against the builder", () => {
  it("stores the same samples on a straight path", () => {
    for (const strength of [0, 0.25, 0.5, 1]) {
      expect(modelSamples(straightPath, strength)).toEqual(builderSamples(straightPath, strength));
    }
  });

  it("stores the same samples on a path that changes direction", () => {
    const path: StrokeSample[] = [
      sample(0, 0, 0.2, 0),
      sample(4, 3, 0.4, 8),
      sample(-2, 9, 0.6, 16),
      sample(11, 11, 0.9, 24),
      sample(11, 2, 1, 32),
    ];
    for (const strength of [0, 0.5, 1]) {
      expect(modelSamples(path, strength)).toEqual(builderSamples(path, strength));
    }
  });

  it("stores the same samples when the movement is smaller than the sample distance", () => {
    // Each step is below the distance the builder stores, so the strokes
    // accumulate instead of stalling - and the model has to agree.
    const path: StrokeSample[] = [
      sample(0, 0, 1, 0),
      sample(0.04, 0, 1, 4),
      sample(0.08, 0, 1, 8),
      sample(0.12, 0, 1, 12),
      sample(0.16, 0, 1, 16),
    ];
    for (const strength of [0, 1]) {
      expect(modelSamples(path, strength)).toEqual(builderSamples(path, strength));
    }
  });

  it("stores the same samples when a pressure ramps", () => {
    const path: StrokeSample[] = [
      sample(0, 0, 0, 0),
      sample(10, 0, 0.5, 10),
      sample(20, 0, 1, 20),
    ];
    expect(modelSamples(path, 1)).toEqual(builderSamples(path, 1));
  });
});

describe("the follow rule", () => {
  it("stores the first sample unchanged, so the stroke starts on the press", () => {
    const result = filterStabilizerSample(createStabilizerState(), sample(12, 34, 0.5, 7), 1);
    expect(result.point).toEqual({ x: 12, y: 34, pressure: 0.5, time: 7 });
  });

  it("pulls the stored point towards the pointer by the follow factor", () => {
    const first = filterStabilizerSample(createStabilizerState(), sample(0, 0, 0, 0), 1);
    const second = filterStabilizerSample(first.state, sample(10, 0, 1, 10), 1);
    // follow = 0.25: the stored point covers a quarter of the way to the
    // pointer.
    expect(second.point?.x).toBe(2.5);
  });

  it("filters the pressure with the same factor as the position", () => {
    const first = filterStabilizerSample(createStabilizerState(), sample(0, 0, 0, 0), 1);
    const second = filterStabilizerSample(first.state, sample(10, 0, 1, 10), 1);
    expect(second.point?.pressure).toBe(0.25);
  });

  it("keeps the device's own time", () => {
    const first = filterStabilizerSample(createStabilizerState(), sample(0, 0, 0, 0), 1);
    const second = filterStabilizerSample(first.state, sample(10, 0, 1, 33), 1);
    expect(second.point?.time).toBe(33);
  });

  it("stores the raw path when the stabilizer is off", () => {
    const first = filterStabilizerSample(createStabilizerState(), sample(0, 0, 0.2, 0), 0);
    const second = filterStabilizerSample(first.state, sample(10, 0, 0.6, 10), 0);
    expect(second.point).toEqual({ x: 10, y: 0, pressure: 0.6, time: 10 });
  });

  it("ignores a sample that is not finite", () => {
    const first = filterStabilizerSample(createStabilizerState(), sample(0, 0, 1, 0), 1);
    const second = filterStabilizerSample(first.state, sample(Number.NaN, 0, 1, 10), 1);
    expect(second.point).toBeNull();
    expect(second.state).toBe(first.state);
  });

  it("clamps a pressure that is out of range", () => {
    const first = filterStabilizerSample(createStabilizerState(), sample(0, 0, 4, 0), 1);
    expect(first.point?.pressure).toBe(1);
  });
});

describe("the release settle", () => {
  it("lands the stroke on the pointer's last position", () => {
    const first = filterStabilizerSample(createStabilizerState(), sample(0, 0, 0, 0), 1);
    const second = filterStabilizerSample(first.state, sample(10, 0, 1, 10), 1);
    const settle = settleStabilizerSample(second.state, 1);
    expect(settle).toEqual({ x: 10, y: 0, pressure: 1, time: 10 });
  });

  it("does nothing when the filter is off, because the path is already the pointer's", () => {
    const first = filterStabilizerSample(createStabilizerState(), sample(0, 0, 0, 0), 0);
    const second = filterStabilizerSample(first.state, sample(10, 0, 1, 10), 0);
    expect(settleStabilizerSample(second.state, 0)).toBeNull();
  });

  it("does nothing when the stroke has no samples", () => {
    expect(settleStabilizerSample(createStabilizerState(), 1)).toBeNull();
  });

  it("does nothing when the pointer is already where the stroke ends", () => {
    const first = filterStabilizerSample(createStabilizerState(), sample(0, 0, 1, 0), 1);
    const second = filterStabilizerSample(first.state, sample(0, 0, 1, 10), 1);
    expect(settleStabilizerSample(second.state, 1)).toBeNull();
  });

  it("is skipped below the distance the builder stores", () => {
    const first = filterStabilizerSample(createStabilizerState(), sample(0, 0, 1, 0), 1);
    const second = filterStabilizerSample(first.state, sample(MIN_STABILIZER_SEGMENT / 2, 0, 1, 10), 1);
    expect(settleStabilizerSample(second.state, 1)).toBeNull();
  });
});

describe("the regimes the filter has", () => {
  it("are the raw path and the lagged path", () => {
    expect(normalizeStabilizerMode("off")).toBe("off");
    expect(normalizeStabilizerMode("pull")).toBe("pull");
    expect(isStabilizerMode("off")).toBe(true);
    expect(isStabilizerMode("smooth")).toBe(false);
  });

  it("fall back to the default for a value the filter does not have", () => {
    expect(DEFAULT_STABILIZER_MODE).toBe("off");
    expect(normalizeStabilizerMode("smooth")).toBe("off");
    expect(normalizeStabilizerMode(undefined)).toBe("off");
    expect(normalizeStabilizerMode(7)).toBe("off");
  });
});
