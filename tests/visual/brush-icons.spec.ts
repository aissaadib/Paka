import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The brush library, in a real browser.
 *
 * The unit suite proves the grids, the palettes and the generated kinds; this
 * spec proves the part a user meets: the library is a grid of square
 * thumbnails, every tile carries a picture and no tile carries a caption, the
 * six built-in brushes draw six different ones, and a saved brush is drawn
 * from its own settings - a bristle brush does not look like a nib, and no
 * tile falls back to a painted dot.
 */

/** The six built-in brushes, by the name their tile announces. */
const BUILT_IN_NAMES = ["Pen", "Soft Round", "Marker", "Airbrush", "Charcoal", "Stamp Dots"];

async function openBrushes(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.locator("canvas.canvas-stage__surface").waitFor();
  await page.waitForTimeout(300);
  await page
    .getByRole("tablist", { name: "Panels" })
    .getByRole("tab", { name: "Brushes", exact: true })
    .click();
  const panel = page.getByRole("tabpanel", { name: "Brushes", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/** A tile, by the name its button announces. */
function tile(panel: Locator, page: Page, name: string): Locator {
  return panel
    .locator(".brush-tile")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
}

test("the library is a grid of square thumbnails with no captions", async ({ page }) => {
  const panel = await openBrushes(page);
  const tiles = panel.locator(".brush-tile");
  await expect(tiles.first()).toBeVisible();

  const first = tiles.first();
  const box = await first.boundingBox();
  expect(box, "a tile must have a box").not.toBeNull();
  expect(
    Math.abs((box?.width ?? 0) - (box?.height ?? 0)),
    "a tile must be square",
  ).toBeLessThanOrEqual(1);

  // The picture is the tile: no name is drawn under it.
  const pick = first.locator(".brush-tile__pick");
  expect((await pick.innerText()).trim()).toBe("");
  await expect(pick).toHaveAttribute("aria-label", /./);

  // A grid, not a column: the first tiles share a row.
  const tops = await tiles.evaluateAll((elements) =>
    elements.slice(0, 8).map((element) => Math.round(element.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size, "the first tiles share a row").toBeLessThan(tops.length);
});

test("every built-in brush shows its own icon", async ({ page }) => {
  const panel = await openBrushes(page);
  const builtIn = panel.locator(".brush-tile[data-built-in='true']");
  await expect(builtIn).toHaveCount(BUILT_IN_NAMES.length);

  const pictures: string[] = [];
  for (const name of BUILT_IN_NAMES) {
    const row = builtIn.filter({
      has: page.getByRole("button", { name: `${name} (built-in brush)`, exact: true }),
    });
    await expect(row, `${name} must be a built-in tile`).toHaveCount(1);
    const icon = row.locator("svg.brush-icon");
    await expect(icon, `${name} must show an icon`).toBeVisible();
    // The icon is decoration: the button's name is what is announced.
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    // A picture, not an empty box: one path per colour.
    expect(await icon.locator("path").count(), `${name} must draw colours`).toBeGreaterThan(4);
    pictures.push(await icon.evaluate((element) => element.innerHTML));
  }

  expect(new Set(pictures).size, "each built-in brush draws a different picture").toBe(
    BUILT_IN_NAMES.length,
  );
});

test("the keyboard's tile is scrolled into view", async ({ page }) => {
  const panel = await openBrushes(page);
  await panel.getByRole("button", { name: "Krita 4", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Imported 81 brushes.");

  const list = panel.locator(".brush-browser__list");
  await list.focus();
  // More rows than the panel can show: the selection has to follow.
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("ArrowDown");
  }
  const selected = panel.locator(".brush-tile.is-selected");
  await expect(selected).toHaveCount(1);
  const inView = await list.evaluate((element) => {
    const tile = element.querySelector(".brush-tile.is-selected");
    if (tile === null) {
      return null;
    }
    const listRect = element.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    return tileRect.top >= listRect.top - 1 && tileRect.bottom <= listRect.bottom + 1;
  });
  expect(inView, "the selected tile must be inside the list's viewport").toBe(true);
});

test("a saved brush is drawn from its settings, never from a painted dot", async ({ page }) => {
  const panel = await openBrushes(page);
  await panel.getByRole("button", { name: "Krita 4", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Imported 81 brushes.");

  // No tile of the library falls back to the old mark.
  await expect(panel.locator(".brush-row__mark")).toHaveCount(0);

  const nib = tile(panel, page, "Krita - Basic-1");
  await expect(nib).toHaveCount(1);
  const nibIcon = nib.locator("svg.brush-icon");
  await expect(nibIcon).toHaveCount(1);
  expect(await nibIcon.locator("path").count()).toBeGreaterThan(4);

  // A bristle brush and a hard round one are different kinds of brush, so
  // their icons differ even though both paint the same black ink.
  const bristles = tile(panel, page, "Krita - Bristles-1 Details");
  await expect(bristles).toHaveCount(1);
  const bristleIcon = bristles.locator("svg.brush-icon");
  await expect(bristleIcon).toHaveCount(1);

  const picture = (locator: typeof nibIcon) =>
    locator.evaluate((element) => element.innerHTML);
  expect(await picture(bristleIcon)).not.toBe(await picture(nibIcon));
});
