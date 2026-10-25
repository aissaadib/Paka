/**
 * QA tool: extracts the pre-R1 renderer (commit 520aa77) into qa/preR1/.
 *
 * The point is a real-pixel A/B: the same document rendered by the shipped
 * renderer and by the renderer as it was before the bounded-rasterization
 * change. Relative imports are rewritten to Vite-root absolute paths so the
 * dev server can serve the copy from qa/preR1/.
 *
 * This file is a QA artifact. It never touches production source.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const commit = process.argv[2] ?? "520aa77";
const sourcePath = "src/core/rendering/Canvas2DRenderer.ts";

const original = execSync(`git show ${commit}:${sourcePath}`, {
  cwd: repoRoot,
  maxBuffer: 64 * 1024 * 1024,
  encoding: "utf8",
});

const importMap = new Map([
  ["../document/types", "/src/core/document/types"],
  ["../../types/viewport", "/src/types/viewport"],
  ["../../utils/color", "/src/utils/color"],
  ["./frameScheduler", "/src/core/rendering/frameScheduler"],
  ["./layerSurfaceStore", "/src/core/rendering/layerSurfaceStore"],
  ["./canvas2dStroke", "/src/core/rendering/canvas2dStroke"],
  ["./types", "/src/core/rendering/types"],
]);

const seen = new Set();
const rewritten = original.replace(/from "(\.[^"]+)"/g, (_match, specifier) => {
  seen.add(specifier);
  const target = importMap.get(specifier);
  if (!target) {
    throw new Error(`Unmapped import "${specifier}" in ${sourcePath} @ ${commit}`);
  }
  return `from "${target}"`;
});

const outPath = resolve(repoRoot, "qa", "preR1", "Canvas2DRenderer.ts");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, rewritten, "utf8");

console.log(
  JSON.stringify(
    {
      commit,
      sourcePath,
      bytes: rewritten.length,
      imports: [...seen].sort(),
      out: outPath,
    },
    null,
    2,
  ),
);
