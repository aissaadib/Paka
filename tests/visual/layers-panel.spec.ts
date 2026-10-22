import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The layers panel, driven in a real browser.
 *
 * The engine-level tests in `src/test/layerPanel.test.ts` prove the commands
 * the panel issues: the reorder arithmetic, the undo steps, the content count
 * the delete confirmation asks about. They cannot prove the part a user
 * actually touches: that the panel *shows* which layer is active, that the
 * drag marker appears where the layer will land, that the keyboard reaches
 * the rows, and that a destructive deletion really asks first.
 *
 * This spec does that, against the running application, in the same browser
 * the visual harness uses. It is not a golden test: it asserts behaviour -
 * the panel's own state and the history entry the command leaves behind - not
 * pixels.
 */

const CANVAS = "canvas.canvas-stage__surface";

/** The window is wider than the harness's, so the canvas has room. */
test.use({ viewport: { width: 1280, height: 900 } });

/** Every layer row, top of the stack first. */
function rows(page: Page): Locator {
  return page.locator(".layer-list > li.layer-row");
}

/** The row of the layer with this name. */
function rowFor(page: Page, name: string): Locator {
  return rows(page).filter({ has: page.getByRole("button", { name, exact: true }) });
}

/** The name button of the layer with this name. */
function nameButton(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

/** The history depth the status bar reports. */
async function historyDepth(page: Page): Promise<number> {
  const text = await page.locator(".status-bar__item", { hasText: "history" }).innerText();
  return Number(text.replace("history", "").trim());
}

/** Draws a short stroke through the middle of the canvas, with the brush. */
async function drawStroke(page: Page): Promise<void> {
  const box = await page.locator(CANVAS).boundingBox();
  if (!box) {
    throw new Error("the canvas has no box");
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 30, y - 20);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 20, { steps: 6 });
  await page.mouse.up();
}

/** Adds `count` layers and returns their names, bottom-first. */
async function addLayers(page: Page, count: number): Promise<string[]> {
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    await page.getByRole("button", { name: "Add layer", exact: true }).click();
    names.push(`Layer ${index + 2}`);
  }
  return names;
}

test("the panel lists the layers and marks the active one", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();

  await expect(rows(page)).toHaveCount(1);
  await expect(rowFor(page, "Layer 1")).toHaveClass(/is-active/);

  await addLayers(page, 1);

  await expect(rows(page)).toHaveCount(2);
  // The new layer is on top of the stack and is the active one.
  await expect(rows(page).first()).toContainText("Layer 2");
  await expect(rowFor(page, "Layer 2")).toHaveClass(/is-active/);
  await expect(rowFor(page, "Layer 1")).not.toHaveClass(/is-active/);
});

test("hiding a layer marks the row and leaves one undo step", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  const before = await historyDepth(page);

  await page.getByRole("button", { name: "Hide Layer 1", exact: true }).click();

  await expect(rowFor(page, "Layer 1")).toHaveClass(/is-hidden/);
  expect(await historyDepth(page)).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Undo Layer Visibility" })).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(rowFor(page, "Layer 1")).not.toHaveClass(/is-hidden/);
});

test("F2 renames the focused layer and leaves one undo step", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  const before = await historyDepth(page);

  await nameButton(page, "Layer 1").click();
  await page.keyboard.press("F2");

  const input = page.getByRole("textbox", { name: "Layer name" });
  await expect(input).toBeVisible();
  await input.fill("Ink");
  await input.press("Enter");

  await expect(nameButton(page, "Ink")).toBeVisible();
  expect(await historyDepth(page)).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Undo Rename Layer" })).toBeVisible();
});

test("the arrow keys move the focus without changing the active layer", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await addLayers(page, 2);

  await nameButton(page, "Layer 3").click();
  const activeBefore = await page
    .locator(".layer-row.is-active .layer-row__title")
    .innerText();

  await page.keyboard.press("ArrowDown");
  const focused = await page.evaluate(() => {
    const element = document.activeElement;
    return element?.closest(".layer-row")?.querySelector(".layer-row__title")?.textContent ?? "";
  });
  expect(focused).toBe("Layer 2");

  // The focus moved; the active layer did not.
  const activeAfter = await page.locator(".layer-row.is-active .layer-row__title").innerText();
  expect(activeAfter).toBe(activeBefore);
});

test("Ctrl+Down reorders the focused layer and leaves one undo step", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await addLayers(page, 2);
  const before = await historyDepth(page);

  await nameButton(page, "Layer 3").click();
  await page.keyboard.press("Control+ArrowDown");

  // The list is shown top-first, so "down" is towards the bottom of the stack.
  const titles = await rows(page).locator(".layer-row__title").allInnerTexts();
  expect(titles).toEqual(["Layer 2", "Layer 3", "Layer 1"]);
  expect(await historyDepth(page)).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Undo Reorder Layers" })).toBeVisible();
});

test("the quick opacity edit changes one layer in one step", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  const before = await historyDepth(page);

  await page.getByRole("button", { name: /Opacity of Layer 1/ }).click();
  const input = page.getByRole("spinbutton", { name: /Opacity of Layer 1/ });
  await input.fill("40");
  await input.press("Enter");

  await expect(rowFor(page, "Layer 1")).toContainText("40%");
  expect(await historyDepth(page)).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Undo Layer Opacity" })).toBeVisible();
});

test("a layer's preview shows what the layer holds", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await drawStroke(page);

  /** The dark pixels in the layer's preview. */
  const darkPixels = () =>
    page.evaluate(() => {
      const canvases = Array.from(
        document.querySelectorAll(".layer-row__thumb"),
      ) as HTMLCanvasElement[];
      return canvases.map((canvas) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return -1;
        }
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (data[index] < 200) {
            dark += 1;
          }
        }
        return dark;
      });
    });

  // The preview is cropped to the stroke, so the mark fills it; an empty
  // layer shows the paper. The preview follows the renderer, which
  // rasterizes the layer on its own frame, so the test waits for it.
  await expect.poll(async () => (await darkPixels())[0] ?? 0).toBeGreaterThan(0);
});

test("deleting a layer that holds content asks first", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await drawStroke(page);

  await nameButton(page, "Layer 1").click();
  await page.keyboard.press("Delete");

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Layer 1");
  await expect(dialog).toContainText("1 item");

  // Cancelling keeps the layer.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
});

test("deleting an empty layer asks nothing", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await addLayers(page, 1);

  await nameButton(page, "Layer 2").click();
  await page.keyboard.press("Delete");

  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Undo Delete Layer" })).toBeVisible();
});

test("a drag shows the insertion marker and lands the layer where it was", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await addLayers(page, 2);
  const before = await historyDepth(page);

  const grip = rowFor(page, "Layer 3").locator(".layer-row__grip");
  const target = rowFor(page, "Layer 1");
  const gripBox = await grip.boundingBox();
  const targetBox = await target.boundingBox();
  if (!gripBox || !targetBox) {
    throw new Error("the row has no box");
  }

  // The lower half of the row means "below it", so the dragged layer lands
  // under the bottom layer.
  const dropY = targetBox.y + targetBox.height * 0.75;

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, dropY, { steps: 12 });

  // The marker is the panel saying where the layer will land.
  await expect(page.locator(".layer-marker")).toBeVisible();

  await page.mouse.up();

  const titles = await rows(page).locator(".layer-row__title").allInnerTexts();
  expect(titles).toEqual(["Layer 2", "Layer 1", "Layer 3"]);
  expect(await historyDepth(page)).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Undo Reorder Layers" })).toBeVisible();
});

test("a drag onto the upper half of a row lands the layer above it", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await addLayers(page, 2);

  const grip = rowFor(page, "Layer 1").locator(".layer-row__grip");
  const target = rowFor(page, "Layer 3");
  const gripBox = await grip.boundingBox();
  const targetBox = await target.boundingBox();
  if (!gripBox || !targetBox) {
    throw new Error("the row has no box");
  }

  // The upper half of the top row means "above it", so the dragged layer
  // becomes the top of the stack.
  const dropY = targetBox.y + targetBox.height * 0.25;

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, dropY, { steps: 12 });
  await expect(page.locator(".layer-marker")).toBeVisible();
  await page.mouse.up();

  const titles = await rows(page).locator(".layer-row__title").allInnerTexts();
  expect(titles).toEqual(["Layer 1", "Layer 3", "Layer 2"]);
});

test("a cancelled drag changes nothing", async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await addLayers(page, 1);
  const before = await historyDepth(page);
  const titlesBefore = await rows(page).locator(".layer-row__title").allInnerTexts();

  const grip = rowFor(page, "Layer 2").locator(".layer-row__grip");
  const gripBox = await grip.boundingBox();
  if (!gripBox) {
    throw new Error("the row has no box");
  }

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  // Escape cancels the drag in flight, exactly as it cancels a drag anywhere
  // else in the application.
  await page.keyboard.press("Escape");
  await page.mouse.up();

  await expect(page.locator(".layer-marker")).toBeHidden();
  const titlesAfter = await rows(page).locator(".layer-row__title").allInnerTexts();
  expect(titlesAfter).toEqual(titlesBefore);
  expect(await historyDepth(page)).toBe(before);
});
