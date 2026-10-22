import { describe, expect, it } from "vitest";
import {
  brushSettingsEqual,
  DEFAULT_BRUSH,
  MAX_BRUSH_SIZE,
  MAX_STAMP_ASPECT,
  MAX_STAMP_SPACING,
  MIN_BRUSH_SIZE,
  DEFAULT_PRESSURE_CURVE,
  normalizeBrush,
  stepBrushSize,
  updateBrushSettings,
} from "../core/brushes/defaults";
import { clamp, distance, fromLogPosition, lerp, roundTo, toLogPosition } from "../utils/math";
import { findToolByShortcut, getToolDefinition, TOOL_DEFINITIONS } from "../core/tools/toolDefinitions";

describe("math helpers", () => {
  it("clamps and falls back for non-finite input", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });

  it("interpolates and measures distance", () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(distance(0, 0, 3, 4)).toBe(5);
  });

  it("rounds for display", () => {
    expect(roundTo(1.23456, 2)).toBe(1.23);
  });

  it("round-trips a logarithmic slider position", () => {
    for (const value of [1, 6, 42, 128, 512]) {
      expect(fromLogPosition(toLogPosition(value, 1, 512), 1, 512)).toBeCloseTo(value, 6);
    }
    expect(toLogPosition(1, 1, 512)).toBe(0);
    expect(toLogPosition(512, 1, 512)).toBeCloseTo(1, 9);
    expect(toLogPosition(0, 1, 512)).toBe(0);
  });
});

describe("brush configuration", () => {
  it("clamps every numeric field", () => {
    const normalized = normalizeBrush({
      size: 10_000,
      opacity: 4,
      color: "  ",
      hardness: 5,
      pressureSize: -3,
      pressureOpacity: 9,
      pressureCurve: DEFAULT_PRESSURE_CURVE,
      minSizeRatio: 0,
      spacing: 100,
      stabilizer: -4,
      texture: 9,
      stamp: true,
      stampSpacing: 9,
      stampHardness: -2,
      stampTexture: 4,
      stampTip: "ellipse",
      stampAspect: 4,
      stampAngle: -30,
      stampAngleFollow: false,
    });
    expect(normalized.size).toBe(MAX_BRUSH_SIZE);
    expect(normalized.opacity).toBe(1);
    expect(normalized.color).toBe(DEFAULT_BRUSH.color);
    expect(normalized.hardness).toBe(1);
    expect(normalized.pressureSize).toBe(0);
    expect(normalized.pressureOpacity).toBe(1);
    expect(normalized.minSizeRatio).toBe(0.02);
    expect(normalized.spacing).toBe(2);
    expect(normalized.stabilizer).toBe(0);
    expect(normalized.texture).toBe(1);
    expect(normalized.stampSpacing).toBe(MAX_STAMP_SPACING);
    expect(normalized.stampHardness).toBe(0);
    expect(normalized.stampTexture).toBe(1);
    expect(normalized.stampTip).toBe("ellipse");
    expect(normalized.stampAspect).toBe(MAX_STAMP_ASPECT);
    // The angle is a direction: it is wrapped, not clamped away.
    expect(normalized.stampAngle).toBe(330);
    expect(normalized.stampAngleFollow).toBe(false);
  });

  it("applies a patch without mutating the current settings", () => {
    const next = updateBrushSettings(DEFAULT_BRUSH, { size: 40, color: "#ff0000" });
    expect(next.size).toBe(40);
    expect(next.color).toBe("#ff0000");
    expect(DEFAULT_BRUSH.size).toBe(6);
  });

  it("defaults to a hard edge and clamps hardness into range", () => {
    expect(DEFAULT_BRUSH.hardness).toBe(1);
    expect(normalizeBrush({ ...DEFAULT_BRUSH, hardness: -1 }).hardness).toBe(0);
    expect(normalizeBrush({ ...DEFAULT_BRUSH, hardness: 4 }).hardness).toBe(1);
  });

  it("treats hardness as part of the brush identity", () => {
    const soft = updateBrushSettings(DEFAULT_BRUSH, { hardness: 0.5 });
    expect(soft.hardness).toBe(0.5);
    expect(brushSettingsEqual(DEFAULT_BRUSH, soft)).toBe(false);
    expect(brushSettingsEqual(soft, { ...soft })).toBe(true);
  });

  it("defaults spacing and stabilizer, and treats both as brush identity", () => {
    expect(DEFAULT_BRUSH.spacing).toBe(0.12);
    expect(DEFAULT_BRUSH.stabilizer).toBe(0);
    expect(DEFAULT_BRUSH.texture).toBe(0);
    expect(normalizeBrush({ ...DEFAULT_BRUSH, stabilizer: 3 }).stabilizer).toBe(1);

    const spacing = updateBrushSettings(DEFAULT_BRUSH, { spacing: 0.4 });
    const stabilized = updateBrushSettings(DEFAULT_BRUSH, { stabilizer: 0.7 });
    const textured = updateBrushSettings(DEFAULT_BRUSH, { texture: 0.6 });
    expect(brushSettingsEqual(DEFAULT_BRUSH, spacing)).toBe(false);
    expect(brushSettingsEqual(DEFAULT_BRUSH, stabilized)).toBe(false);
    expect(brushSettingsEqual(DEFAULT_BRUSH, textured)).toBe(false);
    expect(brushSettingsEqual(stabilized, { ...stabilized })).toBe(true);
  });

  it("steps size finely for small brushes and proportionally for large ones", () => {
    expect(stepBrushSize(6, 1)).toBe(7);
    expect(stepBrushSize(6, -1)).toBe(5);
    expect(stepBrushSize(100, 1)).toBe(110);
    expect(stepBrushSize(100, -1)).toBe(90);
    expect(stepBrushSize(MIN_BRUSH_SIZE, -1)).toBe(MIN_BRUSH_SIZE);
    expect(stepBrushSize(MAX_BRUSH_SIZE, 1)).toBe(MAX_BRUSH_SIZE);
  });
});

describe("tool definitions", () => {
  it("lists the implemented tools only", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.id)).toEqual([
      "brush",
      "eraser",
      "select",
      "line",
      "rectangle",
      "ellipse",
      "polygon",
      "star",
      "bucket",
      "gradient",
      "picker",
      "guides",
      "pan",
    ]);
    expect(getToolDefinition("brush").shortcut).toBe("B");
    expect(getToolDefinition("eraser").shortcut).toBe("E");
    expect(getToolDefinition("select").shortcut).toBe("M");
    expect(getToolDefinition("line").shortcut).toBe("L");
    expect(getToolDefinition("rectangle").shortcut).toBe("R");
    expect(getToolDefinition("ellipse").shortcut).toBe("O");
    expect(getToolDefinition("polygon").shortcut).toBe("P");
    expect(getToolDefinition("star").shortcut).toBe("S");
    expect(getToolDefinition("bucket").shortcut).toBe("F");
    expect(getToolDefinition("gradient").shortcut).toBe("G");
    expect(getToolDefinition("picker").shortcut).toBe("I");
    expect(getToolDefinition("guides").shortcut).toBe("U");
    expect(getToolDefinition("pan").shortcut).toBe("H");
  });

  it("resolves shortcuts case-insensitively and ignores unknown keys", () => {
    expect(findToolByShortcut("b")?.id).toBe("brush");
    expect(findToolByShortcut("E")?.id).toBe("eraser");
    expect(findToolByShortcut("m")?.id).toBe("select");
    expect(findToolByShortcut("l")?.id).toBe("line");
    expect(findToolByShortcut("r")?.id).toBe("rectangle");
    expect(findToolByShortcut("o")?.id).toBe("ellipse");
    expect(findToolByShortcut("p")?.id).toBe("polygon");
    expect(findToolByShortcut("s")?.id).toBe("star");
    expect(findToolByShortcut("f")?.id).toBe("bucket");
    expect(findToolByShortcut("g")?.id).toBe("gradient");
    expect(findToolByShortcut("i")?.id).toBe("picker");
    expect(findToolByShortcut("h")?.id).toBe("pan");
    expect(findToolByShortcut("x")).toBeUndefined();
  });

  it("throws for an unknown tool id", () => {
    expect(() => getToolDefinition("smudge" as "brush")).toThrow(/Unknown tool id/);
  });
});
