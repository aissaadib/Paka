import { defineConfig } from "@playwright/test";

/**
 * The workspace shell's layout checks.
 *
 * The visual harness in `tests/visual` proves the *renderer* against golden
 * images; this config proves the *shell*: the bands and columns of the
 * workspace, their sizes at the window sizes the application is used at, and
 * the facts that must not move when the tool changes.
 *
 * The app itself is the subject, so the server is the application's own dev
 * server and the page is the real workspace - not a fixture that imitates it.
 * The port is the harness's own, because the app's server holds 1420 with
 * `strictPort`.
 */
const PORT = Number(process.env.PAKA_SHELL_PORT ?? 1437);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/shell",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    // The window size the acceptance criteria name.
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    animations: "disabled",
    caret: "hide",
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `${BASE_URL}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
  },
});
