/**
 * Capture the running application at a fixed set of window sizes.
 *
 * The UI-regression suite asserts behaviour; this script produces the
 * before/after pictures and the raw layout numbers that go beside them, from
 * the same browser build the visual suite uses.
 *
 * Usage:
 *   node scripts/ui-screenshots.mjs <url> <outDir>
 *
 * It writes `<outDir>/<width>x<height>.png` and `<outDir>/layout.json`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:1422/";
const outDir = process.argv[3] ?? "docs/qa/ui-redesign/shots";

/** The sizes the brief names, plus the default window. */
const SIZES = [
  { width: 1440, height: 900, label: "1440x900" },
  { width: 1366, height: 768, label: "1366x768" },
  { width: 1180, height: 800, label: "1180x800" },
  { width: 1024, height: 768, label: "1024x768" },
  { width: 960, height: 600, label: "960x600" },
  { width: 900, height: 700, label: "900x700" },
  { width: 820, height: 700, label: "820x700" },
  { width: 700, height: 640, label: "700x640" },
];

/** Measures the shell: overflow, panel boxes and clipped controls. */
const MEASURE = () => {
  const rect = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
      bottom: Math.round(box.bottom),
      right: Math.round(box.right),
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
    };
  };
  const panels = [...document.querySelectorAll(".panel")]
    .map((panel) => {
      const header = panel.querySelector(".panel__header");
      const body = panel.querySelector(".panel__body");
      const box = panel.getBoundingClientRect();
      return {
        title: panel.querySelector(".panel__title")?.textContent ?? "",
        width: Math.round(box.width),
        height: Math.round(box.height),
        bottom: Math.round(box.bottom),
        headerVisible: header ? header.getBoundingClientRect().height > 0 : false,
        bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : 0,
      };
    })
    // A tab that is not on top is mounted but hidden: it has no box.
    .filter((panel) => panel.height > 0);
  // Every control that ought to be usable: a control whose box is outside the
  // window is only a fault when no ancestor can scroll it into view.
  const controls = [...document.querySelectorAll("button, input, select")];
  const clipped = controls
    .filter((control) => {
      const box = control.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return false;
      const inside =
        box.right <= window.innerWidth + 1 &&
        box.bottom <= window.innerHeight + 1 &&
        box.left >= -1 &&
        box.top >= -1;
      if (inside) return false;
      let node = control.parentElement;
      while (node) {
        const style = getComputedStyle(node);
        const scrollsX =
          /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
        const scrollsY =
          /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
        if (scrollsX || scrollsY) return false;
        node = node.parentElement;
      }
      return true;
    })
    .map((control) => {
      const box = control.getBoundingClientRect();
      return {
        tag: control.tagName.toLowerCase(),
        label:
          control.getAttribute("aria-label") ??
          control.textContent?.trim().slice(0, 40) ??
          "",
        x: Math.round(box.x),
        y: Math.round(box.y),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
      };
    });
  const scrolling = document.scrollingElement ?? document.documentElement;
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentHeight: scrolling.scrollHeight,
    overflowY: scrolling.scrollHeight - window.innerHeight,
    appShell: rect(".app-shell"),
    toolbar: rect(".toolbar"),
    toolOptions: rect(".tool-options-bar"),
    workspace: rect(".workspace-body"),
    sidePanels: rect(".side-panels"),
    toolRail: rect(".tool-rail"),
    canvas: rect(".canvas-stage"),
    statusBar: rect(".status-bar"),
    panels,
    clipped,
  };
};

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const results = {};
try {
  for (const size of SIZES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.locator(".app-shell").waitFor();
    // Let the canvas resize observer settle before measuring.
    await page.waitForTimeout(400);
    const layout = await page.evaluate(MEASURE);
    layout.errors = errors;
    results[size.label] = layout;
    await page.screenshot({ path: `${outDir}/${size.label}.png` });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(`${outDir}/layout.json`, JSON.stringify(results, null, 2), "utf8");

for (const [label, layout] of Object.entries(results)) {
  const dock = layout.sidePanels;
  console.log(
    `${label}: overflow ${layout.overflowY}px, toolbar ${layout.toolbar?.height ?? 0}px, ` +
      `side ${dock?.width ?? 0}x${dock?.height ?? 0}, panels ${layout.panels
        .map((panel) => `${panel.title || "?"} ${panel.height}px`)
        .join(", ")}, clipped ${layout.clipped.length}, errors ${layout.errors.length}`,
  );
}
