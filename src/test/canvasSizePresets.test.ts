/**
 * Canvas size presets.
 *
 * These tests keep the quick sizes honest: every button must describe a
 * document the model accepts, the ids and dimensions stay unique, and the
 * selected state follows the rounded values the dialog actually creates.
 * Nothing here allocates a canvas.
 */

import { describe, expect, it } from "vitest";
import {
  CANVAS_SIZE_PRESETS,
  findCanvasSizePreset,
  isCanvasSizePresetSelected,
} from "../core/document/canvasSizePresets";
import {
  MAX_DOCUMENT_PIXELS,
  documentPixelCount,
  isValidDocumentSize,
} from "../core/document/document";

describe("canvas size presets", () => {
  it("offers only documents the model accepts", () => {
    for (const preset of CANVAS_SIZE_PRESETS) {
      expect(isValidDocumentSize(preset.width, preset.height)).toBe(true);
      expect(documentPixelCount(preset.width, preset.height)).toBeLessThanOrEqual(
        MAX_DOCUMENT_PIXELS,
      );
    }
  });

  it("keeps ids and dimensions unique", () => {
    expect(new Set(CANVAS_SIZE_PRESETS.map((preset) => preset.id)).size).toBe(
      CANVAS_SIZE_PRESETS.length,
    );
    expect(
      new Set(CANVAS_SIZE_PRESETS.map((preset) => `${preset.width}x${preset.height}`)).size,
    ).toBe(CANVAS_SIZE_PRESETS.length);
  });

  it("reaches beyond the old default and stops at the raster cap", () => {
    expect(CANVAS_SIZE_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(
      CANVAS_SIZE_PRESETS.some((preset) => preset.width * preset.height > 1600 * 1200),
    ).toBe(true);
    expect(findCanvasSizePreset(4096, 4096)?.id).toBe("square-max");
    expect(findCanvasSizePreset(4096, 4095)).toBeUndefined();
  });

  it("matches the rounded values the dialog creates", () => {
    const fullHd = findCanvasSizePreset(1920, 1080);
    expect(fullHd).toBeDefined();
    if (!fullHd) {
      return;
    }
    expect(isCanvasSizePresetSelected(fullHd, 1920.4, 1080.4)).toBe(true);
    expect(isCanvasSizePresetSelected(fullHd, 1920.6, 1080)).toBe(false);
    expect(isCanvasSizePresetSelected(fullHd, 1920, 1080.4)).toBe(true);
  });
});
