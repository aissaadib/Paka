import { expect, test, type Page } from "@playwright/test";

/**
 * The colour comparison, driven in a real browser.
 *
 * The unit tests prove the arithmetic; this spec proves the part a user
 * touches: two colour inputs, the WCAG guidance and the CIEDE2000 readout are
 * on screen, and changing either input changes the numbers. It is a
 * behaviour test, not a golden: no pixel is compared.
 */

test.use({ viewport: { width: 1280, height: 900 } });

/** `input[type=color]` cannot be typed into; set its value and notify React. */
async function setColour(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await input.evaluate((element, colour) => {
    const field = element as HTMLInputElement;
    // React tracks the previous value on the element, so assigning
    // `field.value` directly is invisible to it. Go through the native
    // setter, then dispatch the events a real colour picker dispatches.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(field, colour);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("the colour panel compares two colours and updates both metrics", async ({ page }) => {
  await page.goto("/");
  await page.locator("canvas.canvas-stage__surface").waitFor();

  const panel = page.locator(".color-readout");
  await expect(panel.getByText("Compare colours", { exact: true })).toBeVisible();

  await setColour(page, "Ink colour", "#000000");
  await setColour(page, "Comparison colour", "#ffffff");

  await expect(panel.getByText("21.0:1", { exact: true })).toBeVisible();
  await expect(panel.getByText("Meets AAA body text (7:1)", { exact: true })).toBeVisible();
  await expect(panel.getByText("100.00", { exact: true })).toBeVisible();
  await expect(panel.getByText("CIEDE2000", { exact: true })).toBeVisible();

  // Changing the comparison colour changes the same two numbers.
  await setColour(page, "Comparison colour", "#000000");
  await expect(panel.getByText("1.0:1", { exact: true })).toBeVisible();
  await expect(panel.getByText("0.00", { exact: true })).toBeVisible();
  await expect(panel.getByText("Below AA text (3:1)", { exact: true })).toBeVisible();

  // Changing the ink also updates the pair. #777777 is just below 4.5:1, so
  // the printed one-decimal value rounds up to 4.5 while the unrounded
  // guidance still says "large text only".
  await setColour(page, "Comparison colour", "#ffffff");
  await setColour(page, "Ink colour", "#777777");
  await expect(panel.getByText("4.5:1", { exact: true })).toBeVisible();
  await expect(panel.getByText("Meets AA large text (3:1)", { exact: true })).toBeVisible();
});
