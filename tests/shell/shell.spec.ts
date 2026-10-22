/**
 * The workspace shell, checked in a real browser.
 *
 * These are the promises the shell makes to the user, written down:
 *
 *  - the six bands and columns are there, and each one is named;
 *  - the canvas is the largest thing on screen and keeps its size;
 *  - switching tools never resizes the canvas or the options row;
 *  - nothing overflows sideways, at any window width;
 *  - a narrow window folds the panel dock away instead of squeezing the
 *    canvas;
 *  - the keyboard can reach the workspace in reading order, and the focus ring
 *    is visible when it arrives.
 */

import { expect, test, type Page } from "@playwright/test";

/** The tools whose options differ the most from each other. */
const TOOLS = ["Brush", "Eraser", "Select", "Rectangle", "Polygon", "Star", "Bucket fill", "Gradient", "Colour picker"];

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  // The engine attaches to the canvas once it is mounted; waiting for the
  // canvas to have a size keeps the measurements honest.
  await expect(page.locator("main.canvas-stage canvas")).toBeVisible();
}

function boxOf(page: Page, selector: string) {
  return page.locator(selector).boundingBox();
}

test.describe("the workspace shell", () => {
  test("has the six slots, each one named", async ({ page }) => {
    await openWorkspace(page);

    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("toolbar", { name: "Tool options" })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Tools" })).toHaveCount(1);
    await expect(page.getByRole("main", { name: "Canvas" })).toHaveCount(1);
    await expect(page.getByRole("complementary", { name: "Panels" })).toHaveCount(1);
    await expect(page.getByRole("contentinfo", { name: "Document status" })).toHaveCount(1);
  });

  test("puts the bands in reading order", async ({ page }) => {
    await openWorkspace(page);

    const indices = await page.evaluate(() => {
      const selectors = [
        ".app-bar",
        ".options-bar",
        ".tool-rail",
        "main.canvas-stage",
        ".panel-area",
        ".status-bar",
      ];
      const found = Array.from(document.querySelectorAll(selectors.join(",")));
      return selectors.map((selector) => found.findIndex((element) => element.matches(selector)));
    });

    expect(indices.every((index) => index >= 0)).toBe(true);
    // Each band follows the one before it in the document.
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  test("gives the canvas the room at 1366x768", async ({ page }) => {
    await openWorkspace(page);

    const canvas = await boxOf(page, "main.canvas-stage canvas");
    expect(canvas).not.toBeNull();
    // The canvas must be the dominant surface, not a strip between the panels.
    expect(canvas!.width).toBeGreaterThan(1000);
    expect(canvas!.height).toBeGreaterThan(600);

    const chrome = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      const body = document.querySelector(".workspace-body");
      return {
        shell: shell!.getBoundingClientRect().height,
        body: body!.getBoundingClientRect().height,
      };
    });
    // The bars above and below the canvas together are a small fraction of
    // the window.
    expect(chrome.shell - chrome.body).toBeLessThan(90);
  });

  test("keeps the layout still when the tool changes", async ({ page }) => {
    await openWorkspace(page);

    const before = {
      canvas: await boxOf(page, "main.canvas-stage"),
      options: await boxOf(page, ".options-bar"),
    };

    for (const tool of TOOLS) {
      await page.getByRole("button", { name: tool, exact: true }).click();
      const canvas = await boxOf(page, "main.canvas-stage");
      const options = await boxOf(page, ".options-bar");
      expect(canvas, `the canvas moved for ${tool}`).toEqual(before.canvas);
      expect(options, `the options row moved for ${tool}`).toEqual(before.options);
    }
  });

  test("overflows nothing at any window width", async ({ page }) => {
    await openWorkspace(page);

    for (const width of [1366, 1180, 1024, 900, 820, 700]) {
      await page.setViewportSize({ width, height: 768 });
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(overflow.scroll, `the page overflows at ${width}px`).toBeLessThanOrEqual(
        overflow.inner + 1,
      );
    }
  });

  test("folds the panel dock away on a narrow window", async ({ page }) => {
    await openWorkspace(page);
    await page.setViewportSize({ width: 820, height: 700 });

    const dock = page.locator(".panel-area");
    await expect(dock).toBeHidden();

    const toggle = page.getByRole("button", { name: "Show the panels" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(dock).toBeVisible();

    // The canvas keeps the window's width: the dock floats over it.
    const canvas = await boxOf(page, "main.canvas-stage");
    expect(canvas!.width).toBeGreaterThan(700);
  });

  test("shows the document once, and marks it unsaved", async ({ page }) => {
    await openWorkspace(page);

    const title = page.locator(".doc-title");
    await expect(title).toBeVisible();
    await expect(title).toContainText("Untitled");
    // The status bar must not repeat the name.
    await expect(page.locator(".status-bar")).not.toContainText("Untitled");
  });

  test("offers the zoom, the tool and the colours in the chrome", async ({ page }) => {
    await openWorkspace(page);

    await expect(page.getByRole("group", { name: "Zoom" })).toBeVisible();
    await expect(page.locator(".tool-badge")).toContainText("Brush");
    await expect(page.getByLabel("Primary stroke color")).toBeVisible();
    await expect(page.locator(".status-bar")).toContainText("Layer");
  });

  test("reaches the workspace with the keyboard, in order", async ({ page }) => {
    await openWorkspace(page);

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => document.activeElement?.className ?? "");
    expect(first).toContain("menu__trigger");

    // The focus ring is visible when the focus arrives by keyboard.
    const outline = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) {
        return "none";
      }
      return getComputedStyle(element).outlineWidth;
    });
    expect(outline).not.toBe("0px");
  });

  test("keeps every control reachable and named", async ({ page }) => {
    await openWorkspace(page);

    const unnamed = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>("button, input, select, textarea"),
      );
      return controls
        .filter((control) => {
          if (control.getAttribute("aria-hidden") === "true") {
            return false;
          }
          const label =
            control.getAttribute("aria-label") ??
            control.getAttribute("title") ??
            control.textContent ??
            "";
          // A control wrapped in a label takes its name from that label.
          const wrapping = control.labels?.length
            ? Array.from(control.labels)
                .map((candidate) => candidate.textContent ?? "")
                .join(" ")
            : "";
          const labelled = control.getAttribute("aria-labelledby");
          return label.trim() === "" && wrapping.trim() === "" && !labelled;
        })
        .map((control) => `${control.tagName.toLowerCase()}.${control.className}`);
    });

    expect(unnamed).toEqual([]);
  });

  test("anchors the tool's tooltip to the button, not to the pointer", async ({ page }) => {
    await openWorkspace(page);

    const brush = page.getByRole("button", { name: "Brush", exact: true });
    await brush.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Brush");

    // The tooltip sits beside the button in the rail, and it is not where the
    // pointer happened to be.
    const button = (await brush.boundingBox())!;
    const bubble = (await tooltip.boundingBox())!;
    expect(bubble.x).toBeGreaterThan(button.x + button.width);
    expect(Math.abs(bubble.y + bubble.height / 2 - (button.y + button.height / 2))).toBeLessThan(4);
  });

  test("moves between the options with the arrow keys", async ({ page }) => {
    await openWorkspace(page);

    // A control that does not own the arrow keys passes them on.
    await page.locator('.toggle:has-text("Stamp") input').focus();
    const before = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return (
        active?.getAttribute("aria-label") ??
        active?.labels?.[0]?.textContent?.trim() ??
        active?.tagName
      );
    });
    await page.keyboard.press("ArrowRight");
    const after = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return (
        active?.getAttribute("aria-label") ??
        active?.labels?.[0]?.textContent?.trim() ??
        active?.tagName
      );
    });
    expect(after).not.toBe(before);

    // A slider keeps its own arrow keys: they change the value, they do not
    // move the focus.
    await page.getByLabel("Size", { exact: true }).first().focus();
    await page.keyboard.press("ArrowRight");
    const still = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label"),
    );
    expect(still).toBe("Size");
  });

  test("opens the pressure-curve editor over the canvas, not over the layout", async ({ page }) => {
    await openWorkspace(page);

    const before = await boxOf(page, ".options-bar");
    const region = page.locator(".options-region__scroll");
    await region.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
    await page.locator('.toggle:has-text("Pressure size") input').check();
    await page.locator(".pressure-curve__toggle").click();

    const editor = page.locator(".pressure-curve");
    await expect(editor).toBeVisible();
    // The options row did not grow to make room for it.
    expect(await boxOf(page, ".options-bar")).toEqual(before);
    // It floats over the canvas.
    const canvas = (await boxOf(page, "main.canvas-stage"))!;
    const bubble = (await editor.boundingBox())!;
    expect(bubble.y).toBeGreaterThan(canvas.y);
  });
});
