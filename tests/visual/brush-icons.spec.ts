import { expect, test, type Page } from "@playwright/test";

/**
 * The built-in brushes' icons, in a real browser.
 *
 * The unit suite proves the grids and the preset lookup; this spec proves the
 * part a user meets: every built-in row in the brush browser carries a
 * picture, the six pictures are different from one another, and a saved brush
 * still shows the mark its settings paint instead of borrowing a built-in
 * icon.
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
  const builtIn = panel
    .locator(".brush-row")
    .filter({ has: page.locator(".brush-row__builtin") });
  await expect(builtIn).toHaveCount(BUILT_IN_NAMES.length);

  const pictures: string[] = [];
  for (const name of BUILT_IN_NAMES) {
    const row = builtIn.filter({ hasText: name });
    await expect(row, `${name} must be a built-in row`).toHaveCount(1);
    const icon = row.locator("svg.brush-icon");
    await expect(icon, `${name} must show an icon`).toBeVisible();
    // The icon is decoration: the row's name is what is announced.
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    // A picture, not an empty box.
    expect(await icon.locator("rect").count(), `${name} must draw pixels`).toBeGreaterThan(20);
    pictures.push(await icon.evaluate((element) => element.innerHTML));
  }

  expect(new Set(pictures).size, "each built-in brush draws a different picture").toBe(
    BUILT_IN_NAMES.length,
  );
});

test("a saved brush keeps its painted mark instead of an icon", async ({ page }) => {
  const panel = await openBrushes(page);
  await panel.getByRole("button", { name: "Krita 4", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Imported 81 brushes.");

  const saved = panel.locator(".brush-row").filter({ hasText: "Krita - Basic-1" }).first();
  await expect(saved).toBeVisible();
  await expect(saved.locator("svg.brush-icon")).toHaveCount(0);
  await expect(saved.locator(".brush-row__mark")).toHaveCount(1);
});
