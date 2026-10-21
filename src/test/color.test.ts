import { describe, expect, it } from "vitest";
import {
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hsvToRgb,
  normalizeHue,
  rgbToHex,
  rgbToHsv,
} from "../utils/color";

describe("colour conversions", () => {
  it("formats an 8-bit sRGB triple as lowercase hex", () => {
    expect(rgbToHex({ r: 204, g: 51, b: 102 })).toBe("#cc3366");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#ffffff");
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });

  it("rounds and clamps each channel into a valid hex pair", () => {
    expect(rgbToHex({ r: 12.6, g: -4, b: 300 })).toBe("#0d00ff");
  });

  it("round-trips every channel value through hex", () => {
    for (const value of [0, 1, 51, 127, 204, 254, 255]) {
      const rgb = { r: value, g: 255 - value, b: (value * 7) % 256 };
      expect(hexToRgb(rgbToHex(rgb))).toEqual(rgb);
    }
  });

  it("parses shorthand and long hex, and rejects anything else", () => {
    expect(hexToRgb("#f0a")).toEqual({ r: 255, g: 0, b: 170 });
    expect(hexToRgb("CC3366")).toEqual({ r: 204, g: 51, b: 102 });
    expect(hexToRgb("#ggg")).toBeNull();
    expect(hexToRgb("red")).toBeNull();
  });
});

describe("HSV conversion", () => {
  it("places the six primaries at the expected hues", () => {
    const cases: readonly [number, string][] = [
      [0, "#ff0000"],
      [60, "#ffff00"],
      [120, "#00ff00"],
      [180, "#00ffff"],
      [240, "#0000ff"],
      [300, "#ff00ff"],
    ];
    for (const [h, hex] of cases) {
      expect(hsvToHex({ h, s: 1, v: 1 })).toBe(hex);
      const back = rgbToHsv(hexToRgb(hex)!);
      expect(back.h).toBeCloseTo(h, 6);
      expect(back.s).toBeCloseTo(1, 6);
      expect(back.v).toBeCloseTo(1, 6);
    }
  });

  it("reports a grey as no hue and no saturation", () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 })).toEqual({
      h: 0,
      s: 0,
      v: 128 / 255,
    });
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, v: 1 });
  });

  it("round-trips a colour through HSV without changing a byte", () => {
    // The wheel must not shift a colour the user picked elsewhere, so the
    // conversion has to be exact for the 8-bit values the app stores.
    for (const hex of [
      "#000000",
      "#ffffff",
      "#16181c",
      "#cc3366",
      "#4c8ef7",
      "#00ff00",
      "#010203",
      "#fefdfc",
      "#123456",
      "#fedcba",
    ]) {
      const rgb = hexToRgb(hex)!;
      expect(hsvToRgb(rgbToHsv(rgb))).toEqual(rgb);
      expect(hsvToHex(rgbToHsv(rgb))).toBe(hex);
    }
  });

  it("round-trips every colour of a coarse sweep exactly", () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const rgb = { r, g, b };
          expect(hsvToRgb(rgbToHsv(rgb))).toEqual(rgb);
        }
      }
    }
  });

  it("round-trips every one of the 16,777,216 colours of the cube exactly", () => {
    // The whole cube, not a sample of it: this is the sweep the architecture
    // note claims, so it has to be here or the claim is not backed. The check
    // is a plain comparison rather than 16.7M `expect` calls, because the
    // matcher costs far more than the conversion does.
    let checked = 0;
    for (let r = 0; r < 256; r++) {
      for (let g = 0; g < 256; g++) {
        for (let b = 0; b < 256; b++) {
          const back = hsvToRgb(rgbToHsv({ r, g, b }));
          if (back.r !== r || back.g !== g || back.b !== b) {
            throw new Error(
              `rgb(${r}, ${g}, ${b}) came back as rgb(${back.r}, ${back.g}, ${back.b})`,
            );
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(16_777_216);
  });

  it("wraps a hue into one turn", () => {
    expect(normalizeHue(0)).toBe(0);
    expect(normalizeHue(360)).toBe(0);
    expect(normalizeHue(420)).toBe(60);
    expect(normalizeHue(-30)).toBe(330);
    expect(normalizeHue(-390)).toBe(330);
    expect(normalizeHue(Number.NaN)).toBe(0);
  });

  it("treats a hue of one turn as the same colour as a hue of none", () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual(hsvToRgb({ h: 0, s: 1, v: 1 }));
    expect(hsvToRgb({ h: -30, s: 1, v: 1 })).toEqual(hsvToRgb({ h: 330, s: 1, v: 1 }));
    expect(hsvToRgb({ h: 420, s: 1, v: 1 })).toEqual(hsvToRgb({ h: 60, s: 1, v: 1 }));
  });

  it("clamps the saturation and the value into 0..1", () => {
    expect(hsvToRgb({ h: 0, s: 2, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: 0, s: -1, v: 1 })).toEqual({ r: 255, g: 255, b: 255 });
    expect(hsvToRgb({ h: 0, s: 1, v: 2 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: 0, s: 1, v: -1 })).toEqual({ r: 0, g: 0, b: 0 });
    expect(hsvToRgb({ h: 0, s: 0.5, v: 0.5 })).toEqual({ r: 128, g: 64, b: 64 });
  });

  it("never produces a NaN channel from a broken input", () => {
    const broken = hsvToRgb({ h: Number.NaN, s: Number.NaN, v: Number.NaN });
    expect(Number.isFinite(broken.r)).toBe(true);
    expect(Number.isFinite(broken.g)).toBe(true);
    expect(Number.isFinite(broken.b)).toBe(true);
    expect(hsvToRgb({ h: Number.NaN, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("parses a hex colour into HSV and rejects anything else", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#000")).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv("red")).toBeNull();
    expect(hexToHsv("#ggg")).toBeNull();
  });
});
