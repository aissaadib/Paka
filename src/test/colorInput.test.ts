/**
 * The wider colour input: `#rrggbbaa`, `hsl()` / `hsla()` and `oklch()`.
 *
 * Three things are being pinned here, in the order the app depends on them:
 *
 * 1. **The parser.** Each syntax is read into the same 8-bit triple and
 *    alpha, an out-of-sRGB OKLCH colour is clamped into the cube, and junk is
 *    `null` rather than an exception (the parser runs on a keystroke).
 * 2. **The round trip.** Parse -> `rgbToHex` -> parse is stable within one
 *    8-bit step for all three syntaxes, so a value the field accepts is a
 *    value that survives being stored as `#rrggbb` and read back.
 * 3. **The alpha decision.** A translucent colour is *not* stored (it cannot
 *    be: the app stores and paints `#rrggbb`), and the field says so and
 *    reverts to the last valid colour instead of silently dropping the alpha.
 */

import { describe, expect, it } from "vitest";
import { parseColorInput, rgbToHex } from "../utils/color";
import { resolveColorInput } from "../features/color/colorInput";

/** Asserts that a string parses, and returns the result for further checks. */
function parsed(text: string) {
  const result = parseColorInput(text);
  expect(result, `${text} should parse`).not.toBeNull();
  return result!;
}

describe("hex input", () => {
  it("reads all four CSS lengths", () => {
    expect(parsed("#f00").rgb).toEqual({ r: 255, g: 0, b: 0 });
    expect(parsed("#f008").rgb).toEqual({ r: 255, g: 0, b: 0 });
    expect(parsed("#ff0000").rgb).toEqual({ r: 255, g: 0, b: 0 });
    expect(parsed("#ff000080").rgb).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("expands shorthand rather than truncating it", () => {
    expect(parsed("#abc").rgb).toEqual({ r: 170, g: 187, b: 204 });
    expect(parsed("#abcd").rgb).toEqual({ r: 170, g: 187, b: 204 });
    expect(parsed("#abcd").alpha).toBeCloseTo(0xdd / 255, 6);
  });

  it("turns the alpha pair into a fraction", () => {
    expect(parsed("#00000000").alpha).toBe(0);
    expect(parsed("#00000080").alpha).toBeCloseTo(128 / 255, 6);
    expect(parsed("#000000ff").alpha).toBe(1);
    expect(parsed("#000000").alpha).toBe(1);
  });

  it("accepts an upper-case value and surrounding space, and the bare form", () => {
    expect(parsed("  #FF8000  ").rgb).toEqual({ r: 255, g: 128, b: 0 });
    expect(parsed("ff8000").rgb).toEqual({ r: 255, g: 128, b: 0 });
  });
});

describe("hsl() input", () => {
  it("reads the comma and the space syntax the same way", () => {
    expect(parsed("hsl(210, 50%, 40%)").rgb).toEqual({ r: 51, g: 102, b: 153 });
    expect(parsed("hsl(210 50% 40%)").rgb).toEqual({ r: 51, g: 102, b: 153 });
    expect(parsed("hsl(210deg 50% 40%)").rgb).toEqual({ r: 51, g: 102, b: 153 });
  });

  it("reads the primaries exactly", () => {
    expect(parsed("hsl(0 100% 50%)").rgb).toEqual({ r: 255, g: 0, b: 0 });
    expect(parsed("hsl(120 100% 50%)").rgb).toEqual({ r: 0, g: 255, b: 0 });
    expect(parsed("hsl(240 100% 50%)").rgb).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("treats the percent sign as optional and clamps the range", () => {
    expect(parsed("hsl(210 50 40)").rgb).toEqual({ r: 51, g: 102, b: 153 });
    // Out of range is clamped to the syntax's own limits: 150 % saturation is
    // fully saturated (210, 100 %, 40 %), not a quiet fallback to 50 %.
    expect(parsed("hsl(210 150% 40%)").rgb).toEqual({ r: 0, g: 102, b: 204 });
    expect(parsed("hsl(-150 50% 40%)").rgb).toEqual({ r: 51, g: 102, b: 153 });
  });

  it("reads alpha after a slash or as a fourth argument", () => {
    expect(parsed("hsl(210 50% 40% / 0.5)").alpha).toBe(0.5);
    expect(parsed("hsla(210, 50%, 40%, 0.5)").alpha).toBe(0.5);
    expect(parsed("hsl(210, 50%, 40%, 50%)").alpha).toBe(0.5);
    expect(parsed("hsl(210 50% 40%)").alpha).toBe(1);
  });

  it("rejects a component list that is short, long or not numeric", () => {
    expect(parseColorInput("hsl(210 50%)")).toBeNull();
    expect(parseColorInput("hsl(210 50% 40% 0.5 / 0.5)")).toBeNull();
    expect(parseColorInput("hsl(210 50% 40% / 0.5 / 0.5)")).toBeNull();
    expect(parseColorInput("hsl(210 50% none)")).toBeNull();
    expect(parseColorInput("hsl(1turn 50% 40%)")).toBeNull();
  });
});

describe("oklch() input", () => {
  it("reads a colour, with and without alpha", () => {
    const opaque = parsed("oklch(0.7 0.1 200)");
    expect(opaque.alpha).toBe(1);
    expect(parsed("oklch(0.7 0.1 200 / 0.25)").alpha).toBe(0.25);
    expect(parsed("oklch(0.7 0.1 200 / 50%)").alpha).toBe(0.5);
  });

  it("puts the axes where the space puts them", () => {
    expect(parsed("oklch(0 0 0)").rgb).toEqual({ r: 0, g: 0, b: 0 });
    expect(parsed("oklch(1 0 0)").rgb).toEqual({ r: 255, g: 255, b: 255 });

    // A neutral OKLCH colour has no hue to show: it must come back grey.
    const grey = parsed("oklch(0.5 0 0)").rgb;
    expect(grey.r).toBe(grey.g);
    expect(grey.g).toBe(grey.b);
  });

  it("finds the sRGB primaries at their published OKLCH coordinates", () => {
    // Ottosson's conversion puts sRGB red at L 0.62796, C 0.25768, H 29.234.
    const red = parsed("oklch(0.62796 0.25768 29.234)").rgb;
    expect(Math.abs(red.r - 255)).toBeLessThanOrEqual(1);
    expect(red.g).toBeLessThanOrEqual(1);
    expect(red.b).toBeLessThanOrEqual(1);
  });

  it("clamps an out-of-sRGB colour into the cube instead of leaving the range", () => {
    // A far more saturated green than any display can show. Every channel has
    // to land in 0..255, and at least one has to sit on the cube's face,
    // which is what "clamped" means.
    const impossible = parsed("oklch(0.9 0.4 145)").rgb;
    for (const channel of [impossible.r, impossible.g, impossible.b]) {
      expect(Number.isFinite(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
    expect([impossible.r, impossible.g, impossible.b]).toContain(255);
  });

  it("clamps the lightness and wraps the hue", () => {
    expect(parsed("oklch(1.4 0.1 200)").rgb).toEqual(
      parsed("oklch(1 0.1 200)").rgb,
    );
    expect(parsed("oklch(0.7 0.1 560)").rgb).toEqual(
      parsed("oklch(0.7 0.1 200)").rgb,
    );
    expect(parsed("oklch(0.7 -0.1 200)").rgb).toEqual(
      parsed("oklch(0.7 0 200)").rgb,
    );
  });

  it("rejects a component list that is short or not numeric", () => {
    expect(parseColorInput("oklch(0.7 0.1)")).toBeNull();
    expect(parseColorInput("oklch(0.7 0.1 none)")).toBeNull();
  });
});

describe("garbage input", () => {
  it("is null for everything that is not a colour, and never throws", () => {
    const junk = [
      "",
      "   ",
      "nope",
      "#",
      "#12",
      "#12345",
      "#gg0000",
      "0123456789",
      "rgb(255, 0, 0)",
      "hsl",
      "hsl()",
      "hsl(210 50% 40%",
      "oklch(0.7 0.1 200",
      "oklch()",
      "hsl(210 50% 40%)px",
      "NaN",
      "Infinity",
      "-",
    ];
    for (const input of junk) {
      expect(() => parseColorInput(input)).not.toThrow();
      expect(parseColorInput(input), input).toBeNull();
    }
  });
});

describe("the round trip through the stored hex", () => {
  it("is stable within one 8-bit step for every syntax", () => {
    const samples = [
      "#000000",
      "#ffffff",
      "#3b82f6",
      "#e5484d",
      "#16181c",
      "#123456",
      "#ff8000",
      "#3b82f6cc",
      "#f008",
      "hsl(0 100% 50%)",
      "hsl(210, 50%, 40%)",
      "hsl(217 91% 60%)",
      "hsl(359.9 12.5% 87.5%)",
      "hsla(45 80% 50% / 1)",
      "oklch(0.7 0.1 200)",
      "oklch(0.62796 0.25768 29.234)",
      "oklch(0.5 0 0)",
      "oklch(0.9 0.4 145)",
      "oklch(1 0 0)",
    ];

    for (const sample of samples) {
      const first = parsed(sample);
      const stored = rgbToHex(first.rgb);
      expect(stored, `${sample} stores as #rrggbb`).toMatch(/^#[0-9a-f]{6}$/);

      const second = parsed(stored);
      expect(Math.abs(second.rgb.r - first.rgb.r), sample).toBeLessThanOrEqual(1);
      expect(Math.abs(second.rgb.g - first.rgb.g), sample).toBeLessThanOrEqual(1);
      expect(Math.abs(second.rgb.b - first.rgb.b), sample).toBeLessThanOrEqual(1);
      expect(second.alpha, sample).toBe(1);
    }
  });
});

describe("committing the field", () => {
  it("stores a lowercase #rrggbb for every syntax", () => {
    for (const input of ["#FF8000", "hsl(210 50% 40%)", "oklch(0.7 0.1 200)"]) {
      const outcome = resolveColorInput(input, "#16181c");
      expect(outcome.kind).toBe("applied");
      if (outcome.kind === "applied") {
        expect(outcome.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    const fromHsl = resolveColorInput("hsl(210, 50%, 40%)", "#16181c");
    expect(fromHsl).toEqual({ kind: "applied", color: "#336699" });
  });

  it("accepts a fully opaque 8-digit hex", () => {
    expect(resolveColorInput("#3b82f6ff", "#16181c")).toEqual({
      kind: "applied",
      color: "#3b82f6",
    });
  });

  it("reverts garbage to the last valid colour and says so", () => {
    const outcome = resolveColorInput("nope", "#16181c");
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.reason).toBe("invalid");
      expect(outcome.color).toBe("#16181c");
      expect(outcome.message).toContain("#16181c");
      expect(outcome.message).toMatch(/not a colour/i);
    }
  });

  it("reverts a blank field to the last valid colour and says so", () => {
    const outcome = resolveColorInput("   ", "#16181c");
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.reason).toBe("invalid");
      expect(outcome.color).toBe("#16181c");
      expect(outcome.message).toMatch(/enter a colour/i);
    }
  });

  it("refuses a translucent colour rather than dropping its alpha", () => {
    const samples = ["#ff000080", "hsl(0 100% 50% / 0.5)", "oklch(0.7 0.1 200 / 0.5)"];
    for (const sample of samples) {
      const outcome = resolveColorInput(sample, "#16181c");
      expect(outcome.kind, sample).toBe("rejected");
      if (outcome.kind === "rejected") {
        expect(outcome.reason, sample).toBe("translucent");
        // The alpha is named, and the stored colour is untouched.
        expect(outcome.message, sample).toMatch(/not a solid colour/i);
        expect(outcome.color, sample).toBe("#16181c");
      }
    }
  });
});
