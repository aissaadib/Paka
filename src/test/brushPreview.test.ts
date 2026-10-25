/**
 * The brush cursor and the brush preview.
 *
 * Two promises are pinned down here:
 *
 *  - **The cursor shows the brush's real footprint.** The ring's radius is
 *    the rasterizer's own diameter at full pressure - not the size slider
 *    restated - so the pressure curve, the size floor and the soft edge all
 *    move it, because they move the ink. The cursor also knows when it must
 *    not draw: a brush larger than the window cannot be shown by a ring, and
 *    a gesture in flight owns the pointer.
 *
 *  - **The preview agrees with the real rasterizer.** Not by assertion, but
 *    by comparison: the preview's coverage is compared, call for call and
 *    byte for byte, against the coverage the engine's own rasterizer and
 *    stamp engine produce for the same samples. A preview that quietly
 *    drifted from the renderer would fail here.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MIN_CURSOR_DIAMETER_CSS_PX,
  brushCursorFootprint,
  brushCursorGeometry,
  brushCursorIsOversized,
  readBrushTip,
  type BrushCursorInput,
} from "../core/brushes/brushCursor";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  PREVIEW_CSS_HEIGHT,
  PREVIEW_CSS_WIDTH,
  buildPreviewStroke,
  previewCoveragePlan,
  previewFit,
  previewGrainTile,
  renderBrushPreview,
} from "../core/rendering/brushPreview";
import {
  TEXTURE_TILE_SIZE,
  rasterizeStroke,
  strokeDiameter,
  strokeFeatherRadius,
  strokeOpacity,
  textureCoverage,
} from "../core/rendering/canvas2dStroke";
import {
  StampCoverage,
  stampDabs,
  stampTextureLaneWidth,
  unionStampRect,
} from "../core/rendering/stampCoverage";
import type { BrushSettings } from "../types/brush";
import { hexToRgb } from "../utils/color";
import {
  installRecordingDocument,
  RecordingCanvas,
  type DrawCall,
  type RecordingDocument,
} from "./support/recordingCanvas";

/** A brush with a pressure curve that flattens the top of the response. */
const CURVED_BRUSH: BrushSettings = {
  ...DEFAULT_BRUSH,
  size: 20,
  pressureSize: 1,
  minSizeRatio: 0.2,
  pressureCurve: [
    { x: 0, y: 0 },
    { x: 1, y: 0.4 },
  ],
};

describe("the brush cursor's footprint", () => {
  it("is the rasterizer's own diameter, not the size slider restated", () => {
    const footprint = brushCursorFootprint(CURVED_BRUSH);
    expect(footprint.radiusDocPx).toBeCloseTo(strokeDiameter(CURVED_BRUSH, 1) / 2, 10);
    // The curve flattens the top of the response, so the brush's real
    // footprint is smaller than its nominal size.
    expect(footprint.radiusDocPx).not.toBeCloseTo(CURVED_BRUSH.size / 2, 5);
  });

  it("reports the soft edge's blur next to the core radius", () => {
    const soft = { ...DEFAULT_BRUSH, hardness: 0 };
    expect(brushCursorFootprint(soft).featherDocPx).toBeCloseTo(
      strokeFeatherRadius(soft),
      10,
    );
    // A hard brush has no blur at all.
    expect(brushCursorFootprint(DEFAULT_BRUSH).featherDocPx).toBe(0);
  });

  it("is round for a brush that carries no tip", () => {
    const footprint = brushCursorFootprint(DEFAULT_BRUSH);
    expect(footprint.shape).toBe("round");
    expect(footprint.tipName).toBeUndefined();
  });

  it("takes the shape of a tip, read off the brush", () => {
    const brush = {
      ...DEFAULT_BRUSH,
      tip: { name: "chisel", outline: [{ x: 1, y: 0 }, { x: -1, y: 0 }] },
    } as unknown as BrushSettings;
    const footprint = brushCursorFootprint(brush);
    expect(footprint.shape).toBe("tip");
    expect(footprint.tipName).toBe("chisel");
    expect(footprint.outline).toHaveLength(2);
    // The radius is still the brush's own: a tip changes the shape, not the
    // size.
    expect(footprint.radiusDocPx).toBeCloseTo(strokeDiameter(brush, 1) / 2, 10);
  });

  it("falls back to a round footprint for a tip it cannot read", () => {
    for (const tip of [undefined, null, {}, { name: "" }, { name: 7 }, "chisel"]) {
      const brush = { ...DEFAULT_BRUSH, tip } as unknown as BrushSettings;
      expect(readBrushTip(brush)).toBeNull();
      expect(brushCursorFootprint(brush).shape).toBe("round");
    }
  });

  it("keeps a named tip whose outline it cannot read, and falls back to a disc", () => {
    const brush = {
      ...DEFAULT_BRUSH,
      tip: { name: "chisel", outline: "not an outline" },
    } as unknown as BrushSettings;
    const footprint = brushCursorFootprint(brush);
    expect(footprint.shape).toBe("tip");
    expect(footprint.tipName).toBe("chisel");
    expect(footprint.outline).toBeUndefined();
  });
});

describe("the brush cursor on screen", () => {
  const base: BrushCursorInput = {
    brush: { ...DEFAULT_BRUSH, size: 10 },
    zoom: 2,
    devicePixelRatio: 2,
    viewportWidth: 800,
    viewportHeight: 600,
    gesture: false,
    inside: true,
  };

  it("needs only the brush and the zoom to answer", () => {
    const geometry = brushCursorGeometry({ brush: { ...DEFAULT_BRUSH, size: 10 }, zoom: 2 });
    expect(geometry.marker).toBe("ring");
    expect(geometry.cssDiameter).toBeCloseTo(20, 10);
    expect(geometry.hairlineCss).toBe(1);
    // Without a window to measure against, nothing is known to be too big.
    expect(geometry.oversized).toBe(false);
  });

  it("shows the footprint at the real zoom", () => {
    const geometry = brushCursorGeometry(base);
    expect(geometry.marker).toBe("ring");
    expect(geometry.cssDiameter).toBeCloseTo(20, 10);
    expect(geometry.cssRadius).toBeCloseTo(10, 10);
    expect(geometry.diameterDocPx).toBeCloseTo(10, 10);
    expect(geometry.clamped).toBe(false);
  });

  it("clamps a brush too small to see, and says that it did", () => {
    const geometry = brushCursorGeometry({ ...base, brush: { ...DEFAULT_BRUSH, size: 1 }, zoom: 0.1 });
    expect(geometry.cssDiameter).toBe(MIN_CURSOR_DIAMETER_CSS_PX);
    expect(geometry.clamped).toBe(true);
  });

  it("becomes a crosshair when the brush is larger than the window", () => {
    const geometry = brushCursorGeometry({ ...base, brush: { ...DEFAULT_BRUSH, size: 400 } });
    expect(geometry.oversized).toBe(true);
    expect(geometry.marker).toBe("crosshair");
    expect(geometry.visible).toBe(true);
  });

  it("keeps the ring when the brush still fits the window", () => {
    expect(brushCursorIsOversized(600, 800, 600)).toBe(false);
    expect(brushCursorIsOversized(601, 800, 600)).toBe(true);
    // Without a window to measure against, nothing is known to be too big.
    expect(brushCursorIsOversized(5000, 0, 0)).toBe(false);
  });

  it("is hidden while a gesture is in flight", () => {
    const geometry = brushCursorGeometry({ ...base, gesture: true });
    expect(geometry.marker).toBe("hidden");
    expect(geometry.visible).toBe(false);
  });

  it("is hidden while the pointer is outside the canvas", () => {
    expect(brushCursorGeometry({ ...base, inside: false }).marker).toBe("hidden");
  });

  it("draws its outline one device pixel wide", () => {
    expect(brushCursorGeometry({ ...base, devicePixelRatio: 1 }).hairlineCss).toBe(1);
    expect(brushCursorGeometry({ ...base, devicePixelRatio: 2 }).hairlineCss).toBe(0.5);
    // Never thinner than half a CSS pixel: below that it stops being a line.
    expect(brushCursorGeometry({ ...base, devicePixelRatio: 4 }).hairlineCss).toBe(0.5);
  });
});

describe("the brush preview's stroke", () => {
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

  it("zooms so the brush fills the swatch", () => {
    const small = previewFit({ ...DEFAULT_BRUSH, size: 4 });
    const large = previewFit({ ...DEFAULT_BRUSH, size: 200 });
    expect(small).toBeGreaterThan(large);
    const room = PREVIEW_CSS_HEIGHT - 6;
    expect(4 * small).toBeCloseTo(room / 1.15, 6);
  });
});

describe("the brush preview against the real rasterizer", () => {
  let recording: RecordingDocument;

  beforeEach(() => {
    recording = installRecordingDocument();
  });

  afterEach(() => {
    recording.restore();
  });

  /** A target canvas of the swatch's size, and the context to paint into. */
  function target(): { canvas: RecordingCanvas; ctx: CanvasRenderingContext2D } {
    const canvas = new RecordingCanvas();
    canvas.width = PREVIEW_CSS_WIDTH;
    canvas.height = PREVIEW_CSS_HEIGHT;
    return { canvas, ctx: canvas.getContext() };
  }

  /**
   * The calls a canvas made, from the transform that set the scale onwards.
   *
   * The scale is part of the comparison: it is what maps the stroke's
   * document coordinates onto the swatch's pixels, so a preview that zoomed
   * the wrong way would paint a different picture.
   */
  function callsFromTransform(canvas: RecordingCanvas): DrawCall[] {
    const save = canvas.calls.findIndex((call) => call.name === "save");
    if (save < 0) {
      return [];
    }
    let start = save;
    for (let index = save - 1; index >= 0; index -= 1) {
      if (canvas.calls[index].name === "setTransform") {
        start = index;
        break;
      }
      if (canvas.calls[index].name === "clearRect") {
        break;
      }
    }
    return canvas.calls.slice(start);
  }

  /** A comparable signature of one draw call. */
  function signature(call: DrawCall): string {
    return [
      call.name,
      JSON.stringify(call.args),
      call.alpha,
      call.composite,
      call.fillStyle,
      call.strokeStyle,
      call.lineWidth,
      call.filter,
    ].join("|");
  }

  it("paints the segment path exactly as the rasterizer paints it", () => {
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      size: 12,
      pressureSize: 0.8,
      minSizeRatio: 0.1,
      color: "#224466",
    };
    const stroke = buildPreviewStroke(brush);
    const { ctx } = target();
    renderBrushPreview(ctx, stroke, { pixelRatio: 1, background: "#ffffff" });

    // The preview's coverage scratch is the first canvas it allocated.
    const coverage = recording.allocated[0];
    // The reference: the engine's own rasterizer, given the same stroke and
    // the same scale, exactly as the renderer hands them over.
    const scale = previewFit(brush);
    const reference = new RecordingCanvas();
    reference.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    rasterizeStroke(reference.ctx, stroke, 0);

    const painted = callsFromTransform(coverage).map(signature);
    const expected = callsFromTransform(reference).map(signature);
    expect(painted.length).toBeGreaterThan(0);
    expect(expected.length).toBeGreaterThan(0);
    // The same calls, in the same order, with the same transform, the same
    // geometry and the same widths: the preview's coverage *is* the
    // rasterizer's coverage.
    expect(painted).toEqual(expected);
    // The widths come from the engine's own diameter rule.
    const widths = coverage.named("stroke").map((call) => call.lineWidth);
    expect(widths[0]).toBeCloseTo(
      strokeDiameter(brush, (stroke.pressures[0] + stroke.pressures[1]) / 2),
      10,
    );
  });

  it("paints the stamp path exactly as the stamp engine paints it", () => {
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      size: 8,
      stamp: true,
      stampSpacing: 0.25,
      stampHardness: 0.6,
    };
    const stroke = buildPreviewStroke(brush);
    const { ctx } = target();
    renderBrushPreview(ctx, stroke, { pixelRatio: 1, background: "#ffffff" });

    const scale = previewFit(brush);
    // The dabs are the stamp engine's own plan.
    const plan = previewCoveragePlan(stroke, scale);
    expect(plan.kind).toBe("dabs");
    if (plan.kind !== "dabs") {
      return;
    }
    expect(plan.dabs).toEqual(stampDabs(stroke, brush));
    expect(plan.laneWidth).toBe(stampTextureLaneWidth(brush, scale));

    // The coverage the preview uploaded, byte for byte.
    const coverage = recording.allocated[0];
    const uploads = coverage.named("putImageData");
    expect(uploads).toHaveLength(1);
    // A stamped stroke is drawn as dabs, not as segments.
    expect(coverage.named("stroke")).toHaveLength(0);

    const [image, left, top] = uploads[0].args as [ImageData, number, number];
    // The expected coverage: the stamp engine's own map, built the way the
    // renderer builds it.
    const expected = new StampCoverage();
    let dirty = null;
    for (const dab of stampDabs(stroke, brush)) {
      const rect = expected.paintDab(
        dab.x * scale,
        dab.y * scale,
        dab.radius * scale,
        brush.stampHardness,
        null,
      );
      if (rect) {
        dirty = unionStampRect(dirty, rect);
      }
    }
    expect(dirty).not.toBeNull();
    if (!dirty) {
      return;
    }
    const expectedImage = {
      data: new Uint8ClampedArray(dirty.width * dirty.height * 4),
      width: dirty.width,
      height: dirty.height,
    };
    const rgb = hexToRgb(brush.color) ?? { r: 0, g: 0, b: 0 };
    expected.writeRect(expectedImage.data, dirty.width, dirty, rgb);

    expect(left).toBe(dirty.left);
    expect(top).toBe(dirty.top);
    expect(image.width).toBe(dirty.width);
    expect(image.height).toBe(dirty.height);
    // The same pixels, byte for byte.
    expect(Array.from(image.data)).toEqual(Array.from(expectedImage.data));
    // And the coverage is not empty: the comparison is a real one.
    expect(expectedImage.data.some((value) => value > 0)).toBe(true);
  });

  it("composites the stroke at the opacity the engine would use", () => {
    const brush = { ...DEFAULT_BRUSH, opacity: 0.4 };
    const stroke = buildPreviewStroke(brush);
    const { canvas, ctx } = target();
    renderBrushPreview(ctx, stroke, { pixelRatio: 1, background: "#ffffff" });

    const blits = canvas.named("drawImage");
    expect(blits.length).toBeGreaterThan(0);
    // The last blit is the stroke onto the paper, at the stroke's opacity.
    expect(blits[blits.length - 1].alpha).toBeCloseTo(
      strokeOpacity(brush, stroke.pressures),
      10,
    );
  });

  it("softens a soft edge with the engine's own blur radius", () => {
    const brush = { ...DEFAULT_BRUSH, hardness: 0.2, texture: 0 };
    const stroke = buildPreviewStroke(brush);
    const { ctx } = target();
    renderBrushPreview(ctx, stroke, { pixelRatio: 1, background: "#ffffff" });

    const scale = previewFit(brush);
    // The softened scratch is the second canvas the preview allocated.
    const softened = recording.allocated[1];
    const blits = softened.named("drawImage");
    expect(blits.length).toBe(1);
    expect(blits[0].filter).toBe(`blur(${strokeFeatherRadius(brush) * scale}px)`);
  });

  it("grains a textured stroke with the engine's own grain tile", () => {
    const brush = { ...DEFAULT_BRUSH, hardness: 1, texture: 0.8 };
    const stroke = buildPreviewStroke(brush);
    const { ctx } = target();
    renderBrushPreview(ctx, stroke, { pixelRatio: 1, background: "#ffffff" });

    // The grain multiplies the coverage's alpha. The pattern is created on
    // the softened scratch, which is the second canvas the preview allocated.
    expect(recording.allocated[1].named("createPattern")).toHaveLength(1);

    // The tile is the renderer's own: the same coverage rule, pixel for pixel.
    const tile = previewGrainTile(0.8) as unknown as RecordingCanvas;
    const upload = tile.named("putImageData")[0];
    const image = upload.args[0] as ImageData;
    const expected = new Uint8ClampedArray(TEXTURE_TILE_SIZE * TEXTURE_TILE_SIZE * 4);
    for (let index = 0; index < TEXTURE_TILE_SIZE * TEXTURE_TILE_SIZE; index += 1) {
      const coverage = Math.round(textureCoverage(index, 0.8) * 255);
      const offset = index * 4;
      expected[offset] = 255;
      expected[offset + 1] = 255;
      expected[offset + 2] = 255;
      expected[offset + 3] = coverage;
    }
    expect(Array.from(image.data)).toEqual(Array.from(expected));
  });
});
