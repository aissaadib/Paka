/**
 * Real-browser blend-mode proof.
 *
 * The Vitest software canvas and the pure formula suite run in Node. This spec
 * asks the bundled Chromium to perform the same composites through the actual
 * Canvas 2D `globalCompositeOperation`, which is the operation Paka selects at
 * runtime. A mismatch here means the browser disagrees with the reference
 * formulas, not merely that a fake canvas does.
 */

import { expect, test } from "@playwright/test";

type Rgb = readonly [number, number, number];

interface Sample {
  readonly mode: GlobalCompositeOperation;
  readonly expected: Rgb;
  readonly alpha?: number;
}

test("Chromium composites Paka's blend modes like the reference formulas", async ({ page }) => {
  await page.goto("about:blank");

  const samples: Sample[] = [
    { mode: "source-over", expected: [204, 102, 51] },
    { mode: "multiply", expected: [82, 61, 41] },
    { mode: "screen", expected: [224, 194, 214] },
    { mode: "overlay", expected: [163, 133, 173] },
    { mode: "soft-light", expected: [138, 141, 180] },
    { mode: "hard-light", expected: [194, 122, 82] },
    { mode: "color-dodge", expected: [255, 255, 255] },
    { mode: "darken", expected: [102, 102, 51] },
    { mode: "lighten", expected: [204, 153, 204] },
    { mode: "difference", expected: [102, 51, 153] },
    { mode: "exclusion", expected: [143, 133, 173] },
    // Half layer opacity, difference over the same backdrop.
    { mode: "difference", expected: [102, 102, 179], alpha: 0.5 },
  ];

  const actual = await page.evaluate((list) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D is unavailable in this browser.");
    }

    return list.map(({ mode, alpha }) => {
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#6699cc";
      context.fillRect(0, 0, 1, 1);

      context.globalCompositeOperation = mode as GlobalCompositeOperation;
      context.globalAlpha = alpha ?? 1;
      context.fillStyle = "#cc6633";
      context.fillRect(0, 0, 1, 1);

      const pixel = context.getImageData(0, 0, 1, 1).data;
      return [pixel[0], pixel[1], pixel[2]];
    });
  }, samples);

  for (const [index, sample] of samples.entries()) {
    const [r, g, b] = actual[index];
    const label = `${sample.mode}${sample.alpha === undefined ? "" : ` @ ${sample.alpha}`}`;
    expect(Math.abs(r - sample.expected[0]), `${label} red`).toBeLessThanOrEqual(2);
    expect(Math.abs(g - sample.expected[1]), `${label} green`).toBeLessThanOrEqual(2);
    expect(Math.abs(b - sample.expected[2]), `${label} blue`).toBeLessThanOrEqual(2);
  }
});

test("Chromium leaves a transparent source untouched in every blend mode", async ({ page }) => {
  await page.goto("about:blank");

  const actual = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D is unavailable in this browser.");
    }

    const modes: GlobalCompositeOperation[] = [
      "multiply",
      "screen",
      "overlay",
      "soft-light",
      "hard-light",
      "color-dodge",
      "darken",
      "lighten",
      "difference",
      "exclusion",
    ];

    return modes.map((mode) => {
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#6699cc";
      context.fillRect(0, 0, 1, 1);

      context.globalCompositeOperation = mode;
      // A fully transparent source must not change the backdrop.
      context.globalAlpha = 0;
      context.fillStyle = "#cc6633";
      context.fillRect(0, 0, 1, 1);

      const pixel = context.getImageData(0, 0, 1, 1).data;
      return [pixel[0], pixel[1], pixel[2]];
    });
  });

  for (const pixel of actual) {
    expect(pixel[0]).toBe(102);
    expect(pixel[1]).toBe(153);
    expect(pixel[2]).toBe(204);
  }
});
