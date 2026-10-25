import { expect, test, type Page } from "@playwright/test";

/**
 * Movable panels in a real browser.
 *
 * The unit suite proves the preference model; this spec proves the gestures a
 * user actually performs: reorder a tab, pull a panel out into its own window,
 * dock it again, and reset the arrangement from the Panels menu.
 *
 * The assertions deliberately talk about the dock and the floating layer, not
 * about pixels. A panel that is still in the DOM but hidden behind another
 * one is not "moved".
 */

async function openApp(page: Page) {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.locator("canvas.canvas-stage__surface").waitFor();
  await page.waitForTimeout(300);
}

function tabNames(page: Page) {
  return page
    .getByRole("tablist", { name: "Panels" })
    .getByRole("tab")
    .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label")));
}

test("dragging a tab reorders the dock", async ({ page }) => {
  await openApp(page);
  expect(await tabNames(page)).toEqual([
    "Color",
    "Brushes",
    "References",
    "Navigator",
    "Shortcuts",
  ]);

  const brushes = page.getByRole("tab", { name: "Brushes" });
  const color = page.getByRole("tab", { name: "Color" });
  await brushes.dragTo(color, { targetPosition: { x: 2, y: 10 } });

  expect(await tabNames(page)).toEqual([
    "Brushes",
    "Color",
    "References",
    "Navigator",
    "Shortcuts",
  ]);
});

test("a panel can be floated, moved and docked again", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "Panel actions" }).click();
  await page.getByRole("menuitem", { name: "Float Color" }).click();

  const floating = page.locator('.floating-panel[data-panel-id="color"]');
  await expect(floating).toBeVisible();
  await expect(page.getByRole("tab", { name: "Color" })).toHaveCount(0);
  expect(await tabNames(page)).toEqual(["Brushes", "References", "Navigator", "Shortcuts"]);

  const before = await floating.boundingBox();
  await floating.getByRole("heading", { name: "Color" }).dragTo(page.locator("body"), {
    targetPosition: { x: 20, y: 20 },
  });
  const after = await floating.boundingBox();
  expect(after?.x).not.toBe(before?.x);

  await floating.getByRole("button", { name: "Dock Color" }).click();
  await expect(floating).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Color" })).toHaveCount(1);
  expect(await tabNames(page)).toEqual([
    "Brushes",
    "References",
    "Navigator",
    "Shortcuts",
    "Color",
  ]);
});

test("dragging a tab onto the canvas floats it", async ({ page }) => {
  await openApp(page);

  const brushes = page.getByRole("tab", { name: "Brushes" });
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await brushes.dispatchEvent("dragstart", { dataTransfer });
  await page.waitForTimeout(50);

  const drop = page.locator(".panel-float-drop");
  await expect(drop).toBeVisible();
  await drop.dispatchEvent("dragover", { dataTransfer });
  await drop.dispatchEvent("drop", { dataTransfer });

  await expect(page.locator('.floating-panel[data-panel-id="brushes"]')).toBeVisible();
  await expect(page.getByRole("tab", { name: "Brushes" })).toHaveCount(0);
});

test("the Panels menu resets the arrangement", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "Panel actions" }).click();
  await page.getByRole("menuitem", { name: "Float Color" }).click();
  await expect(page.locator('.floating-panel[data-panel-id="color"]')).toBeVisible();

  await page.getByRole("menuitem", { name: "Panels" }).click();
  await page.getByRole("menuitem", { name: "Reset Panel Layout" }).click();

  await expect(page.locator('.floating-panel[data-panel-id="color"]')).toHaveCount(0);
  expect(await tabNames(page)).toEqual([
    "Color",
    "Brushes",
    "References",
    "Navigator",
    "Shortcuts",
  ]);
});
