/**
 * Smoke-test the editable-shape workflow in the packaged Windows application.
 *
 * The unit suites and the visual harness prove the rules and the pixels; this
 * script proves the part only the real window can:
 *
 *  - every shape tool creates the expected native object through the packaged
 *    WebView, with the fill option and the modifiers the editor really uses;
 *  - Escape discards an unreleased outline and leaves no history behind;
 *  - a committed shape is selectable, movable, resizable, rotatable and
 *    deletable, each gesture one history step with exact undo and redo;
 *  - the shape-editing options edit the real record, and only the fields that
 *    apply to the selected primitive are shown;
 *  - save and reopen go through the packaged Rust file commands and preserve
 *    the shape's identity and geometry;
 *  - a v14 file full of baked strokes still opens, is not converted, and is
 *    not selectable as a shape;
 *  - a PNG export contains the artwork and neither the selection overlay nor
 *    a reference image.
 *
 * Usage (the caller owns the process and sets the environment):
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   Start-Process src-tauri/target/release/paka.exe
 *   node scripts/packaged-shapes-step.mjs docs/qa/editable-shapes-wave/packaged
 *
 * The native open/save dialogs are Win32 windows the DevTools protocol cannot
 * address, so this script answers *only* the two dialog commands
 * (`plugin:dialog|save` / `plugin:dialog|open`) with fixed paths, at the IPC
 * fetch layer. Every byte still travels through the packaged Tauri commands and
 * the real serializer, and the files are inspected on disk.
 *
 * Screenshots are read from the canvas inside the page (`toDataURL`). An
 * element screenshot is not used: the browser dispatches pointer events while
 * taking one, which cancels an in-flight shape gesture and would hide the very
 * preview this script has to observe.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const outDir = resolve(process.argv[2] ?? "docs/qa/editable-shapes-wave/packaged");
await mkdir(outDir, { recursive: true });

const projectPath = join(outDir, "shapes-smoke.paka");
const legacyPath = join(outDir, "legacy-v14.paka");
const exportPath = join(outDir, "shapes-export.png");
const exportNoSelectionPath = join(outDir, "shapes-export-no-selection.png");
const referencePath = join(outDir, "reference-fixture.png");

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
const failures = [];
function check(name, condition, detail) {
  results[name] = condition;
  if (!condition) {
    failures.push(detail ?? name);
  }
}

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

/**
 * Captures the canvas by reading its backing store in the page.
 *
 * `locator.screenshot()` is not used: taking an element screenshot makes the
 * browser dispatch pointer events (and a pointer-leave), which cancels an
 * in-flight shape gesture. `toDataURL` reads the same pixels without touching
 * the input state, so a mid-drag capture is safe.
 */
async function capture(label) {
  await settle();
  const dataUrl = await page.evaluate(() => {
    const surface = document.querySelector("canvas.canvas-stage__surface");
    return surface instanceof HTMLCanvasElement ? surface.toDataURL("image/png") : null;
  });
  if (dataUrl === null) {
    throw new Error("the stage has no canvas surface");
  }
  await writeFile(join(outDir, `${label}.png`), dataUrlToBuffer(dataUrl));
  return dataUrl;
}

function dataUrlToBuffer(dataUrl) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

function same(a, b) {
  return a === b;
}

/**
 * Counts the paper pixels that are not the document's white background.
 *
 * Used to prove that hiding the layer leaves an empty page. The paper's rounded
 * corners are anti-aliased against the workspace and can shift by a fraction of
 * a device pixel between frames, so a few pixels at the paper edge are ignored;
 * artwork never lives there.
 */
function paperInk(dataUrl) {
  const image = decodePng(dataUrlToBuffer(dataUrl));
  const scaleX = image.width / box.width;
  const scaleY = image.height / box.height;
  const left = Math.round((origin.x - box.x) * scaleX);
  const top = Math.round((origin.y - box.y) * scaleY);
  const right = Math.round((origin.x - box.x + 1600 * zoom) * scaleX);
  const bottom = Math.round((origin.y - box.y + 1200 * zoom) * scaleY);
  const inset = 4;
  let ink = 0;
  for (let y = top + inset; y < bottom - inset; y += 1) {
    for (let x = left + inset; x < right - inset; x += 1) {
      const index = (y * image.width + x) * image.channels;
      if (
        image.pixels[index] !== 255 ||
        image.pixels[index + 1] !== 255 ||
        image.pixels[index + 2] !== 255
      ) {
        ink += 1;
      }
    }
  }
  return { ink, left, top, right, bottom };
}

async function blur() {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  });
}

/** The tool the options bar is describing; the rail's group slot is not enough. */
async function useTool(key, name) {
  await blur();
  await page.keyboard.press(key);
  await page.waitForFunction((expected) => {
    const node = document.querySelector(".tool-options-bar__tool-name");
    return node?.textContent?.trim() === expected;
  }, name);
}

async function statusItem(prefix) {
  return page.evaluate((p) => {
    const items = [...document.querySelectorAll(".status-bar__item")];
    const found = items.find((item) => (item.textContent ?? "").trim().startsWith(p));
    return found ? found.textContent.trim() : null;
  }, prefix);
}

async function historyDepth() {
  const text = await statusItem("history");
  return text === null ? null : Number(text.split(/\s+/)[1]);
}

async function fileMessage() {
  return page.evaluate(() => {
    const node = document.querySelector(".status-bar__message");
    if (!node) {
      return null;
    }
    const clone = node.cloneNode(true);
    if (clone instanceof Element) {
      clone.querySelector(".status-bar__dismiss")?.remove();
    }
    return (clone.textContent ?? "").trim();
  });
}

async function waitForMessage(pattern) {
  await page.waitForFunction(
    (source) => {
      const node = document.querySelector(".status-bar__message");
      return node !== null && new RegExp(source).test((node.textContent ?? "").trim());
    },
    pattern.source,
  );
}

/** Every input label the options bar currently shows, deduplicated. */
async function visibleFields() {
  return page.evaluate(() => {
    const bar = document.querySelector(".tool-options-bar");
    if (!bar) {
      return [];
    }
    const labels = [...bar.querySelectorAll("input")].map((input) => {
      const aria = input.getAttribute("aria-label");
      if (aria) {
        return aria.replace(/ \(exact value\)$/, "");
      }
      return (input.closest("label")?.textContent ?? "").trim();
    });
    return [...new Set(labels)];
  });
}

async function exactValue(label) {
  const text = await page
    .locator(".tool-options-bar")
    .locator(`input[aria-label="${label} (exact value)"]`)
    .inputValue();
  return Number(text);
}

async function setExact(label, value) {
  await page
    .locator(".tool-options-bar")
    .locator(`input[aria-label="${label} (exact value)"]`)
    .fill(String(value));
  await blur();
  await settle();
}

async function setNumber(label, value) {
  await page
    .locator(".tool-options-bar")
    .locator(`input[aria-label="${label}"]`)
    .fill(String(value));
  await blur();
  await settle();
}

async function setColor(label, value) {
  await page
    .locator(".tool-options-bar")
    .locator(`input[aria-label="${label}"]`)
    .evaluate((element, next) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(element, next);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  await blur();
  await settle();
}

async function colorValue(label) {
  return page
    .locator(".tool-options-bar")
    .locator(`input[aria-label="${label}"]`)
    .inputValue();
}

async function numberValue(label) {
  const text = await page
    .locator(".tool-options-bar")
    .locator(`input[aria-label="${label}"]`)
    .inputValue();
  return Number(text.trim());
}

// The viewport mapping after Fit to Window. The engine fits the 1600x1200
// document into the stage with 32 px padding and centres it, so the mapping is
// exact and no wheel zoom is involved.
await blur();
await page.keyboard.press("Control+0");
await settle();
const stage = page.locator(".canvas-stage");
const box = await stage.boundingBox();
if (!box) {
  throw new Error("the canvas stage has no box");
}
const zoom = Math.min((box.width - 64) / 1600, (box.height - 64) / 1200);
const origin = {
  x: box.x + (box.width - 1600 * zoom) / 2,
  y: box.y + (box.height - 1200 * zoom) / 2,
};
function toScreen(x, y) {
  return { x: origin.x + x * zoom, y: origin.y + y * zoom };
}

async function drag(from, to, { steps = 14, shift = false } = {}) {
  const start = toScreen(from[0], from[1]);
  const end = toScreen(to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  if (shift) {
    await page.keyboard.down("Shift");
  }
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  if (shift) {
    await page.keyboard.up("Shift");
  }
  await settle();
}

async function clickDoc(x, y) {
  const point = toScreen(x, y);
  await page.mouse.click(point.x, point.y);
  await settle();
}

// Only the two native pickers are answered here; every other command still
// travels through the packaged IPC and the Rust handler. The window's
// `__TAURI_INTERNALS__.invoke` is non-writable, so the interception happens one
// level lower: the IPC transport is a fetch to `http://ipc.localhost/<command>`,
// and a routed response with `Tauri-Response: ok` resolves the invoke with the
// JSON body.
let dialogSavePath = null;
let dialogOpenPath = null;
const DIALOG_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "Tauri-Response, content-type",
};
await page.route("http://ipc.localhost/**", async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: DIALOG_CORS });
    return;
  }
  const command = decodeURIComponent(request.url().replace("http://ipc.localhost/", ""));
  if (command === "plugin:dialog|save" || command === "plugin:dialog|open") {
    await route.fulfill({
      status: 200,
      headers: { ...DIALOG_CORS, "content-type": "application/json", "Tauri-Response": "ok" },
      body: JSON.stringify(command === "plugin:dialog|save" ? dialogSavePath : dialogOpenPath),
    });
    return;
  }
  await route.continue();
});

function stubSave(path) {
  dialogSavePath = path;
}

function stubOpen(path) {
  dialogOpenPath = path;
}

results.zoomReadout = await statusItem("zoom");
results.zoomExpectedPercent = Math.round(zoom * 100);
check(
  "fitZoomAgrees",
  results.zoomReadout === `zoom ${results.zoomExpectedPercent}%`,
  `the fit zoom reads ${results.zoomReadout}, expected ${results.zoomExpectedPercent}%`,
);

// ---------------------------------------------------------------- fresh state
results.historyAtStart = await historyDepth();
results.dirtyAtStart = (await page.locator(".status-bar__dirty").count()) === 1;
const emptyArtwork = await capture("00-empty");
results.emptyPaper = paperInk(emptyArtwork);
check("freshHistoryEmpty", results.historyAtStart === 0, `history is ${results.historyAtStart}`);
check("freshDocumentClean", !results.dirtyAtStart, "a fresh document is marked unsaved");
check(
  "emptyPaperIsBlank",
  results.emptyPaper.ink === 0,
  `the fresh paper already has ${results.emptyPaper.ink} non-white pixels`,
);

// A known brush colour, so the export's palette check is meaningful even if a
// previous session stored a different one.
await page.getByRole("tab", { name: "Color" }).click();
const colourInput = page.locator('input[aria-label="Colour value"]');
await colourInput.waitFor();
await colourInput.fill("#000000");
await colourInput.press("Enter");
await blur();
await settle();

// --------------------------------------------------------------- create shapes
// Fill is editor state shared by the shape tools; turning it on with the
// rectangle tool applies to the ellipse, polygon and star too.
await useTool("r", "Rectangle");
const fillShape = page.locator(".tool-options-bar").getByRole("checkbox", { name: "Fill shape" });
await fillShape.waitFor();
if (!(await fillShape.isChecked())) {
  await fillShape.click();
}
await settle();
results.fillShapeOn = await fillShape.isChecked();

const created = [];
async function createShape(key, name, from, to) {
  await useTool(key, name);
  const before = await capture(`create-${name.toLowerCase()}-before`);
  await drag(from, to);
  const after = await capture(`create-${name.toLowerCase()}-after`);
  created.push({ name, changed: !same(before, after), history: await historyDepth() });
  return after;
}

// Line first, so the saved order is line, rectangle, ellipse, polygon, star.
const afterLine = await createShape("l", "Line", [100, 100], [300, 180]);
const afterRectangle = await createShape("r", "Rectangle", [400, 100], [620, 220]);
await createShape("o", "Ellipse", [700, 100], [900, 240]);
await createShape("p", "Polygon", [100, 320], [300, 480]);
const afterStar = await createShape("s", "Star", [400, 320], [620, 500]);

results.created = created;
results.historyAfterCreations = await historyDepth();
results.dirtyAfterCreations = (await page.locator(".status-bar__dirty").count()) === 1;
check(
  "everyCreationChangedTheCanvas",
  created.every((entry) => entry.changed),
  "a shape tool committed nothing visible",
);
check(
  "eachCreationIsOneStep",
  created.every((entry, index) => entry.history === index + 1),
  `creation history is ${JSON.stringify(created.map((entry) => entry.history))}`,
);
check("historyAfterCreations", results.historyAfterCreations === 5, `history is ${results.historyAfterCreations}`);
check("dirtyAfterCreations", results.dirtyAfterCreations, "creating a shape did not dirty the document");
results.lineFirst = !same(afterLine, afterStar);
check("lineDrawnFirst", results.lineFirst, "the line and the star render identically");

// ------------------------------------------- Escape cancels an unreleased shape
await useTool("r", "Rectangle");
const beforeEscape = await capture("01-before-escape");
const escapeStart = toScreen(700, 320);
await page.mouse.move(escapeStart.x, escapeStart.y);
await page.mouse.down();
await page.mouse.move(toScreen(860, 430).x, toScreen(860, 430).y, { steps: 10 });
await settle();
const duringEscape = await capture("02-preview-in-flight");
await page.keyboard.press("Escape");
await settle();
const afterEscape = await capture("03-after-escape");
await page.mouse.up();
await settle();
const afterEscapeRelease = await capture("04-after-escape-release");
results.previewDrew = !same(beforeEscape, duringEscape);
results.escapeDiscardedPreview = same(beforeEscape, afterEscape);
results.escapeReleaseCommittedNothing = same(beforeEscape, afterEscapeRelease);
results.historyAfterEscape = await historyDepth();
check("escapePreviewVisible", results.previewDrew, "the in-flight outline did not preview");
check("escapeDiscardsPreview", results.escapeDiscardedPreview, "Escape left the preview on the canvas");
check(
  "escapeReleaseCommitsNothing",
  results.escapeReleaseCommittedNothing,
  "the release after Escape committed the abandoned outline",
);
check("escapeAddsNoHistory", results.historyAfterEscape === 5, `history is ${results.historyAfterEscape}`);

// ------------------------------------------- select a shape and inspect options
await useTool("v", "Shape edit");
async function selectAt(label, x, y) {
  await clickDoc(x, y);
  // Every selected shape, the line included, offers the colour field. Nothing
  // selected shows the bar's hint instead, so this is the "a shape is selected"
  // signal.
  await page.locator('.tool-options-bar input[aria-label="Color"]').waitFor();
  const fields = await visibleFields();
  results[`fields-${label}`] = fields;
  return fields;
}

const rectangleFields = await selectAt("rectangle", 510, 160);
const ellipseFields = await selectAt("ellipse", 800, 170);
const polygonFields = await selectAt("polygon", 200, 400);
const starFields = await selectAt("star", 510, 410);
const lineFields = await selectAt("line", 200, 140);

function fieldSet(fields) {
  return [...fields].sort().join("|");
}
check(
  "rectangleFields",
  fieldSet(rectangleFields) === fieldSet(["Fill", "Rotation", "Width", "Height", "Color", "Stroke", "Opacity"]),
  `rectangle fields: ${rectangleFields.join(", ")}`,
);
check(
  "ellipseFields",
  fieldSet(ellipseFields) === fieldSet(["Fill", "Rotation", "Width", "Height", "Color", "Stroke", "Opacity"]),
  `ellipse fields: ${ellipseFields.join(", ")}`,
);
check(
  "polygonFields",
  fieldSet(polygonFields) === fieldSet(["Fill", "Sides", "Rotation", "Width", "Height", "Color", "Stroke", "Opacity"]),
  `polygon fields: ${polygonFields.join(", ")}`,
);
check(
  "starFields",
  fieldSet(starFields) === fieldSet(["Fill", "Points", "Inner radius", "Rotation", "Width", "Height", "Color", "Stroke", "Opacity"]),
  `star fields: ${starFields.join(", ")}`,
);
check(
  "lineFields",
  fieldSet(lineFields) === fieldSet(["Color", "Stroke", "Opacity"]),
  `line fields: ${lineFields.join(", ")}`,
);
results.historyAfterFieldChecks = await historyDepth();
check(
  "selectingIsNotAnEdit",
  results.historyAfterFieldChecks === 5,
  `selecting shapes changed the history to ${results.historyAfterFieldChecks}`,
);

// Selecting a shape never reorders the elements; the saved order is checked
// again after the round trip.

// ------------------------------------------------------- move, resize, rotate
const rectangleSelected = await selectAt("rectangle-again", 510, 160);
results.rectangleSelectionFields = rectangleSelected;
const beforeMove = await capture("05-rectangle-selected");
await drag([510, 160], [560, 200]);
const afterMove = await capture("06-moved");
results.historyAfterMove = await historyDepth();
results.moveChangedPixels = !same(beforeMove, afterMove);
check("moveChangedPixels", results.moveChangedPixels, "the move gesture changed nothing");
check("moveIsOneStep", results.historyAfterMove === 6, `history after move is ${results.historyAfterMove}`);
await page.keyboard.press("Control+z");
await settle();
const afterMoveUndo = await capture("07-move-undone");
results.moveUndoRestored = same(beforeMove, afterMoveUndo);
check("moveUndoRestored", results.moveUndoRestored, "undo did not restore the shape's position and overlay");
await page.keyboard.press("Control+Shift+z");
await settle();
const afterMoveRedo = await capture("08-move-redone");
results.moveRedoRestored = same(afterMove, afterMoveRedo);
check("moveRedoRestored", results.moveRedoRestored, "redo did not restore the move");

// The rectangle now sits at (450,140)-(670,260). Pull its south-east corner.
const beforeResize = await capture("09-before-resize");
await drag([670, 260], [720, 300]);
const afterResize = await capture("10-resized");
results.historyAfterResize = await historyDepth();
results.widthAfterResize = await numberValue("Width");
results.heightAfterResize = await numberValue("Height");
check("resizeChangedPixels", !same(beforeResize, afterResize), "the resize gesture changed nothing");
check("resizeIsOneStep", results.historyAfterResize === 7, `history after resize is ${results.historyAfterResize}`);
check(
  "resizeKeptPrimitiveSize",
  Math.abs(results.widthAfterResize - 270) < 1.5 && Math.abs(results.heightAfterResize - 160) < 1.5,
  `resize produced ${results.widthAfterResize}x${results.heightAfterResize}, expected 270x160`,
);
await page.keyboard.press("Control+z");
await settle();
const afterResizeUndo = await capture("11-resize-undone");
results.resizeUndoRestored = same(beforeResize, afterResizeUndo);
results.widthAfterResizeUndo = await numberValue("Width");
check("resizeUndoRestored", results.resizeUndoRestored, "undo did not restore the size and overlay");
check(
  "resizeUndoExact",
  Math.abs(results.widthAfterResizeUndo - 220) < 1.5,
  `undo produced width ${results.widthAfterResizeUndo}, expected 220`,
);
await page.keyboard.press("Control+Shift+z");
await settle();
const afterResizeRedo = await capture("12-resize-redone");
results.resizeRedoRestored = same(afterResize, afterResizeRedo);
check("resizeRedoRestored", results.resizeRedoRestored, "redo did not restore the resize");

// Turn it from the rotation handle. The handle sits 24 screen pixels above the
// middle of the top edge; the drag turns the shape clockwise by about 30°.
const centre = toScreen(585, 220);
const radius = 80 * zoom + 24;
const handle = { x: centre.x, y: centre.y - radius };
const end = {
  x: centre.x + radius * Math.sin(Math.PI / 6),
  y: centre.y - radius * Math.cos(Math.PI / 6),
};
const beforeRotate = await capture("13-before-rotate");
await page.mouse.move(handle.x, handle.y);
await page.mouse.down();
await page.mouse.move(end.x, end.y, { steps: 12 });
await page.mouse.up();
await settle();
const afterRotate = await capture("14-rotated");
results.historyAfterRotate = await historyDepth();
results.rotationAfterGesture = await exactValue("Rotation");
check("rotateChangedPixels", !same(beforeRotate, afterRotate), "the rotation gesture changed nothing");
check("rotateIsOneStep", results.historyAfterRotate === 8, `history after rotate is ${results.historyAfterRotate}`);
check(
  "rotateTurnedTheShape",
  results.rotationAfterGesture > 20 && results.rotationAfterGesture < 40,
  `the rotation handle produced ${results.rotationAfterGesture}°, expected about 30°`,
);
await page.keyboard.press("Control+z");
await settle();
const afterRotateUndo = await capture("15-rotate-undone");
results.rotationAfterUndo = await exactValue("Rotation");
results.rotateUndoRestored = same(beforeRotate, afterRotateUndo);
check("rotateUndoExact", Math.abs(results.rotationAfterUndo) < 0.01, `undo left rotation ${results.rotationAfterUndo}`);
check("rotateUndoRestored", results.rotateUndoRestored, "undo did not restore the unrotated shape");
await page.keyboard.press("Control+Shift+z");
await settle();
const afterRotateRedo = await capture("16-rotate-redone");
results.rotateRedoRestored = same(afterRotate, afterRotateRedo);
check("rotateRedoRestored", results.rotateRedoRestored, "redo did not restore the rotation");

// ------------------------------------------------- primitive and appearance
const beforeWidth = await capture("17-before-width");
await setNumber("Width", 200);
const afterWidth = await capture("18-width-edited");
results.historyAfterWidth = await historyDepth();
results.widthAfterEdit = await numberValue("Width");
results.heightAfterWidthEdit = await numberValue("Height");
check("widthChangedPixels", !same(beforeWidth, afterWidth), "the width field changed nothing");
check("widthIsOneStep", results.historyAfterWidth === 9, `history after width is ${results.historyAfterWidth}`);
check(
  "widthKeptHeight",
  Math.abs(results.widthAfterEdit - 200) < 0.01 && Math.abs(results.heightAfterWidthEdit - 160) < 1.5,
  `width edit produced ${results.widthAfterEdit}x${results.heightAfterWidthEdit}`,
);
await page.keyboard.press("Control+z");
await settle();
const afterWidthUndo = await capture("19-width-undone");
results.widthUndoRestored = same(beforeWidth, afterWidthUndo);
check("widthUndoRestored", results.widthUndoRestored, "undo did not restore the previous width");
await page.keyboard.press("Control+Shift+z");
await settle();

const beforeRotationField = await capture("20-before-rotation-field");
await setExact("Rotation", 45);
const afterRotationField = await capture("21-rotation-field");
results.historyAfterRotationField = await historyDepth();
results.rotationAfterField = await exactValue("Rotation");
check(
  "rotationFieldChangedPixels",
  !same(beforeRotationField, afterRotationField),
  "the rotation field changed nothing",
);
check(
  "rotationFieldIsOneStep",
  results.historyAfterRotationField === 10,
  `history after rotation field is ${results.historyAfterRotationField}`,
);
check(
  "rotationFieldExact",
  Math.abs(results.rotationAfterField - 45) < 0.01,
  `rotation field reads ${results.rotationAfterField}`,
);

// Fill off and undo: one step, and the record comes back exactly.
const fillToggle = page.locator(".tool-options-bar").getByRole("checkbox", { name: "Fill", exact: true });
const filledArtwork = await capture("22-filled");
await fillToggle.click();
await settle();
const unfilledArtwork = await capture("23-fill-off");
results.historyAfterFillOff = await historyDepth();
results.fillOffChangedPixels = !same(filledArtwork, unfilledArtwork);
results.fillCheckboxAfterOff = await fillToggle.isChecked();
check("fillOffChangedPixels", results.fillOffChangedPixels, "unchecking Fill changed nothing");
check("fillOffIsOneStep", results.historyAfterFillOff === 11, `history after fill is ${results.historyAfterFillOff}`);
check("fillOffUnchecked", !results.fillCheckboxAfterOff, "the Fill box still reads checked");
// A focused checkbox counts as a text field for the shortcut layer, so the
// canvas has to have the focus back before Ctrl+Z means undo.
await blur();
await page.keyboard.press("Control+z");
await settle();
const fillRestored = await capture("24-fill-undone");
results.fillUndoRestored = same(filledArtwork, fillRestored);
results.fillCheckboxAfterUndo = await fillToggle.isChecked();
check("fillUndoRestored", results.fillUndoRestored, "undo did not restore the filled rendering");
check("fillUndoChecked", results.fillCheckboxAfterUndo, "the Fill box did not come back checked");

const beforeColor = await capture("25-before-color");
await setColor("Color", "#ff0000");
const afterColor = await capture("26-color");
results.historyAfterColor = await historyDepth();
results.colorAfterEdit = await colorValue("Color");
check("colorChangedPixels", !same(beforeColor, afterColor), "the colour field changed nothing");
check("colorIsOneStep", results.historyAfterColor === 11, `history after colour is ${results.historyAfterColor}`);
check(
  "colorApplied",
  results.colorAfterEdit.toLowerCase() === "#ff0000",
  `the colour field reads ${results.colorAfterEdit}`,
);

const beforeStroke = await capture("27-before-stroke");
await setExact("Stroke", 12);
const afterStroke = await capture("28-stroke");
results.historyAfterStroke = await historyDepth();
results.strokeAfterEdit = await exactValue("Stroke");
check("strokeChangedPixels", !same(beforeStroke, afterStroke), "the stroke width changed nothing");
check("strokeIsOneStep", results.historyAfterStroke === 12, `history after stroke is ${results.historyAfterStroke}`);
check("strokeApplied", Math.abs(results.strokeAfterEdit - 12) < 0.01, `stroke reads ${results.strokeAfterEdit}`);

const beforeOpacity = await capture("29-before-opacity");
await setExact("Opacity", 0.5);
const afterOpacity = await capture("30-opacity");
results.historyAfterOpacity = await historyDepth();
results.opacityAfterEdit = await exactValue("Opacity");
check("opacityChangedPixels", !same(beforeOpacity, afterOpacity), "the opacity changed nothing");
check("opacityIsOneStep", results.historyAfterOpacity === 13, `history after opacity is ${results.historyAfterOpacity}`);
check("opacityApplied", Math.abs(results.opacityAfterEdit - 0.5) < 0.01, `opacity reads ${results.opacityAfterEdit}`);

// A polygon's side count and a star's inner radius are editable too.
await selectAt("polygon-edit", 200, 400);
const beforeSides = await capture("31-before-sides");
await setExact("Sides", 7);
const afterSides = await capture("32-sides");
results.historyAfterSides = await historyDepth();
results.sidesAfterEdit = await exactValue("Sides");
check("sidesChangedPixels", !same(beforeSides, afterSides), "the side count changed nothing");
check("sidesIsOneStep", results.historyAfterSides === 14, `history after sides is ${results.historyAfterSides}`);
check("sidesApplied", Math.abs(results.sidesAfterEdit - 7) < 0.01, `sides reads ${results.sidesAfterEdit}`);

await selectAt("star-edit", 510, 410);
const beforeInner = await capture("33-before-inner");
await setExact("Inner radius", 0.4);
const afterInner = await capture("34-inner");
results.historyAfterInner = await historyDepth();
results.innerAfterEdit = await exactValue("Inner radius");
check("innerChangedPixels", !same(beforeInner, afterInner), "the inner radius changed nothing");
check("innerIsOneStep", results.historyAfterInner === 15, `history after inner radius is ${results.historyAfterInner}`);
check("innerApplied", Math.abs(results.innerAfterEdit - 0.4) < 0.01, `inner radius reads ${results.innerAfterEdit}`);

// ---------------------------------------------------------- delete and undo
await selectAt("ellipse-delete", 800, 170);
const beforeDelete = await capture("35-before-delete");
await page.keyboard.press("Delete");
await settle();
const afterDelete = await capture("36-deleted");
results.historyAfterDelete = await historyDepth();
results.deleteChangedPixels = !same(beforeDelete, afterDelete);
check("deleteChangedPixels", results.deleteChangedPixels, "Delete removed nothing");
check("deleteIsOneStep", results.historyAfterDelete === 16, `history after delete is ${results.historyAfterDelete}`);
await page.keyboard.press("Control+z");
await settle();
await selectAt("ellipse-restored", 800, 170);
const afterDeleteUndo = await capture("37-delete-undone");
results.deleteUndoRestored = same(beforeDelete, afterDeleteUndo);
check("deleteUndoRestored", results.deleteUndoRestored, "undo did not bring the deleted shape back exactly");
results.historyAfterDeleteUndo = await historyDepth();
check(
  "deleteUndoDepth",
  results.historyAfterDeleteUndo === 15,
  `history after undo is ${results.historyAfterDeleteUndo}`,
);

// ------------------------------------------------------------- save and reopen
// Clear the selection so the saved artwork and the reopened artwork can be
// compared without the editor overlay in either.
await page.keyboard.press("Escape");
await settle();
const artworkBeforeSave = await capture("38-artwork-before-save");
results.selectionClearedForSave = (await page.locator(".tool-options-bar__hint").count()) === 1;
check(
  "selectionClearedForSave",
  results.selectionClearedForSave,
  "Escape did not clear the shape selection",
);

await stubSave(projectPath);
await page.keyboard.press("Control+s");
await waitForMessage(/^Saved shapes-smoke\.paka/);
await settle();
results.saveMessage = await fileMessage();
results.dirtyAfterSave = (await page.locator(".status-bar__dirty").count()) === 1;
check("dirtyAfterSave", !results.dirtyAfterSave, "saving did not clear the unsaved marker");

const savedText = await readFile(projectPath, "utf8");
const saved = JSON.parse(savedText);
results.savedVersion = saved.version;
results.savedElementKinds = saved.layers[0].elements.map((element) => element.kind);
results.savedShapeKinds = saved.layers[0].elements.map((element) => element.geometry?.shape ?? null);
check("savedVersion", saved.version === 15, `the file says version ${saved.version}`);
check(
  "savedEveryElementIsAShape",
  saved.layers[0].elements.length === 5 && saved.layers[0].elements.every((element) => element.kind === "shape"),
  `the file holds ${JSON.stringify(results.savedElementKinds)}`,
);
check(
  "savedOrderPreserved",
  results.savedShapeKinds.join(",") === "line,rectangle,ellipse,polygon,star",
  `the saved order is ${results.savedShapeKinds.join(",")}`,
);
const savedRectangle = saved.layers[0].elements[1];
results.savedRectangle = {
  geometry: savedRectangle.geometry,
  fill: savedRectangle.fill,
  color: savedRectangle.brush.color,
  size: savedRectangle.brush.size,
  opacity: savedRectangle.brush.opacity,
  stamp: savedRectangle.brush.stamp,
};
/** The packaged pointer maps to the document with sub-pixel rounding. */
function near(actual, expected, tolerance = 1.5) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}
check(
  "savedRectangleGeometry",
  near(savedRectangle.geometry.x, 450) &&
    near(savedRectangle.geometry.y, 140) &&
    near(savedRectangle.geometry.width, 200) &&
    near(savedRectangle.geometry.height, 160) &&
    Math.abs(savedRectangle.geometry.rotation - 45) < 0.01,
  `the saved rectangle is ${JSON.stringify(savedRectangle.geometry)}`,
);
check(
  "savedRectangleAppearance",
  savedRectangle.fill === true &&
    savedRectangle.brush.color.toLowerCase() === "#ff0000" &&
    savedRectangle.brush.size === 12 &&
    Math.abs(savedRectangle.brush.opacity - 0.5) < 0.01,
  `the saved appearance is ${JSON.stringify(results.savedRectangle)}`,
);
const savedLine = saved.layers[0].elements[0];
check(
  "savedLineGeometry",
  savedLine.geometry.shape === "line" &&
    near(savedLine.geometry.x1, 100) &&
    near(savedLine.geometry.y1, 100) &&
    near(savedLine.geometry.x2, 300) &&
    near(savedLine.geometry.y2, 180),
  `the saved line is ${JSON.stringify(savedLine.geometry)}`,
);
check(
  "savedNoTransientUi",
  !/selected|handle|preview|hover/i.test(savedText),
  "the project file carries transient editor state",
);

await stubOpen(projectPath);
await page.keyboard.press("Control+o");
await waitForMessage(/^Opened shapes-smoke\.paka/);
await settle();
const artworkAfterReopen = await capture("39-reopened");
results.reopenMessage = await fileMessage();
results.reopenRestoredPixels = same(artworkBeforeSave, artworkAfterReopen);
results.historyAfterReopen = await historyDepth();
results.dirtyAfterReopen = (await page.locator(".status-bar__dirty").count()) === 1;
check("reopenRestoredPixels", results.reopenRestoredPixels, "reopening changed the artwork's pixels");
check("reopenHistory", results.historyAfterReopen === 5, `reopened history is ${results.historyAfterReopen}`);
check("reopenClean", !results.dirtyAfterReopen, "a freshly opened project is marked unsaved");

// The reopened shape is still the same primitive, with the same geometry.
await useTool("v", "Shape edit");
await selectAt("reopened-rectangle", 550, 220);
results.reopenedWidth = await numberValue("Width");
results.reopenedHeight = await numberValue("Height");
results.reopenedRotation = await exactValue("Rotation");
results.reopenedFill = await page
  .locator(".tool-options-bar")
  .getByRole("checkbox", { name: "Fill", exact: true })
  .isChecked();
results.reopenedColor = await colorValue("Color");
results.reopenedStroke = await exactValue("Stroke");
results.reopenedOpacity = await exactValue("Opacity");
check(
  "reopenedGeometry",
  near(results.reopenedWidth, 200) &&
    near(results.reopenedHeight, 160) &&
    Math.abs(results.reopenedRotation - 45) < 0.01,
  `reopened geometry ${results.reopenedWidth}x${results.reopenedHeight} at ${results.reopenedRotation}°`,
);
check("reopenedFill", results.reopenedFill === true, "the reopened shape lost its fill");
check(
  "reopenedAppearance",
  results.reopenedColor.toLowerCase() === "#ff0000" &&
    Math.abs(results.reopenedStroke - 12) < 0.01 &&
    Math.abs(results.reopenedOpacity - 0.5) < 0.01,
  `reopened appearance ${results.reopenedColor}/${results.reopenedStroke}/${results.reopenedOpacity}`,
);

// ------------------------------- export excludes the overlay and references
await page.keyboard.press("Escape");
await settle();
const artworkNoSelection = await capture("40-artwork-no-selection");

// Import a solid magenta reference. The reference is painted over the paper,
// so the window shows magenta while the export must not contain a pixel of it.
const fixtureBase64 = await page.evaluate(() => {
  const surface = document.createElement("canvas");
  surface.width = 320;
  surface.height = 200;
  const context = surface.getContext("2d");
  if (!context) {
    throw new Error("no 2d context for the fixture");
  }
  context.fillStyle = "#ff00ff";
  context.fillRect(0, 0, 320, 200);
  return surface.toDataURL("image/png").split(",")[1];
});
await writeFile(referencePath, Buffer.from(fixtureBase64, "base64"));
await page.getByRole("tab", { name: "References" }).click();
await page.locator('[data-testid="reference-file-input"]').setInputFiles(referencePath);
await page.locator(".reference-panel__row").first().waitFor();
await settle();
const withReference = await capture("41-reference-overlay");
results.referenceChangedCanvas = !same(artworkNoSelection, withReference);

// The import hands the tool to the reference tool; take the shape editor back
// and select the rectangle so both an overlay and a reference are on screen
// when the export runs.
await useTool("v", "Shape edit");
await selectAt("export-rectangle", 550, 220);
const withOverlayAndReference = await capture("42-overlay-and-reference");
results.overlayVisibleForExport = !same(artworkNoSelection, withOverlayAndReference);

await stubSave(exportPath);
await blur();
// The export lives in the File menu; there is no chord for it.
await page.getByRole("menuitem", { name: "File", exact: true }).click();
await page.getByRole("menuitem", { name: "Export PNG…", exact: true }).click();
await waitForMessage(/^Exported shapes-export\.png/);
await settle();
results.exportMessage = await fileMessage();

await page.keyboard.press("Escape");
await settle();
await stubSave(exportNoSelectionPath);
await page.getByRole("menuitem", { name: "File", exact: true }).click();
await page.getByRole("menuitem", { name: "Export PNG…", exact: true }).click();
await waitForMessage(/^Exported shapes-export-no-selection\.png/);
await settle();
results.exportNoSelectionMessage = await fileMessage();

/** Minimal 8-bit PNG reader: enough for Chromium's non-interlaced RGBA output. */
function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error("not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, colour ${colorType}, interlace ${interlace})`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const row = raw.subarray(position, position + stride);
    position += stride;
    const previous = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);
    const output = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? output[x - channels] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= channels ? previous[x - channels] : 0;
      let value = row[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
      output[x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

const exported = decodePng(await readFile(exportPath));
const exportedNoSelection = decodePng(await readFile(exportNoSelectionPath));
let artworkPixels = 0;
let accentPixels = 0;
let magentaPixels = 0;
for (let index = 0; index < exported.pixels.length; index += exported.channels) {
  const r = exported.pixels[index];
  const g = exported.pixels[index + 1];
  const b = exported.pixels[index + 2];
  if (!(r > 250 && g > 250 && b > 250)) {
    artworkPixels += 1;
  }
  if (Math.abs(r - 47) <= 4 && Math.abs(g - 123) <= 4 && Math.abs(b - 255) <= 4) {
    accentPixels += 1;
  }
  if (r > 240 && g < 20 && b > 240) {
    magentaPixels += 1;
  }
}
results.export = {
  width: exported.width,
  height: exported.height,
  artworkPixels,
  accentPixels,
  magentaPixels,
};
check(
  "exportSize",
  exported.width === 1600 && exported.height === 1200,
  `the export is ${exported.width}x${exported.height}`,
);
check("exportHasArtwork", artworkPixels > 5000, `only ${artworkPixels} non-paper pixels were exported`);
check("exportHasNoSelectionAccent", accentPixels === 0, `${accentPixels} selection-accent pixels leaked into the export`);
check("exportHasNoReference", magentaPixels === 0, `${magentaPixels} reference pixels leaked into the export`);
results.exportIgnoresOverlay =
  exported.pixels.length === exportedNoSelection.pixels.length &&
  exported.pixels.equals(exportedNoSelection.pixels);
check(
  "exportIgnoresOverlay",
  results.exportIgnoresOverlay,
  "exporting with a selection produced different pixels than exporting without one",
);

// -------------------------------------------------------- reference removal
// The reference is a document object of its own: removing it is one step, and
// the artwork must come back exactly.
await page.getByRole("tab", { name: "References" }).click();
await page.locator(".reference-panel__row").first().locator(".reference-panel__remove").click();
await page.locator(".reference-panel__empty").waitFor();
await settle();
results.historyAfterReferenceRemove = await historyDepth();
results.referenceRemovalRestored = same(artworkNoSelection, await capture("43-reference-removed"));
check(
  "referenceRemovalIsOneStep",
  results.historyAfterReferenceRemove === 7,
  `history after removing the reference is ${results.historyAfterReferenceRemove}`,
);
check(
  "referenceRemovalRestored",
  results.referenceRemovalRestored,
  "removing the reference did not restore the artwork",
);

// -------------------------------------------------------- layer visibility
// The Layers panel lives in the side stack, which has no tab strip: its rows
// are always on screen.
const hideLayer = page.getByRole("button", { name: "Hide Layer 1" });
await hideLayer.waitFor();
// No selection, so the only thing that can disappear is the artwork.
await page.keyboard.press("Escape");
await settle();
const beforeHide = await capture("44-before-hide");
await hideLayer.click();
await settle();
const hidden = await capture("45-layer-hidden");
results.hideChangedCanvas = !same(beforeHide, hidden);
results.hiddenPaper = paperInk(hidden);
results.hideMatchesEmptyPaper = results.hiddenPaper.ink === 0;
results.historyAfterHide = await historyDepth();
check("hideChangedCanvas", results.hideChangedCanvas, "hiding the layer changed nothing");
check(
  "hideMatchesEmptyPaper",
  results.hideMatchesEmptyPaper,
  `the hidden layer still drew ${results.hiddenPaper.ink} paper pixels`,
);
check("hideIsOneStep", results.historyAfterHide === 8, `history after hide is ${results.historyAfterHide}`);
await page.keyboard.press("Control+z");
await settle();
const shown = await capture("46-layer-shown");
results.showRestoredPixels = same(beforeHide, shown);
check("showRestoredPixels", results.showRestoredPixels, "undoing the hide did not restore the artwork");

// ------------------------------------------------------------ legacy v14 file
const legacy = JSON.parse(savedText);
legacy.version = 14;
legacy.document.name = "Legacy baked shapes";
const legacyBrush = JSON.parse(JSON.stringify(saved.layers[0].elements[0].brush));
for (const layer of legacy.layers) {
  if (layer.kind !== "layer") {
    continue;
  }
  layer.elements = [
    {
      kind: "stroke",
      id: "stroke-legacy-1",
      brush: legacyBrush,
      startTime: 0,
      fill: true,
      xs: [900, 1100, 1100, 900, 900],
      ys: [600, 600, 720, 720, 600],
      pressures: [0.5, 0.5, 0.5, 0.5, 0.5],
      times: [0, 40, 80, 120, 160],
    },
  ];
}
const legacyText = `${JSON.stringify(legacy)}\n`;
await writeFile(legacyPath, legacyText);

// Undoing the layer hide left unsaved changes, and Open asks before discarding
// them. Save first, exactly as a user would.
await blur();
await page.keyboard.press("Control+s");
await waitForMessage(/^Saved shapes-smoke\.paka/);
await settle();

await stubOpen(legacyPath);
await page.keyboard.press("Control+o");
await waitForMessage(/^Opened legacy-v14\.paka/);
await settle();
results.legacyMessage = await fileMessage();
results.legacyHistory = await historyDepth();
const legacyArtwork = await capture("47-legacy-v14");
results.legacyChangedCanvas = !same(shown, legacyArtwork);
results.legacyFileUntouched = (await readFile(legacyPath, "utf8")) === legacyText;
check("legacyOpened", /^Opened legacy-v14\.paka/.test(results.legacyMessage ?? ""), `message: ${results.legacyMessage}`);
check("legacyHistory", results.legacyHistory === 1, `legacy history is ${results.legacyHistory}`);
check("legacyChangedCanvas", results.legacyChangedCanvas, "the legacy stroke did not render");
check("legacyFileUntouched", results.legacyFileUntouched, "opening rewrote the legacy file");

await useTool("v", "Shape edit");
await clickDoc(1000, 660);
await settle();
results.legacyShapeFields = await visibleFields();
results.legacyHint = (await page.locator(".tool-options-bar__hint").count()) === 1;
check(
  "legacyStrokeIsNotAShape",
  results.legacyShapeFields.length === 0 && results.legacyHint,
  `a baked stroke offered shape fields: ${results.legacyShapeFields.join(", ")}`,
);
check(
  "legacyStrokeNotConverted",
  results.legacyShapeFields.length === 0,
  "the legacy stroke became a native shape",
);

// --------------------------------------------------------------- final state
results.dirtyAtEnd = (await page.locator(".status-bar__dirty").count()) === 1;
results.historyAtEnd = await historyDepth();
results.finalZoom = await statusItem("zoom");
await page.screenshot({ path: join(outDir, "paka-window.png") });
await browser.close();

const log = { ...results, errors, failures };
await writeFile(join(outDir, "packaged-shapes-smoke.json"), `${JSON.stringify(log, null, 2)}\n`);
console.log(JSON.stringify({ ...results, errors, failures }, null, 2));

if (failures.length > 0) {
  throw new Error(failures.join("; "));
}
