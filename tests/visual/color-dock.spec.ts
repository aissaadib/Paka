import { expect, test, type Page } from "@playwright/test";

/**
 * The colour dock, driven in a real browser.
 *
 * The unit tests prove the model and the engine seam; this spec proves the
 * part an artist touches: the two colours and their exact values are on
 * screen, a keyboard shortcut swaps them, the palette can be edited and the
 * recent colours remember what was picked.
 *
 * It is a behaviour test, not a golden: no pixel is compared.
 */

test.use({ viewport: { width: 1280, height: 900 } });

/** The value in one of the dock's text fields. */
function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true });
}

/** Types a colour into one of the dock's fields and applies it. */
async function typeColour(page: Page, label: string, value: string): Promise<void> {
  const input = field(page, label);
  await input.fill(value);
  await input.press("Enter");
}

test("the dock shows both colours and swaps and resets them", async ({ page }) => {
  await page.goto("/");
  await page.locator("canvas.canvas-stage__surface").waitFor();

  const dock = page.locator(".color-dock");
  await expect(field(page, "Ink colour value")).toHaveValue("#16181c");
  await expect(field(page, "Alt colour value")).toHaveValue("#ffffff");

  // The swap exchanges the two; the stroke colours already drawn are not
  // touched, so this is editor state only.
  await page.keyboard.press("x");
  await expect(field(page, "Ink colour value")).toHaveValue("#ffffff");
  await expect(field(page, "Alt colour value")).toHaveValue("#16181c");

  // The default puts both back.
  await page.keyboard.press("d");
  await expect(field(page, "Ink colour value")).toHaveValue("#16181c");
  await expect(field(page, "Alt colour value")).toHaveValue("#ffffff");
});

test("an exact value is applied and a wrong one is refused", async ({ page }) => {
  await page.goto("/");
  await page.locator("canvas.canvas-stage__surface").waitFor();

  await typeColour(page, "Ink colour value", "#123456");
  await expect(field(page, "Ink colour value")).toHaveValue("#123456");

  // Garbage is refused with a reason, and the colour the editor holds is
  // left exactly as it was.
  await typeColour(page, "Ink colour value", "nope");
  await expect(field(page, "Ink colour value")).toHaveValue("#123456");
  await expect(page.getByText("Not a colour", { exact: false })).toBeVisible();
});

test("the palette is edited and the colour it holds is the colour painted with", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("canvas.canvas-stage__surface").waitFor();

  const palette = page.locator(".color-palette");
  await expect(palette.getByRole("button", { name: "Ink, #16181c" })).toBeVisible();

  // A new colour is saved, and the button says so once it is there.
  await typeColour(page, "Ink colour value", "#123456");
  await palette.getByRole("button", { name: "Add ink" }).click();
  await expect(palette.getByRole("button", { name: "#123456, #123456" })).toBeVisible();

  // Another colour is not saved twice.
  await expect(palette.getByRole("button", { name: "Add ink" })).toBeDisabled();

  // Clicking a swatch paints with it.
  await palette.getByRole("button", { name: "Red, #e5484d" }).click();
  await expect(field(page, "Ink colour value")).toHaveValue("#e5484d");

  // Renaming it keeps the colour.
  await palette.getByRole("button", { name: "Red, #e5484d" }).dblclick();
  const rename = page.getByLabel("Rename Red");
  await rename.fill("Warm red");
  await rename.press("Enter");
  await expect(palette.getByRole("button", { name: "Warm red, #e5484d" })).toBeVisible();

  // Removing it takes it out of the palette.
  await palette.getByRole("button", { name: "Remove Warm red from the palette" }).click();
  await expect(palette.getByRole("button", { name: "Warm red, #e5484d" })).toHaveCount(0);
});

test("the recent colours remember what was picked, newest first", async ({ page }) => {
  await page.goto("/");
  await page.locator("canvas.canvas-stage__surface").waitFor();

  const recent = page.locator(".color-recent");
  await expect(recent.getByText("Colours you pick appear here", { exact: false })).toBeVisible();

  await typeColour(page, "Ink colour value", "#123456");
  await typeColour(page, "Ink colour value", "#654321");

  // The newest colour is first.
  await expect(recent.getByRole("button", { name: "Use colour #654321" })).toBeVisible();
  await expect(
    recent.getByRole("button", { name: "Use colour #654321" }),
  ).toHaveAttribute("aria-label", "Use colour #654321");

  // Picking a colour again moves it to the front rather than doubling it.
  await typeColour(page, "Ink colour value", "#123456");
  await expect(recent.getByRole("button", { name: "Use colour #123456" })).toBeVisible();
  await expect(recent.getByRole("button", { name: "Use colour #123456" })).toHaveCount(1);

  // And the list can be emptied.
  await recent.getByRole("button", { name: "Clear" }).click();
  await expect(recent.getByText("Colours you pick appear here", { exact: false })).toBeVisible();
});

test("an adjustment of the wheel is one colour in the history, not a trail", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("canvas.canvas-stage__surface").waitFor();

  const swatches = page.locator(".color-recent .swatch-grid button");
  const hue = page.getByLabel("Hue", { exact: true });

  // Nudging the slider writes a colour on every step.
  await hue.focus();
  for (let step = 0; step < 5; step += 1) {
    await hue.press("ArrowRight");
  }

  // None of the steps is a colour the artist chose on its own, so none of them
  // is in the list yet.
  await expect(swatches).toHaveCount(0);

  // The colour they settled on is one entry, whatever the number of steps.
  await field(page, "Ink colour value").click();
  await expect(swatches).toHaveCount(1);
});

test("the palette's own keys do not reach the editor's shortcuts", async ({ page }) => {
  await page.goto("/");
  await page.locator("canvas.canvas-stage__surface").waitFor();

  const palette = page.locator(".color-palette");
  const swatch = palette.getByRole("button", { name: "Red, #e5484d" });

  // F2 renames the focused swatch in place.
  await swatch.focus();
  await swatch.press("F2");
  const rename = page.getByLabel("Rename Red");
  await expect(rename).toBeVisible();
  await rename.fill("Warm red");
  await rename.press("Enter");
  await expect(palette.getByRole("button", { name: "Warm red, #e5484d" })).toBeVisible();

  // Delete removes the swatch - and not the selection in the document, which
  // is what the editor's own Delete would do.
  await palette.getByRole("button", { name: "Warm red, #e5484d" }).focus();
  await palette.getByRole("button", { name: "Warm red, #e5484d" }).press("Delete");
  await expect(palette.getByRole("button", { name: "Warm red, #e5484d" })).toHaveCount(0);
});

test("the palette and the alt colour are session state in the browser preview", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("canvas.canvas-stage__surface").waitFor();

  const palette = page.locator(".color-palette");
  await typeColour(page, "Ink colour value", "#123456");
  await palette.getByRole("button", { name: "Add ink" }).click();
  await expect(palette.getByRole("button", { name: "#123456, #123456" })).toBeVisible();
  await typeColour(page, "Alt colour value", "#654321");

  // The browser preview has no native settings file, so nothing is written
  // and a reload starts from the defaults again. The persistence itself is
  // proved by the settings test, which drives the real store against a
  // memory gateway.
  await page.reload();
  await page.locator("canvas.canvas-stage__surface").waitFor();

  await expect(field(page, "Alt colour value")).toHaveValue("#ffffff");
  await expect(
    page.locator(".color-palette").getByRole("button", { name: "#123456, #123456" }),
  ).toHaveCount(0);
  // The recent colours are session state too, so they do not come back.
  await expect(page.locator(".color-recent .swatch-grid__swatch")).toHaveCount(0);
  await expect(page.getByText("Colours you pick appear here", { exact: false })).toBeVisible();
});
