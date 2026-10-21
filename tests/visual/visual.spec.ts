import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scene, SceneVerdict } from "./scene";

/**
 * The visual-regression suite.
 *
 * Two kinds of check live here:
 *
 *  1. **the product's own invariant**, checked in a real browser: for every
 *     scene, the live drawing, the rebuilt layer and the exported composite
 *     must agree. This is the check the repository's software pixel canvas
 *     cannot make, because it has neither antialiasing nor blur.
 *  2. **the harness's own rules**, so the suite cannot rot into a
 *     brush-specific test in disguise: the corpus is data, the harness
 *     reaches the product only through its renderer boundary, and the corpus
 *     holds no text.
 *
 * The spec never imports the page's module: `scene.ts` carries the types
 * both halves share, so pulling `harness.ts` into Node would drag the app's
 * absolute `/src/...` imports with it.
 */
const here = dirname(fileURLToPath(import.meta.url));
const scenesDirectory = join(here, "scenes");

/** The module the app's rasterization lives in, and the ones next to it. */
const FORBIDDEN_IMPORTS = ["stampCoverage", "canvas2dStroke", "strokeBuilder"];

/**
 * The only app modules the harness may import.
 *
 * The renderer and the scheduler are the boundary; the document model and the
 * brush defaults are configuration. The transform maps are here because a
 * scene may declare a scale and a rotation, and the picture the golden pins
 * has to be the picture the *product* draws - not a hand-written
 * approximation of it. They are geometry, not rasterization: they decide
 * where a sample lands, never how a pixel is made.
 */
const ALLOWED_APP_IMPORTS = [
  "/src/core/rendering/Canvas2DRenderer",
  "/src/core/rendering/frameScheduler",
  "/src/core/rendering/types",
  "/src/core/document/document",
  "/src/core/document/selectionTransform",
  "/src/core/document/types",
  "/src/core/brushes/defaults",
  "/src/types/brush",
];

function loadScenes(): Scene[] {
  return readdirSync(scenesDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(scenesDirectory, name), "utf8")) as Scene);
}

const scenes = loadScenes();

declare global {
  interface Window {
    __pakaVisual?: {
      run(
        scene: Scene,
        golden?: HTMLCanvasElement,
        displayCanvas?: HTMLCanvasElement,
      ): SceneVerdict;
    };
  }
}

test.describe("the harness's own rules", () => {
  test("the corpus is not empty", () => {
    expect(scenes.length).toBeGreaterThan(0);
  });

  test("the harness imports no rasterization internal", () => {
    const sources = ["harness.ts", "scene.ts"]
      .map((name) => readFileSync(join(here, name), "utf8"))
      .join("\n");
    for (const forbidden of FORBIDDEN_IMPORTS) {
      expect(
        sources.includes(forbidden),
        `the harness must not mention ${forbidden}`,
      ).toBe(false);
    }
  });

  test("the harness reaches the product only through its renderer boundary", () => {
    const source = readFileSync(join(here, "harness.ts"), "utf8");
    const imported = [...source.matchAll(/from "(\/src\/[^"]+)"/g)].map((match) => match[1]);
    expect(imported.length).toBeGreaterThan(0);
    for (const specifier of imported) {
      expect(ALLOWED_APP_IMPORTS, `the harness may not import ${specifier}`).toContain(
        specifier,
      );
    }
  });

  test("the corpus holds no text scene", () => {
    for (const name of readdirSync(scenesDirectory)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const source = readFileSync(join(scenesDirectory, name), "utf8");
      expect(
        /"kind"\s*:\s*"text"/.test(source),
        `${name} must not hold a text scene: font identity is still open (D-1)`,
      ).toBe(false);
    }
  });
});

test.describe("Paka visual regression", () => {
  for (const scene of scenes) {
    test(`scene ${scene.id}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto("/tests/visual/harness.html");

      const verdict = await page.evaluate((input) => {
        const api = window.__pakaVisual;
        if (!api) {
          throw new Error("the harness did not mount");
        }
        return api.run(
          input,
          document.getElementById("golden") as HTMLCanvasElement,
          document.getElementById("display") as HTMLCanvasElement,
        );
      }, scene);

      expect(errors, "the harness page must not raise").toEqual([]);

      // The product's invariant, in a real browser.
      expect(
        verdict.liveEqualsRebuilt,
        `live and rebuilt differ in ${verdict.liveVsRebuiltDiffering} pixel(s)` +
          (verdict.firstDifference
            ? `, first at (${verdict.firstDifference.x}, ${verdict.firstDifference.y})`
            : ""),
      ).toBe(true);
      expect(
        verdict.rebuiltEqualsExported,
        `rebuilt and exported differ in ${verdict.rebuiltVsExportedDiffering} pixel(s)`,
      ).toBe(true);

      // The guides are display-only: they change the display and never the
      // export.
      expect(
        verdict.guidesVisible,
        `the guides of scene ${scene.id} are not visible on the display`,
      ).toBe((scene.guides?.length ?? 0) > 0);
      expect(
        verdict.guidesNotExported,
        `the guides of scene ${scene.id} reached the exported composite`,
      ).toBe(true);

      // The golden is the exported picture: the thing a PNG export writes.
      await expect(page.locator("#golden")).toHaveScreenshot({ name: `${scene.id}.png` });

      // A scene with guides is also captured from the display, because that is
      // the only place they can be seen.
      if ((scene.guides?.length ?? 0) > 0) {
        await expect(page.locator("#display")).toHaveScreenshot({
          name: `${scene.id}-display.png`,
        });
      }
    });
  }
});
