/**
 * QA tool: freezes the *current working tree* renderer into qa/frozen/.
 *
 * The implementer is editing the tree while QA runs, so the browser harness
 * must test a fixed copy, not whatever is on disk when the page loads.
 *
 * The copy keeps the relative import of the new stamp module, rewritten to a
 * Vite-root path so the dev server serves it from qa/frozen/.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = resolve(repoRoot, "qa", process.argv[2] ?? "frozen");
mkdirSync(outDir, { recursive: true });

const importMap = new Map([
  ["../document/types", "/src/core/document/types"],
  ["../../types/viewport", "/src/types/viewport"],
  ["../../utils/color", "/src/utils/color"],
  ["../../types/brush", "/src/types/brush"],
  ["../../utils/math", "/src/utils/math"],
  ["../brushes/defaults", "/src/core/brushes/defaults"],
  ["./frameScheduler", "/src/core/rendering/frameScheduler"],
  ["./layerSurfaceStore", "/src/core/rendering/layerSurfaceStore"],
  ["./canvas2dStroke", "/src/core/rendering/canvas2dStroke"],
  ["./stampCoverage", `/qa/${process.argv[2] ?? "frozen"}/stampCoverage.ts`],
  ["./types", "/src/core/rendering/types"],
]);

const rewrite = (source, label) =>
  source.replace(/from "(\.[^"]+)"/g, (_match, specifier) => {
    const target = importMap.get(specifier);
    if (!target) {
      throw new Error(`unmapped import "${specifier}" in ${label}`);
    }
    return `from "${target}"`;
  });

const renderer = readFileSync(
  resolve(repoRoot, "src/core/rendering/Canvas2DRenderer.ts"),
  "utf8",
);
const stamp = readFileSync(resolve(repoRoot, "src/core/rendering/stampCoverage.ts"), "utf8");

writeFileSync(resolve(outDir, "Canvas2DRenderer.ts"), rewrite(renderer, "Canvas2DRenderer.ts"), "utf8");
writeFileSync(resolve(outDir, "stampCoverage.ts"), rewrite(stamp, "stampCoverage.ts"), "utf8");

// The committed renderer (HEAD) is frozen too, so the R1 comparison is not
// affected by whatever the working tree contains.
const { execSync } = await import("node:child_process");
const head = execSync("git show HEAD:src/core/rendering/Canvas2DRenderer.ts", {
  cwd: repoRoot,
  maxBuffer: 64 * 1024 * 1024,
  encoding: "utf8",
});
const headDir = resolve(repoRoot, "qa", "head");
mkdirSync(headDir, { recursive: true });
writeFileSync(resolve(headDir, "Canvas2DRenderer.ts"), rewrite(head, "HEAD renderer"), "utf8");

console.log(
  JSON.stringify(
    {
      frozen: [
        "qa/frozen/Canvas2DRenderer.ts",
        "qa/frozen/stampCoverage.ts",
        "qa/head/Canvas2DRenderer.ts",
      ],
      rendererBytes: renderer.length,
      stampBytes: stamp.length,
      headBytes: head.length,
      headCommit: execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim(),
      at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
