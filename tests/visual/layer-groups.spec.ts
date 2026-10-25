import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Layer groups, driven in a real browser.
 *
 * The unit tests pin the tree rules, the engine's commands and the renderer's
 * composite calls. They cannot prove what the artist actually touches: that the
 * group row exists, that a layer can be dragged into it, that collapse is a
 * view-only state, and that deleting a group asks about the layers inside it.
 *
 * This spec does that against the running application. It is a behaviour test,
 * not a golden: it asserts the panel's own state and the history the commands
 * leave behind, not pixels.
 */

const CANVAS = "canvas.canvas-stage__surface";

test.use({ viewport: { width: 1280, height: 900 } });

/** The layers panel, found by its title rather than by its position. */
function layersPanel(page: Page): Locator {
  return page.locator(".panel").filter({ has: page.locator(".panel__title", { hasText: "Layers" }) });
}

/** The row whose name is exactly `name`. */
function layerRow(page: Page, name: string): Locator {
  return layersPanel(page)
    .locator(".layer-row")
    .filter({ has: page.locator(".layer-row__title", { hasText: name }) });
}

/** Renames the row that is currently being edited. */
async function commitRename(page: Page, name: string): Promise<void> {
  const input = layersPanel(page).getByRole("textbox", { name: "Group name" });
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press("Enter");
  await expect(layersPanel(page).getByRole("textbox", { name: "Group name" })).toHaveCount(0);
}

/**
 * Drags a row's grip into the middle of a group row.
 *
 * The middle band is the "into" zone; a group's top and bottom quarters are
 * sibling drops. Playwright's dragTo drives the same HTML5 drag events a mouse
 * does, so the panel's real handlers run.
 */
async function dragIntoGroup(page: Page, sourceName: string, groupName: string): Promise<void> {
  const source = layerRow(page, sourceName).locator(".layer-row__grip");
  const target = layerRow(page, groupName);
  const box = await target.boundingBox();
  if (!box) {
    throw new Error("the group row has no box");
  }
  await source.dragTo(target, { targetPosition: { x: 60, y: Math.round(box.height / 2) } });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
  await expect(layersPanel(page)).toBeVisible();
});

test("creates a group, renames it, and drags a layer into it", async ({ page }) => {
  const panel = layersPanel(page);
  await panel.getByRole("button", { name: "New group", exact: true }).click();

  // The new group is immediately editable: a default name is not yet useful.
  await commitRename(page, "Shading");

  const group = layerRow(page, "Shading");
  await expect(group).toHaveClass(/is-group/);
  await expect(group).toHaveClass(/is-expanded/);

  await dragIntoGroup(page, "Layer 1", "Shading");

  await expect(layerRow(page, "Layer 1")).toHaveCSS("padding-left", "20px");
  await expect(group.locator(".layer-row__count")).toHaveText("1");
  await expect(group.locator(".layer-row__chevron")).toBeVisible();
  await expect(group.locator(".layer-row__name")).toHaveAttribute(
    "title",
    /group with 1 layer/,
  );
});

test("collapses and expands a group, and the keyboard follows the tree", async ({ page }) => {
  const panel = layersPanel(page);
  await panel.getByRole("button", { name: "New group", exact: true }).click();
  await commitRename(page, "Shading");
  await dragIntoGroup(page, "Layer 1", "Shading");

  const group = layerRow(page, "Shading");
  const chevron = group.locator(".layer-row__chevron");
  const history = page.locator(".status-bar").getByText(/^history \d+$/);
  const before = await history.textContent();
  await chevron.click();
  await expect(chevron).toHaveAttribute("aria-expanded", "false");
  await expect(layerRow(page, "Layer 1")).toHaveCount(0);
  // The group keeps the focus and the active layer is still the child.
  await expect(group).toHaveClass(/is-focused/);
  // Collapsing is a view, not an edit: it must not reach the history.
  await expect(history).toHaveText(before ?? "");

  await chevron.click();
  await expect(layerRow(page, "Layer 1")).toBeVisible();
  await expect(history).toHaveText(before ?? "");

  // Right on an expanded group enters its first child; left returns.
  await group.locator(".layer-row__name").focus();
  await page.keyboard.press("ArrowRight");
  await expect(layerRow(page, "Layer 1")).toHaveClass(/is-focused/);
  await page.keyboard.press("ArrowLeft");
  await expect(group).toHaveClass(/is-focused/);
});

test("cancels a rename with Escape and refuses a name that is only spaces", async ({ page }) => {
  const panel = layersPanel(page);
  await panel.getByRole("button", { name: "New group", exact: true }).click();
  await commitRename(page, "Shading");

  const group = layerRow(page, "Shading");
  const history = page.locator(".status-bar").getByText(/^history \d+$/);
  const before = await history.textContent();

  await group.locator(".layer-row__name").dblclick();
  const input = panel.getByRole("textbox", { name: "Group name" });
  await input.fill("Discarded");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(layerRow(page, "Shading")).toBeVisible();
  await expect(layerRow(page, "Discarded")).toHaveCount(0);

  // An empty name is not a name: the old one stays and no history step is
  // recorded. The panel closes the editor rather than leaving it open.
  await group.locator(".layer-row__name").dblclick();
  await input.fill("   ");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(layerRow(page, "Shading")).toBeVisible();
  await expect(history).toHaveText(before ?? "");
});

test("deleting a non-empty group confirms the layers inside it, and undo restores them", async ({
  page,
}) => {
  const panel = layersPanel(page);
  await panel.getByRole("button", { name: "New group", exact: true }).click();
  await commitRename(page, "Shading");
  await dragIntoGroup(page, "Layer 1", "Shading");

  // A second root layer, so the group is not the last paintable layer.
  await panel.getByRole("button", { name: "Add layer", exact: true }).click();
  await layerRow(page, "Shading").locator(".layer-row__name").click();

  await panel.getByRole("button", { name: "Delete group", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("1 layer");
  await expect(dialog).toContainText("Undo brings the whole group back");

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(layerRow(page, "Shading")).toBeVisible();

  await panel.getByRole("button", { name: "Delete group", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete group and layers", exact: true })
    .click();
  await expect(layerRow(page, "Shading")).toHaveCount(0);
  await expect(layerRow(page, "Layer 1")).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(layerRow(page, "Shading")).toBeVisible();
  await expect(layerRow(page, "Layer 1")).toBeVisible();
});

test("an empty group is removed without a question", async ({ page }) => {
  const panel = layersPanel(page);
  await panel.getByRole("button", { name: "New group", exact: true }).click();
  await commitRename(page, "Empty");

  await layerRow(page, "Empty").locator(".layer-row__name").click();
  await panel.getByRole("button", { name: "Delete group", exact: true }).click();

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(layerRow(page, "Empty")).toHaveCount(0);
});

test("group visibility hides the children, and the group's own opacity is editable", async ({
  page,
}) => {
  const panel = layersPanel(page);
  await panel.getByRole("button", { name: "New group", exact: true }).click();
  await commitRename(page, "Shading");
  await dragIntoGroup(page, "Layer 1", "Shading");

  const group = layerRow(page, "Shading");
  await group.getByRole("button", { name: "Hide Shading", exact: true }).click();
  await expect(group).toHaveClass(/is-hidden/);
  await expect(layerRow(page, "Layer 1")).toHaveClass(/is-inherited-hidden/);
  await group.getByRole("button", { name: "Show Shading", exact: true }).click();
  await expect(group).not.toHaveClass(/is-hidden/);

  await group.locator(".layer-row__opacity").click();
  const opacity = group.getByRole("spinbutton", { name: "Opacity of Shading, in percent" });
  await opacity.fill("50");
  await opacity.press("Enter");
  await expect(group.locator(".layer-row__opacity")).toHaveText("50%");
});

test("the accessible Inside selector moves a child out of its group", async ({ page }) => {
  const panel = layersPanel(page);
  await panel.getByRole("button", { name: "New group", exact: true }).click();
  await commitRename(page, "Shading");
  await dragIntoGroup(page, "Layer 1", "Shading");

  await layerRow(page, "Layer 1").locator(".layer-row__name").click();
  const inside = panel.getByRole("combobox", { name: "Layer group" });
  await inside.selectOption({ label: "Root" });

  await expect(layerRow(page, "Layer 1")).toHaveCSS("padding-left", "6px");
  await expect(layerRow(page, "Shading").locator(".layer-row__count")).toHaveText("0");
});

test("Ungroup removes the container and keeps the layer", async ({ page }) => {
  const panel = layersPanel(page);
  await panel.getByRole("button", { name: "New group", exact: true }).click();
  await commitRename(page, "Shading");
  await dragIntoGroup(page, "Layer 1", "Shading");

  await layerRow(page, "Shading").locator(".layer-row__name").click();
  await panel.getByRole("button", { name: "Ungroup", exact: true }).click();

  await expect(layerRow(page, "Shading")).toHaveCount(0);
  await expect(layerRow(page, "Layer 1")).toHaveCSS("padding-left", "6px");
});
