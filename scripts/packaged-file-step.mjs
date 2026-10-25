/**
 * One step of the packaged-app file smoke test.
 *
 * The app's save, open and export all go through native Win32 dialogs, which
 * the DevTools protocol cannot address. This script therefore drives only the
 * WebView: it draws, presses a file chord, opens the File menu and reads the
 * facts the app reports through its status bar. The caller handles the native
 * dialog separately - see docs/qa/feature-wave/REPORT.md for what was and was
 * not exercised.
 *
 * Each run attaches to the already-running packaged application over WebView2's
 * DevTools protocol, performs one step and exits. Nothing here is imported by
 * the product.
 *
 *   node scripts/packaged-file-step.mjs draw
 *   node scripts/packaged-file-step.mjs save      (native dialog follows)
 *   node scripts/packaged-file-step.mjs open      (native dialog follows)
 *   node scripts/packaged-file-step.mjs export    (native dialog follows)
 *   node scripts/packaged-file-step.mjs state
 *   node scripts/packaged-file-step.mjs project <path>
 */

import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const [action, argument] = process.argv.slice(2);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => !candidate.url().startsWith("devtools://"));
if (!page) {
  throw new Error(`no application page among: ${pages.map((entry) => entry.url()).join(", ")}`);
}

const canvas = page.locator("canvas.canvas-stage__surface");
await canvas.waitFor();
const box = await canvas.boundingBox();
if (!box) {
  throw new Error("the canvas has no box");
}

/** Draws two separate strokes through the real pointer path. */
async function draw() {
  for (const offset of [0, 90]) {
    const x = box.x + box.width * 0.32;
    const y = box.y + box.height * 0.35 + offset;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 20, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
}

switch (action) {
  case "draw": {
    await draw();
    console.log(await status());
    break;
  }
  case "save": {
    await page.keyboard.press("Control+s");
    break;
  }
  case "open": {
    await page.keyboard.press("Control+o");
    break;
  }
  case "export": {
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /Export PNG/ }).click();
    break;
  }
  case "state": {
    console.log(await status());
    break;
  }
  case "project": {
    const raw = await readFile(argument, "utf8");
    const project = JSON.parse(raw);
    const layers = Array.isArray(project.layers) ? project.layers : [];
    const elements = layers.flatMap((layer) =>
      Array.isArray(layer.elements) ? layer.elements : [],
    );
    console.log(
      JSON.stringify(
        {
          format: project.format,
          version: project.version,
          document: project.document
            ? { width: project.document.width, height: project.document.height }
            : null,
          layers: layers.length,
          elements: elements.length,
          strokes: elements.filter((element) => element.kind === "stroke").length,
        },
        null,
        2,
      ),
    );
    break;
  }
  default:
    throw new Error(`unknown step: ${action}`);
}

/** The facts the app itself reports through its status bar. */
async function status() {
  return page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const items = [...document.querySelectorAll(".status-bar__item")].map((item) =>
      item.textContent?.trim(),
    );
    return {
      statusBar: text(".status-bar"),
      items,
      documentName: text(".status-bar__item"),
      title: document.title,
    };
  });
}

await browser.close();
