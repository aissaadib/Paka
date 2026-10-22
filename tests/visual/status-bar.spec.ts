import { expect, test, type Page } from "@playwright/test";

/**
 * The status bar and the view controls, driven in a real browser.
 *
 * The engine-level tests in `src/test/viewNavigation.test.ts` prove the zoom
 * bounds, the typed zoom, the view-only dirty state and the reset. They cannot
 * prove the part a user actually touches: that the bar *shows* the engine's
 * real state, that the zoom field takes a typed zoom and applies it, that the
 * view controls turn the canvas without marking the drawing unsaved, and that
 * all of it fits in a small window.
 *
 * This spec does that against the running application, in the same browser the
 * visual harness uses. It asserts behaviour, not pixels.
 */

const CANVAS = "canvas.canvas-stage__surface";
const STATUS_BAR = "footer.status-bar";
const ZOOM_FIELD = ".zoom-field__input";

/** A small laptop: the bar has to fit in it. */
test.use({ viewport: { width: 1366, height: 768 } });

/** Opens the app and waits for the canvas. */
async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
}

/** The zoom the canvas really has, read from the field. */
async function zoomValue(page: Page): Promise<string> {
  return (await page.locator(ZOOM_FIELD).inputValue()).trim();
}

/** The status bar's own text, on one line. */
async function barText(page: Page): Promise<string> {
  return (await page.locator(STATUS_BAR).innerText()).replace(/\s+/g, " ");
}

test("the status bar reports the document, the tool and the zoom", async ({ page }) => {
  await openApp(page);
  const bar = page.locator(STATUS_BAR);

  // The document's size, the active tool and the history depth, all read from
  // the engine.
  await expect(bar).toContainText(/\d+ × \d+ px/);
  await expect(bar).toContainText("tool Brush");
  await expect(bar).toContainText("history 0");
  // A fresh document is not dirty.
  await expect(bar).not.toContainText("unsaved");
});

test("the zoom field shows the canvas' zoom and takes a typed one", async ({ page }) => {
  await openApp(page);
  const field = page.locator(ZOOM_FIELD);

  // It shows a real zoom, not a constant.
  const initial = Number(await zoomValue(page));
  expect(initial).toBeGreaterThan(0);

  await field.click();
  await field.fill("150");
  await field.press("Enter");
  await expect(field).toHaveValue("150");

  // A zoom the canvas cannot show is clamped, not refused: the viewport's
  // range is 2 % to 6400 %.
  await field.click();
  await field.fill("100000");
  await field.press("Enter");
  await expect(field).toHaveValue("6400");

  // Escape throws the typing away and the field goes back to the canvas' zoom.
  await field.click();
  await field.fill("25");
  await field.press("Escape");
  await expect(field).toHaveValue("6400");
});

test("the zoom buttons move the zoom, the field follows and the ends are bounded", async ({
  page,
}) => {
  await openApp(page);
  const field = page.locator(ZOOM_FIELD);
  const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });

  await zoomIn.click();
  const zoomedIn = Number(await zoomValue(page));
  expect(zoomedIn).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Actual size", exact: true }).click();
  await expect(field).toHaveValue("100");

  await zoomOut.click();
  await expect(field).not.toHaveValue("100");

  // The buttons stop at the ends of the range the canvas supports.
  for (let step = 0; step < 80 && !(await zoomIn.isDisabled()); step += 1) {
    await zoomIn.click();
  }
  await expect(field).toHaveValue("6400");
  await expect(zoomIn).toBeDisabled();

  for (let step = 0; step < 120 && !(await zoomOut.isDisabled()); step += 1) {
    await zoomOut.click();
  }
  await expect(field).toHaveValue("2");
  await expect(zoomOut).toBeDisabled();
});

test("turning the view changes the canvas and nothing else", async ({ page }) => {
  await openApp(page);
  const bar = page.locator(STATUS_BAR);

  // An upright view is not named.
  await expect(bar).not.toContainText("rotated");

  await page.getByRole("button", { name: /^Rotate the view/ }).click();
  await expect(bar).toContainText("rotated 90°");

  await page.getByRole("button", { name: /Mirror the view/ }).click();
  await expect(bar).toContainText("mirrored");

  // The view is not an edit: the drawing is still saved.
  await expect(bar).not.toContainText("unsaved");

  await page.getByRole("button", { name: /Reset the view/ }).click();
  await expect(bar).not.toContainText("rotated");
  await expect(bar).not.toContainText("mirrored");
  await expect(bar).not.toContainText("unsaved");
});

test("the view can be turned from the keyboard", async ({ page }) => {
  await openApp(page);
  const bar = page.locator(STATUS_BAR);

  await page.keyboard.press("Shift+R");
  await expect(bar).toContainText("rotated 90°");

  await page.keyboard.press("Shift+M");
  await expect(bar).toContainText("mirrored");

  await page.keyboard.press("Control+Shift+0");
  await expect(bar).not.toContainText("rotated");
  await expect(bar).not.toContainText("mirrored");
  await expect(bar).not.toContainText("unsaved");
});

test("the space bar pans the canvas instead of drawing", async ({ page }) => {
  await openApp(page);
  const bar = page.locator(STATUS_BAR);
  const box = await page.locator(CANVAS).boundingBox();
  if (!box) {
    throw new Error("the canvas has no box");
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Space");

  // A pan is not an edit: no history, no unsaved marker.
  await expect(bar).toContainText("history 0");
  await expect(bar).not.toContainText("unsaved");
});

test("the status bar fits a small window without hiding the cursor", async ({ page }) => {
  await openApp(page);
  const bar = page.locator(STATUS_BAR);

  // The bar does not spill out of the window.
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);

  // The cursor readout - the last thing in the bar - is still on screen.
  await expect(bar.getByText("cursor", { exact: false })).toBeInViewport();
  // And the bar's own text says what the canvas is showing.
  expect(await barText(page)).toContain("tool Brush");
});
