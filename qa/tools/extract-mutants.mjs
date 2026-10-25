/**
 * QA tool: extracts mutated copies of the renderer into qa/mutants/<name>/.
 *
 * Each mutant is the shipped renderer with one line changed, so the browser
 * harness can render the same document through the mutant and through the
 * shipped renderer and compare the pixels. A mutant that changes pixels but
 * passes the repository's test suite is a gap in the regression tests.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const worktree = process.argv[2];
const source = resolve(worktree, "src/core/rendering/Canvas2DRenderer.ts");
const raw = readFileSync(source, "utf8");
const original = raw.replace(/\r\n/g, "\n");

const importMap = new Map([
  ["../document/types", "/src/core/document/types"],
  ["../../types/viewport", "/src/types/viewport"],
  ["../../utils/color", "/src/utils/color"],
  ["./frameScheduler", "/src/core/rendering/frameScheduler"],
  ["./layerSurfaceStore", "/src/core/rendering/layerSurfaceStore"],
  ["./canvas2dStroke", "/src/core/rendering/canvas2dStroke"],
  ["./types", "/src/core/rendering/types"],
]);

const mutants = [
  {
    name: "m4-feather-spread",
    find: "    const spread = strokeDiameter(stroke.brush, 1) / 2 + radius * 3 + 1;",
    replace: "    const spread = strokeDiameter(stroke.brush, 1) / 2 + radius + 1;",
  },
  {
    name: "m6-floored-bounds",
    find: `    const right = Math.min(this.strokeBuffer.width, Math.ceil(bounds.maxX * scale));
    const bottom = Math.min(this.strokeBuffer.height, Math.ceil(bounds.maxY * scale));`,
    replace: `    const right = Math.min(this.strokeBuffer.width, Math.floor(bounds.maxX * scale));
    const bottom = Math.min(this.strokeBuffer.height, Math.floor(bounds.maxY * scale));`,
  },
];

const written = [];
for (const mutant of mutants) {
  if (!original.includes(mutant.find)) {
    throw new Error(`pattern not found for ${mutant.name}`);
  }
  const mutated = original.replace(mutant.find, mutant.replace);
  const rewritten = mutated.replace(/from "(\.[^"]+)"/g, (_match, specifier) => {
    const target = importMap.get(specifier);
    if (!target) {
      throw new Error(`unmapped import ${specifier}`);
    }
    return `from "${target}"`;
  });
  const outPath = resolve(repoRoot, "qa", "mutants", mutant.name, "Canvas2DRenderer.ts");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, rewritten, "utf8");
  written.push({ name: mutant.name, path: outPath });
}

// The worktree file must be left exactly as it was.
writeFileSync(source, raw, "utf8");
console.log(JSON.stringify({ written, restored: source }, null, 2));
