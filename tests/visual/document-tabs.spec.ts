import { expect, test, type Page } from "@playwright/test";

/**
 * The document tabs, driven in a real browser.
 *
 * The engine-level tests in `src/test/documentSessions.test.ts` prove that
 * every open document has an engine of its own, and therefore its own
 * history, selection and viewport. They cannot prove the part a user
 * actually touches: that the strip shows the open documents, that switching
 * tab really swaps the canvas, that a drawing survives the round trip, and
 * that a tab with unsaved changes is never closed without asking.
 *
 * This spec does that against the running application. It asserts behaviour,
 * not pixels.
 */

const CANVAS = "canvas.canvas-stage__surface";
const TABS = ".document-tabs";
const TAB = ".document-tab";
const TAB_TITLE = ".document-tab__title";
const TAB_DIRTY = ".document-tab__dirty";
const STATUS_BAR = "footer.status-bar";

/** A small laptop: the strip has to fit in it. */
test.use({ viewport: { width: 1366, height: 768 } });

/** Opens the app and waits for the canvas. */
async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
}

/** The titles of the open tabs, in order. */
async function tabTitles(page: Page): Promise<string[]> {
  return page.locator(TAB_TITLE).allInnerTexts();
}

/** Draws a short stroke in the middle of the canvas. */
async function drawStroke(page: Page): Promise<void> {
  const box = await page.locator(CANVAS).boundingBox();
  if (!box) {
    throw new Error("the canvas has no box");
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 8 });
  await page.mouse.up();
}

test("the strip shows the open documents", async ({ page }) => {
  await openApp(page);

  // One document is open, and the strip says so.
  await expect(page.locator(TAB)).toHaveCount(1);
  await expect(page.locator(TAB_TITLE)).toHaveText(/Untitled/);
  // The tab on screen is the active one.
  await expect(page.locator(TAB).first()).toHaveClass(/is-active/);
});

test("a new document opens in its own tab and keeps the drawing on screen", async ({ page }) => {
  await openApp(page);
  await drawStroke(page);

  // The first document is now dirty, and says so.
  await expect(page.locator(TAB_DIRTY)).toHaveCount(1);
  await expect(page.locator(STATUS_BAR)).toContainText("unsaved");

  await page.getByRole("button", { name: "New document", exact: true }).click();
  await page.getByRole("button", { name: /^Create/ }).click();

  // A second tab, and the drawing is still in the first one.
  await expect(page.locator(TAB)).toHaveCount(2);
  await expect(page.locator(STATUS_BAR)).not.toContainText("unsaved");

  // The first tab is still marked: its drawing was not thrown away.
  await expect(page.locator(TAB_DIRTY)).toHaveCount(1);
});

test("each tab keeps its own drawing and its own history", async ({ page }) => {
  await openApp(page);
  await drawStroke(page);
  await expect(page.locator(STATUS_BAR)).toContainText("history 1");

  await page.getByRole("button", { name: "New document", exact: true }).click();
  await page.getByRole("button", { name: /^Create/ }).click();

  // The new document has no history of its own.
  await expect(page.locator(STATUS_BAR)).toContainText("history 0");
  await expect(page.locator(STATUS_BAR)).not.toContainText("unsaved");

  // Back to the first tab: its history is still there.
  await page.locator(TAB).first().getByRole("button").first().click();
  await expect(page.locator(STATUS_BAR)).toContainText("history 1");
  await expect(page.locator(STATUS_BAR)).toContainText("unsaved");
});

test("a tab with unsaved changes is not closed without asking", async ({ page }) => {
  await openApp(page);
  await drawStroke(page);

  await page.locator(TAB).first().getByRole("button", { name: /^Close/ }).click();

  // The question is asked, and the tab is still there.
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.locator(TAB)).toHaveCount(1);

  // Cancel keeps the document and its drawing.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator(TAB)).toHaveCount(1);
  await expect(page.locator(STATUS_BAR)).toContainText("unsaved");
});

test("a clean tab closes without a question", async ({ page }) => {
  await openApp(page);

  await page.locator(TAB).first().getByRole("button", { name: /^Close/ }).click();

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  // The editor always has a document to draw on.
  await expect(page.locator(TAB)).toHaveCount(1);
});

test("the strip does not push the canvas out of a small window", async ({ page }) => {
  await openApp(page);

  const strip = await page.locator(TABS).boundingBox();
  const canvas = await page.locator(CANVAS).boundingBox();
  const viewport = page.viewportSize();
  expect(strip).not.toBeNull();
  expect(canvas).not.toBeNull();

  // The strip is inside the window, and the canvas starts below it.
  expect(strip!.x).toBeGreaterThanOrEqual(0);
  expect(strip!.x + strip!.width).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
  expect(canvas!.y).toBeGreaterThanOrEqual(strip!.y + strip!.height - 1);
  // And the canvas still has a real height.
  expect(canvas!.height).toBeGreaterThan(200);
});
