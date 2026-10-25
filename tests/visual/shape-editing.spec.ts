import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scene, SceneVerdict } from "./scene";

/**
 * Native shapes in a real browser.
 *
 * The unit tests pin the calls and the model. This spec asks Chromium for the
 * pixels, which is the only place the antialiased outline and the filled
 * interior can be checked. It proves three things a scene can state:
 *
 *  - every primitive exports the picture its geometry describes;
 *  - a filled shape covers its interior with its own brush colour;
 *  - a rotated box is turned rigidly, so a point inside the turned outline is
 *    painted and a point inside the unrotated box is not.
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

test("every primitive exports the picture its geometry describes", async ({ page }) => {
  const scene = loadScene("shape-primitives.json");
  const { verdict, samples } = await renderScene(page, scene, [
    { x: 40, y: 30 }, // rectangle's interior
    { x: 120, y: 30 }, // ellipse's interior
    { x: 40, y: 110 }, // pentagon's interior
    { x: 120, y: 110 }, // star's interior
    { x: 170, y: 80 }, // the line's centre
    { x: 5, y: 150 }, // empty paper
  ]);

  // A shape is committed content, not a live stroke.
  expect(verdict.liveChecked).toBe(false);
  // The rebuilt layer and the export are the same picture, which is the
  // invariant that makes an exported shape trustworthy.
  expect(verdict.rebuiltEqualsExported).toBe(true);

  // Each interior takes its own brush colour; the outline does not leak into
  // the middle of a filled primitive.
  expectChannel(samples[0]?.[0], 250, 255);
  expectChannel(samples[0]?.[1], 0, 5);
  expectChannel(samples[1]?.[2], 250, 255);
  expectChannel(samples[1]?.[0], 0, 5);
  expectChannel(samples[2]?.[1], 124, 132);
  expectChannel(samples[2]?.[0], 0, 5);
  expect(samples[3]).toEqual([0, 0, 0, 255]);
  expectChannel(samples[4]?.[0], 0, 8);
  expectChannel(samples[4]?.[1], 0, 8);
  expectChannel(samples[4]?.[2], 0, 8);
  expect(samples[5]).toEqual([255, 255, 255, 255]);
});

test("a rotated box is turned rigidly, not stretched into its bounding box", async ({
  page,
}) => {
  const scene = loadScene("shape-rotation.json");
  const { verdict, samples } = await renderScene(page, scene, [
    { x: 70, y: 10 }, // inside the turned outline, above the upright box
    { x: 30, y: 40 }, // inside the upright box, left of the turned one
  ]);

  expect(verdict.rebuiltEqualsExported).toBe(true);

  expectChannel(samples[0]?.[0], 250, 255);
  expectChannel(samples[0]?.[1], 0, 5);
  expect(samples[1]).toEqual([255, 255, 255, 255]);
});
