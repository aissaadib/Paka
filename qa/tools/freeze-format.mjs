/**
 * QA tool: freezes the committed (v8) project format reader into qa/head/.
 *
 * The v9 reader must refuse a file that omits a stamp field, and the v8
 * reader must refuse a v9 file. Both readers are needed to check that.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = execSync("git show HEAD:src/core/project/projectFormat.ts", {
  cwd: repoRoot,
  maxBuffer: 64 * 1024 * 1024,
  encoding: "utf8",
});

const importMap = new Map([
  ["../brushes/defaults", "/src/core/brushes/defaults"],
  ["../document/document", "/src/core/document/document"],
  ["../document/types", "/src/core/document/types"],
  ["../../types/brush", "/src/types/brush"],
  ["../../types/geometry", "/src/types/geometry"],
  ["../fill/floodFill", "/src/core/fill/floodFill"],
  ["../../utils/color", "/src/utils/color"],
  ["../../utils/ids", "/src/utils/ids"],
  ["../../utils/base64", "/src/utils/base64"],
]);

/** Any other relative import is resolved against src/core/project/. */
const resolveSpecifier = (specifier) => {
  const stack = ["src", "core", "project"];
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") {
      continue;
    }
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return `/${stack.join("/")}`;
};

const rewritten = source.replace(/from "(\.[^"]+)"/g, (_match, specifier) => {
  const target = importMap.get(specifier) ?? resolveSpecifier(specifier);
  return `from "${target}"`;
});

const outDir = resolve(repoRoot, "qa", "head");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "projectFormat.ts"), rewritten, "utf8");
console.log(JSON.stringify({ written: "qa/head/projectFormat.ts", bytes: rewritten.length }, null, 2));
