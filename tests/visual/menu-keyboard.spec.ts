import { expect, test, type Page } from "@playwright/test";

/**
 * The menu bar's keyboard model, driven in a real browser.
 *
 * The unit tests in `src/test/menuNavigation.test.ts` prove the rules: which
 * entry the focus is on and what a key does. They cannot prove the part a
 * user actually touches - that the DOM focus really follows the rules, that
 * the popup really opens and closes, that a disabled entry is stepped over,
 * and that the menu does not swallow the editor's own shortcuts.
 *
 * This spec does that, against the running application, in the same browser
 * the visual harness uses. It is not a golden test: it asserts behaviour - the
 * focus, the popup and the command that ran - not pixels.
 */

const CANVAS = "canvas.canvas-stage__surface";

/** The window is wider than the harness's, so the canvas has room. */
test.use({ viewport: { width: 1280, height: 900 } });

/** A menu of the bar, by its label. */
function trigger(page: Page, label: string) {
  return page.getByRole("menuitem", { name: label, exact: true });
}

/**
 * The label of the entry that holds the focus.
 *
 * The label is the entry's first span: the second one holds the chord, so
 * the whole text of the button is "Open…Ctrl+O".
 */
async function focusedLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active) {
      return "";
    }
    const label = active.querySelector("span");
    return label?.textContent ?? active.textContent ?? "";
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
});

test("the arrow keys walk the entries and step over the separators", async ({ page }) => {
  await trigger(page, "File").click();
  await expect(page.getByRole("menu")).toBeVisible();

  await page.keyboard.press("ArrowDown");
  expect(await focusedLabel(page)).toBe("New Document…");

  await page.keyboard.press("ArrowDown");
  expect(await focusedLabel(page)).toBe("Open…");

  // The separator between "Open…" and "Save" is not an entry.
  await page.keyboard.press("ArrowDown");
  expect(await focusedLabel(page)).toBe("Save");

  // The walk wraps around.
  await page.keyboard.press("ArrowUp");
  expect(await focusedLabel(page)).toBe("Open…");
});

test("the arrow keys move between the menus", async ({ page }) => {
  await trigger(page, "File").click();
  await page.keyboard.press("ArrowRight");

  await expect(page.getByRole("menu")).toBeVisible();
  // "Undo" and "Redo" are disabled with no history, so the focus steps over
  // them and lands on the first entry that can run.
  expect(await focusedLabel(page)).toBe("Duplicate Layer");

  await page.keyboard.press("ArrowLeft");
  expect(await focusedLabel(page)).toBe("New Document…");
});

test("a menu whose entries are all disabled keeps the focus on its trigger", async ({ page }) => {
  await trigger(page, "File").click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");

  // The Selection menu has nothing to offer without a selection.
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(trigger(page, "Selection")).toBeFocused();
});

test("Enter runs the focused entry", async ({ page }) => {
  await trigger(page, "File").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "New Document" })).toBeVisible();
});

test("Escape closes the popup and gives the focus back to the trigger", async ({ page }) => {
  await trigger(page, "File").click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menu")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger(page, "File")).toBeFocused();
});

test("Tab closes the popup and leaves the menu bar", async ({ page }) => {
  await trigger(page, "File").click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menu")).toBeVisible();

  await page.keyboard.press("Tab");

  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger(page, "Edit")).toBeFocused();
});

test("the menu shows the chord the registry defines", async ({ page }) => {
  await trigger(page, "File").click();

  await expect(page.getByRole("menuitem", { name: "Open…" })).toContainText(/Ctrl\+O|Cmd\+O/);
  await expect(page.getByRole("menuitem", { name: "Save As…" })).toContainText(
    /Ctrl\+Shift\+S|Cmd\+Shift\+S/,
  );
});

test("the editor's own shortcuts still work while no menu is open", async ({ page }) => {
  // The menu bar claims no key while it does not hold the focus.
  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: "Eraser", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
