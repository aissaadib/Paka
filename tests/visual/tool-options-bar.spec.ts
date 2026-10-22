import { expect, test, type Page } from "@playwright/test";

/**
 * The contextual tool-options strip, driven in a real browser.
 *
 * The unit tests in `src/test/toolOptions.test.ts` prove the schema: which
 * controls a tool shows, what each one reads and which editor action it
 * reaches. They cannot prove the part a user actually touches: that the strip
 * is *there*, that it changes with the tool, that it keeps its height when
 * the tool changes, that a control in the popover really reaches the brush,
 * and that a narrow window scrolls the strip instead of pushing the canvas
 * away.
 *
 * This spec does that, against the running application, in the same browser
 * the visual harness uses. It is not a golden test: it asserts behaviour, not
 * pixels - with one exception, the last test, which reads the canvas back to
 * prove that a control on the strip changed what was drawn.
 */

const CANVAS = "canvas.canvas-stage__surface";
const STRIP = ".tool-options-bar";

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

/** Draws a short horizontal stroke through the middle of the canvas. */
async function drawStroke(page: Page): Promise<void> {
  const middle = await canvasMiddle(page);
  await page.mouse.move(middle.x - 40, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x + 40, middle.y, { steps: 8 });
  await page.mouse.up();
}

/** The number of inked rows in the canvas column at the canvas's middle. */
async function strokeThickness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas.canvas-stage__surface");
    if (!(canvas instanceof HTMLCanvasElement)) {
      return -1;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return -1;
    }
    const column = Math.floor(canvas.width / 2);
    const data = context.getImageData(column, 0, 1, canvas.height).data;
    let rows = 0;
    for (let row = 0; row < canvas.height; row += 1) {
      const red = data[row * 4];
      const green = data[row * 4 + 1];
      const blue = data[row * 4 + 2];
      // The ink is the red swatch, so the stroke is the only red on the canvas.
      if (red > 140 && green < 120 && blue < 120) {
        rows += 1;
      }
    }
    return rows;
  });
}

test("the strip shows the active tool's controls", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();

  const strip = page.locator(STRIP);
  await expect(strip).toBeVisible();

  // The brush: the size and the opacity are in the strip, the rest is behind
  // the popover.
  await expect(strip.getByRole("slider", { name: "Size", exact: true })).toBeVisible();
  await expect(strip.getByRole("slider", { name: "Opacity", exact: true })).toBeVisible();
  await expect(strip.getByRole("button", { name: "Brush settings" })).toBeVisible();
  // The shape's controls are not on show for the brush.
  await expect(strip.getByText("Fill shape", { exact: true })).toHaveCount(0);

  // The polygon: its own controls join the brush's.
  await page.getByRole("button", { name: "Polygon", exact: true }).click();
  await expect(strip.getByRole("slider", { name: "Sides", exact: true })).toBeVisible();
  await expect(strip.getByText("Fill shape", { exact: true })).toBeVisible();
  // A shape has no stabilizer and no dabs: they are not offered at all.
  await expect(strip.getByRole("slider", { name: "Stabilizer", exact: true })).toHaveCount(0);

  // The bucket: its own tolerance, and no brush.
  await page.getByRole("button", { name: "Bucket fill", exact: true }).click();
  await expect(strip.getByRole("slider", { name: "Tolerance", exact: true })).toBeVisible();
  await expect(strip.getByRole("slider", { name: "Size", exact: true })).toHaveCount(0);
});

test("the strip keeps its height when the tool changes", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();

  const strip = page.locator(STRIP);
  const height = async () => (await strip.boundingBox())?.height ?? 0;

  const brushHeight = await height();
  for (const tool of ["Polygon", "Star", "Bucket fill", "Gradient", "Select", "Colour picker"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    expect(await height(), `the strip moved with the ${tool} tool`).toBe(brushHeight);
  }
  expect(brushHeight).toBeGreaterThan(0);
});

test("the popover holds the rest of the brush and its controls reach it", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();

  const strip = page.locator(STRIP);
  await strip.getByRole("button", { name: "Brush settings" }).click();

  const panel = page.getByRole("dialog", { name: "Brush settings" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("slider", { name: "Hardness", exact: true })).toBeVisible();
  await expect(panel.getByRole("slider", { name: "Stabilizer", exact: true })).toBeVisible();

  // A control in the popover writes through to the brush: the number box and
  // the slider show the same new value. The stabilizer is a fraction, so the
  // box carries 0.4 and the display beside it reads 40%.
  const stabilizer = panel.getByRole("spinbutton", { name: "Stabilizer (exact value)" });
  await stabilizer.fill("0.4");
  await expect(stabilizer).toHaveValue("0.4");
  await expect(panel.getByText("40%", { exact: true })).toBeVisible();

  // Escape closes the panel and puts the focus back on the trigger.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "Brush settings" })).toBeFocused();
});

test("the selection actions are disabled until something is selected", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();

  // The stroke is drawn with the brush first: the select tool draws nothing.
  await drawStroke(page);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  const strip = page.locator(STRIP);
  await expect(strip.getByRole("button", { name: "Duplicate", exact: true })).toBeDisabled();

  const middle = await canvasMiddle(page);
  await page.mouse.move(middle.x - 80, middle.y - 60);
  await page.mouse.down();
  await page.mouse.move(middle.x + 80, middle.y + 60, { steps: 8 });
  await page.mouse.up();

  await expect(strip.getByRole("button", { name: "Duplicate", exact: true })).toBeEnabled();
  await expect(strip.getByRole("button", { name: "Flip H", exact: true })).toBeEnabled();
});

test("a narrow window scrolls the strip instead of covering the canvas", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();

  await page.getByRole("button", { name: "Polygon", exact: true }).click();
  await page.setViewportSize({ width: 560, height: 700 });

  const strip = page.locator(STRIP);
  const stripBox = await strip.boundingBox();
  const canvasBox = await page.locator(CANVAS).boundingBox();
  expect(stripBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  if (!stripBox || !canvasBox) {
    throw new Error("the strip or the canvas has no box");
  }

  // The strip ends above the canvas: it never lies over it.
  expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(canvasBox.y + 1);

  // The controls are reachable by scrolling the strip sideways.
  const scrollable = await strip.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(scrollable).toBe(true);
  await strip.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect(strip.getByRole("slider", { name: "Rotation", exact: true })).toBeVisible();
});

test("the wheel scrolls the strip sideways when the window is narrow", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();

  await page.getByRole("button", { name: "Polygon", exact: true }).click();
  await page.setViewportSize({ width: 560, height: 700 });

  const strip = page.locator(STRIP);
  const scrollLeft = () => strip.evaluate((element) => element.scrollLeft);
  const before = await scrollLeft();

  // The pointer is placed on the strip's own padding, not on a control, so the
  // wheel reaches the strip itself.
  const box = await strip.boundingBox();
  if (!box) {
    throw new Error("the strip has no box");
  }
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);

  expect(await scrollLeft()).toBeGreaterThan(before);
});

test("a control on the strip changes what is drawn", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();

  // The red swatch makes the stroke the only red thing on the canvas, so the
  // drawn pixels can be counted.
  await page.getByRole("button", { name: "Use color #e5484d" }).click();

  const strip = page.locator(STRIP);
  const size = strip.getByRole("spinbutton", { name: "Size (exact value)" });
  await size.fill("4");
  await expect(size).toHaveValue("4");

  await drawStroke(page);
  const thin = await strokeThickness(page);

  await size.fill("60");
  await expect(size).toHaveValue("60");
  await drawStroke(page);
  const thick = await strokeThickness(page);

  // The wider brush really drew a wider stroke.
  expect(thin).toBeGreaterThan(0);
  expect(thick).toBeGreaterThan(thin * 2);
});
