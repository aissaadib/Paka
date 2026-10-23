import { expect, test, type Page } from "@playwright/test";

/**
 * The Krita 4 import button, in a real browser.
 *
 * The unit suite proves the translated set is complete and in bounds; this
 * spec proves the part the user does: open the brush browser, press one
 * button, and find the Krita brushes in the list. It also proves the second
 * press does not duplicate them.
 */

const KRITA_BRUSHES = 69;

async function openApp(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.locator("canvas.canvas-stage__surface").waitFor();
  await page.waitForTimeout(300);
}

test("one press adds the Krita 4 brushes and a second press adds nothing", async ({
  page,
}) => {
  await openApp(page);
  await page
    .getByRole("tablist", { name: "Panels" })
    .getByRole("tab", { name: "Brushes", exact: true })
    .click();

  const panel = page.getByRole("tabpanel", { name: "Brushes", exact: true });
  await expect(panel).toBeVisible();

  const krita = panel.getByRole("button", { name: "Krita 4", exact: true });
  await expect(krita).toBeVisible();
  await expect(krita).toHaveAttribute(
    "title",
    `Add the ${KRITA_BRUSHES} Krita 4 default brushes`,
  );

  await krita.click();
  await expect(panel.getByRole("status")).toHaveText(
    `Imported ${KRITA_BRUSHES} brushes.`,
  );

  // The translated names are in the library, not just a count.
  const search = panel.getByLabel("Search brushes");
  await search.fill("Basic-5");
  await expect(
    panel.getByRole("button", { name: "Krita - Basic-5 Size", exact: true }),
  ).toBeVisible();
  await search.fill("Stamp Bokeh");
  await expect(
    panel.getByRole("button", { name: "Krita - Stamp Bokeh", exact: true }),
  ).toBeVisible();

  // The translated brush is a normal user preset: applying it works.
  await panel
    .getByRole("button", { name: "Krita - Stamp Bokeh", exact: true })
    .click();

  // A second press has nothing left to add.
  await search.fill("");
  await krita.click();
  await expect(panel.getByRole("status")).toHaveText(
    "The Krita 4 brushes are already in the library.",
  );
});
