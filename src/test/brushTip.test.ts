/**
 * Brush tip tests.
 *
 * A tip is a **mask**, not a colour, and these tests hold it to that:
 *
 * - the round tip - and no tip at all - leave the stamp engine's coverage
 *   byte for byte as it was, so every existing drawing is untouched;
 * - a tip multiplies a dab's coverage *before* the dabs are unioned, so the
 *   union is still a maximum and a stroke cannot darken where it crosses
 *   itself, and a tip can only ever take ink away;
 * - the mask is a pure function of the dab's own frame, so live drawing, a
 *   rebuild, undo/redo, a reopen and an export agree;
 * - the mask is zero outside the dab's radius, so the coverage map stays
 *   footprint-bounded and the raster budget does not move.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH } from "../core/brushes/defaults";
import {
  BRUSH_TIP_SHAPES,
  brushTipMask,
  brushTipSilhouette,
  DEFAULT_BRUSH_TIP,
  EVERY_BRUSH_TIP_SHAPE_IS_LISTED,
  isBrushTipShape,
  normalizeBrushTip,
  type BrushTipFrame,
} from "../core/rendering/brushTip";
import { StampCoverage, stampDabs, type StampRect } from "../core/rendering/stampCoverage";
import type { BrushTipShape } from "../types/brush";

/** The dab's own frame: the tip, the direction it points and its radius. */
function frameFor(shape: BrushTipShape, angle: number, radius: number): BrushTipFrame {
  return {
    shape,
    directionX: Math.cos(angle),
    directionY: Math.sin(angle),
    radius,
  };
}

/** Reads the coverage of one device pixel out of a coverage map. */
function coverageAt(map: StampCoverage, x: number, y: number): number {
  const data = new Uint8ClampedArray(4);
  map.writeRect(data, 1, { left: x, top: y, width: 1, height: 1 }, { r: 0, g: 0, b: 0 });
  return data[3];
}

/** The whole coverage map as bytes, so two maps can be compared exactly. */
function coverageBytes(map: StampCoverage, rect: StampRect): Uint8ClampedArray {
  const data = new Uint8ClampedArray(rect.width * rect.height);
  const rgba = new Uint8ClampedArray(rect.width * rect.height * 4);
  map.writeRect(rgba, rect.width, rect, { r: 0, g: 0, b: 0 });
  for (let index = 0; index < data.length; index += 1) {
    data[index] = rgba[index * 4 + 3];
  }
  return data;
}

describe("the closed set of tip shapes", () => {
  it("names every shape the brush type allows", () => {
    // The compile-time guard fails the build when a shape is added to the
    // type and not to the list; the assertion keeps the runtime honest too.
    expect(EVERY_BRUSH_TIP_SHAPE_IS_LISTED).toBe(true);
    expect(BRUSH_TIP_SHAPES.length).toBeGreaterThan(1);
    for (const shape of BRUSH_TIP_SHAPES) {
      expect(isBrushTipShape(shape)).toBe(true);
    }
  });

  it("rejects anything that is not one of the shapes", () => {
    expect(isBrushTipShape("nib")).toBe(false);
    expect(isBrushTipShape("")).toBe(false);
    expect(isBrushTipShape(42)).toBe(false);
    expect(isBrushTipShape(null)).toBe(false);
    expect(isBrushTipShape(undefined)).toBe(false);
    expect(isBrushTipShape({ shape: "round" })).toBe(false);
  });

  it("repairs an unusable tip to the round tip", () => {
    expect(DEFAULT_BRUSH_TIP).toBe("round");
    expect(normalizeBrushTip("chisel")).toBe("chisel");
    expect(normalizeBrushTip("nib")).toBe("round");
    expect(normalizeBrushTip(undefined)).toBe("round");
    expect(normalizeBrushTip(7)).toBe("round");
  });

  it("gives the default brush the round tip", () => {
    expect(DEFAULT_BRUSH.tip).toBe("round");
  });
});

describe("the tip's mask", () => {
  it("leaves the round dab completely alone", () => {
    const frame = frameFor("round", 0, 10);
    // The round tip is the disc itself: solid in the middle, and nothing
    // outside the dab's radius.
    for (const [along, across] of [
      [0, 0],
      [3, 4],
      [9, 0],
      [-7, 2],
    ]) {
      expect(brushTipMask(frame, along, across)).toBe(1);
    }
    expect(brushTipMask(frame, 10.5, 0)).toBe(0);
  });

  it("is a fraction everywhere, and never more than one", () => {
    for (const shape of BRUSH_TIP_SHAPES) {
      const frame = frameFor(shape, 0.7, 12);
      for (let along = -14; along <= 14; along += 1) {
        for (let across = -14; across <= 14; across += 1) {
          const mask = brushTipMask(frame, along, across);
          expect(mask, `${shape} at ${along}/${across}`).toBeGreaterThanOrEqual(0);
          expect(mask, `${shape} at ${along}/${across}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("stops at the dab's radius, so a tip never widens a stroke", () => {
    // Every shape but the round one is bounded by the disc the dab already
    // reserved: the mask is zero a pixel past the radius.
    for (const shape of BRUSH_TIP_SHAPES) {
      if (shape === "round") {
        continue;
      }
      const radius = 10;
      const frame = frameFor(shape, 0.3, radius);
      for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
        const along = Math.cos(angle) * (radius + 1);
        const across = Math.sin(angle) * (radius + 1);
        expect(brushTipMask(frame, along, across), `${shape} at ${angle}`).toBe(0);
      }
    }
  });

  it("keeps the ink inside the dab's radius, whatever the tip is", () => {
    // The mask's edge is a fraction at the very rim of the disc, so the
    // coverage there is a fraction of a byte - and nothing at all outside it.
    for (const shape of BRUSH_TIP_SHAPES) {
      const map = new StampCoverage();
      map.paintDab(20.5, 20.5, 10, 1, null, frameFor(shape, 0.9, 10));
      for (let x = 12; x <= 29; x += 1) {
        for (let y = 12; y <= 29; y += 1) {
          const distance = Math.hypot(x + 0.5 - 20.5, y + 0.5 - 20.5);
          if (distance > 10.5) {
            expect(coverageAt(map, x, y), `${shape} at ${x}/${y}`).toBe(0);
          }
        }
      }
    }
  });

  it("is a pure function of the dab's frame", () => {
    for (const shape of BRUSH_TIP_SHAPES) {
      const frame = frameFor(shape, 1.1, 9);
      const first = brushTipMask(frame, 3.5, -2.25);
      const second = brushTipMask(frameFor(shape, 1.1, 9), 3.5, -2.25);
      expect(second).toBe(first);
    }
  });

  it("gives a felt tip a soft edge instead of a crisp rim", () => {
    const felt = frameFor("felt", 0, 10);
    // The middle of the pad is solid...
    expect(brushTipMask(felt, 0, 0)).toBe(1);
    expect(brushTipMask(felt, 2, 0)).toBe(1);
    // ... and it thins out towards the edge, where a round dab is still solid.
    expect(brushTipMask(felt, 9, 0)).toBeLessThan(1);
    expect(brushTipMask(felt, 10, 0)).toBe(0);
  });

  it("holds a chisel nib at an angle, so the dab is not a disc", () => {
    const chisel = frameFor("chisel", 0, 10);
    // The nib crosses the dab's centre at 45 degrees: the two diagonals of
    // the dab are not the same.
    const along = brushTipMask(chisel, 4, 4);
    const across = brushTipMask(chisel, -4, 4);
    expect(along).not.toBe(across);
    // And the nib is thin: the points beside it are empty.
    expect(brushTipMask(chisel, 7, -7)).toBe(0);
  });

  it("gives a blot a ragged edge that is the same in every dab", () => {
    const blot = frameFor("blot", 0, 10);
    // The edge is not a circle: two directions at the same distance differ.
    const first = brushTipMask(blot, 7, 0);
    const second = brushTipMask(blot, 0, 7);
    expect(first).not.toBe(second);
    // The same dab in the same place always gets the same edge.
    expect(brushTipMask(frameFor("blot", 0, 10), 7, 0)).toBe(first);
  });

  it("splits a bristle bundle into lanes with gaps between them", () => {
    const bristle = frameFor("bristle", 0, 10);
    let solid = 0;
    let empty = 0;
    for (let across = -9.5; across <= 9.5; across += 0.5) {
      const mask = brushTipMask(bristle, 0, across);
      if (mask > 0.9) {
        solid += 1;
      }
      if (mask === 0) {
        empty += 1;
      }
    }
    expect(solid).toBeGreaterThan(0);
    expect(empty).toBeGreaterThan(0);
  });
});

describe("the tip in the stamp engine", () => {
  it("leaves the coverage byte for byte as it was without a tip", () => {
    const plain = new StampCoverage();
    const rect = plain.paintDab(20, 20, 10, 1);
    expect(rect).not.toBeNull();
    if (!rect) {
      return;
    }
    const before = coverageBytes(plain, rect);

    // The round tip is the plain disc, and so is no tip at all.
    const round = new StampCoverage();
    round.paintDab(20, 20, 10, 1, null, frameFor("round", 0, 10));
    expect(Array.from(coverageBytes(round, rect))).toEqual(Array.from(before));

    // The same for a soft dab and for the per-dab texture.
    const softPlain = new StampCoverage();
    const softRect = softPlain.paintDab(20, 20, 10, 0.4);
    if (softRect) {
      const softBefore = coverageBytes(softPlain, softRect);
      const softRound = new StampCoverage();
      softRound.paintDab(20, 20, 10, 0.4, null, frameFor("round", 0, 10));
      expect(Array.from(coverageBytes(softRound, softRect))).toEqual(
        Array.from(softBefore),
      );
    }
  });

  it("only ever takes ink away", () => {
    for (const shape of BRUSH_TIP_SHAPES) {
      if (shape === "round") {
        continue;
      }
      const plain = new StampCoverage();
      const rect = plain.paintDab(20, 20, 10, 1);
      if (!rect) {
        return;
      }
      const before = coverageBytes(plain, rect);

      const tipped = new StampCoverage();
      tipped.paintDab(20, 20, 10, 1, null, frameFor(shape, 0.4, 10));
      const after = coverageBytes(tipped, rect);

      let removed = 0;
      for (let index = 0; index < before.length; index += 1) {
        expect(after[index], `${shape} at ${index}`).toBeLessThanOrEqual(before[index]);
        if (after[index] < before[index]) {
          removed += 1;
        }
      }
      // And it really does change the picture: a tip is not a no-op.
      expect(removed, shape).toBeGreaterThan(0);
    }
  });

  it("keeps the union a maximum, so a stroke cannot darken where it crosses itself", () => {
    for (const shape of BRUSH_TIP_SHAPES) {
      const once = new StampCoverage();
      once.paintDab(20, 20, 10, 0.5, null, frameFor(shape, 0, 10));
      const twice = new StampCoverage();
      twice.paintDab(20, 20, 10, 0.5, null, frameFor(shape, 0, 10));
      twice.paintDab(20, 20, 10, 0.5, null, frameFor(shape, 0, 10));

      const rect = once.paintDab(20, 20, 10, 0.5, null, frameFor(shape, 0, 10));
      if (!rect) {
        return;
      }
      expect(Array.from(coverageBytes(twice, rect)), shape).toEqual(
        Array.from(coverageBytes(once, rect)),
      );
    }
  });

  it("does not depend on the order the dabs are painted in", () => {
    const forward = new StampCoverage();
    forward.paintDab(20, 20, 10, 0.6, null, frameFor("chisel", 0.2, 10));
    forward.paintDab(26, 24, 10, 0.6, null, frameFor("chisel", 0.2, 10));

    const backward = new StampCoverage();
    backward.paintDab(26, 24, 10, 0.6, null, frameFor("chisel", 0.2, 10));
    backward.paintDab(20, 20, 10, 0.6, null, frameFor("chisel", 0.2, 10));

    const rect: StampRect = { left: 0, top: 0, width: 64, height: 64 };
    expect(Array.from(coverageBytes(backward, rect))).toEqual(
      Array.from(coverageBytes(forward, rect)),
    );
  });

  it("keeps the dab's footprint where it was, so the raster budget does not move", () => {
    const plain = new StampCoverage();
    const plainRect = plain.paintDab(20, 20, 10, 1);
    for (const shape of BRUSH_TIP_SHAPES) {
      const tipped = new StampCoverage();
      const rect = tipped.paintDab(20, 20, 10, 1, null, frameFor(shape, 0.5, 10));
      expect(rect, shape).toEqual(plainRect);
    }
  });

  it("turns with the dab's direction, because the tip lives in the dab's frame", () => {
    // The dab's centre is a half-integer, so the pixels around it are whole
    // offsets from it.
    const along = new StampCoverage();
    along.paintDab(30.5, 30.5, 12, 1, null, frameFor("chisel", 0, 12));
    const turned = new StampCoverage();
    turned.paintDab(30.5, 30.5, 12, 1, null, frameFor("chisel", Math.PI / 2, 12));

    const rect: StampRect = { left: 0, top: 0, width: 64, height: 64 };
    const alongBytes = coverageBytes(along, rect);
    const turnedBytes = coverageBytes(turned, rect);

    // The same dab, pointed another way, is a different picture.
    expect(Array.from(turnedBytes)).not.toEqual(Array.from(alongBytes));
    // The nib runs along the dab's frame, so the ink is on the nib and off
    // the rest of the disc...
    expect(coverageAt(along, 34, 34)).toBe(255);
    expect(coverageAt(along, 34, 26)).toBe(0);
    // ... and turning the dab turns the nib with it.
    expect(coverageAt(turned, 26, 34)).toBe(255);
    expect(coverageAt(turned, 34, 34)).toBe(0);
  });

  it("is deterministic: the same dabs paint the same coverage, every time", () => {
    const path = {
      xs: [4, 12, 20, 28],
      ys: [4, 12, 8, 20],
      pressures: [1, 1, 1, 1],
    };
    const brush = { ...DEFAULT_BRUSH, stamp: true, stampSpacing: 0.25 };
    const dabs = stampDabs(path, brush);
    expect(dabs.length).toBeGreaterThan(1);

    const first = new StampCoverage();
    const second = new StampCoverage();
    for (const dab of dabs) {
      const frame = frameFor("blot", dab.angle, dab.radius);
      first.paintDab(dab.x, dab.y, dab.radius, 1, null, frame);
      second.paintDab(dab.x, dab.y, dab.radius, 1, null, frame);
    }

    const rect: StampRect = { left: 0, top: 0, width: 64, height: 64 };
    expect(Array.from(coverageBytes(second, rect))).toEqual(
      Array.from(coverageBytes(first, rect)),
    );
  });
});

describe("the tip's preview", () => {
  it("draws the round tip as a filled disc", () => {
    const silhouette = brushTipSilhouette("round", 32);
    expect(silhouette.length).toBe(32 * 32);
    const middle = 16 * 32 + 16;
    expect(silhouette[middle]).toBe(255);
    expect(silhouette[0]).toBe(0);
  });

  it("draws every shape as a coverage, not as a picture of a brush", () => {
    for (const shape of BRUSH_TIP_SHAPES) {
      const silhouette = brushTipSilhouette(shape, 24);
      expect(silhouette.length, shape).toBe(24 * 24);
      let solid = 0;
      for (const value of silhouette) {
        expect(value, shape).toBeGreaterThanOrEqual(0);
        expect(value, shape).toBeLessThanOrEqual(255);
        if (value === 255) {
          solid += 1;
        }
      }
      expect(solid, shape).toBeGreaterThan(0);
    }
  });

  it("is the same picture every time it is asked for", () => {
    expect(Array.from(brushTipSilhouette("chisel", 24))).toEqual(
      Array.from(brushTipSilhouette("chisel", 24)),
    );
  });
});
