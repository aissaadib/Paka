import { expect, test, type Page } from "@playwright/test";

/**
 * The brush cursor, the size ring and the quick resize, driven in a real
 * browser.
 *
 * The engine tests in `src/test/brushCursor.test.ts` prove the geometry, the
 * drag model and the ownership rules. They cannot prove the part a user
 * actually touches: that the ring is drawn **on the canvas** at the brush's
 * real size, that it follows the **zoom**, that the readout appears while
 * the gesture runs, and that a resize leaves the artwork and the history
 * alone.
 *
 * This spec does that, against the running application, in the same browser
 * the visual harness uses. It is not a golden test: it asserts behaviour -
 * the overlay's own geometry, the control's value, the history depth - not
 * pixels.
 */

const CANVAS = "canvas.canvas-stage__surface";
const RING = ".brush-cursor__ring";
const READOUT = ".brush-cursor__readout";

/** The window is wider than the harness's, so the canvas has room. */
test.use({ viewport: { width: 1280, height: 900 } });

/** The middle of the canvas: the document is centred there, so it is inside it. */
async function canvasMiddle(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(CANVAS).boundingBox();
  if (!box) {
    throw new Error("the canvas has no box");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The zoom the status bar reports, as a number. */
async function zoomOf(page: Page): Promise<number> {
  const text = await page.locator(".status-bar__item", { hasText: /^zoom / }).first().innerText();
  const percent = Number.parseFloat(text.replace("zoom", "").replace("%", "").trim());
  return percent / 100;
}

/** The brush size the toolbar's exact-value box shows. */
async function brushSizeOf(page: Page): Promise<number> {
  const value = await page.getByLabel("Size (exact value)").inputValue();
  return Number(value);
}

/** The history depth the status bar reports. */
async function historyDepth(page: Page): Promise<number> {
  const text = await page.locator(".status-bar__item", { hasText: /^history / }).first().innerText();
  return Number(text.replace("history", "").trim());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator(CANVAS).waitFor();
});

test("the ring is drawn on the canvas at the brush's real size", async ({ page }) => {
  const middle = await canvasMiddle(page);
  await page.mouse.move(middle.x, middle.y);

  const ring = page.locator(RING);
  await expect(ring).toBeVisible();

  const size = await brushSizeOf(page);
  const zoom = await zoomOf(page);
  const expected = Math.max(4, size * zoom);

  const box = await ring.boundingBox();
  expect(box).not.toBeNull();
  // The ring is the brush's diameter on screen, through the zoom.
  expect(box!.width).toBeCloseTo(expected, 0);
  expect(box!.height).toBeCloseTo(expected, 0);
  // And it sits on the pointer.
  expect(box!.x + box!.width / 2).toBeCloseTo(middle.x, 0);
  expect(box!.y + box!.height / 2).toBeCloseTo(middle.y, 0);
});

test("the ring grows with the zoom, because the brush is a document size", async ({ page }) => {
  const middle = await canvasMiddle(page);
  await page.mouse.move(middle.x, middle.y);

  const before = await page.locator(RING).boundingBox();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const after = await page.locator(RING).boundingBox();

  expect(after!.width).toBeGreaterThan(before!.width);
  const zoom = await zoomOf(page);
  const size = await brushSizeOf(page);
  expect(after!.width).toBeCloseTo(Math.max(4, size * zoom), 0);
});

test("Ctrl+Alt and drag resizes the brush and paints nothing", async ({ page }) => {
  const middle = await canvasMiddle(page);
  const before = await brushSizeOf(page);

  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y - 120, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");

  const after = await brushSizeOf(page);
  expect(after).toBeGreaterThan(before);
  // The resize is not an edit: no command was pushed and the document is
  // exactly as it was.
  expect(await historyDepth(page)).toBe(0);
});

test("the readout shows the size while the resize runs", async ({ page }) => {
  const middle = await canvasMiddle(page);

  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y - 120, { steps: 8 });

  const readout = page.locator(READOUT);
  await expect(readout).toBeVisible();
  const text = await readout.innerText();
  expect(text).toMatch(/^\d+ px$/);
  expect(Number(text.replace(" px", ""))).toBe(await brushSizeOf(page));

  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");

  // The readout is a gesture affordance, not a permanent label.
  await expect(readout).not.toHaveClass(/is-visible/);
});

test("Escape cancels a resize and puts the size back", async ({ page }) => {
  const middle = await canvasMiddle(page);
  const before = await brushSizeOf(page);

  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y - 120, { steps: 8 });
  await expect(page.locator(READOUT)).toBeVisible();

  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");

  expect(await brushSizeOf(page)).toBe(before);
  expect(await historyDepth(page)).toBe(0);
});

test("the next stroke uses the size the resize left behind", async ({ page }) => {
  const middle = await canvasMiddle(page);

  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y - 120, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
  const resized = await brushSizeOf(page);

  await page.mouse.move(middle.x - 40, middle.y - 40);
  await page.mouse.down();
  await page.mouse.move(middle.x + 40, middle.y + 40, { steps: 6 });
  await page.mouse.up();

  // One stroke, one undo step, and the document is dirty.
  expect(await historyDepth(page)).toBe(1);
  expect(resized).toBeGreaterThan(6);
});

test("the brackets step the brush size, and Alt makes the step one pixel", async ({ page }) => {
  const before = await brushSizeOf(page);

  await page.keyboard.press("]");
  expect(await brushSizeOf(page)).toBe(before + 1);
  await page.keyboard.press("[");
  expect(await brushSizeOf(page)).toBe(before);

  // A large brush steps by a tenth of itself, so the fine modifier is what
  // trims it by a pixel.
  await page.getByLabel("Size (exact value)").fill("100");
  await page.getByLabel("Size (exact value)").press("Enter");
  expect(await brushSizeOf(page)).toBe(100);

  // The number box keeps the focus, and a field that takes text keeps the
  // keyboard to itself, so the field is given up first.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await page.keyboard.press("Alt+]");
  expect(await brushSizeOf(page)).toBe(101);
  await page.keyboard.press("Alt+[");
  expect(await brushSizeOf(page)).toBe(100);
});
