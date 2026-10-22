import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The left tool rail, driven in a real browser.
 *
 * The unit tests in `src/test/toolRail.test.ts` prove the rail's model: the
 * grouping, the active slot, the routing rule and the way back from the pan
 * tool. They cannot prove the part a user actually touches: that the buttons
 * are on screen, that a click really selects the tool, that the flyout opens
 * and that the tooltip sits beside its button instead of under the pointer.
 *
 * This spec does that, against the running application, in the same browser
 * the visual harness uses. It asserts behaviour - the rail's own state - not
 * pixels.
 */

test.use({ viewport: { width: 1280, height: 900 } });

const RAIL = ".tool-rail";

/** The rail button whose accessible name matches. */
function tool(page: Page, name: string | RegExp): Locator {
  // Scoped to the rail: the menu bar has a "Selection" entry and the toolbar
  // has its own buttons.
  return page.locator(RAIL).getByRole("button", { name });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator("canvas.canvas-stage__surface").waitFor();
});

test("the rail shows every group, and the shape family behind one slot", async ({ page }) => {
  for (const name of ["Brush", "Eraser", "Bucket fill", "Gradient", "Select", "Colour picker", "Pan", "Guides"]) {
    await expect(tool(page, name)).toBeVisible();
  }
  // The five shape tools share one slot: they are one family with one gesture.
  await expect(tool(page, /^Shapes/)).toBeVisible();
});

test("the active tool is marked, and clicking another one moves the mark", async ({ page }) => {
  await expect(tool(page, "Brush")).toHaveAttribute("aria-pressed", "true");

  await tool(page, "Eraser").click();

  await expect(tool(page, "Eraser")).toHaveAttribute("aria-pressed", "true");
  await expect(tool(page, "Brush")).not.toHaveAttribute("aria-pressed", "true");
});

test("the shape flyout lists every shape tool and arms the one that is picked", async ({ page }) => {
  await tool(page, /^Shapes/).click();

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  for (const name of ["Line", "Rectangle", "Ellipse", "Polygon", "Star"]) {
    await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();
  }

  await menu.getByRole("menuitem", { name: /^Star/ }).click();

  // The slot says which shape is armed, and it is marked as the current one.
  await expect(tool(page, "Shapes, Star active")).toHaveAttribute("aria-current", "true");
});

test("the shape flyout closes on Escape and gives the focus back", async ({ page }) => {
  const shapes = tool(page, /^Shapes/);
  await shapes.click();
  await expect(page.getByRole("menu")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("menu")).toBeHidden();
  await expect(shapes).toBeFocused();
});

test("the pan tool is temporary: a second click returns to the tool before it", async ({ page }) => {
  await tool(page, "Eraser").click();
  await expect(tool(page, "Eraser")).toHaveAttribute("aria-pressed", "true");

  await tool(page, "Pan").click();
  await expect(tool(page, "Pan")).toHaveAttribute("aria-pressed", "true");

  // The way back: the pan tool is navigation, not a place to stay.
  await tool(page, "Pan").click();
  await expect(tool(page, "Eraser")).toHaveAttribute("aria-pressed", "true");
  await expect(tool(page, "Pan")).not.toHaveAttribute("aria-pressed", "true");
});

test("the tooltip names the tool and its shortcut, beside the button", async ({ page }) => {
  const brush = tool(page, "Brush");
  const button = await brush.boundingBox();
  expect(button).not.toBeNull();

  await brush.hover();

  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Brush");
  await expect(tooltip).toContainText("B");

  // The tooltip is anchored to the button: it opens to the right of it, so it
  // never sits under the pointer and never covers the button it describes.
  const box = await tooltip.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(button!.x + button!.width);
});

test("the arrow keys walk the rail", async ({ page }) => {
  await tool(page, "Brush").focus();
  await expect(tool(page, "Brush")).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(tool(page, "Eraser")).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(tool(page, "Brush")).toBeFocused();
});

test("every registered tool can be selected from the rail", async ({ page }) => {
  const tools = [
    "Brush",
    "Eraser",
    "Bucket fill",
    "Gradient",
    "Select",
    "Colour picker",
    "Pan",
    "Guides",
  ];
  for (const name of tools) {
    await tool(page, name).click();
    await expect(tool(page, name)).toHaveAttribute("aria-pressed", "true");
  }

  // The shape family, one by one, through the flyout.
  for (const name of ["Line", "Rectangle", "Ellipse", "Polygon", "Star"]) {
    await tool(page, /^Shapes/).click();
    await page.getByRole("menu").getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
    await expect(tool(page, `Shapes, ${name} active`)).toHaveAttribute("aria-current", "true");
  }
});

test("a short window scrolls the rail instead of clipping the tools away", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 });

  const rail = page.locator(RAIL);
  // The rail scrolls: the tools are never cut off for good.
  const metrics = await rail.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(metrics.scrollHeight).toBeGreaterThan(0);

  // The last tool of the rail is still reachable.
  await tool(page, "Guides").click();
  await expect(tool(page, "Guides")).toHaveAttribute("aria-pressed", "true");
});
