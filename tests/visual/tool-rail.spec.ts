import { expect, test, type Page } from "@playwright/test";

/**
 * The tool rail, driven in a real browser.
 *
 * The model tests in `src/test/toolRail.test.ts` prove the rules: which tool
 * belongs to which group, which slot is active, where a click goes and what
 * the way back from the pan tool does. They cannot prove the part a user
 * actually touches: that the rail draws a button per slot, that the collapsed
 * shape family really opens a flyout, that the tooltip is anchored to its
 * button and shows the shortcut the registry binds, that the arrow keys walk
 * the rail, and that the rail stays usable in a short window.
 *
 * This spec does that, against the running application. It is not a golden
 * test: it asserts behaviour - what the rail shows and where the focus is -
 * not pixels.
 *
 * The application is served by the same Vite dev server as the harness (the
 * config's `webServer` runs Vite on port 1422), so this needs no
 * configuration of its own.
 */

test.use({ viewport: { width: 1280, height: 900 } });

/** The rail itself. */
const RAIL = ".tool-rail";

/** The aria-label of the element that has the focus. */
async function focusedLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
}

test("the rail draws a button for every slot of its groups", async ({ page }) => {
  await page.goto("/");
  await page.locator(RAIL).waitFor();

  const rail = page.getByRole("toolbar", { name: "Tools" });
  await expect(rail).toBeVisible();

  // The common tools are on the rail itself.
  for (const name of ["Brush", "Eraser", "Bucket fill", "Gradient", "Select", "Colour picker", "Pan", "Guides"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }

  // The shape family shares one slot that opens a flyout.
  await expect(page.getByRole("button", { name: "Shapes", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rectangle", exact: true })).toHaveCount(0);
});

test("the collapsed shape family opens a flyout and arms the chosen tool", async ({ page }) => {
  await page.goto("/");
  await page.locator(RAIL).waitFor();

  await page.getByRole("button", { name: "Shapes", exact: true }).click();

  const menu = page.getByRole("menu", { name: "Shapes" });
  await expect(menu).toBeVisible();
  for (const name of ["Line", "Rectangle", "Ellipse", "Polygon", "Star"]) {
    await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();
  }

  await menu.getByRole("menuitem", { name: /^Star/ }).click();

  // The slot now stands for the armed shape, and it says so.
  const slot = page.getByRole("button", { name: "Shapes, Star active", exact: true });
  await expect(slot).toBeVisible();
  await expect(slot).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("the flyout keeps the keyboard contract of a menu", async ({ page }) => {
  await page.goto("/");
  await page.locator(RAIL).waitFor();

  await page.getByRole("button", { name: "Shapes", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Shapes" });
  await expect(menu).toBeVisible();

  // The focus is inside the menu, on the first item.
  await expect(page.getByRole("menuitem", { name: /^Line/ })).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: /^Rectangle/ })).toBeFocused();

  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: /^Star/ })).toBeFocused();

  // Escape closes it and gives the focus back to the button that opened it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Shapes", exact: true })).toBeFocused();
});

test("the tooltip is anchored to its button and shows the registry's shortcut", async ({ page }) => {
  await page.goto("/");
  await page.locator(RAIL).waitFor();

  const brush = page.getByRole("button", { name: "Brush", exact: true });
  await brush.hover();

  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip.getByText("Brush", { exact: true })).toBeVisible();
  await expect(tooltip.getByText("B", { exact: true })).toBeVisible();

  // The tooltip is anchored beside the button, not under the pointer.
  const button = await brush.boundingBox();
  const tip = await tooltip.boundingBox();
  expect(button).not.toBeNull();
  expect(tip).not.toBeNull();
  expect(tip!.x).toBeGreaterThanOrEqual(button!.x + button!.width);

  // It goes away when the pointer leaves the button.
  await page.getByRole("button", { name: "Select", exact: true }).hover();
  await expect(tooltip).toHaveCount(0);
});

test("the arrow keys walk the rail", async ({ page }) => {
  await page.goto("/");
  await page.locator(RAIL).waitFor();

  const brush = page.getByRole("button", { name: "Brush", exact: true });
  await brush.focus();
  expect(await focusedLabel(page)).toBe("Brush");

  await page.keyboard.press("ArrowDown");
  expect(await focusedLabel(page)).toBe("Eraser");

  await page.keyboard.press("ArrowUp");
  expect(await focusedLabel(page)).toBe("Brush");

  await page.keyboard.press("End");
  expect(await focusedLabel(page)).toBe("Reference");

  await page.keyboard.press("Home");
  expect(await focusedLabel(page)).toBe("Brush");
});

test("the pan tool is a way out, not a place to stay", async ({ page }) => {
  await page.goto("/");
  await page.locator(RAIL).waitFor();

  const brush = page.getByRole("button", { name: "Brush", exact: true });
  await brush.click();
  await expect(brush).toHaveAttribute("aria-pressed", "true");

  const pan = page.getByRole("button", { name: "Pan", exact: true });
  await pan.click();
  await expect(pan).toHaveAttribute("aria-pressed", "true");
  await expect(brush).not.toHaveAttribute("aria-pressed", "true");

  // A second click returns to the tool the artist came from.
  await pan.click();
  await expect(brush).toHaveAttribute("aria-pressed", "true");
  await expect(pan).not.toHaveAttribute("aria-pressed", "true");
});

test("the rail keeps every tool reachable in a short window", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await page.goto("/");
  await page.locator(RAIL).waitFor();

  const rail = page.locator(RAIL);
  // The rail either fits its tools or scrolls them; what it may not do is clip
  // one away. (At this height the short chrome means it now fits, which is the
  // better outcome - the scroll is the fallback, not the goal.)
  const scrolls = await rail.evaluate((element) => element.scrollHeight > element.clientHeight);
  const overflowY = await rail.evaluate((element) => getComputedStyle(element).overflowY);
  if (scrolls) {
    expect(["auto", "scroll"]).toContain(overflowY);
  }

  // The last tool is reachable by scrolling the rail, not clipped away.
  const guides = page.getByRole("button", { name: "Guides", exact: true });
  await guides.scrollIntoViewIfNeeded();
  await expect(guides).toBeVisible();
  const railBox = await rail.boundingBox();
  const guideBox = await guides.boundingBox();
  expect(railBox).not.toBeNull();
  expect(guideBox).not.toBeNull();
  expect(guideBox!.y).toBeGreaterThanOrEqual(railBox!.y - 1);
  expect(guideBox!.y + guideBox!.height).toBeLessThanOrEqual(
    railBox!.y + railBox!.height + 1,
  );
});
