/**
 * Brush-control tests.
 *
 * The controls themselves are React and are verified by hand in the running
 * app; the rules they are built on are plain modules, and those are what these
 * tests pin down:
 *
 *  - the numeric rules of the number box (what a value is, what it may be);
 *  - the bounds the engine clamps a brush to, and the promise that no control
 *    can offer a value the engine would change;
 *  - the properties the engine does *not* implement, so no control is ever
 *    built for one of them;
 *  - the live preview, which must agree with the engine's own rasterization.
 */

import { describe, expect, it } from "vitest";
import {
  brushFieldBounds,
  UNIMPLEMENTED_BRUSH_PROPERTIES,
} from "../core/brushes/brushProperties";
import {
  DEFAULT_BRUSH,
  normalizeBrush,
  stepBrushSize,
} from "../core/brushes/defaults";
import {
  brushSizeStep,
  clampNumber,
  parseNumericInput,
  stepSize,
  stepValue,
} from "../core/brushes/numericInput";
import { toolOptionFields } from "../features/options/toolOptionSchema";
import {
  PREVIEW_CSS_HEIGHT,
  PREVIEW_CSS_WIDTH,
  buildPreviewStroke,
  previewFit,
  renderBrushPreview,
} from "../core/rendering/brushPreview";
import { strokeOpacity } from "../core/rendering/canvas2dStroke";
import type { EditorActions } from "../state/editorStore";
import { installRecordingDocument, type RecordingCanvas } from "./support/recordingCanvas";

describe("the number box rules", () => {
  it("reads a number, and refuses everything else", () => {
    expect(parseNumericInput("12")).toBe(12);
    expect(parseNumericInput(" 12.5 ")).toBe(12.5);
    expect(parseNumericInput("-3")).toBe(-3);
    expect(parseNumericInput("0")).toBe(0);
    // An empty field is "no value yet", not zero: `Number("")` is 0, which is
    // how clearing the box used to snap the brush to its minimum.
    expect(parseNumericInput("")).toBeNull();
    expect(parseNumericInput("   ")).toBeNull();
    expect(parseNumericInput("abc")).toBeNull();
    expect(parseNumericInput("1e999")).toBeNull();
    expect(parseNumericInput("Infinity")).toBeNull();
  });

  it("clamps a value into the field's range", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(11, 0, 10)).toBe(10);
    expect(clampNumber(Number.NaN, 0, 10)).toBe(0);
  });

  it("moves a value by a step and stops at the bounds", () => {
    expect(stepValue(10, 1, 0, 100)).toBe(11);
    expect(stepValue(10, -1, 0, 100)).toBe(9);
    expect(stepValue(100, 1, 0, 100)).toBe(100);
    expect(stepValue(0, -1, 0, 100)).toBe(0);
  });

  it("orders the three keyboard steps", () => {
    expect(stepSize(1, "fine")).toBeLessThan(stepSize(1, "normal"));
    expect(stepSize(1, "normal")).toBeLessThan(stepSize(1, "coarse"));
    expect(stepSize(1, "normal")).toBe(1);
  });
});

describe("the brush size under the keyboard", () => {
  it("steps by a pixel when it is small and by a tenth when it is large", () => {
    expect(brushSizeStep(6, 1)).toBe(7);
    expect(brushSizeStep(100, 1)).toBe(110);
    expect(brushSizeStep(6, -1)).toBe(5);
  });

  it("takes a tenth of the step for a fine adjustment", () => {
    expect(brushSizeStep(6, 1, "fine")).toBeCloseTo(6.1, 10);
    expect(brushSizeStep(100, 1, "fine")).toBeCloseTo(101, 10);
  });

  it("takes ten steps for a coarse adjustment", () => {
    expect(brushSizeStep(6, 1, "coarse")).toBe(16);
    expect(brushSizeStep(100, 1, "coarse")).toBe(200);
  });

  it("stops at the bounds, whatever the step", () => {
    expect(brushSizeStep(1, -1, "fine")).toBe(1);
    expect(brushSizeStep(512, 1, "coarse")).toBe(512);
  });

  it("agrees with the shortcut step", () => {
    expect(brushSizeStep(6, 1)).toBe(stepBrushSize(6, 1));
  });
});

describe("the properties the engine honours", () => {
  it("reads the bounds out of the engine's own clamp", () => {
    expect(brushFieldBounds("size")).toEqual({ min: 1, max: 512 });
    expect(brushFieldBounds("opacity")).toEqual({ min: 0, max: 1 });
    expect(brushFieldBounds("spacing")).toEqual({ min: 0.02, max: 2 });
    expect(brushFieldBounds("stampSpacing")).toEqual({ min: 0.02, max: 1 });
  });

  it("offers the properties the mission names, and only wired ones", () => {
    const names = UNIMPLEMENTED_BRUSH_PROPERTIES.map((property) => property.name);
    // Flow is the one the brief names, and the engine has no per-dab alpha.
    expect(names).toContain("flow");
    for (const property of UNIMPLEMENTED_BRUSH_PROPERTIES) {
      expect(property.reason.length).toBeGreaterThan(20);
      expect(property.owner.length).toBeGreaterThan(0);
    }
  });
});

describe("the options bar's brush controls", () => {
  /** The brush sliders, with the value each one writes captured. */
  function brushSliders() {
    const snapshot = {
      brush: DEFAULT_BRUSH,
      toolId: "brush",
    } as never;
    return toolOptionFields("brush", "brush", snapshot).filter(
      (option) => option.kind === "slider",
    );
  }

  it("offers a value the engine keeps as it is", () => {
    for (const option of brushSliders()) {
      if (option.kind !== "slider") {
        continue;
      }
      const written: Array<Partial<typeof DEFAULT_BRUSH>> = [];
      const actions = {
        setBrush: (patch: Partial<typeof DEFAULT_BRUSH>) => written.push(patch),
      } as unknown as EditorActions;
      for (const value of [option.min, option.max, (option.min + option.max) / 2]) {
        option.write(actions, value);
        const patch = written[written.length - 1];
        // The engine clamps a brush; a control must never offer a value the
        // engine would silently change.
        expect(normalizeBrush({ ...DEFAULT_BRUSH, ...patch })).toEqual({
          ...DEFAULT_BRUSH,
          ...patch,
        });
      }
    }
  });

  it("gives the size a keyboard step of its own", () => {
    const size = brushSliders().find((option) => option.id === "brushSize");
    expect(size?.kind).toBe("slider");
    if (size?.kind !== "slider") {
      return;
    }
    expect(size.keyboardStep?.(6, 1, "fine")).toBeCloseTo(6.1, 10);
    expect(size.keyboardStep?.(100, 1, "normal")).toBe(110);
  });

  it("speaks the same unit in the number box and in the readout", () => {
    const snapshot = { brush: DEFAULT_BRUSH, toolId: "brush" } as never;
    for (const option of brushSliders()) {
      if (option.kind !== "slider") {
        continue;
      }
      const value = option.read(snapshot);
      const readout = option.format ? option.format(value) : String(value);
      // The box shows the value; the readout shows the same number with its
      // unit. A box that asked for `0.5` beside a readout that said `50%`
      // would be a box the user has to guess at.
      const shown = Number(readout.replace(/[^0-9.-]/g, ""));
      expect(shown).toBeCloseTo(value, 6);
    }
  });
});

describe("the live brush preview", () => {
  /**
   * Draws the preview on a recorded canvas.
   *
   * The recorded canvases are the ones the preview made for itself: the
   * coverage it draws into, and the softened copy it feathers and grains.
   */
  function drawPreview(brush: typeof DEFAULT_BRUSH) {
    const recording = installRecordingDocument();
    try {
      const canvas = document.createElement("canvas") as unknown as RecordingCanvas;
      canvas.width = PREVIEW_CSS_WIDTH;
      canvas.height = PREVIEW_CSS_HEIGHT;
      const ctx = canvas.getContext();
      if (!ctx) {
        throw new Error("the recorded canvas has no context");
      }
      const stroke = buildPreviewStroke(brush);
      renderBrushPreview(ctx, stroke, { pixelRatio: 1, background: "#ffffff" });
      return { canvas, scratch: recording.allocated.slice(1), stroke };
    } finally {
      recording.restore();
    }
  }

  it("draws the same stroke every time", () => {
    const first = buildPreviewStroke(DEFAULT_BRUSH);
    const second = buildPreviewStroke(DEFAULT_BRUSH);
    expect(first.xs).toEqual(second.xs);
    expect(first.ys).toEqual(second.ys);
    expect(first.pressures).toEqual(second.pressures);
    // The stroke carries the brush, so it is rasterized with it.
    expect(first.brush).toEqual(DEFAULT_BRUSH);
  });

  it("ramps the pressure, so the pressure controls are visible", () => {
    const stroke = buildPreviewStroke(DEFAULT_BRUSH);
    expect(stroke.pressures[0]).toBeLessThan(stroke.pressures[stroke.pressures.length - 1]);
    expect(stroke.pressures[stroke.pressures.length - 1]).toBe(1);
  });

  it("zooms so the brush fits the swatch", () => {
    const small = previewFit({ ...DEFAULT_BRUSH, size: 4 });
    const large = previewFit({ ...DEFAULT_BRUSH, size: 200 });
    expect(small).toBeGreaterThan(large);
    // The brush's diameter fills the swatch's height, whatever it is.
    const room = PREVIEW_CSS_HEIGHT - 6;
    expect(4 * small).toBeCloseTo(room / 1.15, 6);
  });

  it("composites the stroke at the opacity the engine would use", () => {
    const brush = { ...DEFAULT_BRUSH, opacity: 0.4 };
    const { canvas, stroke } = drawPreview(brush);
    const blits = canvas.named("drawImage");
    expect(blits.length).toBeGreaterThan(0);
    // The last blit is the stroke onto the paper, at the stroke's opacity.
    expect(blits[blits.length - 1].alpha).toBeCloseTo(strokeOpacity(brush, stroke.pressures), 10);
  });

  it("softens a soft edge and grains a textured one, as the renderer does", () => {
    const { scratch } = drawPreview({ ...DEFAULT_BRUSH, hardness: 0.2, texture: 0.8 });
    // The soft edge is a blur of the coverage.
    expect(scratch.some((canvas) => canvas.calls.some((call) => call.filter.startsWith("blur(")))).toBe(
      true,
    );
    // The grain multiplies the coverage's alpha.
    expect(scratch.some((canvas) => canvas.named("createPattern").length === 1)).toBe(true);
  });

  it("draws the stamp's dabs rather than a continuous line", () => {
    const { scratch } = drawPreview({ ...DEFAULT_BRUSH, stamp: true });
    expect(scratch.some((canvas) => canvas.named("putImageData").length === 1)).toBe(true);
    expect(scratch.every((canvas) => canvas.named("stroke").length === 0)).toBe(true);
  });
});
