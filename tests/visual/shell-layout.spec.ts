import { expect, test, type Page } from "@playwright/test";

/**
 * The shell's layout, driven in a real browser.
 *
 * The unit suites prove the composition model and the panel rules; this spec
 * proves the part a user meets first: that the frame fits the window. It runs
 * at every size the product is expected to work at - the default 1440x900, a
 * laptop 1366x768, the configured minimum 960x600, and widths down to 700 CSS
 * pixels - and asserts the same invariants at each:
 *
 *  - the page never scrolls: the shell is the window, and a stray row must not
 *    push the status bar out of reach;
 *  - the layers list keeps a usable body, not just its header;
 *  - the panel dock's active panel keeps a usable body;
 *  - every control is either inside the window or inside a scroll container
 *    that can bring it there;
 *  - the status bar is fully visible.
 *
 * It is a behaviour test, not a golden: no pixel is compared.
 */

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1180, height: 800 },
  { width: 1024, height: 768 },
  { width: 960, height: 600 },
  { width: 900, height: 700 },
  { width: 820, height: 700 },
  { width: 700, height: 640 },
] as const;

interface LayoutFaults {
  readonly viewport: { width: number; height: number };
  readonly pageOverflow: number;
  readonly statusBottom: number;
  readonly layersBodyHeight: number;
  readonly layerRows: number;
  readonly dockBodyHeight: number;
  readonly zeroSize: readonly string[];
  readonly unreachable: readonly string[];
  readonly overflowingPanels: readonly string[];
}

/** Everything the assertions need, read from one page. */
async function layoutFaults(page: Page): Promise<LayoutFaults> {
  return page.evaluate(() => {
    const box = (element: Element | null): DOMRect | null =>
      element ? element.getBoundingClientRect() : null;
    const scrolling = document.scrollingElement ?? document.documentElement;

    const layersPanel = [...document.querySelectorAll(".panel")].find(
      (panel) => panel.querySelector(".panel__title")?.textContent === "Layers",
    );
    const layersBody = layersPanel?.querySelector(".panel__body") ?? null;
    const activeDock = document.querySelector(
      ".panel-dock__panel:not([hidden]) .panel",
    );

    // A control is unreachable when it is outside the window and no ancestor
    // can scroll it into view.
    const unreachable: string[] = [];
    for (const control of document.querySelectorAll("button, input, select")) {
      const rect = control.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        continue;
      }
      const inside =
        rect.left >= -1 &&
        rect.top >= -1 &&
        rect.right <= window.innerWidth + 1 &&
        rect.bottom <= window.innerHeight + 1;
      if (inside) {
        continue;
      }
      let node: Element | null = control.parentElement;
      let scrollable = false;
      while (node) {
        const style = getComputedStyle(node);
        const scrollsX =
          /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
        const scrollsY =
          /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
        if (scrollsX || scrollsY) {
          scrollable = true;
          break;
        }
        node = node.parentElement;
      }
      if (!scrollable) {
        unreachable.push(
          control.getAttribute("aria-label") ??
            control.textContent?.trim().slice(0, 40) ??
            control.tagName.toLowerCase(),
        );
      }
    }

    // A control rendered at nothing is unreachable even if it is in the window.
    const zeroSize: string[] = [];
    for (const control of document.querySelectorAll(
      ".tool-options-bar button, .tool-options-bar input, .tool-options-bar select, .panel-dock__tab, .status-bar button",
    )) {
      const rect = control.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        zeroSize.push(
          control.getAttribute("aria-label") ??
            control.textContent?.trim().slice(0, 40) ??
            control.tagName.toLowerCase(),
        );
      }
    }

    // A panel whose own box is shorter than its header has nowhere to draw.
    const overflowingPanels: string[] = [];
    for (const panel of document.querySelectorAll(
      ".panel-dock__panel:not([hidden]) .panel, .side-panels__layers .panel",
    )) {
      const title = panel.querySelector(".panel__title")?.textContent ?? "?";
      const header = box(panel.querySelector(".panel__header"));
      const body = panel.querySelector(".panel__body");
      if (!header || !body || body.clientHeight < 40) {
        overflowingPanels.push(`${title} (body ${body?.clientHeight ?? 0}px)`);
      }
      const outer = box(panel);
      if (outer && outer.bottom > window.innerHeight + 1) {
        overflowingPanels.push(`${title} (bottom ${Math.round(outer.bottom)}px)`);
      }
    }

    const status = box(document.querySelector(".status-bar"));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageOverflow: scrolling.scrollHeight - window.innerHeight,
      statusBottom: status ? Math.round(status.bottom) : -1,
      layersBodyHeight: layersBody?.clientHeight ?? 0,
      layerRows: layersPanel?.querySelectorAll(".layer-list > li:not(.layer-marker)").length ?? 0,
      dockBodyHeight:
        activeDock?.querySelector(".panel__body")?.clientHeight ?? 0,
      zeroSize,
      unreachable,
      overflowingPanels,
    };
  });
}

async function openApp(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.locator("canvas.canvas-stage__surface").waitFor();
  // The canvas and the dock settle their sizes in a resize observer.
  await page.waitForTimeout(300);
}

for (const size of SIZES) {
  test(`the shell fits a ${size.width}x${size.height} window`, async ({ page }) => {
    await openApp(page, size);
    const faults = await layoutFaults(page);

    expect(faults.pageOverflow, "the page must not scroll").toBeLessThanOrEqual(1);
    expect(faults.statusBottom, "the status bar must be inside the window").toBeLessThanOrEqual(
      size.height,
    );
    expect(faults.layersBodyHeight, "the layers list must keep a usable body").toBeGreaterThan(
      60,
    );
    expect(faults.layerRows, "the layers list must show its rows").toBeGreaterThan(0);
    expect(faults.dockBodyHeight, "the active dock panel must keep a usable body").toBeGreaterThan(
      60,
    );
    expect(faults.zeroSize, "no control may render at zero size").toEqual([]);
    expect(faults.unreachable, "every control must be reachable").toEqual([]);
    expect(faults.overflowingPanels, "no panel may overflow the window").toEqual([]);

    // The two top rows are one line each, whatever the window.
    const optionsBar = await page.locator(".tool-options-bar").boundingBox();
    const documentBar = await page.locator(".toolbar").boundingBox();
    expect(optionsBar?.height).toBe(38);
    expect(documentBar?.height).toBe(34);
  });
}

test("the dock tabs switch panels without dropping the layers list", async ({ page }) => {
  await openApp(page, { width: 960, height: 600 });

  const tabs = page.getByRole("tablist", { name: "Panels" }).getByRole("tab");
  await expect(tabs).toHaveCount(4);
  await expect(page.getByRole("tab", { name: "Color" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Every tab is a real button with a box, and switching keeps the layers
  // list where it was.
  const layersBefore = await page.locator(".side-panels__layers").boundingBox();
  for (const name of ["Brushes", "Navigator", "Shortcuts", "Color"]) {
    const tab = page.getByRole("tab", { name });
    const box = await tab.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(20);
    expect(box?.height ?? 0).toBeGreaterThan(20);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const panel = page.locator(".panel-dock__panel:not([hidden])");
    await expect(panel).toHaveCount(1);
    const body = await panel.locator(".panel__body").boundingBox();
    expect(body?.height ?? 0).toBeGreaterThan(60);
    // The panel's own scroll container never spills over the dock.
    const panelBox = await panel.locator(".panel").boundingBox();
    const dockBox = await page.locator(".panel-dock").boundingBox();
    expect((panelBox?.bottom ?? 0) - (dockBox?.bottom ?? 0)).toBeLessThanOrEqual(1);
  }
  const layersAfter = await page.locator(".side-panels__layers").boundingBox();
  expect(layersAfter?.height).toBe(layersBefore?.height);

  // The brush browser's rows are reachable in its tab.
  await page.getByRole("tab", { name: "Brushes" }).click();
  await expect(
    page.locator(".panel-dock__panel:not([hidden]) .brush-row").first(),
  ).toBeVisible();
});

test("the dock's tabs follow the keyboard contract", async ({ page }) => {
  await openApp(page, { width: 1280, height: 900 });
  await page.getByRole("tab", { name: "Color" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Brushes" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Brushes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Shortcuts" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Color" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("switching tools rewrites the options bar", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });

  await page.getByRole("button", { name: "Brush", exact: true }).click();
  const brushBar = page.getByRole("toolbar", { name: "Brush options" });
  await expect(brushBar).toBeVisible();
  await expect(brushBar.getByLabel("Size").first()).toBeVisible();
  const brushBox = await page.locator(".tool-options-bar").boundingBox();

  await page.getByRole("button", { name: "Bucket fill", exact: true }).click();
  const bucketBar = page.getByRole("toolbar", { name: "Bucket fill options" });
  await expect(bucketBar).toBeVisible();
  await expect(bucketBar.getByText("Tolerance", { exact: true }).first()).toBeVisible();

  // The bar is the same height for every tool, so the canvas does not move.
  const bucketBox = await page.locator(".tool-options-bar").boundingBox();
  expect(bucketBox?.height).toBe(brushBox?.height);
  expect(bucketBox?.y).toBe(brushBox?.y);

  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "Pan options" })).toBeVisible();
  // A tool with nothing to configure explains itself instead of showing a
  // row of dead controls.
  await expect(
    page
      .getByRole("toolbar", { name: "Pan options" })
      .getByText("Move the canvas view", { exact: true }),
  ).toBeVisible();
});

test("the brush settings panel holds the advanced fields and writes them", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });
  await page.getByRole("button", { name: "Brush", exact: true }).click();

  const trigger = page.getByRole("button", { name: "Brush settings", exact: true });
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Brush settings" });
  await expect(panel).toBeVisible();

  // The advanced tier is in the panel; the primary tier is not.
  for (const label of ["Sampling", "Stabilizer", "Texture"]) {
    await expect(panel.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(panel.getByText("Size", { exact: true })).toHaveCount(0);

  // Changing a value in the panel changes the brush the engine holds: the
  // number survives closing and reopening the panel.
  const sampling = panel
    .locator(".slider-field")
    .filter({ hasText: "Sampling" })
    .locator(".slider-field__value");
  await sampling.fill("3");
  await sampling.blur();
  await expect(sampling).toHaveValue("3");

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  const reopened = page.getByRole("dialog", { name: "Brush settings" });
  await expect(
    reopened
      .locator(".slider-field")
      .filter({ hasText: "Sampling" })
      .locator(".slider-field__value"),
  ).toHaveValue("3");

  // A toggle in the panel reveals the controls that depend on it, in place.
  const stamp = reopened.getByLabel("Stamp", { exact: true });
  await expect(reopened.getByText("Stamp spacing", { exact: true })).toHaveCount(0);
  await stamp.check();
  await expect(reopened.getByText("Stamp spacing", { exact: true })).toBeVisible();
});

test("the brush preset controls stay in the bar and manage the presets in a panel", async ({
  page,
}) => {
  await openApp(page, { width: 1280, height: 800 });
  await page.getByRole("button", { name: "Brush", exact: true }).click();

  // The picker is inline; the management form is behind its trigger.
  await expect(page.getByLabel("Brush preset", { exact: true })).toBeVisible();
  const manage = page.getByRole("button", { name: "Manage", exact: true });
  await manage.click();
  const panel = page.getByRole("dialog", { name: "Brush presets" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Preset name")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(manage).toBeFocused();
});
