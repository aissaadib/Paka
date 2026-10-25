/**
 * QA tool: builds a mutant of the frozen working-tree renderer with one
 * placement defect, so the browser harness can measure its pixel effect.
 *
 * N6: the composited region is floored instead of ceiled, which clips the
 * last sub-pixel column/row of the stroke's coverage.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = resolve(repoRoot, "qa", "current");
const outDir = resolve(repoRoot, "qa", "mutant-n6");
mkdirSync(outDir, { recursive: true });

const read = (file) => readFileSync(file, "utf8");
const renderer = read(resolve(source, "Canvas2DRenderer.ts")).replace(/\r\n/g, "\n");
const stamp = read(resolve(source, "stampCoverage.ts")).replace(/\r\n/g, "\n");

const find = `    const right = Math.min(this.strokeBuffer.width, Math.ceil(bounds.maxX * scale));
    const bottom = Math.min(this.strokeBuffer.height, Math.ceil(bounds.maxY * scale));`;
const replace = `    const right = Math.min(this.strokeBuffer.width, Math.floor(bounds.maxX * scale));
    const bottom = Math.min(this.strokeBuffer.height, Math.floor(bounds.maxY * scale));`;

if (!renderer.includes(find)) {
  throw new Error("mutation pattern not found");
}

const rewritten = renderer
  .replace(find, replace)
  .replace('from "/qa/current/stampCoverage.ts"', 'from "/qa/mutant-n6/stampCoverage.ts"');

writeFileSync(resolve(outDir, "Canvas2DRenderer.ts"), rewritten, "utf8");
writeFileSync(resolve(outDir, "stampCoverage.ts"), stamp, "utf8");

console.log(
  JSON.stringify(
    { written: ["qa/mutant-n6/Canvas2DRenderer.ts", "qa/mutant-n6/stampCoverage.ts"] },
    null,
    2,
  ),
);
