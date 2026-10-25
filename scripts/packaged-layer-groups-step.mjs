/**
 * One step of the packaged-app layer-groups smoke test.
 *
 * The browser specs already drive the panel. This helper exists to prove the
 * same workflow in the **packaged Tauri window**, where the WebView, the native
 * environment and the real save path differ from `pnpm dev`.
 *
 * It attaches to the running application over WebView2's DevTools protocol:
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   Start-Process src-tauri/target/release/paka.exe
 *   node scripts/packaged-layer-groups-step.mjs draw
 *   node scripts/packaged-layer-groups-step.mjs group
 *   node scripts/packaged-layer-groups-step.mjs state
 *   node scripts/packaged-layer-groups-step.mjs save
 *   node scripts/packaged-layer-groups-step.mjs open
 *   node scripts/packaged-layer-groups-step.mjs export
 *   node scripts/packaged-layer-groups-step.mjs save-direct <path>
 *   node scripts/packaged-layer-groups-step.mjs open-direct <path>
 *   node scripts/packaged-layer-groups-step.mjs export-direct <path>
 *   node scripts/packaged-layer-groups-step.mjs project <path>
 *
 * `save`, `open` and `export` press the chord or menu item and then return:
 * the native Win32 dialog belongs to the caller, because the DevTools protocol
 * cannot address it. The caller must record what it did with that dialog.
 *
 * The `-direct` steps replace only the native path picker. They call the same
 * `ProjectFiles` service the menu calls, so the serializer, the parser, the
 * atomic write and the PNG encoder are the product's own code. They exist
 * because a native dialog cannot be addressed from the DevTools protocol; a
 * report must say that the picker itself was bypassed.
 */

import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const [action, argument] = process.argv.slice(2);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => !candidate.url().startsWith("devtools://"));
if (!page) {
  throw new Error(`no application page among: ${pages.map((entry) => entry.url()).join(", ")}`);
}

await page.locator(".app-shell").waitFor();
await page.locator("canvas.canvas-stage__surface").waitFor();
await page.waitForTimeout(300);

/** The layers panel, found by its title. */
function panel() {
  return page.locator(".panel").filter({ has: page.locator(".panel__title", { hasText: "Layers" }) });
}

function row(name) {
  return panel()
    .locator(".layer-row")
    .filter({ has: page.locator(".layer-row__title", { hasText: name }) });
}

/** Draws two separate strokes through the real pointer path. */
async function drawStrokes() {
  const canvas = page.locator("canvas.canvas-stage__surface");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("the canvas has no box");
  }
  for (const offset of [0, 60]) {
    const x = box.x + box.width * 0.32;
    const y = box.y + box.height * 0.35 + offset;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y + 24, { steps: 10 });
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
}

/**
 * Runs one ProjectFiles operation with its native path picker replaced.
 *
 * The editor is reached through React's own context provider. This is test
 * plumbing, not a product hook: no application module is imported and no
 * product behaviour is changed. The serializer, parser and file gateway are
 * the live instances the menu uses.
 */
async function fileStep(kind, path) {
  return page.evaluate(
    async ({ kind, path }) => {
      const element = document.getElementById("root");
      const key = element && Object.keys(element).find((name) => name.startsWith("__reactContainer$"));
      const seen = new Set();
      const stack = [key ? element[key] : null];
      let editor = null;
      while (stack.length > 0 && !editor) {
        const fiber = stack.pop();
        if (!fiber || seen.has(fiber)) {
          continue;
        }
        seen.add(fiber);
        const value = fiber.memoizedProps?.value;
        if (value && typeof value === "object" && value.engine && value.files) {
          editor = value;
          break;
        }
        if (fiber.child) {
          stack.push(fiber.child);
        }
        if (fiber.sibling) {
          stack.push(fiber.sibling);
        }
      }
      if (!editor) {
        throw new Error("the editor context was not found");
      }
      const files = editor.files;
      if (kind === "save") {
        files.gateway.pickProjectToSave = async () => path;
        return files.saveAs();
      }
      if (kind === "open") {
        files.gateway.pickProjectToOpen = async () => path;
        return files.open();
      }
      if (kind === "export") {
        files.gateway.pickPngToSave = async () => path;
        return files.exportPng();
      }
      throw new Error(`unknown file step: ${kind}`);
    },
    { kind, path },
  );
}

/** The panel's own tree, in the order it shows. */
async function state() {
  return page.evaluate(() => {
    const layersPanel = [...document.querySelectorAll(".panel")].find((candidate) =>
      candidate.querySelector(".panel__title")?.textContent?.includes("Layers"),
    );
    if (!layersPanel) {
      throw new Error("the layers panel is not mounted");
    }
    const rows = [...layersPanel.querySelectorAll(".layer-row")].map((element) => {
      const padding = Number.parseFloat(element.style.paddingLeft || "6");
      return {
        name: element.querySelector(".layer-row__title")?.textContent?.trim() ?? null,
        group: element.classList.contains("is-group"),
        active: element.classList.contains("is-active"),
        focused: element.classList.contains("is-focused"),
        expanded: element.classList.contains("is-expanded"),
        collapsed: element.classList.contains("is-collapsed"),
        hidden: element.classList.contains("is-hidden"),
        inheritedHidden: element.classList.contains("is-inherited-hidden"),
        depth: Math.max(0, Math.round((padding - 6) / 14)),
        children: element.querySelector(".layer-row__count")?.textContent?.trim() ?? null,
        title: element.querySelector(".layer-row__name")?.getAttribute("title") ?? null,
      };
    });
    const items = [...document.querySelectorAll(".status-bar__item")].map((item) =>
      item.textContent?.trim(),
    );
    return {
      rows,
      items,
      statusBar: document.querySelector(".status-bar")?.textContent?.trim() ?? null,
      documentName: document.querySelector(".status-bar__item")?.textContent?.trim() ?? null,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

switch (action) {
  case "draw": {
    await drawStrokes();
    console.log(JSON.stringify(await state(), null, 2));
    break;
  }
  case "group": {
    // Start from the one paintable layer, create an empty group above it, give
    // it a name, then move the layer inside through the accessible selector.
    await panel().getByRole("button", { name: "New group", exact: true }).click();
    const name = panel().getByRole("textbox", { name: "Group name" });
    await name.fill("Shading");
    await name.press("Enter");

    await row("Layer 1").locator(".layer-row__name").click();
    await panel().getByRole("combobox", { name: "Layer group" }).selectOption({ label: "Shading" });
    await page.waitForTimeout(150);

    // Paint while the child is active: the strokes must land inside the group
    // and the group's count must stay one.
    await drawStrokes();

    const group = row("Shading");
    const before = await state();
    await group.getByRole("button", { name: "Hide Shading", exact: true }).click();
    const hidden = await state();
    await group.getByRole("button", { name: "Show Shading", exact: true }).click();
    const shown = await state();

    const chevron = group.locator(".layer-row__chevron");
    await chevron.click();
    const collapsed = await state();
    await chevron.click();
    const expanded = await state();

    console.log(
      JSON.stringify(
        {
          before,
          hidden,
          shown,
          collapsed,
          expanded,
          checks: {
            childIndented: before.rows.some((entry) => entry.name === "Layer 1" && entry.depth === 1),
            childInsideGroup: before.rows.find((entry) => entry.name === "Shading")?.children === "1",
            groupHidesChild: hidden.rows.some(
              (entry) => entry.name === "Layer 1" && entry.inheritedHidden,
            ),
            groupShowsChild: !shown.rows.some(
              (entry) => entry.name === "Layer 1" && entry.inheritedHidden,
            ),
            collapseHidesChild: !collapsed.rows.some((entry) => entry.name === "Layer 1"),
            expandShowsChild: expanded.rows.some((entry) => entry.name === "Layer 1"),
          },
        },
        null,
        2,
      ),
    );
    break;
  }
  case "delete-undo": {
    // The last paintable layer is never deleted. Add a root layer so the
    // non-empty group is a legal deletion, then select the group again.
    await panel().getByRole("button", { name: "Add layer", exact: true }).click();
    await row("Shading").locator(".layer-row__name").click();
    await panel().getByRole("button", { name: "Delete group", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    const prompt = (await dialog.textContent()) ?? "";
    await dialog
      .getByRole("button", { name: "Delete group and layers", exact: true })
      .click();
    const deleted = await state();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    const restored = await state();
    console.log(
      JSON.stringify(
        {
          prompt,
          deleted,
          restored,
          checks: {
            askedAboutTheChild: prompt.includes("1 layer"),
            groupGone: !deleted.rows.some((entry) => entry.name === "Shading"),
            childGone: !deleted.rows.some((entry) => entry.name === "Layer 1"),
            groupBack: restored.rows.some((entry) => entry.name === "Shading"),
            childBack: restored.rows.some((entry) => entry.name === "Layer 1"),
          },
        },
        null,
        2,
      ),
    );
    break;
  }
  case "save": {
    await page.keyboard.press("Control+s");
    break;
  }
  case "open": {
    await page.keyboard.press("Control+o");
    break;
  }
  case "export": {
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /Export PNG/ }).click();
    break;
  }
  case "save-direct": {
    const outcome = await fileStep("save", argument);
    await page.waitForTimeout(200);
    console.log(JSON.stringify({ outcome, state: await state() }, null, 2));
    break;
  }
  case "open-direct": {
    const outcome = await fileStep("open", argument);
    await page.waitForTimeout(300);
    console.log(JSON.stringify({ outcome, state: await state() }, null, 2));
    break;
  }
  case "export-direct": {
    const outcome = await fileStep("export", argument);
    console.log(JSON.stringify({ outcome }, null, 2));
    break;
  }

  case "state": {
    console.log(JSON.stringify(await state(), null, 2));
    break;
  }
  case "project": {
    const raw = await readFile(argument, "utf8");
    const project = JSON.parse(raw);
    const rootLayers = Array.isArray(project.layers) ? project.layers : [];
    let groups = 0;
    let layers = 0;
    let strokes = 0;
    let fills = 0;
    let gradients = 0;
    const visit = (nodes) => {
      for (const node of nodes) {
        if (node.kind === "group") {
          groups += 1;
          visit(Array.isArray(node.children) ? node.children : []);
        } else {
          layers += 1;
          for (const element of Array.isArray(node.elements) ? node.elements : []) {
            if (element.kind === "stroke") strokes += 1;
            else if (element.kind === "fill") fills += 1;
            else if (element.kind === "gradient") gradients += 1;
          }
        }
      }
    };
    visit(rootLayers);
    console.log(
      JSON.stringify(
        {
          format: project.format,
          version: project.version,
          document: project.document
            ? {
                width: project.document.width,
                height: project.document.height,
                activeLayerId: project.document.activeLayerId,
              }
            : null,
          rootLayers: rootLayers.length,
          groups,
          layers,
          strokes,
          fills,
          gradients,
        },
        null,
        2,
      ),
    );
    break;
  }
  default:
    throw new Error(`unknown step: ${action}`);
}

await browser.close();
