import { expect, test, type Page } from "@playwright/test";

/**
 * The brush icons, in a real browser.
 *
 * The unit suite proves the grids, the palettes and the generated kinds; this
 * spec proves the part a user meets: every row of the brush library carries a
 * picture, the six built-in brushes draw six different ones, and a saved
 * brush is drawn from its own settings - a bristle brush does not look like a
 * nib, and no row falls back to a painted dot.
 */

/** The six built-in brushes, by the name their row shows. */
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

test("every built-in brush shows its own icon", async ({ page }) => {
  const panel = await openBrushes(page);
  const builtIn = panel.locator(".brush-row").filter({ has: page.locator(".brush-row__builtin") });
  await expect(builtIn).toHaveCount(BUILT_IN_NAMES.length);

  const pictures: string[] = [];
  for (const name of BUILT_IN_NAMES) {
    const row = builtIn.filter({ hasText: name });
    await expect(row, `${name} must be a built-in row`).toHaveCount(1);
    const icon = row.locator("svg.brush-icon");
    await expect(icon, `${name} must show an icon`).toBeVisible();
    // The icon is decoration: the row's name is what is announced.
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    // A picture, not an empty box: one path per colour.
    expect(await icon.locator("path").count(), `${name} must draw colours`).toBeGreaterThan(4);
    pictures.push(await icon.evaluate((element) => element.innerHTML));
  }

  expect(new Set(pictures).size, "each built-in brush draws a different picture").toBe(
    BUILT_IN_NAMES.length,
  );
});

test("a saved brush is drawn from its settings, never from a painted dot", async ({ page }) => {
  const panel = await openBrushes(page);
  await panel.getByRole("button", { name: "Krita 4", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Imported 81 brushes.");

  // No row of the library falls back to the old mark.
  await expect(panel.locator(".brush-row__mark")).toHaveCount(0);

  const row = (name: string) => panel.locator(".brush-row").filter({ hasText: name }).first();

  const nib = row("Krita - Basic-1");
  await expect(nib).toBeVisible();
  const nibIcon = nib.locator("svg.brush-icon");
  await expect(nibIcon).toHaveCount(1);
  expect(await nibIcon.locator("path").count()).toBeGreaterThan(4);

  // A bristle brush and a hard round one are different kinds of brush, so
  // their icons differ even though both paint the same black ink.
  const bristles = row("Krita - Bristles-1 Details");
  await expect(bristles).toBeVisible();
  const bristleIcon = bristles.locator("svg.brush-icon");
  await expect(bristleIcon).toHaveCount(1);

  const picture = (locator: typeof nibIcon) =>
    locator.evaluate((element) => element.innerHTML);
  expect(await picture(bristleIcon)).not.toBe(await picture(nibIcon));
});
