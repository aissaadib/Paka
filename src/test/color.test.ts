import { describe, expect, it } from "vitest";
import { hexToRgb, rgbToHex } from "../utils/color";

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
