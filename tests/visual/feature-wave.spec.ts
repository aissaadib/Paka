import { expect, test, type Page } from "@playwright/test";

/**
 * The feature-wave controls, driven in a real browser.
 *
 * The unit suites prove the rules: the scan's global mode and sampling, the
 * lasso's polygon hit-test, the combining modes, and the symmetry copies. What
 * they cannot prove is the part a user touches - that the controls are in the
 * options bar, that changing one reaches the engine, and that a gesture drawn
 * on the canvas really produces the selection or the history step the rules
 * promise.
 *
 * Every assertion here is behavioural: the status bar reports the selection
 * count, the history depth and the unsaved marker, and those are read from the
 * engine's own snapshot. No pixel goldens, so the spec is stable across
 * platforms.
 */

test.use({ viewport: { width: 1280, height: 900 } });

/** The canvas the pointer draws on. */
const CANVAS = "canvas.canvas-stage__surface";

async function canvasMiddle(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(CANVAS).boundingBox();
  if (!box) {
    throw new Error("the canvas has no box");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A short brush stroke from (x, y) to (x + dx, y + dy). */
async function drawStroke(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

test("the bucket offers a mode and a sample scale, and keeps them", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();

  await page.getByRole("button", { name: "Bucket fill", exact: true }).click();
  const mode = page.getByLabel("Mode", { exact: true });
  const sample = page.getByLabel("Sample", { exact: true });
  await expect(mode).toBeVisible();
  await expect(sample).toBeVisible();
  await expect(mode).toHaveValue("contiguous");
  await expect(sample).toHaveValue("1");

  await mode.selectOption("global");
  await sample.selectOption("4");
  await expect(mode).toHaveValue("global");
  await expect(sample).toHaveValue("4");

  // The settings describe the next fill, not the tool: they survive a switch.
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await page.getByRole("button", { name: "Bucket fill", exact: true }).click();
  await expect(page.getByLabel("Mode", { exact: true })).toHaveValue("global");
  await expect(page.getByLabel("Sample", { exact: true })).toHaveValue("4");
});

test("a lasso selects the stroke it encloses", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  const middle = await canvasMiddle(page);
  const status = page.locator(".status-bar");

  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await drawStroke(page, middle.x - 140, middle.y - 60, 30, 0);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  const shape = page.getByLabel("Shape", { exact: true });
  await expect(shape).toHaveValue("rect");
  await shape.selectOption("lasso");
  await expect(shape).toHaveValue("lasso");

  // Trace a closed loop around the stroke.
  await page.mouse.move(middle.x - 175, middle.y - 90);
  await page.mouse.down();
  await page.mouse.move(middle.x - 80, middle.y - 90, { steps: 6 });
  await page.mouse.move(middle.x - 80, middle.y - 30, { steps: 6 });
  await page.mouse.move(middle.x - 175, middle.y - 30, { steps: 6 });
  await page.mouse.move(middle.x - 175, middle.y - 90, { steps: 6 });
  await page.mouse.up();

  await expect(status).toContainText("1 selected");
});

test("select all, invert and deselect drive the selection", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  const middle = await canvasMiddle(page);
  const status = page.locator(".status-bar");

  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await drawStroke(page, middle.x - 160, middle.y - 90, 40, 0);
  await drawStroke(page, middle.x + 60, middle.y + 60, 40, 0);

  await page.keyboard.press("Control+a");
  await expect(status).toContainText("2 selected");

  await page.keyboard.press("Control+Shift+i");
  await expect(status).not.toContainText("selected");

  await page.keyboard.press("Control+Shift+i");
  await expect(status).toContainText("2 selected");

  await page.keyboard.press("Control+Shift+d");
  await expect(status).not.toContainText("selected");

  // Selecting is editor state: the document was never edited by it.
  await expect(status).toContainText("history 2");
});

test("symmetry commits the mirrored copies as one undo step", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  const middle = await canvasMiddle(page);
  const status = page.locator(".status-bar");

  await page.getByRole("button", { name: "Brush", exact: true }).click();
  // The bar labels both the group and the select "Symmetry", so the select is
  // addressed by its role.
  const symmetry = page.getByRole("combobox", { name: "Symmetry", exact: true });
  await expect(symmetry).toHaveValue("off");
  await symmetry.selectOption("both");
  // The mode reveals the two axis fields.
  await expect(page.getByLabel("Axis X", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Axis Y", { exact: true })).toBeVisible();

  // Draw well away from both axes, so the original and its three mirrors are
  // four distinct strokes.
  await drawStroke(page, middle.x - 140, middle.y - 80, 30, 10);

  await expect(status).toContainText("history 1");
  await page.keyboard.press("Control+a");
  await expect(status).toContainText("4 selected");

  // One gesture, one undo step: undoing takes the original and all three
  // copies away together.
  await page.keyboard.press("Control+z");
  await expect(status).toContainText("history 0");
  await expect(status).not.toContainText("selected");

  await page.keyboard.press("Control+Shift+z");
  await expect(status).toContainText("history 1");
  await page.keyboard.press("Control+a");
  await expect(status).toContainText("4 selected");
});
