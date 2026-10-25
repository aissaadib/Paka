/**
 * Smoke-test the reference-image workflow in the packaged Windows application.
 *
 * The unit suites and the visual harness prove the rules and the pixels; this
 * script proves the part only the real window can: that the packaged WebView
 * imports a picture through its own file input, that the reference appears on
 * the canvas, that a drag moves it, that one undo puts the picture back, and
 * that hiding, rotating and removing it are the engine's steps rather than a
 * panel-local illusion.
 *
 * Usage (the caller owns the process and sets the environment):
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   Start-Process src-tauri/target/release/paka.exe
 *   node scripts/packaged-reference-step.mjs docs/qa/reference-images-wave/packaged
 *
 * The native open/save/export dialogs are Win32 windows the DevTools protocol
 * cannot address, so this script never presses a file chord and never leaves a
 * modal dialog on the desktop. Save/reopen and export isolation are covered by
 * `referenceManipulation.test.ts`, `referenceFormat.test.ts` and the visual
 * harness's `references` scene; see the report for the boundary.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const outDir = process.argv[2] ?? "docs/qa/reference-images-wave/packaged";
await mkdir(outDir, { recursive: true });

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => !candidate.url().startsWith("devtools://"));
if (!page) {
  throw new Error(`no application page among: ${pages.map((entry) => entry.url()).join(", ")}`);
}

const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

const results = {};
const canvas = page.locator("canvas.canvas-stage__surface");
await page.locator(".app-shell").waitFor();
await canvas.waitFor();
await page.waitForTimeout(700);

/** Waits for the renderer to have painted, then captures the canvas. */
async function settle() {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
      ),
  );
  await page.waitForTimeout(180);
}

async function capture(label) {
  await settle();
  return canvas.screenshot({ path: join(outDir, `${label}.png`) });
}

function same(a, b) {
  return a.equals(b);
}

const rows = page.locator(".reference-panel__row");

// 1. The panel is in the dock, and it is empty on a fresh document.
await page.getByRole("tab", { name: "References" }).click();
await page.locator(".reference-panel").waitFor();
await page.locator(".reference-panel__empty").waitFor();
results.tabs = await page
  .getByRole("tablist", { name: "Panels" })
  .getByRole("tab")
  .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label")));

const emptyArtwork = await capture("00-empty");

// 2. The fixture is a real PNG built by the packaged WebView itself, so the
//    import path decodes genuine bytes rather than a hand-written header.
const fixtureBase64 = await page.evaluate(() => {
  const surface = document.createElement("canvas");
  surface.width = 320;
  surface.height = 200;
  const context = surface.getContext("2d");
  if (!context) {
    throw new Error("no 2d context for the fixture");
  }
  context.fillStyle = "#2f6fd0";
  context.fillRect(0, 0, 320, 200);
  context.fillStyle = "#9cc8ff";
  context.fillRect(0, 0, 160, 200);
  context.strokeStyle = "#101418";
  context.lineWidth = 10;
  context.strokeRect(20, 20, 280, 160);
  return surface.toDataURL("image/png").split(",")[1];
});
const fixturePath = join(outDir, "reference-fixture.png");
await writeFile(fixturePath, Buffer.from(fixtureBase64, "base64"));

await page.locator('[data-testid="reference-file-input"]').setInputFiles(fixturePath);
await rows.first().waitFor();
await settle();

results.rowCount = await rows.count();
results.name = (await rows.first().locator(".reference-panel__name").textContent())?.trim();
results.meta = (await rows.first().locator(".reference-panel__meta").textContent())?.trim();
results.importMessage = await page.locator(".reference-panel__message").count();
results.dirty = (await page.locator(".status-bar__dirty").count()) === 1;
results.undoEnabledAfterImport = await page
  .locator(".toolbar")
  .getByRole("button", { name: "Undo" })
  .isEnabled();
// The import hands the tool over, so the user can move what they just placed.
results.activeTool = await page
  .locator(".tool-rail .icon-button.is-active")
  .first()
  .getAttribute("aria-label");

const imported = await capture("01-imported");

// 3. A drag from the middle of the paper moves the reference.
const box = await canvas.boundingBox();
if (!box) {
  throw new Error("the canvas has no box");
}
const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
await page.mouse.move(centre.x, centre.y);
await page.mouse.down();
await page.mouse.move(centre.x + 40, centre.y + 24, { steps: 10 });
await page.mouse.up();
await settle();
const moved = await capture("02-moved");
results.moveChangedPixels = !same(imported, moved);

// 4. One undo puts the picture back exactly: the gesture was one step.
await page.keyboard.press("Control+z");
await settle();
const undone = await capture("03-undone");
results.undoRestoredPixels = same(imported, undone);
results.undoEnabledAfterUndo = await page
  .locator(".toolbar")
  .getByRole("button", { name: "Undo" })
  .isEnabled();

// 5. Redo returns to the moved picture.
await page.keyboard.press("Control+Shift+z");
await settle();
const redone = await capture("04-redone");
results.redoRestoredPixels = same(moved, redone);

// 6. Hiding the reference removes it from the canvas without touching history
//    depth: visibility is a document edit, but the picture the user sees is the
//    proof that the toggle reaches the renderer.
const visibility = rows.first().locator(".reference-panel__visibility");
await visibility.click();
await settle();
const hidden = await capture("05-hidden");
results.hideChangedPixels = !same(redone, hidden);
results.hideMatchesEmptyArtwork = same(emptyArtwork, hidden);
await visibility.click();
await settle();
const shown = await capture("06-shown");
results.showRestoredPixels = same(redone, shown);

// 7. The rotation slider reaches the model and the canvas.
const rotation = page.locator('input[aria-label="Reference rotation"]');
await rotation.fill("30");
await settle();
results.rotationReadout = (
  await page.locator(".reference-panel__value").nth(1).textContent()
)?.trim();
const rotated = await capture("07-rotated");
results.rotationChangedPixels = !same(shown, rotated);

// 8. Removing the reference is one step, and undo brings it back.
await rows.first().locator(".reference-panel__remove").click();
await page.locator(".reference-panel__empty").waitFor();
await settle();
results.rowsAfterRemove = await rows.count();
await page.keyboard.press("Control+z");
await rows.first().waitFor();
await settle();
results.rowsAfterUndoRemove = await rows.count();
// The removal dropped the selection; reselect so the handles match the state
// just before the removal.
await rows.first().locator(".reference-panel__pick").click();
await settle();
const restored = await capture("08-restored");
results.removeUndoRestoredPixels = same(rotated, restored);

// 9. The status bar still reports the document as unsaved, because nothing was
//    written: a reference is an edit, and an edit is a dirty document.
results.dirtyAtEnd = (await page.locator(".status-bar__dirty").count()) === 1;
results.zoom = (
  await page.locator(".status-bar__item").filter({ hasText: "zoom" }).textContent()
)?.trim();

await page.screenshot({ path: join(outDir, "paka-window.png") });
await browser.close();

const log = { ...results, errors };
await writeFile(join(outDir, "packaged-reference-smoke.json"), `${JSON.stringify(log, null, 2)}\n`);
console.log(JSON.stringify(log, null, 2));

const failures = [];
if (results.rowCount !== 1) failures.push(`the panel shows ${results.rowCount} rows`);
if (results.importMessage !== 0) failures.push("the import reported a message");
if (!results.dirty) failures.push("the import did not mark the document unsaved");
if (!results.undoEnabledAfterImport) failures.push("the import is not in the history");
if (!results.moveChangedPixels) failures.push("the drag did not move the reference");
if (!results.undoRestoredPixels) failures.push("undo did not restore the imported picture");
if (!results.redoRestoredPixels) failures.push("redo did not restore the moved picture");
if (!results.hideChangedPixels) failures.push("hiding the reference changed nothing");
if (!results.hideMatchesEmptyArtwork)
  failures.push("the hidden reference left something on the canvas");
if (!results.showRestoredPixels) failures.push("showing the reference again changed the picture");
if (!results.rotationChangedPixels) failures.push("the rotation slider changed nothing");
if (results.rowsAfterRemove !== 0) failures.push("the remove left a row");
if (results.rowsAfterUndoRemove !== 1) failures.push("undo did not bring the reference back");
if (!results.removeUndoRestoredPixels) failures.push("the restored picture differs from the import");
if (!results.dirtyAtEnd) failures.push("the document is not marked unsaved at the end");
if (errors.length > 0) failures.push(`console errors: ${errors.join(" | ")}`);

if (failures.length > 0) {
  throw new Error(failures.join("; "));
}
