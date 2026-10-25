const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const page = browser.contexts()[0].pages()[0];
  const panel = page.getByRole("tabpanel", { name: "Brushes", exact: true });
  const list = panel.locator(".brush-browser__list");
  const read = async (label) => {
    const value = await list.evaluate((element) => ({
      scrollTop: element.scrollTop,
      selected: element.querySelector(".brush-tile.is-selected button")?.getAttribute("aria-label") ?? null,
    }));
    console.log(label, JSON.stringify(value));
  };
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await read("reset");
  await panel.getByRole("button", { name: "Krita 4", exact: true }).click();
  await page.waitForTimeout(300);
  await read("after import click");
  await list.focus();
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await page.waitForTimeout(300);
  await read("after six downs");
  await browser.close();
})().catch((error) => {
  console.error("failed", error);
  process.exit(1);
});
