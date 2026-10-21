import { describe, expect, it } from "vitest";
import { hexToRgb } from "../utils/color";
import {
  CONTRAST_BAND_LABELS,
  UNKNOWN_REASONS,
  contrastBand,
  contrastRatio,
  deltaE2000,
  formatContrastRatio,
  formatDeltaE,
  formatSpokenRatio,
  measureColor,
  nearestByDeltaE,
  relativeLuminance,
  srgbToLab,
} from "../utils/colorMetrics";
import type { Lab, PaletteEntry } from "../utils/colorMetrics";

/**
 * The published verification data of the CIEDE2000 formula.
 *
 * Sharma, Wu & Dalal, "The CIEDE2000 color-difference formula: Implementation
 * notes, supplementary test data, and mathematical observations", Color
 * Research & Application 30(1), 21-30 (2005). The table is the standard's own
 * check on an implementation: it is the data the formula's authors published
 * so that an implementation can be *proven* rather than merely plausible.
 *
 * Each row is a reference colour, a sample colour and the colour difference
 * the formula must produce between them.
 */
const CIEDE2000_VERIFICATION: readonly (readonly [Lab, Lab, number])[] = [
  [{ L: 50.0, a: 2.6772, b: -79.7751 }, { L: 50.0, a: 0.0, b: -82.7485 }, 2.0425],
  [{ L: 50.0, a: 3.1571, b: -77.2803 }, { L: 50.0, a: 0.0, b: -82.7485 }, 2.8615],
  [{ L: 50.0, a: 2.8361, b: -74.02 }, { L: 50.0, a: 0.0, b: -82.7485 }, 3.4412],
  [{ L: 50.0, a: -1.3802, b: -84.2814 }, { L: 50.0, a: 0.0, b: -82.7485 }, 1.0],
  [{ L: 50.0, a: -1.1848, b: -84.8006 }, { L: 50.0, a: 0.0, b: -82.7485 }, 1.0],
  [{ L: 50.0, a: -0.9009, b: -85.5211 }, { L: 50.0, a: 0.0, b: -82.7485 }, 1.0],
  [{ L: 50.0, a: 0.0, b: 0.0 }, { L: 50.0, a: -1.0, b: 2.0 }, 2.3669],
  [{ L: 50.0, a: -1.0, b: 2.0 }, { L: 50.0, a: 0.0, b: 0.0 }, 2.3669],
  [{ L: 50.0, a: 2.49, b: -0.001 }, { L: 50.0, a: -2.49, b: 0.0009 }, 7.1792],
  [{ L: 50.0, a: 2.49, b: -0.001 }, { L: 50.0, a: -2.49, b: 0.001 }, 7.1792],
  [{ L: 50.0, a: 2.49, b: -0.001 }, { L: 50.0, a: -2.49, b: 0.0011 }, 7.2195],
  [{ L: 50.0, a: 2.49, b: -0.001 }, { L: 50.0, a: -2.49, b: 0.0012 }, 7.2195],
  [{ L: 50.0, a: -0.001, b: 2.49 }, { L: 50.0, a: 0.0009, b: -2.49 }, 4.8045],
  [{ L: 50.0, a: -0.001, b: 2.49 }, { L: 50.0, a: 0.001, b: -2.49 }, 4.8045],
  [{ L: 50.0, a: -0.001, b: 2.49 }, { L: 50.0, a: 0.0011, b: -2.49 }, 4.7461],
  [{ L: 50.0, a: 2.5, b: 0.0 }, { L: 50.0, a: 0.0, b: -2.5 }, 4.3065],
  [{ L: 50.0, a: 2.5, b: 0.0 }, { L: 73.0, a: 25.0, b: -18.0 }, 27.1492],
  [{ L: 50.0, a: 2.5, b: 0.0 }, { L: 61.0, a: -5.0, b: 29.0 }, 22.8977],
  [{ L: 50.0, a: 2.5, b: 0.0 }, { L: 56.0, a: -27.0, b: -3.0 }, 31.903],
  [{ L: 50.0, a: 2.5, b: 0.0 }, { L: 58.0, a: 24.0, b: 15.0 }, 19.4535],
  [{ L: 50.0, a: 2.5, b: 0.0 }, { L: 50.0, a: 3.1736, b: 0.5854 }, 1.0],
  [{ L: 50.0, a: 2.5, b: 0.0 }, { L: 50.0, a: 3.2972, b: 0.0 }, 1.0],
  [{ L: 50.0, a: 2.5, b: 0.0 }, { L: 50.0, a: 1.8634, b: 0.5757 }, 1.0],
  [{ L: 50.0, a: 2.5, b: 0.0 }, { L: 50.0, a: 3.2592, b: 0.335 }, 1.0],
  [{ L: 60.2574, a: -34.0099, b: 36.2677 }, { L: 60.4626, a: -34.1751, b: 39.4387 }, 1.2644],
  [{ L: 63.0109, a: -31.0961, b: -5.8663 }, { L: 62.8187, a: -29.7946, b: -4.0864 }, 1.263],
  [{ L: 61.2901, a: 3.7196, b: -5.3901 }, { L: 61.4292, a: 2.248, b: -4.962 }, 1.8731],
  [{ L: 35.0831, a: -44.1164, b: 3.7933 }, { L: 35.0232, a: -40.0716, b: 1.5901 }, 1.8645],
  [{ L: 22.7233, a: 20.0904, b: -46.694 }, { L: 23.0331, a: 14.973, b: -42.5619 }, 2.0373],
  [{ L: 36.4612, a: 47.858, b: 18.3852 }, { L: 36.2715, a: 50.5065, b: 21.2231 }, 1.4146],
  [{ L: 90.8027, a: -2.0831, b: 1.441 }, { L: 91.1528, a: -1.6435, b: 0.0447 }, 1.4441],
  [{ L: 90.9257, a: -0.5406, b: -0.9208 }, { L: 88.6381, a: -0.8985, b: -0.7239 }, 1.5381],
  [{ L: 6.7747, a: -0.2908, b: -2.4247 }, { L: 5.8714, a: -0.0985, b: -2.2286 }, 0.6377],
  [{ L: 2.0776, a: 0.0795, b: -1.135 }, { L: 0.9033, a: -0.0636, b: -0.5514 }, 0.9082],
];

const PALETTE: readonly PaletteEntry[] = [
  { hex: "#16181c", rgb: { r: 22, g: 24, b: 28 } },
  { hex: "#ffffff", rgb: { r: 255, g: 255, b: 255 } },
  { hex: "#e5484d", rgb: { r: 229, g: 72, b: 77 } },
  { hex: "#e8a33d", rgb: { r: 232, g: 163, b: 61 } },
  { hex: "#3fb950", rgb: { r: 63, g: 185, b: 80 } },
  { hex: "#3b82f6", rgb: { r: 59, g: 130, b: 246 } },
  { hex: "#8b5cf6", rgb: { r: 139, g: 92, b: 246 } },
  { hex: "#d946a0", rgb: { r: 217, g: 70, b: 160 } },
];

function rgb(hex: string) {
  const parsed = hexToRgb(hex);
  if (parsed === null) {
    throw new Error(`${hex} is not a hex colour`);
  }
  return parsed;
}

describe("WCAG 2.2 relative luminance", () => {
  it("puts black at 0 and white at 1", () => {
    expect(relativeLuminance(rgb("#000000"))).toBe(0);
    expect(relativeLuminance(rgb("#ffffff"))).toBe(1);
  });

  it("matches the published luminance of the sRGB primaries", () => {
    expect(relativeLuminance(rgb("#ff0000"))).toBeCloseTo(0.2126, 6);
    expect(relativeLuminance(rgb("#00ff00"))).toBeCloseTo(0.7152, 6);
    expect(relativeLuminance(rgb("#0000ff"))).toBeCloseTo(0.0722, 6);
  });

  it("uses the transfer function of the standard", () => {
    // The value of a channel below the breakpoint is the linear segment, and
    // the value above it is the 2.4 power curve. These two channels sit on
    // either side of WCAG 2.2's 0.04045 breakpoint.
    expect(relativeLuminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(
      0.003035269835488375,
      12,
    );
    expect(relativeLuminance({ r: 11, g: 11, b: 11 })).toBeCloseTo(
      0.003346535763899161,
      12,
    );
  });
});

describe("WCAG 2.2 contrast ratio", () => {
  it("gives the maximum of 21 for black on white", () => {
    expect(contrastRatio(rgb("#000000"), rgb("#ffffff"))).toBe(21);
  });

  it("gives the minimum of 1 for a colour on itself", () => {
    expect(contrastRatio(rgb("#ffffff"), rgb("#ffffff"))).toBe(1);
    expect(contrastRatio(rgb("#3b82f6"), rgb("#3b82f6"))).toBe(1);
  });

  it("puts the 4.5:1 boundary where WCAG 2.2 puts it", () => {
    // The grey that is commonly cited as the 4.5:1 boundary: #767676 is just
    // over it and #777777 is just under.
    expect(contrastRatio(rgb("#767676"), rgb("#ffffff"))).toBeCloseTo(4.5422, 4);
    expect(contrastRatio(rgb("#767676"), rgb("#ffffff"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(rgb("#777777"), rgb("#ffffff"))).toBeCloseTo(4.4781, 4);
    expect(contrastRatio(rgb("#777777"), rgb("#ffffff"))).toBeLessThan(4.5);
  });

  it("measures the app's own default ink and its weakest swatch", () => {
    expect(contrastRatio(rgb("#16181c"), rgb("#ffffff"))).toBeCloseTo(17.7735, 4);
    expect(contrastRatio(rgb("#e8a33d"), rgb("#ffffff"))).toBeCloseTo(2.1566, 4);
  });

  it("is symmetric in its arguments", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["#000000", "#ffffff"],
      ["#3b82f6", "#e8a33d"],
      ["#16181c", "#16181c"],
      ["#767676", "#777777"],
    ];
    for (const [a, b] of pairs) {
      expect(contrastRatio(rgb(a), rgb(b))).toBe(contrastRatio(rgb(b), rgb(a)));
    }
  });
});

describe("sRGB to CIELAB", () => {
  it("puts black at L 0 and white at L 100, both without chroma", () => {
    const black = srgbToLab(rgb("#000000"));
    expect(black.L).toBeCloseTo(0, 9);
    expect(black.a).toBeCloseTo(0, 9);
    expect(black.b).toBeCloseTo(0, 9);

    // The published sRGB matrix and the published D65 white point are each
    // rounded to seven decimals, so a neutral colour is neutral only to
    // about 1e-5 rather than exactly.
    const white = srgbToLab(rgb("#ffffff"));
    expect(white.L).toBeCloseTo(100, 4);
    expect(white.a).toBeCloseTo(0, 4);
    expect(white.b).toBeCloseTo(0, 4);
  });

  it("leaves a grey without chroma", () => {
    const grey = srgbToLab(rgb("#808080"));
    expect(grey.L).toBeCloseTo(53.585, 3);
    expect(grey.a).toBeCloseTo(0, 4);
    expect(grey.b).toBeCloseTo(0, 4);
  });

  it("matches the published CIELAB coordinates of the sRGB primaries", () => {
    const red = srgbToLab(rgb("#ff0000"));
    expect(red.L).toBeCloseTo(53.2408, 3);
    expect(red.a).toBeCloseTo(80.0925, 3);
    expect(red.b).toBeCloseTo(67.2032, 3);

    const green = srgbToLab(rgb("#00ff00"));
    expect(green.L).toBeCloseTo(87.7347, 3);
    expect(green.a).toBeCloseTo(-86.1827, 3);
    expect(green.b).toBeCloseTo(83.1793, 3);

    const blue = srgbToLab(rgb("#0000ff"));
    expect(blue.L).toBeCloseTo(32.297, 3);
    expect(blue.a).toBeCloseTo(79.1875, 3);
    expect(blue.b).toBeCloseTo(-107.8602, 3);
  });
});

describe("CIEDE2000 colour difference", () => {
  it("is zero for a colour against itself", () => {
    const colour = srgbToLab(rgb("#3b82f6"));
    expect(deltaE2000(colour, colour)).toBe(0);
    expect(deltaE2000({ L: 50, a: 2.5, b: 0 }, { L: 50, a: 2.5, b: 0 })).toBe(0);
  });

  it("reproduces the published verification data", () => {
    for (const [reference, sample, expected] of CIEDE2000_VERIFICATION) {
      expect(deltaE2000(reference, sample)).toBeCloseTo(expected, 4);
    }
  });

  it("is symmetric, including on the pairs the standard says to swap", () => {
    for (const [reference, sample] of CIEDE2000_VERIFICATION) {
      expect(deltaE2000(reference, sample)).toBeCloseTo(
        deltaE2000(sample, reference),
        10,
      );
    }
  });

  it("separates colours that are far apart and joins ones that are close", () => {
    // A dark blue and a dark red are far apart to the eye and yet almost
    // equally bright: the difference metric says so, the contrast ratio does
    // not. The two metrics answer different questions.
    const blue = srgbToLab(rgb("#1a1a8a"));
    const red = srgbToLab(rgb("#8a1a1a"));
    expect(deltaE2000(blue, red)).toBeCloseTo(38.62, 1);
    expect(contrastRatio(rgb("#1a1a8a"), rgb("#8a1a1a"))).toBeCloseTo(1.44, 2);

    // One 8-bit step apart: a difference the eye cannot see.
    const nearRed = srgbToLab(rgb("#fe0000"));
    const red2 = srgbToLab(rgb("#ff0000"));
    expect(deltaE2000(nearRed, red2)).toBeCloseTo(0.208, 2);
  });

  it("never returns a number it cannot use", () => {
    const broken: Lab = { L: Number.NaN, a: Number.NaN, b: Number.NaN };
    expect(Number.isFinite(deltaE2000(broken, broken))).toBe(true);
    expect(Number.isFinite(deltaE2000({ L: 50, a: 0, b: 0 }, broken))).toBe(true);
  });
});

describe("the nearest palette entry", () => {
  it("finds the entry itself for an exact match", () => {
    const match = nearestByDeltaE(rgb("#3b82f6"), PALETTE);
    expect(match?.hex).toBe("#3b82f6");
    expect(match?.deltaE).toBeCloseTo(0, 9);
  });

  it("finds the entry one 8-bit step away", () => {
    const match = nearestByDeltaE(rgb("#3b83f7"), PALETTE);
    expect(match?.hex).toBe("#3b82f6");
    expect(match?.deltaE).toBeCloseTo(0.35, 2);
  });

  it("finds the default ink's own entry", () => {
    const match = nearestByDeltaE(rgb("#000000"), PALETTE);
    expect(match?.hex).toBe("#16181c");
    expect(match?.deltaE).toBeCloseTo(5.68, 2);
  });

  it("has nothing to say about an empty palette", () => {
    expect(nearestByDeltaE(rgb("#3b82f6"), [])).toBeNull();
  });
});

describe("the contrast bands", () => {
  it("names the bands by WCAG 2.2's thresholds", () => {
    expect(contrastBand(21)).toBe("excellent");
    expect(contrastBand(7)).toBe("excellent");
    expect(contrastBand(6.99)).toBe("good");
    expect(contrastBand(4.5)).toBe("good");
    expect(contrastBand(4.49)).toBe("fair");
    expect(contrastBand(3)).toBe("fair");
    expect(contrastBand(2.99)).toBe("low");
    expect(contrastBand(1)).toBe("low");
  });

  it("takes the band from the unrounded ratio", () => {
    // 4.499 is printed as "4.5" but is not 4.5.
    expect(contrastBand(4.499)).toBe("fair");
  });

  it("words every band", () => {
    for (const band of ["excellent", "good", "fair", "low"] as const) {
      expect(CONTRAST_BAND_LABELS[band].length).toBeGreaterThan(0);
    }
    expect(CONTRAST_BAND_LABELS.excellent).toBe("Excellent contrast");
  });
});

describe("the displayed numbers", () => {
  it("rounds a ratio to one decimal and a difference to two", () => {
    expect(formatContrastRatio(17.7735)).toBe("17.8:1");
    expect(formatContrastRatio(21)).toBe("21.0:1");
    expect(formatContrastRatio(1)).toBe("1.0:1");
    expect(formatDeltaE(0.3486)).toBe("0.35");
    expect(formatDeltaE(0)).toBe("0.00");
  });

  it("spells the ratio out for a screen reader", () => {
    expect(formatSpokenRatio(17.7735)).toBe("17.8 to 1");
  });

  it("never shows a value that is not a number", () => {
    // The readout's own vocabulary: a value that is not there reads as
    // missing, never as the text "NaN".
    expect(formatContrastRatio(Number.NaN)).toBe("unknown");
    expect(formatContrastRatio(Number.POSITIVE_INFINITY)).toBe("unknown");
    expect(formatSpokenRatio(Number.NaN)).toBe("unknown");
    expect(formatDeltaE(Number.NaN)).toBe("unknown");
    expect(formatDeltaE(Number.NEGATIVE_INFINITY)).toBe("unknown");
    for (const rendered of [
      formatContrastRatio(Number.NaN),
      formatSpokenRatio(Number.NaN),
      formatDeltaE(Number.NaN),
    ]) {
      expect(rendered).not.toContain("NaN");
    }
  });
});

describe("measuring an ink against a paper", () => {
  it("reports the ratio, the band and the nearest swatch", () => {
    const report = measureColor("#16181c", "#ffffff", PALETTE.map((e) => e.hex));
    expect(report.ink).toEqual({ r: 22, g: 24, b: 28 });
    expect(report.paper).toEqual({ r: 255, g: 255, b: 255 });
    expect(report.ratio).toBeCloseTo(17.7735, 4);
    expect(report.band).toBe("excellent");
    expect(report.nearest?.hex).toBe("#16181c");
  });

  it("accepts a short-hand hex colour", () => {
    const report = measureColor("#abc", "#fff", PALETTE.map((e) => e.hex));
    expect(report.ink).toEqual({ r: 170, g: 187, b: 204 });
    expect(report.paper).toEqual({ r: 255, g: 255, b: 255 });
    expect(report.ratio).not.toBeNull();
  });

  it("says nothing rather than guessing when the ink is not a hex colour", () => {
    const report = measureColor("red", "#ffffff", PALETTE.map((e) => e.hex));
    expect(report.ink).toBeNull();
    expect(report.ratio).toBeNull();
    expect(report.band).toBeNull();
    expect(report.nearest).toBeNull();
    expect(report.ratioReason).toBe("ink");
    expect(report.nearestReason).toBe("ink");
  });

  it("still finds the nearest swatch when the paper is not a hex colour", () => {
    const report = measureColor("#3b82f6", "rgb(1, 2, 3)", PALETTE.map((e) => e.hex));
    expect(report.paper).toBeNull();
    expect(report.ratio).toBeNull();
    expect(report.ratioReason).toBe("paper");
    expect(report.nearest?.hex).toBe("#3b82f6");
    expect(report.nearestReason).toBeNull();
  });

  it("has no nearest swatch without a palette", () => {
    const report = measureColor("#3b82f6", "#ffffff", []);
    expect(report.ratio).toBeCloseTo(3.6779, 4);
    expect(report.nearest).toBeNull();
    expect(report.nearestReason).toBe("palette-empty");
  });

  it("tells an empty palette from one that holds nothing readable", () => {
    // The two are different facts, and the readout's words must not confuse
    // them: a palette with an entry that cannot be parsed is not empty.
    const unreadable = measureColor("#3b82f6", "#ffffff", ["nope"]);
    expect(unreadable.nearest).toBeNull();
    expect(unreadable.nearestReason).toBe("palette-unreadable");
    expect(UNKNOWN_REASONS["palette-unreadable"]).not.toBe(
      UNKNOWN_REASONS["palette-empty"],
    );

    const empty = measureColor("#3b82f6", "#ffffff", []);
    expect(empty.nearestReason).toBe("palette-empty");
  });

  it("measures against the readable entries of a partly readable palette", () => {
    const report = measureColor("#3b82f6", "#ffffff", ["nope", "#3b82f6"]);
    expect(report.nearest?.hex).toBe("#3b82f6");
    expect(report.nearestReason).toBeNull();
  });
});

describe("the metrics are total", () => {
  it("folds a broken channel into the cube instead of poisoning the result", () => {
    const broken = { r: Number.NaN, g: Number.POSITIVE_INFINITY, b: -50 };
    expect(Number.isFinite(relativeLuminance(broken))).toBe(true);
    expect(relativeLuminance(broken)).toBeCloseTo(
      relativeLuminance({ r: 0, g: 0, b: 0 }),
      9,
    );
    expect(Number.isFinite(contrastRatio(broken, rgb("#ffffff")))).toBe(true);
    expect(Number.isFinite(srgbToLab(broken).L)).toBe(true);
  });

  it("clamps an out-of-range channel into the cube", () => {
    expect(relativeLuminance({ r: 300, g: 0, b: 0 })).toBeCloseTo(
      relativeLuminance({ r: 255, g: 0, b: 0 }),
      12,
    );
    expect(relativeLuminance({ r: -40, g: 0, b: 0 })).toBe(
      relativeLuminance({ r: 0, g: 0, b: 0 }),
    );
  });
});
