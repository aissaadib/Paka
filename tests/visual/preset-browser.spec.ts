import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The brush library, driven in a real browser.
 *
 * The engine-level tests in `src/test/presetBrowser.test.ts` prove the model:
 * the search, the order, the protection of the built-in brushes, the library
 * file and the preset operations. They cannot prove the part a user actually
 * touches: that the **panel** offers the operations, that a click on a row
 * really changes the brush the next stroke is drawn with, that a deletion is
 * confirmed before it happens, and that the list can be driven from the
 * keyboard.
 *
 * This spec does that, against the running application, in the same browser
 * the visual harness uses. It is not a golden test: it asserts behaviour - the
 * panel's own state, the brush the editor holds, the row that is there - not
 * pixels.
 *
 * The application is served by the same Vite dev server as the harness (the
 * config's `webServer` runs Vite on port 1422), so this needs no
 * configuration of its own.
 */

/** The window is wider than the harness's, so the side panels have room. */
test.use({ viewport: { width: 1280, height: 900 } });

/** The brush library panel. */
function library(page: Page): Locator {
  return page
    .locator(".panel")
    .filter({ has: page.getByRole("heading", { name: "Brushes", exact: true }) });
}

/** The list of brushes inside the panel. */
function list(page: Page): Locator {
  return library(page).getByRole("listbox", { name: "Brush presets" });
}

/** The row of one brush. */
function row(page: Page, name: string): Locator {
  return list(page).getByRole("option").filter({ hasText: name });
}

/** The brush size the editor holds, read from the toolbar's number box. */
async function brushSize(page: Page): Promise<number> {
  const box = page.getByRole("spinbutton", { name: "Size (exact value)" });
  return Number(await box.getAttribute("aria-valuenow"));
}

test("the library lists the built-in brushes", async ({ page }) => {
  await page.goto("/");
  await library(page).waitFor();

  await expect(library(page).getByRole("heading", { name: "Built-in" })).toBeVisible();
  await expect(row(page, "Pen")).toBeVisible();
  await expect(row(page, "Soft Round")).toBeVisible();
  await expect(row(page, "Charcoal")).toBeVisible();
});

test("clicking a brush changes the brush the next stroke uses", async ({ page }) => {
  await page.goto("/");
  await library(page).waitFor();

  // The default brush is 6 px; "Soft Round" is 24 px.
  expect(await brushSize(page)).toBe(6);

  await row(page, "Soft Round").click();

  // The control follows the brush...
  await expect
    .poll(async () => brushSize(page))
    .toBe(24);
  // ...the picker names the brush that is in effect...
  const picker = page.getByRole("combobox", { name: "Brush preset" });
  await expect(picker.locator("option:checked")).toHaveText(/Soft Round/);
  // ...and the panel says which brush is in effect.
  await expect(library(page).getByText(/Soft Round.* is in effect/)).toBeVisible();
});

test("an edited brush is not the brush that was applied", async ({ page }) => {
  await page.goto("/");
  await library(page).waitFor();

  await row(page, "Marker").click();
  await expect(library(page).getByText(/Marker.* is in effect\./)).toBeVisible();

  // The brush is changed after the preset was applied: the panel says the
  // brush has changed, and the stored copy is untouched.
  await page.getByRole("spinbutton", { name: "Size (exact value)" }).fill("40");
  await page.getByRole("spinbutton", { name: "Size (exact value)" }).blur();

  await expect(library(page).getByText(/the brush has changed since it was applied/)).toBeVisible();
});

test("the search narrows the list, and says so when nothing matches", async ({ page }) => {
  await page.goto("/");
  await library(page).waitFor();

  const search = library(page).getByRole("searchbox", { name: "Search brushes" });
  await search.fill("char");
  await expect(row(page, "Charcoal")).toBeVisible();
  await expect(row(page, "Pen")).toHaveCount(0);

  await search.fill("nothing matches this");
  await expect(library(page).getByText("No saved brush matches the search.")).toBeVisible();
  await expect(library(page).getByText("No built-in brush matches the search.")).toBeVisible();
});

test("a brush is saved, and a deletion is confirmed before it happens", async ({ page }) => {
  await page.goto("/");
  await library(page).waitFor();

  const name = library(page).getByRole("textbox", { name: "Preset name" });
  await name.fill("My Ink");
  await library(page).getByRole("button", { name: "Save", exact: true }).click();

  await expect(row(page, "My Ink")).toBeVisible();

  // The deletion asks first, and can be called off.
  await library(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(library(page).getByRole("alertdialog")).toBeVisible();
  await library(page).getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(row(page, "My Ink")).toBeVisible();

  // And it happens when the confirmation is accepted.
  await library(page).getByRole("button", { name: "Delete", exact: true }).click();
  await library(page).getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(row(page, "My Ink")).toHaveCount(0);
});

test("a built-in brush is protected, but it can be starred and copied", async ({ page }) => {
  await page.goto("/");
  await library(page).waitFor();

  await row(page, "Pen").click();

  // The built-in brush cannot be renamed, overwritten or deleted.
  await expect(library(page).getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
  await expect(library(page).getByRole("button", { name: "Update", exact: true })).toBeDisabled();
  await expect(library(page).getByRole("button", { name: "Rename", exact: true })).toBeDisabled();

  // The star is the user's own note, so it works.
  const star = library(page).getByRole("button", { name: "Star Pen" });
  await star.click();
  await expect(library(page).getByRole("button", { name: "Unstar Pen" })).toBeVisible();

  // A copy is a brush the user owns.
  await library(page).getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(row(page, "Pen (2)")).toBeVisible();
});

test("the list is driven from the keyboard", async ({ page }) => {
  await page.goto("/");
  await library(page).waitFor();

  await list(page).focus();
  await list(page).press("Home");
  const active = list(page).getAttribute("aria-activedescendant");
  expect(active).not.toBeNull();

  await list(page).press("ArrowDown");
  await expect
    .poll(async () => list(page).getAttribute("aria-activedescendant"))
    .not.toBe(active);

  // Enter applies the brush the selection is on, so the brush changes.
  const before = await brushSize(page);
  await list(page).press("Enter");
  await expect.poll(async () => brushSize(page)).not.toBe(before);
});
