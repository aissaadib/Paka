import { defineConfig } from "@playwright/test";

/**
 * Visual-regression harness configuration.
 *
 * The harness renders Paka's own scenes in a real browser, so the goldens
 * carry the antialiasing and the blur that the repository's software pixel
 * canvas cannot produce. That is the point of the harness: the software
 * canvas can disprove a placement or extent bug, but it cannot prove a
 * Chromium edge.
 *
 * Two decisions keep the goldens stable:
 *
 *  - the **bundled** Chromium is used, not the machine's Chrome, so the
 *    browser build is pinned by the lockfile rather than by whatever the host
 *    happens to have installed;
 *  - the device scale factor and the viewport are fixed, so the golden's
 *    pixel grid does not move.
 *
 * The dev server runs on its own port, because the app's own server holds
 * 1420 with `strictPort`, and the harness must not fight it.
 */
const PORT = 1698;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/visual",
  // One worker: the harness shares one dev server and one browser build, and
  // the goldens are compared against that single build.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    // A fixed device scale factor keeps the golden's pixel grid stable.
    deviceScaleFactor: 1,
    viewport: { width: 512, height: 512 },
    // The canvas is drawn synchronously; nothing may animate or blink.
    animations: "disabled",
    caret: "hide",
  },
  expect: {
    toHaveScreenshot: {
      // A tolerance, not an exact match: antialiasing differs between
      // platforms. 2 % is the value the audited reference (fabric.js) uses
      // for the same purpose.
      maxDiffPixelRatio: 0.02,
    },
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `${BASE_URL}/tests/visual/harness.html`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
  },
});
