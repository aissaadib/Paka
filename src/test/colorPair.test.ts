import { describe, expect, it } from "vitest";
import { compareColorPair, contrastGuidance } from "../utils/colorPair";

/**
 * The contrast expectations below are published WCAG 2.2 values: black on
 * white is the maximum 21:1, and `#767676` / `#777777` are the two greys
 * commonly cited either side of the 4.5:1 body-text boundary. The exact
 * CIEDE2000 verification table lives in `colorMetrics.test.ts`; this file
 * checks that the pair report feeds the same colours to both metrics.
 */
describe("comparing two colours", () => {
  it("gives black on white the maximum contrast and the maximum lightness difference", () => {
    const report = compareColorPair("#000000", "#ffffff");
    expect(report.contrast).toBe(21);
    // CIEDE2000 reduces to ΔL* when both colours are neutral, so black to
    // white is 100 up to the published sRGB matrix's rounding.
    expect(report.deltaE).toBeCloseTo(100, 4);
    expect(report.guidance?.level).toBe("aaa-body");
    expect(report.inkIssue).toBeNull();
    expect(report.againstIssue).toBeNull();
  });

  it("gives an identical pair a ratio of 1 and a difference of 0", () => {
    for (const hex of ["#000000", "#ffffff", "#3b82f6", "#e8a33d"]) {
      const report = compareColorPair(hex, hex);
      expect(report.contrast).toBe(1);
      expect(report.deltaE).toBe(0);
      expect(report.guidance?.level).toBe("below-aa");
    }
  });

  it("is symmetric in both metrics", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["#000000", "#ffffff"],
      ["#3b82f6", "#e8a33d"],
      ["#16181c", "#d946a0"],
      ["#777777", "#ffffff"],
    ];
    for (const [a, b] of pairs) {
      const forward = compareColorPair(a, b);
      const backward = compareColorPair(b, a);
      expect(forward.contrast).toBe(backward.contrast);
      expect(forward.deltaE).toBe(backward.deltaE);
    }
  });

  it("reproduces the published greys on either side of 4.5:1", () => {
    expect(compareColorPair("#767676", "#ffffff").contrast).toBeCloseTo(
      4.5422,
      4,
    );
    expect(compareColorPair("#777777", "#ffffff").contrast).toBeCloseTo(
      4.4781,
      4,
    );
  });

  it("keeps the two metrics independent", () => {
    // Dark blue and dark red are almost equally bright but far apart to the
    // eye: the contrast ratio is near 1 while CIEDE2000 is large.
    const report = compareColorPair("#1a1a8a", "#8a1a1a");
    expect(report.contrast).toBeCloseTo(1.44, 2);
    expect(report.deltaE).toBeCloseTo(38.62, 1);
  });

  it("uses the unrounded ratio for the WCAG guidance", () => {
    expect(contrastGuidance(21).level).toBe("aaa-body");
    expect(contrastGuidance(7).level).toBe("aaa-body");
    expect(contrastGuidance(6.999).level).toBe("aa-body");
    expect(contrastGuidance(4.5).level).toBe("aa-body");
    expect(contrastGuidance(4.499).level).toBe("aa-large");
    expect(contrastGuidance(3).level).toBe("aa-large");
    expect(contrastGuidance(2.999).level).toBe("below-aa");
    expect(contrastGuidance(Number.NaN).level).toBe("below-aa");
    expect(contrastGuidance(Number.POSITIVE_INFINITY).level).toBe("below-aa");
  });
});

describe("a pair that cannot be measured", () => {
  it("reports malformed text as invalid and returns no numbers", () => {
    for (const bad of ["", "   ", "red", "#ggg", "#12345", "rgb(1, 2, 3)"]) {
      const report = compareColorPair(bad, "#ffffff");
      expect(report.contrast).toBeNull();
      expect(report.deltaE).toBeNull();
      expect(report.guidance).toBeNull();
      expect(report.ink).toBeNull();
      expect(report.inkIssue).toBe("invalid");
      expect(report.againstIssue).toBeNull();
    }
  });

  it("reports translucent colours as a different fact from invalid text", () => {
    const translucent = compareColorPair("#00000080", "#ffffff");
    expect(translucent.contrast).toBeNull();
    expect(translucent.deltaE).toBeNull();
    expect(translucent.ink).toBeNull();
    expect(translucent.inkIssue).toBe("translucent");

    const shorthand = compareColorPair("#0000", "#ffffff");
    expect(shorthand.inkIssue).toBe("translucent");

    const against = compareColorPair("#000000", "#ffffff00");
    expect(against.againstIssue).toBe("translucent");
    expect(against.inkIssue).toBeNull();
  });

  it("accepts opaque 8-digit and 4-digit hex", () => {
    expect(compareColorPair("#000000ff", "#ffffffff").contrast).toBe(21);
    expect(compareColorPair("#000f", "#ffff").contrast).toBe(21);
  });

  it("reports both sides when both are unreadable", () => {
    const report = compareColorPair("nope", "#00000080");
    expect(report.inkIssue).toBe("invalid");
    expect(report.againstIssue).toBe("translucent");
    expect(report.contrast).toBeNull();
    expect(report.deltaE).toBeNull();
  });

  it("never returns a non-finite number for any readable pair", () => {
    const palette = [
      "#000000",
      "#ffffff",
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#16181c",
      "#e8a33d",
      "#d946a0",
      "#808080",
      "#010203",
      "#fefdfc",
    ];
    for (const a of palette) {
      for (const b of palette) {
        const report = compareColorPair(a, b);
        expect(report.contrast).not.toBeNull();
        expect(report.deltaE).not.toBeNull();
        expect(Number.isFinite(report.contrast)).toBe(true);
        expect(Number.isFinite(report.deltaE)).toBe(true);
        expect(report.contrast).toBeGreaterThanOrEqual(1);
        expect(report.contrast).toBeLessThanOrEqual(21);
        expect(report.deltaE).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
