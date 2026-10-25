import { expect, test } from "@playwright/test";

/**
 * The New Document presets, driven in a real browser.
 *
 * The unit tests prove every preset is a legal document. This spec proves the
 * part a user meets: the buttons are in the dialog, choosing one fills both
 * fields, the selected state follows, and a 4K preset really becomes a 4K
 * document. It is a behaviour test, not a golden: no pixel is compared.
 */

const CANVAS = "canvas.canvas-stage__surface";

test.use({ viewport: { width: 1280, height: 900 } });

test("the bigger canvas presets fill the fields and create the document", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Document…", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "New Document" });
  await expect(dialog).toBeVisible();

  const presets = dialog.getByRole("group", { name: "Canvas size presets" });
  await expect(presets.getByRole("button")).toHaveCount(6);

  const width = dialog.getByRole("spinbutton", { name: "Width", exact: true });
  const height = dialog.getByRole("spinbutton", { name: "Height", exact: true });

  // The default is still the original 1600x1200, so no preset starts active.
  await expect(width).toHaveValue("1600");
  await expect(height).toHaveValue("1200");

  const fourK = presets.getByRole("button", { name: /4K UHD/ });
  await fourK.click();
  await expect(width).toHaveValue("3840");
  await expect(height).toHaveValue("2160");
  await expect(fourK).toHaveAttribute("aria-pressed", "true");

  // The largest square the raster budget allows is one click away and is
  // distinct from 4K UHD.
  const square = presets.getByRole("button", { name: /Square max/ });
  await square.click();
  await expect(width).toHaveValue("4096");
  await expect(height).toHaveValue("4096");
  await expect(square).toHaveAttribute("aria-pressed", "true");
  await expect(fourK).toHaveAttribute("aria-pressed", "false");

  // Go back to 4K and create it: large enough to prove the preset reaches the
  // engine, small enough to keep the browser suite's allocation modest.
  await fourK.click();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".status-bar")).toContainText("3840 × 2160 px");
});
