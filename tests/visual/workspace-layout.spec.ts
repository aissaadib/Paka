import { expect, test, type Page } from "@playwright/test";

/**
 * The workspace layout, driven in a real browser.
 *
 * The tests in `src/test/workspaceSettings.test.ts` prove the schema, the
 * profiles and the store. They cannot prove the part a user actually touches:
 * that the **Workspace menu** offers the profiles, and that choosing one
 * really **changes the shell** - the side panels go, the tool rail goes, the
 * interface gets smaller - rather than only moving a label.
 *
 * This spec does that, against the running application, in the same browser
 * the visual harness uses. It is not a golden test: it asserts behaviour - the
 * menu's own state and what is on screen afterwards - not pixels.
 *
 * The application is served by the same Vite dev server as the harness (the
 * config's `webServer` runs Vite on port 1422), so this needs no
 * configuration of its own.
 */

/** The window is wider than the harness's, so the panels have room to show. */
test.use({ viewport: { width: 1280, height: 900 } });

/** Opens the Workspace menu. */
async function openWorkspaceMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
}

/** Waits for the shell to be on screen. */
async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
}

/** Chooses an entry of the Workspace menu and closes it. */
async function chooseWorkspaceEntry(page: Page, label: string): Promise<void> {
  await openWorkspaceMenu(page);
  await page.getByRole("menuitemcheckbox", { name: label, exact: true }).click();
}

test("the Workspace menu offers the profiles and the preferences", async ({ page }) => {
  await openApp(page);

  await openWorkspaceMenu(page);

  // The two presets are there, and the preferences that make up an
  // arrangement are there too.
  await expect(page.getByRole("menuitemcheckbox", { name: "Painting" })).toBeVisible();
  await expect(page.getByRole("menuitemcheckbox", { name: "Compact Canvas" })).toBeVisible();
  await expect(page.getByRole("menuitemcheckbox", { name: "Tool Rail" })).toBeVisible();
  await expect(page.getByRole("menuitemcheckbox", { name: "Advanced Brush Controls" })).toBeVisible();
  await expect(page.getByRole("menuitemcheckbox", { name: "Dark Scheme" })).toBeVisible();
  await expect(page.getByRole("menuitemcheckbox", { name: "Light Scheme" })).toBeVisible();
});

test("the Compact Canvas profile really rearranges the shell", async ({ page }) => {
  await openApp(page);

  // The shell starts with the panels and the tool rail up.
  await expect(page.locator(".side-panels > .panel:visible").first()).toBeVisible();
  await expect(page.locator(".tool-rail")).toBeVisible();

  await chooseWorkspaceEntry(page, "Compact Canvas");

  // No panel is on screen and the tool rail has taken no space, so the canvas
  // has the window. A panel that keeps state of its own stays mounted while
  // it is hidden, so the count of *visible* panels is what matters.
  await expect(page.locator(".side-panels > .panel:visible")).toHaveCount(0);
  await expect(page.locator(".tool-rail")).toHaveCount(0);
  await expect(page.locator(".side-panels")).toHaveJSProperty("clientWidth", 0);

  // And the menu says so honestly.
  await openWorkspaceMenu(page);
  await expect(page.getByRole("menuitemcheckbox", { name: "Compact Canvas" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("menuitemcheckbox", { name: "Painting" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("the Painting profile puts the shell back", async ({ page }) => {
  await openApp(page);

  await chooseWorkspaceEntry(page, "Compact Canvas");
  await chooseWorkspaceEntry(page, "Painting");

  await expect(page.locator(".side-panels > .panel:visible").first()).toBeVisible();
  await expect(page.locator(".tool-rail")).toBeVisible();
});

test("the colour scheme follows the menu", async ({ page }) => {
  await openApp(page);

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await chooseWorkspaceEntry(page, "Light Scheme");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await chooseWorkspaceEntry(page, "Dark Scheme");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("the interface scale follows the menu", async ({ page }) => {
  await openApp(page);

  const scale = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
    );

  expect(await scale()).toBe("1");

  await chooseWorkspaceEntry(page, "Scale 125%");
  expect(await scale()).toBe("1.25");

  await chooseWorkspaceEntry(page, "Scale 80%");
  expect(await scale()).toBe("0.8");
});

test("Restore Workspace Defaults puts the shell back", async ({ page }) => {
  await openApp(page);

  await chooseWorkspaceEntry(page, "Compact Canvas");
  await chooseWorkspaceEntry(page, "Light Scheme");

  await openWorkspaceMenu(page);
  await page.getByRole("menuitem", { name: "Restore Workspace Defaults" }).click();

  await expect(page.locator(".side-panels > .panel:visible").first()).toBeVisible();
  await expect(page.locator(".tool-rail")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
