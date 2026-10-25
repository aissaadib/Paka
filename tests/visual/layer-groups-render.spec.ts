import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scene, SceneVerdict } from "./scene";

/**
 * The group compositor's real pixels.
 *
 * The unit tests in `canvas2dRenderer.test.ts` pin the *calls*: a group with
 * opacity is drawn through one scratch, once. They run on a recording canvas,
 * so they cannot prove the composite's arithmetic. This spec asks Chromium for
 * the exported pixels and checks the two things that separate a group from a
 * folder of layers:
 *
 *  - **opacity is applied to the group as a unit**, not to each child. Two
 *    opaque overlapping children under a 50 % group are one 50 % layer; if the
 *    children were faded individually, the overlap would show the lower child
 *    through the upper one.
 *  - **blend mode is applied to the group's composite**, not to each child.
 *
 * The scenes use bucket-fill rectangles, so the expected values are exact
 * colours rather than an antialiased brush edge.
 */

declare global {
  interface Window {
    __pakaVisual?: {
      run(scene: Scene, golden?: HTMLCanvasElement): SceneVerdict;
    };
  }
}

const here = dirname(fileURLToPath(import.meta.url));

function loadScene(name: string): Scene {
  return JSON.parse(readFileSync(join(here, "scenes", name), "utf8")) as Scene;
}

/** Runs a scene in the harness and samples four RGBA pixels from its export. */
async function renderScene(
  page: import("@playwright/test").Page,
  scene: Scene,
  points: readonly { readonly x: number; readonly y: number }[],
): Promise<{
  readonly verdict: SceneVerdict;
  readonly samples: readonly (readonly number[])[];
}> {
  return page.evaluate(
    ({ scene, points }) => {
      const golden = document.createElement("canvas");
      const harness = window.__pakaVisual;
      if (!harness) {
        throw new Error("the visual harness did not mount");
      }
      const verdict = harness.run(scene, golden);
      const context = golden.getContext("2d");
      if (!context) {
        throw new Error("the export has no 2d context");
      }
      const data = context.getImageData(0, 0, golden.width, golden.height).data;
      const samples = points.map((point) => {
        const index = (point.y * golden.width + point.x) * 4;
        return [data[index], data[index + 1], data[index + 2], data[index + 3]];
      });
      return { verdict, samples };
    },
    { scene, points },
  );
}

function expectChannel(value: number | undefined, low: number, high: number): void {
  expect(value).toBeGreaterThanOrEqual(low);
  expect(value).toBeLessThanOrEqual(high);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/visual/harness.html");
  await page.waitForFunction(() => window.__pakaVisual !== undefined);
});

test("a group's opacity fades its children as one composite", async ({ page }) => {
  const scene = loadScene("group-opacity.json");
  const { verdict, samples } = await renderScene(page, scene, [
    { x: 20, y: 30 }, // red only
    { x: 40, y: 30 }, // red and blue overlap; blue is on top
    { x: 60, y: 30 }, // blue only
  ]);

  expect(verdict.rebuiltEqualsExported).toBe(true);
  expect(verdict.liveChecked).toBe(false);

  // 50 % red over white paper.
  expectChannel(samples[0]?.[0], 253, 255);
  expectChannel(samples[0]?.[1], 120, 136);
  expectChannel(samples[0]?.[2], 120, 136);

  // 50 % blue over white. The lower red child is not visible through the
  // upper one: the group's own composite is opaque before its opacity.
  expectChannel(samples[1]?.[0], 120, 136);
  expectChannel(samples[1]?.[1], 120, 136);
  expectChannel(samples[1]?.[2], 253, 255);
  expect(samples[1]).toEqual(samples[2]);
});

test("a hidden group removes its whole subtree from the export", async ({ page }) => {
  const scene = loadScene("group-hidden.json");
  const { verdict, samples } = await renderScene(page, scene, [
    { x: 20, y: 30 },
    { x: 40, y: 30 },
    { x: 60, y: 30 },
  ]);

  expect(verdict.rebuiltEqualsExported).toBe(true);
  for (const sample of samples) {
    expect(sample).toEqual([255, 255, 255, 255]);
  }
});

test("a group's blend mode applies to its composite, not to each child", async ({ page }) => {
  const scene = loadScene("group-blend.json");
  const { verdict, samples } = await renderScene(page, scene, [
    { x: 10, y: 10 }, // the yellow base, away from the group
    { x: 50, y: 30 }, // the blue group over the yellow base
  ]);

  expect(verdict.rebuiltEqualsExported).toBe(true);

  // The base is untouched outside the group.
  expect(samples[0]?.[0]).toBe(255);
  expect(samples[0]?.[1]).toBe(255);
  expect(samples[0]?.[2]).toBe(0);

  // multiply(blue, yellow) is black; at 50 % over yellow it is half yellow.
  // If the group's blend were ignored, the result would be grey; if its
  // opacity were ignored, it would be black.
  expectChannel(samples[1]?.[0], 120, 136);
  expectChannel(samples[1]?.[1], 120, 136);
  expectChannel(samples[1]?.[2], 0, 8);
});
