import { expect, test, type Page } from "@playwright/test";

/**
 * The shortcut editor, driven in a real browser.
 *
 * The unit tests in `src/test/shortcutEditor.test.ts` prove the rules: what
 * is refused, what counts as a conflict, what a reset does. They cannot prove
 * the part a user actually touches: that the editor **captures** a key press,
 * that it **says** which action holds a conflicting chord, and that a rebound
 * shortcut really **runs the command** instead of only changing a label.
 *
 * The application is served by the same Vite dev server as the harness (the
 * config's `webServer` runs Vite on port 1422), so this needs no configuration
 * of its own.
 */

test.use({ viewport: { width: 1280, height: 900 } });

/** Opens the shortcut editor from the Help menu. */
async function openEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("menuitem", { name: "Keyboard Shortcuts…", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Narrows the list to the actions whose name contains the text. */
async function search(page: Page, text: string): Promise<void> {
  await page.getByLabel("Search actions").fill(text);
}

test("the editor lists the actions with the shortcut the app answers to", async ({ page }) => {
  await page.goto("/");
  await openEditor(page);

  await expect(page.getByRole("button", { name: /^Save: Ctrl\+S\./ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Brush: B\./ })).toBeVisible();
  // The actions are grouped, so the list is readable.
  await expect(page.getByRole("heading", { name: "Tools", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "File", exact: true })).toBeVisible();
});

test("the editor owns the keyboard while it is open", async ({ page }) => {
  await page.goto("/");
  await openEditor(page);

  // The eraser answers to E, but the dialog is modal: the key must not run
  // the command behind it.
  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: "Eraser", exact: true })).not.toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: "Eraser", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a rebound shortcut runs the real command", async ({ page }) => {
  await page.goto("/");
  await openEditor(page);

  await search(page, "Line");
  await page.getByRole("button", { name: /^Line: L\./ }).click();
  await page.keyboard.press("k");

  // The editor shows the new chord.
  await expect(page.getByRole("button", { name: /^Line: K\./ })).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();

  // And the app answers to it: the line tool is now the active one.
  await page.keyboard.press("k");
  await expect(page.getByRole("button", { name: "Line", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The old chord does not select the tool any more: the brush still answers
  // to B, and L no longer reaches the line tool.
  await page.keyboard.press("b");
  await expect(page.getByRole("button", { name: "Brush", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("l");
  await expect(page.getByRole("button", { name: "Line", exact: true })).not.toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a conflict names the action that holds the chord", async ({ page }) => {
  await page.goto("/");
  await openEditor(page);

  await search(page, "Save");
  await page.getByRole("button", { name: /^Save: Ctrl\+S\./ }).click();
  await page.keyboard.press("Control+j");

  await expect(page.getByText(/already used by/)).toBeVisible();
  await expect(page.getByText("Duplicate Layer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Swap the two", exact: true })).toBeVisible();

  // Nothing was stored while the question was open.
  await expect(page.getByRole("button", { name: /^Save: Ctrl\+S\./ })).toBeVisible();
});

test("the swap exchanges the two shortcuts", async ({ page }) => {
  await page.goto("/");
  await openEditor(page);

  await search(page, "Save");
  await page.getByRole("button", { name: /^Save: Ctrl\+S\./ }).click();
  await page.keyboard.press("Control+j");
  await page.getByRole("button", { name: "Swap the two", exact: true }).click();

  await expect(page.getByRole("button", { name: /^Save: Ctrl\+J\./ })).toBeVisible();
  // The other action took the chord Save had.
  await search(page, "Duplicate Layer");
  await expect(page.getByRole("button", { name: /^Duplicate Layer: Ctrl\+S\./ })).toBeVisible();
});

test("a chord the operating system owns is refused", async ({ page }) => {
  await page.goto("/");
  await openEditor(page);

  await search(page, "Save");
  await page.getByRole("button", { name: /^Save: Ctrl\+S\./ }).click();
  await page.keyboard.press("Control+w");

  await expect(page.getByText(/not available/)).toBeVisible();
  // The shortcut is untouched.
  await expect(page.getByRole("button", { name: /^Save: Ctrl\+S\./ })).toBeVisible();
});

test("escape cancels the capture", async ({ page }) => {
  await page.goto("/");
  await openEditor(page);

  await search(page, "Save");
  await page.getByRole("button", { name: /^Save: Ctrl\+S\./ }).click();
  await page.keyboard.press("k");
  await expect(page.getByRole("button", { name: /^Save: K\./ })).toBeVisible();

  await page.getByRole("button", { name: /^Save: K\./ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Save: K\./ })).toBeVisible();
  // The dialog is still open: Esc cancels the capture, it does not close it.
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("reset puts the defaults back", async ({ page }) => {
  await page.goto("/");
  await openEditor(page);

  await search(page, "Save");
  await page.getByRole("button", { name: /^Save: Ctrl\+S\./ }).click();
  await page.keyboard.press("k");
  await expect(page.getByRole("button", { name: /^Save: K\./ })).toBeVisible();

  await page.getByRole("button", { name: "Reset all", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Save: Ctrl\+S\./ })).toBeVisible();
});
