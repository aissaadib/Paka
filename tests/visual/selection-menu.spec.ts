import { expect, test, type Page } from "@playwright/test";

/**
 * The Selection menu, driven in a real browser.
 *
 * The engine-level tests in `src/test/fixedStepTransform.test.ts` prove the
 * geometry, the pivot and the history. They cannot prove the part a user
 * actually touches: that the **menu entries** exist, that they grey out
 * when there is nothing to transform, and that choosing one **runs the real
 * transform path** rather than only changing some UI state.
 *
 * This spec does that, against the running application, in the same browser
 * the visual harness uses. It is not a golden test: it asserts behaviour -
 * the menu's own state, and the history entry the command leaves behind - not
 * pixels.
 *
 * The application is served by the same Vite dev server as the harness (the
 * config's `webServer` runs Vite on port 1422), so this needs no
 * configuration of its own.
 */

const CANVAS = "canvas.canvas-stage__surface";

/** The window is wider than the harness's, so the canvas has room. */
test.use({ viewport: { width: 1280, height: 900 } });

/** The middle of the canvas: the document is centred there, so it is inside it. */
async function canvasMiddle(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(CANVAS).boundingBox();
  if (!box) {
    throw new Error("the canvas has no box");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Draws a short stroke through the middle of the canvas, with the brush. */
async function drawStroke(page: Page): Promise<void> {
  const middle = await canvasMiddle(page);
  await page.mouse.move(middle.x - 30, middle.y - 20);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y, { steps: 6 });
  await page.mouse.move(middle.x + 30, middle.y + 20, { steps: 6 });
  await page.mouse.up();
}

/** Marquee-selects whatever is around the middle of the canvas. */
async function marqueeSelect(page: Page): Promise<void> {
  const middle = await canvasMiddle(page);
  await page.mouse.move(middle.x - 80, middle.y - 60);
  await page.mouse.down();
  await page.mouse.move(middle.x + 80, middle.y + 60, { steps: 8 });
  await page.mouse.up();
}

/**
 * Opens the Selection menu.
 *
 * The menu bar is a real menubar: its triggers are menu items, not buttons.
 */
async function openSelectionMenu(page: Page): Promise<void> {
  await page.getByRole("menuitem", { name: "Selection", exact: true }).click();
}

test("the fixed-step commands are in the Selection menu", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await openSelectionMenu(page);

  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Scale by 150%", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rotate 15° Clockwise", exact: true })).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Rotate 15° Counter-Clockwise", exact: true }),
  ).toBeVisible();
});

test("the fixed-step commands grey out when nothing is selected", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await openSelectionMenu(page);

  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Scale by 150%", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Rotate 15° Clockwise", exact: true })).toBeDisabled();
  await expect(
    menu.getByRole("menuitem", { name: "Rotate 15° Counter-Clockwise", exact: true }),
  ).toBeDisabled();
});

test("the fixed-step commands are enabled once something is selected", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await drawStroke(page);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await marqueeSelect(page);
  await openSelectionMenu(page);

  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Scale by 150%", exact: true })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "Rotate 15° Clockwise", exact: true })).toBeEnabled();
  await expect(
    menu.getByRole("menuitem", { name: "Rotate 15° Counter-Clockwise", exact: true }),
  ).toBeEnabled();
});

test("choosing a scale runs the real transform and leaves one undo step", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await drawStroke(page);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await marqueeSelect(page);
  await openSelectionMenu(page);

  await page.getByRole("menuitem", { name: "Scale by 150%", exact: true }).click();

  // The command really ran: the history names it, and the undo button offers
  // to undo *that* command.
  await expect(
    page.getByRole("button", { name: "Undo Scale 150%", exact: true }),
  ).toBeVisible();
  // And the document is now marked as having unsaved changes, which only an
  // edit can do.
  await expect(page.getByText("unsaved", { exact: true })).toBeVisible();
});

test("choosing a rotation runs the real transform, in both directions", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await drawStroke(page);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await marqueeSelect(page);

  await openSelectionMenu(page);
  await page.getByRole("menuitem", { name: "Rotate 15° Clockwise", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo Rotate 15°", exact: true })).toBeVisible();

  await openSelectionMenu(page);
  await page.getByRole("menuitem", { name: "Rotate 15° Counter-Clockwise", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo Rotate -15°", exact: true })).toBeVisible();
});
