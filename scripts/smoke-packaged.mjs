/**
 * Smoke-test the packaged Windows application.
 *
 * The installed build is a Tauri window around the same WebView2 bundle the
 * browser tests run, so the only honest way to check it is to drive the real
 * window. WebView2 exposes the Chrome DevTools protocol when it is started
 * with `--remote-debugging-port`, and Playwright can attach to it.
 *
 * Usage (the caller owns the process and sets the environment):
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   Start-Process src-tauri/target/release/paka.exe
 *   node scripts/smoke-packaged.mjs
 *
 * It asserts the redesign in the packaged shell (two fixed top rows, the dock
 * tabs, a layers body with room, no page overflow), draws a stroke with the
 * real pointer path and undoes it, and writes a screenshot.
 */

import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const outDir = process.argv[2] ?? "docs/qa/ui-redesign/packaged";
await mkdir(outDir, { recursive: true });

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const contexts = browser.contexts();
const pages = contexts.flatMap((context) => context.pages());
const page = pages.find((candidate) => !candidate.url().startsWith("devtools://"));
if (!page) {
  throw new Error(`no application page among: ${pages.map((p) => p.url()).join(", ")}`);
}

const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.locator(".app-shell").waitFor();
await page.locator("canvas.canvas-stage__surface").waitFor();
await page.waitForTimeout(700);

const shell = await page.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      bottom: Math.round(rect.bottom),
    };
  };
  const scrolling = document.scrollingElement ?? document.documentElement;
  return {
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    overflow: scrolling.scrollHeight - window.innerHeight,
    optionsBar: box(".tool-options-bar"),
    documentBar: box(".toolbar"),
    dock: box(".panel-dock"),
    layers: box(".side-panels__layers"),
    layersBody: document.querySelector(".side-panels__layers .panel__body")?.clientHeight ?? 0,
    tabs: [...document.querySelectorAll(".panel-dock__tab")].map((tab) =>
      tab.getAttribute("aria-label"),
    ),
    statusBar: box(".status-bar"),
    activeTab: document.querySelector(".panel-dock__tab.is-active")?.getAttribute("aria-label"),
  };
});

if (!shell.optionsBar || shell.optionsBar.height !== 38) {
  throw new Error(`the options bar is ${JSON.stringify(shell.optionsBar)}`);
}
if (!shell.documentBar || shell.documentBar.height !== 34) {
  throw new Error(`the document bar is ${JSON.stringify(shell.documentBar)}`);
}
if (shell.overflow > 1) {
  throw new Error(`the packaged page scrolls by ${shell.overflow} px`);
}
if (!shell.layers || shell.layers.height < 150 || shell.layersBody < 60) {
  throw new Error(`the layers list is ${JSON.stringify(shell.layers)} (body ${shell.layersBody})`);
}
if (shell.tabs.length < 4) {
  throw new Error(`the dock has ${shell.tabs.length} tabs: ${shell.tabs.join(", ")}`);
}

// Draw a stroke through the real pointer path, then undo it.
const canvas = await page.locator("canvas.canvas-stage__surface").boundingBox();
if (!canvas) {
  throw new Error("the canvas has no box");
}
const start = { x: canvas.x + canvas.width * 0.4, y: canvas.y + canvas.height * 0.4 };
const end = { x: canvas.x + canvas.width * 0.6, y: canvas.y + canvas.height * 0.6 };
const undo = page.locator(".toolbar").getByRole("button", { name: "Undo" });
await page.mouse.move(start.x, start.y);
await page.mouse.down();
for (let step = 1; step <= 12; step += 1) {
  await page.mouse.move(
    start.x + ((end.x - start.x) * step) / 12,
    start.y + ((end.y - start.y) * step) / 12,
  );
}
await page.mouse.up();
await page.waitForTimeout(250);
const undoEnabled = await undo.isEnabled();
if (!undoEnabled) {
  throw new Error("the stroke did not reach the history");
}
await undo.click();
await page.waitForTimeout(150);
if (await undo.isEnabled()) {
  throw new Error("undo did not consume the stroke");
}

// Switch a dock tab in the packaged shell.
await page.getByRole("tab", { name: "Brushes" }).click();
await page.waitForTimeout(250);
const brushRows = await page
  .locator(".panel-dock__panel:not([hidden]) .brush-row")
  .count();
if (brushRows === 0) {
  throw new Error("the brushes tab shows no presets");
}

await page.screenshot({ path: `${outDir}/paka-window.png` });
await browser.close();

console.log(
  JSON.stringify(
    {
      ...shell,
      undoEnabledAfterStroke: undoEnabled,
      brushRows,
      errors,
    },
    null,
    2,
  ),
);
if (errors.length > 0) {
  throw new Error(`console errors: ${errors.join(" | ")}`);
}
