/**
 * Release-candidate steps for the packaged Windows application.
 *
 * The browser specs already drive these workflows against `pnpm dev`. This
 * script drives the **packaged Tauri window** instead, where the WebView, the
 * native environment and the real settings file differ.
 *
 * It attaches to the running application over WebView2's DevTools protocol:
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   Start-Process src-tauri/target/release/paka.exe
 *   node scripts/packaged-rc-step.mjs state
 *   node scripts/packaged-rc-step.mjs krita
 *   node scripts/packaged-rc-step.mjs krita-apply "Krita - Ink-1 Precision"
 *   node scripts/packaged-rc-step.mjs canvas "4K UHD"
 *   node scripts/packaged-rc-step.mjs stroke-undo
 *
 * Nothing here is imported by the product. Native file dialogs are not touched:
 * the save/open/export path is exercised by `packaged-layer-groups-step.mjs`,
 * whose `-direct` steps replace only the picker and call the product's own
 * `ProjectFiles` service.
 */

import { chromium } from "@playwright/test";

const [action, argument] = process.argv.slice(2);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => !candidate.url().startsWith("devtools://"));
if (!page) {
  throw new Error(`no application page among: ${pages.map((entry) => entry.url()).join(", ")}`);
}

const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.locator(".app-shell").waitFor();
await page.locator("canvas.canvas-stage__surface").waitFor();
await page.waitForTimeout(300);

const canvas = page.locator("canvas.canvas-stage__surface");

function brushesTab() {
  return page.getByRole("tab", { name: "Brushes", exact: true });
}

async function presetCount() {
  return page.locator(".brush-browser__rows li").count();
}

async function message() {
  const node = page.locator(".brush-browser__message");
  if ((await node.count()) === 0) {
    return null;
  }
  return (await node.first().textContent())?.trim() ?? null;
}

/** The facts the window reports about itself. */
async function state() {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll(".status-bar__item")].map((item) =>
      item.textContent?.trim(),
    );
    const rows = [...document.querySelectorAll(".layer-row")].map((element) => ({
      name: element.querySelector(".layer-row__title")?.textContent?.trim() ?? null,
      group: element.classList.contains("is-group"),
      active: element.classList.contains("is-active"),
    }));
    return {
      title: document.title,
      statusBar: items,
      rows,
      canvas: (() => {
        const element = document.querySelector("canvas.canvas-stage__surface");
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          css: { width: Math.round(rect.width), height: Math.round(rect.height) },
          pixels: { width: element.width, height: element.height },
        };
      })(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

/** Draws one stroke through the real pointer path. */
async function drawStroke() {
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("the canvas has no box");
  }
  const x = box.x + box.width * 0.34;
  const y = box.y + box.height * 0.38;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 30, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

switch (action) {
  case "state": {
    console.log(JSON.stringify({ ...(await state()), errors }, null, 2));
    break;
  }

  case "krita": {
    await brushesTab().click();
    await page.waitForTimeout(200);
    const before = await presetCount();

    const button = page.getByRole("button", { name: "Krita 4", exact: true });
    await button.click();
    await page.waitForTimeout(600);
    const afterFirst = await presetCount();
    const firstMessage = await message();

    await button.click();
    await page.waitForTimeout(400);
    const afterSecond = await presetCount();
    const secondMessage = await message();

    console.log(
      JSON.stringify(
        {
          before,
          afterFirst,
          afterSecond,
          firstMessage,
          secondMessage,
          checks: {
            firstImportAdds81: afterFirst - before === 81,
            secondImportAddsNothing: afterSecond === afterFirst,
            secondImportSaysSo: (secondMessage ?? "").includes("already in the library"),
          },
          errors,
        },
        null,
        2,
      ),
    );
    break;
  }

  case "krita-apply": {
    const name = argument;
    if (!name) {
      throw new Error("krita-apply needs a preset name");
    }
    await brushesTab().click();
    await page.waitForTimeout(200);
    await page.getByRole("searchbox", { name: "Search brushes" }).fill(name);
    await page.waitForTimeout(300);
    const row = page.locator(".brush-browser__rows li").filter({ hasText: name });
    const found = await row.count();
    if (found === 0) {
      throw new Error(`no preset row matched ${name}`);
    }
    const sizeField = page.getByLabel("Size (exact value)", { exact: true }).first();
    const sizeBefore = (await sizeField.count()) > 0 ? await sizeField.inputValue() : null;
    await row.first().locator(".brush-row__pick").click();
    await page.waitForTimeout(250);
    const sizeAfter = (await sizeField.count()) > 0 ? await sizeField.inputValue() : null;
    const applied = await page.evaluate(() => {
      const selected = document.querySelector(".brush-row.is-selected .brush-row__name");
      const current = document.querySelector('.brush-row [aria-current="true"]');
      return {
        selected: selected?.textContent?.trim() ?? null,
        current: current?.closest("li")?.querySelector(".brush-row__name")?.textContent?.trim() ?? null,
      };
    });
    await drawStroke();
    console.log(
      JSON.stringify(
        { requested: name, found, applied, sizeBefore, sizeAfter, state: await state(), errors },
        null,
        2,
      ),
    );
    break;
  }

  case "canvas": {
    const label = argument;
    if (!label) {
      throw new Error("canvas needs a preset label");
    }
    // A dialog left open by an earlier step would swallow the menu click.
    if ((await page.locator(".dialog-backdrop").count()) > 0) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /New Document/ }).click();
    await page.waitForTimeout(500);
    // A dirty document routes New Document through the discard prompt first.
    let discard = null;
    const prompt = page.getByRole("alertdialog");
    if ((await prompt.count()) > 0) {
      const title = (await prompt.locator(".dialog__title").textContent())?.trim() ?? null;
      const primary = prompt.locator(".button--primary");
      const label = (await primary.textContent())?.trim() ?? null;
      await primary.click();
      discard = { title, label };
      await page.waitForTimeout(400);
    }
    const dialog = page.getByRole("dialog", { name: /New document/i });
    await dialog.waitFor();
    const group = dialog.getByRole("group", { name: "Canvas size presets" });
    await group.getByRole("button", { name: new RegExp(label) }).click();
    const width = await dialog.getByLabel(/Width/i).inputValue();
    const height = await dialog.getByLabel(/Height/i).inputValue();
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForTimeout(700);
    console.log(
      JSON.stringify(
        { preset: label, width, height, discard, state: await state(), errors },
        null,
        2,
      ),
    );
    break;
  }

  case "budget": {
    if ((await page.locator(".dialog-backdrop").count()) > 0) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /New Document/ }).click();
    await page.waitForTimeout(500);
    const prompt = page.getByRole("alertdialog");
    if ((await prompt.count()) > 0) {
      await prompt.locator(".button--primary").click();
      await page.waitForTimeout(400);
    }
    const dialog = page.getByRole("dialog", { name: /New document/i });
    await dialog.waitFor();
    const width = dialog.getByLabel(/^Width$/);
    const height = dialog.getByLabel(/^Height$/);
    const create = dialog.getByRole("button", { name: "Create", exact: true });

    await width.fill("8192");
    await height.fill("4096");
    await page.waitForTimeout(150);
    const overBudget = {
      createDisabled: await create.isDisabled(),
      note: (await dialog.locator(".dialog__error").textContent())?.trim() ?? null,
    };

    const group = dialog.getByRole("group", { name: "Canvas size presets" });
    await group.getByRole("button", { name: /Panorama/ }).click();
    await page.waitForTimeout(150);
    const atBudget = {
      width: await width.inputValue(),
      height: await height.inputValue(),
      createEnabled: await create.isEnabled(),
    };

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForTimeout(200);
    console.log(
      JSON.stringify(
        { overBudget, atBudget, checks: { refused: overBudget.createDisabled, accepted: atBudget.createEnabled }, errors },
        null,
        2,
      ),
    );
    break;
  }

  case "overlays": {
    const phase = argument;
    if (!phase) {
      throw new Error("overlays needs a phase: symmetry-on, symmetry-off, selection or clear");
    }
    const rail = page.getByRole("toolbar", { name: "Tools", exact: true });
    const shot = async (name) => {
      await page.screenshot({ path: `docs/qa/release-candidate/${name}.png` });
    };

    if (phase === "symmetry-on" || phase === "symmetry-off") {
      await rail.getByRole("button", { name: "Brush", exact: true }).click();
      await page.waitForTimeout(150);
      const symmetry = page.locator('select[aria-label="Symmetry"]');
      await symmetry.selectOption(phase === "symmetry-on" ? "both" : "off");
      await page.waitForTimeout(300);
      await shot(`packaged-overlay-${phase}`);
      console.log(
        JSON.stringify(
          { phase, symmetry: await symmetry.inputValue(), state: await state(), errors },
          null,
          2,
        ),
      );
      break;
    }

    if (phase === "selection") {
      await rail.getByRole("button", { name: "Select", exact: true }).click();
      await page.waitForTimeout(150);
      const shape = page.locator('select[aria-label="Shape"]');
      await shape.selectOption("lasso");
      const box = await canvas.boundingBox();
      if (!box) {
        throw new Error("the canvas has no box");
      }
      // Trace a freehand polygon, not a rectangle: the lasso path is the point.
      const points = [
        [0.3, 0.3],
        [0.55, 0.32],
        [0.6, 0.5],
        [0.45, 0.62],
        [0.3, 0.52],
        [0.3, 0.3],
      ];
      await page.mouse.move(box.x + box.width * points[0][0], box.y + box.height * points[0][1]);
      await page.mouse.down();
      for (const [fx, fy] of points.slice(1)) {
        await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 8 });
      }
      await page.mouse.up();
      await page.waitForTimeout(300);
      await shot("packaged-overlay-selection-on");
      console.log(
        JSON.stringify(
          { phase, shape: await shape.inputValue(), state: await state(), errors },
          null,
          2,
        ),
      );
      break;
    }

    if (phase === "clear") {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      await rail.getByRole("button", { name: "Brush", exact: true }).click();
      console.log(JSON.stringify({ phase, state: await state(), errors }, null, 2));
      break;
    }

    throw new Error(`unknown overlays phase: ${phase}`);
  }

  case "group-render": {
    const { createHash } = await import("node:crypto");
    const hash = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const layerPanel = page
      .locator(".panel")
      .filter({ has: page.locator(".panel__title", { hasText: "Layers" }) });
    const groupRow = layerPanel
      .locator(".layer-row")
      .filter({ has: page.locator(".layer-row__title", { hasText: "Shading" }) });

    const visible = await canvas.screenshot();
    await groupRow.getByRole("button", { name: "Hide Shading", exact: true }).click();
    await page.waitForTimeout(300);
    const hidden = await canvas.screenshot();
    await page.screenshot({ path: "docs/qa/release-candidate/packaged-group-hidden.png" });
    await groupRow.getByRole("button", { name: "Show Shading", exact: true }).click();
    await page.waitForTimeout(300);
    const shown = await canvas.screenshot();

    console.log(
      JSON.stringify(
        {
          visible: { bytes: visible.length, hash: hash(visible) },
          hidden: { bytes: hidden.length, hash: hash(hidden) },
          shown: { bytes: shown.length, hash: hash(shown) },
          checks: {
            hidingChangesTheCanvas: !visible.equals(hidden),
            showingRestoresTheCanvas: visible.equals(shown),
          },
          errors,
        },
        null,
        2,
      ),
    );
    break;
  }

  case "fill": {
    const rail = page.getByRole("toolbar", { name: "Tools", exact: true });
    await rail.getByRole("button", { name: "Bucket fill", exact: true }).click();
    await page.waitForTimeout(200);
    const mode = page.locator('select[aria-label="Mode"]');
    const sample = page.locator('select[aria-label="Sample"]');
    await mode.selectOption("global");
    await page.waitForTimeout(150);

    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("the canvas has no box");
    }
    // A group cannot hold pixels: select a paintable child first.
    const childRow = page.locator(".layer-row:not(.is-group)").first();
    await childRow.locator(".layer-row__name").click();
    await page.waitForTimeout(200);
    const activeName =
      (await page.locator(".layer-row.is-active .layer-row__name").first().textContent())?.trim() ??
      null;
    const before = await canvas.screenshot();
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
    await page.waitForTimeout(600);
    const after = await canvas.screenshot();

    console.log(
      JSON.stringify(
        {
          mode: await mode.inputValue(),
          sample: await sample.inputValue(),
          activeName,
          state: await state(),
          checks: { globalFillChangedTheCanvas: !before.equals(after) },
          errors,
        },
        null,
        2,
      ),
    );
    break;
  }

  case "add-to-group": {
    const layerPanel = page
      .locator(".panel")
      .filter({ has: page.locator(".panel__title", { hasText: "Layers" }) });
    await layerPanel.getByRole("button", { name: "Add layer", exact: true }).click();
    await page.waitForTimeout(200);
    const active = page.locator(".layer-row.is-active .layer-row__name").first();
    const newName = (await active.textContent())?.trim() ?? null;
    const groupPicker = layerPanel.getByRole("combobox", { name: "Layer group" });
    await groupPicker.selectOption({ label: "Shading" });
    await page.waitForTimeout(250);
    console.log(
      JSON.stringify({ newName, group: await groupPicker.inputValue(), state: await state(), errors }, null, 2),
    );
    break;
  }

  case "stroke-undo": {
    await drawStroke();
    const afterDraw = await state();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    const afterUndo = await state();
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(250);
    const afterRedo = await state();
    console.log(
      JSON.stringify({ afterDraw, afterUndo, afterRedo, errors }, null, 2),
    );
    break;
  }

  default:
    throw new Error(`unknown action: ${action}`);
}

await browser.close();
