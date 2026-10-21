/**
 * Pressure-curve tests.
 *
 * The curve is a mapping, not a sampling change: stored samples keep raw device
 * pressure and the mapping is evaluated once at rasterization. The identity
 * curve must reproduce the old linear formula exactly, so a default brush is
 * bit-for-bit unchanged.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH, DEFAULT_PRESSURE_CURVE, normalizeBrush } from "../core/brushes/defaults";
import {
  evaluatePressureCurve,
  normalizePressureCurve,
  pressureCurvesEqual,
  IDENTITY_PRESSURE_CURVE,
  MAX_PRESSURE_CURVE_POINTS,
} from "../core/brushes/pressureCurve";
import { createDocument } from "../core/document/document";
import type { LayerElement, StrokeRecord, StrokeSource } from "../core/document/types";
import { isStroke } from "../core/document/types";
import { createId } from "../utils/id";
import { PROJECT_VERSION, parseProject, serializeProject } from "../core/project/projectFormat";
import { strokeDiameter, strokeOpacity } from "../core/rendering/canvas2dStroke";
import type { PressureCurvePoint } from "../types/brush";

const BENT: readonly PressureCurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.8 },
  { x: 1, y: 1 },
];

describe("identity curve", () => {
  it("reproduces the linear diameter formula exactly", () => {
    const brush = { ...DEFAULT_BRUSH, size: 20, pressureSize: 0.6, minSizeRatio: 0.12 };
    for (const pressure of [0, 0.25, 0.5, 0.75, 1]) {
      const before = Math.max(20 * 0.12, 20 * (1 - 0.6 * (1 - pressure)));
      expect(strokeDiameter(brush, pressure)).toBe(before);
    }
  });

  it("reproduces the linear mean-pressure opacity exactly", () => {
    const brush = { ...DEFAULT_BRUSH, opacity: 0.8, pressureOpacity: 0.5 };
    const pressures = [0.2, 0.6, 1];
    const mean = pressures.reduce((sum, value) => sum + value, 0) / pressures.length;
    expect(strokeOpacity(brush, pressures)).toBe(0.8 * (1 - 0.5 * (1 - mean)));
  });

  it("is the shared value normalizeBrush returns for the default", () => {
    expect(normalizeBrush({ ...DEFAULT_BRUSH }).pressureCurve).toBe(IDENTITY_PRESSURE_CURVE);
    expect(DEFAULT_PRESSURE_CURVE).toBe(IDENTITY_PRESSURE_CURVE);
  });
});

describe("piecewise-linear evaluation", () => {
  it("maps endpoints and segments", () => {
    expect(evaluatePressureCurve(BENT, 0)).toBe(0);
    expect(evaluatePressureCurve(BENT, 0.25)).toBeCloseTo(0.4, 12);
    expect(evaluatePressureCurve(BENT, 0.5)).toBeCloseTo(0.8, 12);
    expect(evaluatePressureCurve(BENT, 0.75)).toBeCloseTo(0.9, 12);
    expect(evaluatePressureCurve(BENT, 1)).toBe(1);
  });

  it("supports a non-monotonic response", () => {
    const curve: readonly PressureCurvePoint[] = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.9 },
      { x: 0.7, y: 0.2 },
      { x: 1, y: 0.6 },
    ];
    expect(evaluatePressureCurve(curve, 0.2)).toBeCloseTo(0.6, 12);
    // The descending segment: 0.9 -> 0.2 across 0.3 -> 0.7.
    expect(evaluatePressureCurve(curve, 0.5)).toBeCloseTo(0.55, 12);
    expect(evaluatePressureCurve(curve, 0.9)).toBeCloseTo(0.4666666667, 9);
  });

  it("is flat between points with the same y and outside the endpoints", () => {
    const flat: readonly PressureCurvePoint[] = [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.3 },
    ];
    expect(evaluatePressureCurve(flat, 0)).toBe(0.3);
    expect(evaluatePressureCurve(flat, 0.5)).toBe(0.3);
    expect(evaluatePressureCurve(flat, 1)).toBe(0.3);

    const rising: readonly PressureCurvePoint[] = [
      { x: 0.2, y: 0.1 },
      { x: 0.8, y: 0.9 },
    ];
    expect(evaluatePressureCurve(rising, 0)).toBe(0.1);
    expect(evaluatePressureCurve(rising, 1)).toBe(0.9);
  });

  it("clamps non-finite and out-of-range input", () => {
    expect(evaluatePressureCurve(BENT, -3)).toBe(0);
    expect(evaluatePressureCurve(BENT, 4)).toBe(1);
    expect(evaluatePressureCurve(BENT, Number.NaN)).toBe(0);
    expect(evaluatePressureCurve([], 0.4)).toBe(0.4);
  });
});

describe("normalization", () => {
  it("sorts points, keeps the first of a duplicate x, and forces endpoints", () => {
    const normalized = normalizePressureCurve([
      { x: 1, y: 0.8 },
      { x: 0.5, y: 0.6 },
      { x: 0.5, y: 0.1 },
      { x: 0, y: 0.2 },
    ]);
    expect(normalized).toEqual([
      { x: 0, y: 0.2 },
      { x: 0.5, y: 0.6 },
      { x: 1, y: 0.8 },
    ]);

    expect(normalizePressureCurve([{ x: 0.4, y: 0.3 }])).toBe(IDENTITY_PRESSURE_CURVE);
  });

  it("clamps coordinates and drops unusable points", () => {
    const normalized = normalizePressureCurve([
      { x: -2, y: 4 },
      { x: 0.5, y: "high" },
      { x: Number.NaN, y: 0.5 },
      { x: 2, y: 0.9 },
      null,
      "nope",
    ]);
    expect(normalized).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 0.9 },
    ]);
  });

  it("falls back to the identity for unusable input", () => {
    for (const value of [undefined, null, 42, "curve", [], [{ x: 0.5, y: 0.5 }], [{ x: 1, y: 1 }]]) {
      expect(normalizePressureCurve(value)).toBe(IDENTITY_PRESSURE_CURVE);
    }
  });

  it("caps the number of points while keeping both endpoints", () => {
    const many = Array.from({ length: MAX_PRESSURE_CURVE_POINTS + 10 }, (_, index) => ({
      x: index / (MAX_PRESSURE_CURVE_POINTS + 9),
      y: index / (MAX_PRESSURE_CURVE_POINTS + 9),
    }));
    const normalized = normalizePressureCurve(many);
    expect(normalized).toHaveLength(MAX_PRESSURE_CURVE_POINTS);
    expect(normalized[0]).toEqual({ x: 0, y: 0 });
    expect(normalized[normalized.length - 1].x).toBe(1);
  });

  it("recognises the identity curve after normalization", () => {
    expect(
      normalizePressureCurve([
        { x: 1, y: 1 },
        { x: 0, y: 0 },
      ]),
    ).toBe(IDENTITY_PRESSURE_CURVE);
    // A collinear three-point curve maps identically but is kept as written:
    // only the exact two-point identity is collapsed to the shared value.
    expect(
      normalizePressureCurve([
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ]),
    ).toHaveLength(3);
  });

  it("compares curves by value", () => {
    expect(pressureCurvesEqual(BENT, BENT.map((point) => ({ ...point })))).toBe(true);
    expect(pressureCurvesEqual(BENT, DEFAULT_PRESSURE_CURVE)).toBe(false);
    expect(pressureCurvesEqual(BENT, BENT.slice(1))).toBe(false);
  });
});

describe("rendering with a bent curve", () => {
  it("applies the curve once to diameter", () => {
    const brush = { ...DEFAULT_BRUSH, size: 20, pressureSize: 0.5, minSizeRatio: 0.1, pressureCurve: BENT };
    // pressure 0.5 maps to 0.8, so the factor is 1 - 0.5 * (1 - 0.8) = 0.9.
    expect(strokeDiameter(brush, 0.5)).toBeCloseTo(18, 12);
    // pressure 0 maps to 0, so the factor is 1 - 0.5 = 0.5: 10 px.
    expect(strokeDiameter(brush, 0)).toBe(10);
  });

  it("applies the curve once before the opacity mean", () => {
    const brush = {
      ...DEFAULT_BRUSH,
      opacity: 1,
      pressureOpacity: 0.6,
      pressureCurve: BENT,
    };
    // mapped mean = (0 + 0.8 + 1) / 3.
    const mean = (0 + 0.8 + 1) / 3;
    expect(strokeOpacity(brush, [0, 0.5, 1])).toBeCloseTo(1 - 0.6 * (1 - mean), 12);
  });

  it("leaves mouse input at full size when the curve ends at full response", () => {
    const brush = { ...DEFAULT_BRUSH, size: 30, pressureSize: 0.8, pressureCurve: BENT };
    expect(strokeDiameter(brush, 1)).toBe(30);
  });
});

describe("project persistence", () => {
  function strokeWithCurve(curve: readonly PressureCurvePoint[]): StrokeRecord {
    return {
      id: createId("stroke"),
      layerId: "layer",
      brush: { ...DEFAULT_BRUSH, pressureCurve: curve },
      xs: [1, 2],
      ys: [1, 2],
      pressures: [0.5, 1],
      times: [0, 10],
      startTime: 1000,
    };
  }

  function sourceOf(entries: ReadonlyArray<readonly [string, LayerElement[]]>): StrokeSource {
    const map = new Map(entries);
    return {
      listStrokes: (layerId) => (map.get(layerId) ?? []).filter(isStroke),
      listElements: (layerId) => map.get(layerId) ?? [],
    };
  }

  it("round-trips a custom curve at version 12", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const stroke = strokeWithCurve(BENT);
    const payload = JSON.parse(
      serializeProject(document, sourceOf([[layerId, [{ ...stroke, layerId }]]])),
    ) as {
      version: number;
      layers: Array<{ elements: Array<{ brush: { pressureCurve: unknown } }> }>;
    };
    expect(payload.version).toBe(PROJECT_VERSION);
    expect(payload.version).toBe(12);
    expect(payload.layers[0].elements[0].brush.pressureCurve).toEqual(BENT);

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.strokes).toHaveLength(1);
    expect(parsed.project.strokes[0].brush.pressureCurve).toEqual(BENT);
  });

  it("reads a version-11 file as the identity curve", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const stroke = { ...strokeWithCurve(BENT), layerId };
    const payload = JSON.parse(
      serializeProject(document, sourceOf([[layerId, [stroke]]])),
    ) as {
      version: number;
      layers: Array<{ elements: Array<{ brush: Record<string, unknown> }> }>;
    };
    payload.version = 11;
    delete payload.layers[0].elements[0].brush.pressureCurve;

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.strokes[0].brush.pressureCurve).toBe(IDENTITY_PRESSURE_CURVE);
  });

  it("normalises a malformed version-12 curve instead of rejecting the file", () => {
    const document = createDocument({ width: 64, height: 64 });
    const layerId = document.layers[0].id;
    const stroke = { ...strokeWithCurve(BENT), layerId };
    const payload = JSON.parse(
      serializeProject(document, sourceOf([[layerId, [stroke]]])),
    ) as {
      version: number;
      layers: Array<{ elements: Array<{ brush: Record<string, unknown> }> }>;
    };
    payload.layers[0].elements[0].brush.pressureCurve = [{ x: 0.5, y: 0.5 }];

    const parsed = parseProject(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.project.strokes[0].brush.pressureCurve).toBe(IDENTITY_PRESSURE_CURVE);
  });
});
