/**
 * The renderer benchmark driver.
 *
 * Starts the project's own Vite dev server, opens the benchmark page in the
 * bundled Chromium, runs the in-page workloads, and writes the result to
 * `bench/results/<label>.json`.
 *
 * Usage:
 *
 *   node bench/run.mjs --label before
 *   node bench/run.mjs --label after --port 1423
 *
 * The label is only a file name: it is what lets a before/after pair be
 * compared by the same machine on the same day. Run the two back to back, on
 * an idle machine, with the same browser build - the harness pins the browser
 * through Playwright, so the browser version cannot drift between runs.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/** Reads `--name value` pairs; unknown flags are an error, not silently ignored. */
function parseArgs(argv) {
  const options = { label: "run", port: 1423 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--label" && value) {
      options.label = value;
      index += 1;
    } else if (flag === "--port" && value) {
      options.port = Number.parseInt(value, 10);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive integer");
  }
  return options;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`The dev server did not answer at ${url}: ${lastError?.message ?? "timeout"}`);
}

function formatTable(result) {
  const lines = [];
  const header = ["workload", "median ms", "min ms", "max ms", "flush ms"];
  lines.push(header.map((cell) => cell.padEnd(22)).join(""));
  for (const workload of result.workloads) {
    lines.push(
      [
        workload.name.padEnd(22),
        String(workload.medianMs).padEnd(22),
        String(workload.minMs).padEnd(22),
        String(workload.maxMs).padEnd(22),
        String(workload.flushMs ?? "-").padEnd(22),
      ].join(""),
    );
  }
  if (result.memory) {
    const deltaMb = (result.memory.deltaBytes / (1024 * 1024)).toFixed(2);
    lines.push(
      `retained heap after ${result.memory.strokes} strokes: +${deltaMb} MiB ` +
        `(${(result.memory.beforeBytes / (1024 * 1024)).toFixed(1)} -> ` +
        `${(result.memory.afterBytes / (1024 * 1024)).toFixed(1)} MiB)`,
    );
  } else {
    lines.push("retained heap: not measured (no --expose-gc)");
  }
  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const baseUrl = `http://localhost:${options.port}`;
const pageUrl = `${baseUrl}/bench/index.html`;

const server = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--port", String(options.port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);

let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += String(chunk);
});
server.stderr.on("data", (chunk) => {
  serverLog += String(chunk);
});

let browser = null;
let exitCode = 0;

try {
  await waitForServer(pageUrl, 120_000);

  browser = await chromium.launch({
    args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => {
    console.error(`page error: ${error.message}`);
  });
  await page.goto(pageUrl, { waitUntil: "load" });
  await page.waitForFunction(() => globalThis.pakaBench?.ready === true, null, { timeout: 60_000 });

  const result = await page.evaluate((label) => globalThis.pakaBench.run(label), options.label);

  const directory = join(root, "bench", "results");
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${options.label}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`\nPaka renderer benchmark - "${options.label}"`);
  console.log(`${result.userAgent}`);
  console.log(`display ${result.display.width}x${result.display.height}, cores ${result.hardwareConcurrency}\n`);
  console.log(formatTable(result));
  console.log(`\nwritten to ${file}`);
} catch (error) {
  exitCode = 1;
  console.error(error);
  if (serverLog.trim()) {
    console.error("\n--- dev server output ---\n" + serverLog.slice(-4000));
  }
} finally {
  await browser?.close();
  server.kill();
}

process.exit(exitCode);
