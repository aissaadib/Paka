/**
 * Renders `THIRD_PARTY_NOTICES.md` from `licenses/dependency-inventory.json`.
 *
 * The inventory is the machine-readable source of truth: one entry per
 * resolved package in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`, with the
 * licence it declares and the copyright line from the licence file it ships.
 * This script only formats it, so the notices file and the inventory can
 * never drift apart silently.
 *
 *     node scripts/generate-third-party-notices.mjs
 *
 * The verbatim licence texts live in `licenses/` and are bundled with the
 * installer (see `bundle.resources` in `src-tauri/tauri.conf.json`).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const inventory = JSON.parse(
  readFileSync(resolve(root, "licenses", "dependency-inventory.json"), "utf8"),
);

/**
 * The order in which an alternative is elected when a dependency is offered
 * under several licences. MIT is elected whenever it is on offer: it is the
 * licence Paka itself uses, it has the smallest obligation set, and choosing
 * one branch consistently keeps the notice file readable. Apache-2.0 was
 * available as an alternative for most of these packages; it would have
 * carried an express patent grant, which MIT does not - see the note below.
 */
const ELECTION_ORDER = [
  "MIT",
  "Apache-2.0",
  "Zlib",
  "ISC",
  "BSD-3-Clause",
  "0BSD",
  "Unlicense",
  "MPL-2.0",
  "Unicode-3.0",
  "Apache-2.0 WITH LLVM-exception",
];

/**
 * The licence families Paka knows how to satisfy, and the obligation each
 * imposes. `id` is the family; `match` is used to recognise the family
 * inside a licence expression.
 */
const FAMILIES = [
  {
    id: "MIT",
    match: /^MIT$/,
    text: "licenses/MIT.txt",
    obligation:
      "Include the copyright notice and the permission notice. `licenses/MIT.txt` is the permission notice; the per-dependency copyright line is in the tables below.",
  },
  {
    id: "Apache-2.0",
    match: /^Apache-2\.0$/,
    text: "licenses/Apache-2.0.txt",
    obligation:
      "Include a copy of the licence (section 4(a)); retain the copyright, patent, trademark and attribution notices (section 4(c)); mark any modified file (section 4(b)); carry forward any upstream `NOTICE` content (section 4(d)). None of the Apache-2.0 dependencies below ships a `NOTICE` file, and Paka modifies none of them.",
  },
  {
    id: "Apache-2.0 WITH LLVM-exception",
    match: /^Apache-2\.0 WITH LLVM-exception$/,
    text: "licenses/Apache-2.0-LLVM-exception.txt",
    obligation:
      "Include the Apache-2.0 licence text and the LLVM exception, which is what `licenses/Apache-2.0-LLVM-exception.txt` contains.",
  },
  {
    id: "MPL-2.0",
    match: /^MPL-2\.0$/,
    text: "licenses/MPL-2.0.txt",
    obligation:
      "Include the licence text and inform recipients how to obtain the source of the covered files (section 3.2). Paka does not modify these files, so no source is published; the source of each crate is at the crates.io URL in the table.",
  },
  {
    id: "Unicode-3.0",
    match: /^Unicode-3\.0$/,
    text: "licenses/Unicode-3.0.txt",
    obligation:
      "Include the Unicode licence text, which `licenses/Unicode-3.0.txt` contains. The copyright line of each covered item is in the table.",
  },
  {
    id: "BSD-3-Clause",
    match: /^BSD-3-Clause$/,
    text: "licenses/BSD-3-Clause.txt",
    obligation:
      "Retain the copyright notice, the conditions and the disclaimer in the source and in redistributions.",
  },
  {
    id: "ISC",
    match: /^ISC$/,
    text: "licenses/ISC.txt",
    obligation:
      "Retain the copyright notice and the permission notice.",
  },
  {
    id: "Zlib",
    match: /^Zlib$/,
    text: "licenses/Zlib.txt",
    obligation:
      "Retain the copyright notice and the disclaimer.",
  },
  {
    id: "0BSD",
    match: /^0BSD$/,
    text: "licenses/0BSD.txt",
    obligation:
      "No attribution or notice obligation beyond the licence grant itself.",
  },
  {
    id: "Unlicense",
    match: /^Unlicense$/,
    text: "licenses/Unlicense.txt",
    obligation: "No obligation; the text is included for completeness.",
  },
];

const FAMILY_BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));

/**
 * Resolves a licence expression into the licence families Paka actually has
 * to satisfy.
 *
 * `OR` means one of the alternatives is enough, so Paka elects one - see
 * ELECTION_ORDER. `AND` means every side applies, so each side contributes
 * its own elected family. A slash between two names is an alternative too.
 */
function effectiveFamilies(license) {
  const raw = String(license ?? "").trim();
  if (!raw) return [];

  const groups = raw
    .replace(/\s*\/\s*/g, " OR ")
    .split(/\s+AND\s+/i)
    .map((group) => group.replace(/[()]/g, "").trim())
    .filter((group) => group.length > 0);

  const families = [];
  for (const group of groups) {
    const alternatives = group.split(/\s+OR\s+/i).map((a) => a.trim());
    const known = alternatives.filter((a) => FAMILY_BY_ID.has(a));
    if (known.length === 0) continue;
    const elected =
      ELECTION_ORDER.find((id) => known.includes(id)) ?? known[0];
    if (!families.includes(elected)) families.push(elected);
  }
  return families;
}


const escape = (value) =>
  String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();

function familiesFor(license) {
  return effectiveFamilies(license);
}

function table(rows) {
  const header = "| Package | Version | Licence | Copyright | Source |";
  const divider = "| --- | --- | --- | --- | --- |";
  const body = rows.map(
    (row) =>
      `| \`${escape(row.name)}\` | ${escape(row.version)} | \`${escape(row.license)}\` | ${escape(row.copyright) || "— see the package's own licence file"} | ${row.source} |`,
  );
  return [header, divider, ...body].join("\n");
}

function section(title, ecosystem, records) {
  const byFamily = new Map();
  for (const record of records) {
    const families = familiesFor(record.license);
    if (families.length === 0) {
      if (!byFamily.has("Other / not stated")) byFamily.set("Other / not stated", []);
      byFamily.get("Other / not stated").push(record);
      continue;
    }
    for (const familyId of families) {
      if (!byFamily.has(familyId)) byFamily.set(familyId, []);
      byFamily.get(familyId).push(record);
    }
  }

  const parts = [`### ${title} (${records.length} packages)`, ""];
  for (const [familyId, rows] of [...byFamily.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const family = FAMILY_BY_ID.get(familyId);
    parts.push(`#### ${familyId} — ${rows.length} packages`, "");
    if (family) {
      parts.push(`Licence text: \`${family.text}\`. ${family.obligation}`, "");
    } else {
      parts.push(
        "**Review required.** No licence family matched this string; check the package's own licence file before distributing.",
        "",
      );
    }
    parts.push(table(rows.sort((a, b) => a.name.localeCompare(b.name))), "");
  }
  return parts.join("\n");
}

const allRecords = [...inventory.npm, ...inventory.cargo];
const unmatched = allRecords.filter((r) => familiesFor(r.license).length === 0);

const body = `# Third-party notices

Paka is distributed under the MIT licence; see [\`LICENSE\`](LICENSE). This file
is the notice file for the **third-party material that ships inside the Paka
installer** and for the **third-party material committed to this repository**.

It covers every package resolved by \`pnpm-lock.yaml\` and
\`src-tauri/Cargo.lock\`, every licence text in \`licenses/\`, and the
non-dependency material listed in the last section.

## How to read this file

* **\`licenses/\`** holds the verbatim licence texts. They are bundled with the
  installer - see \`bundle.resources\` in \`src-tauri/tauri.conf.json\` - so a
  recipient of the installer receives them.
* **The tables below** list, for every dependency, the exact licence it
  declares and the copyright line from the licence file it ships.
* **Elected licences.** Where a dependency is offered under several licences
  (an \`OR\`), Paka elects **MIT** whenever MIT is on offer, because MIT is the
  licence Paka itself uses and carries the smallest obligation set. Where a
  dependency requires several licences at once (an \`AND\`), Paka complies with
  all of them, so a package appears under each family it is subject to.
* **On the patent grant.** Most of the \`MIT OR Apache-2.0\` packages could
  have been taken under Apache-2.0, which grants an express patent licence.
  MIT does not. Paka's own licence is MIT and carries no express patent grant
  either, so electing MIT changes nothing about the patent position of the
  product as a whole; it only keeps the notice obligations minimal. This is
  recorded as an open decision in \`docs/RELEASE-READINESS.md\` (item R6).
* The data comes from \`licenses/dependency-inventory.json\`, which is generated
  from the two lockfiles and the licence file each package ships. Regenerate
  both with:

  \`\`\`bash
  node scripts/generate-third-party-notices.mjs
  \`\`\`

## Obligations by licence family

| Licence | Text | What it requires of a distributor |
| --- | --- | --- |
${FAMILIES.map(
  (f) => `| ${f.id} | \`${f.text}\` | ${f.obligation} |`,
).join("\n")}

## Tauri

Paka is built with [Tauri](https://tauri.app/), which is licensed
MIT OR Apache-2.0. Tauri is a trademark of The Tauri Programme within the
Commons Conservancy.

**TAURI is a trademark of The Tauri Programme within the Commons Conservancy.
https://tauri.app/**

Paka's application icon is **original Paka artwork**
(\`src-tauri/app-icon.svg\`, generated by \`scripts/generate-app-icon.mjs\`). It
is not the TAURI logo and is not derived from it; see
\`src-tauri/icons/README.md\`.

## Rust dependencies

Source: \`src-tauri/Cargo.lock\`. A crate's source distribution, which contains
the files covered by a copyleft licence, is at the crates.io URL in its row.

${section("Cargo", "cargo", inventory.cargo)}
## npm dependencies

Source: \`pnpm-lock.yaml\`. The runtime packages (\`react\`, \`react-dom\`,
\`@tauri-apps/*\`) are bundled into the application by Vite and ship with it.
The build-time packages (\`vite\`, \`vitest\`, \`typescript\`, \`lightningcss\`
and their dependencies) do not ship with the application. Both are listed here,
because both are part of this repository's source distribution.

${section("npm", "npm", inventory.npm)}
## Material that is not a dependency

| Item | Path | Licence | Notice |
| --- | --- | --- | --- |
| Paka's own source | \`src/\`, \`src-tauri/src/\`, \`docs/\` | MIT ("Copyright (c) 2026 HumanHEART") | See \`LICENSE\` |
| Paka's application icon | \`src-tauri/icons/\`, \`src-tauri/app-icon.svg\` | MIT, original to this repository | See \`src-tauri/icons/README.md\` |
| Vendored agent skill | \`.agents/skills/frontend-ui-engineering/SKILL.md\` | MIT ("Copyright (c) 2025 Addy Osmani") | The MIT permission notice is \`licenses/MIT.txt\` |
| Vendored agent skills | \`.agents/skills/{code-review-and-quality,debugging-and-error-recovery,git-workflow-and-versioning,incremental-implementation,performance-optimization,source-driven-development,test-driven-development}/\` | MIT ("Copyright (c) 2025 Addy Osmani") | The MIT permission notice is \`licenses/MIT.txt\` |
| Vendored agent skill | \`.agents/skills/vercel-react-best-practices/\` (76 files) | MIT — Vercel, Inc. | The MIT permission notice is \`licenses/MIT.txt\`. See the note below. |
| Stamp engine's provenance record | \`docs/CLEAN-ROOM-ATTESTATION.md\`, \`docs/g1/reuse-decision.md\`, \`docs/g1/provenance-record.json\` | MIT, original to this repository | See the note below. |

### The \`vercel-react-best-practices\` skill

These 76 files are byte-for-byte copies of
[\`vercel-labs/agent-skills@main:skills/react-best-practices/\`](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices),
verified by SHA-256.

The upstream project states its licence as **MIT** in the "## License"
section of its repository README. That statement has been present since the
repository's first commit (2025-12-08), and was present at every commit that
touched the files copied here (latest 2026-04-14). The rules were originally
written by [@shuding](https://x.com/shuding) at Vercel.

Two caveats are recorded rather than hidden: upstream ships **no standalone
\`LICENSE\` file**, so the licence is stated in prose in the README rather than
in the canonical MIT form; and upstream states **no copyright line**, so the
copyright holder here is recorded as Vercel, Inc.

Neither caveat prevents redistribution under MIT. The obligations that do
apply are the MIT ones, and they are met by shipping \`licenses/MIT.txt\` and
recording the copyright holder in this table.

### The stamp engine's clean-room attestation

The stamp (dab) brush engine was written from Paka's own written
specification, without reading, copying or adapting any third-party brush
engine's source. \`docs/CLEAN-ROOM-ATTESTATION.md\` records that: which
sources were **not** consulted, and under which protocol the work was done.
Its owner countersignature is still outstanding, and it is tracked as an open
item in \`docs/RELEASE-READINESS.md\` (item R3).

The licence decision behind it is \`docs/g1/reuse-decision.md\`, with the
machine-readable companion \`docs/g1/provenance-record.json\`. Both are
Paka-authored and carry no third-party obligation.
## Review required

${
  unmatched.length === 0
    ? "Every dependency in the inventory matched a licence family above."
    : `${unmatched.length} dependencies did not match a known licence family and need a manual check:\n\n${unmatched
        .map((r) => `* \`${r.name}\` ${r.version} — \`${r.license}\``)
        .join("\n")}`
}

_Generated by \`scripts/generate-third-party-notices.mjs\` from
\`licenses/dependency-inventory.json\` (${inventory.generatedAt})._
`;

const target = resolve(root, "THIRD_PARTY_NOTICES.md");
writeFileSync(target, body, "utf8");
process.stdout.write(`wrote ${target}\n`);
