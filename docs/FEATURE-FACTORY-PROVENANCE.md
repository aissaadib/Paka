# Provenance gate — candidate features

> **Artifact type:** a Licence and Provenance Gate decision, produced by the
> licence gate subagent. It is *not* a project doc and *not* an implementation
> plan.
>
> **It applies only to the candidates, clones, revisions and files named
> below.** It is not a clearance of the Paka repository as a whole; the
> repository-wide findings live in `docs/g1/reuse-decision.md` and
> `docs/g1/provenance-record.json` and are not re-decided here.
>
> **Nothing was modified.** No file in the Paka repository, in any worktree, or
> in any clone was created, edited, staged, committed, merged or pushed. The
> only file written is this report.

| Field | Value |
| --- | --- |
| Gate date | 2026-10-21 |
| Candidates gated | T-13, T-14, T-11, T-06, text tool (future), stroke dynamics (future), T-10 (implemented), animation/playback (future) |
| Clones read | `C:\Users\aissa\Desktop\Paka-feature-factory\sources\` — chroma.js, fabric.js, gifenc, opentype.js, perfect-freehand, react-colorful, svg-path-editor, tauri-apps-plugins-workspace |
| Binding prior rules | `docs/g1/reuse-decision.md` (strategy taxonomy A–H, §2.5 clean-room rule), `docs/g1/provenance-record.json`, `docs/CLEAN-ROOM-ATTESTATION.md` |
| Distribution model assumed | Public GitHub repository **and** a Tauri desktop installer (`src-tauri/tauri.conf.json`: `bundle.active: true`, `bundle.targets: "all"`). `package.json` is `"private": true` — not published to npm. Taken from `docs/g1/reuse-decision.md` §0.3/§4.5, not re-decided. |
| Paka's own licence | MIT, `LICENSE`, "Copyright (c) 2026 HumanHEART" (`docs/g1/reuse-decision.md` §4.1, record R-001) |
| Disclaimer | Engineering triage under the evidence available on the review date. **Not legal advice.** Does not create, transfer or waive any right. |

---

## 0. Method, and the existing rules this follows

### 0.1 The rules that bind this gate

This gate uses the taxonomy and the clean-room rule exactly as established in
`docs/g1/reuse-decision.md`. It does not invent a new one.

| Rule | Source | How it is applied here |
| --- | --- | --- |
| Strategy taxonomy **A**–**H** (A independent reimplementation, B adopt a library, C copy/adapt, D port, E clean-room from a GPL behaviour, F separate-process, G bundled assets, H later third-party assets) | `docs/g1/reuse-decision.md` §0.2, §3.1–§3.8 | Each candidate's decision is expressed in these terms. |
| **The clean-room rule (§2.5)** — independent reimplementation only if the implementer has not read the referenced source, **or** the implementation was written from a Paka-authored specification that does not reproduce the source's expression, structure, constants, comments, identifier names or code layout. Renaming, reformatting and translating do not launder a copy. | `docs/g1/reuse-decision.md` §2.5 | Applied per candidate in §2. For candidates whose Paka-authored specification already exists, the clean-room requirement is a *protocol* obligation on the implementer, recorded in §4. |
| **Asset bar (§3.7)** — CC0-1.0 preferred; MIT / Apache-2.0 / BSD / ISC / SIL-OFL-1.1 acceptable **with** notices; **BLOCKED** for GPL, AGPL, LGPL, CC-BY-SA, CC-BY-NC and anything with no licence statement at all (default = all rights reserved). Each bundled asset recorded with source URL, file name, SHA-256, SPDX id, author, retrieval date. | `docs/g1/reuse-decision.md` §3.7 | Applied to the font assets in §2.5 and to any other bundled asset. |
| **Notice obligations** — the library's copyright notice and licence text must be in `THIRD_PARTY_NOTICES.md` and shipped with the installer; version pinned and recorded; Apache-2.0 §4(b) modified-file marking and §4(d) NOTICE carry-forward. | `docs/g1/reuse-decision.md` §3.2 requirements 1–5 | Restated per candidate in §2 and §4. |
| **Do not fix a licence problem by adding a `LICENSE` file to a vendored directory.** | `docs/g1/reuse-decision.md` §5 | Restated in §2.5 for the font assets. |
| **Machine-readable record shape** — per-file provenance, dependency licence map, obligations, blocked material, clean-room attestation fields. | `docs/g1/provenance-record.json` | The shape of this report mirrors it: per-candidate source/revision/files, licence + identifier line, assets, decision, obligations, risks, clean-room requirements. |

### 0.2 What this gate does **not** decide

* **R6** (the patent-grant position), **R9** (the CI licence allow-list) and
  **R3** (the clean-room countersignature) are the owner's. §4 reports on them
  only where a candidate's decision depends on them, and says so explicitly.
* Architecture, scope, product behaviour and schedule. Where a candidate is
  technically unsuitable, that is recorded as a *fact about the source*, not as
  a licence decision.
* Whether Paka's own repository is clear to distribute. Findings B-1 … B-8 in
  `docs/g1/provenance-record.json` stand as issued.

### 0.3 Method and evidence

| Evidence | How it was obtained |
| --- | --- |
| Clone licence files | Read from **the clone's own file** in every case: `git -C "<clone>" show HEAD:<licence-path>`. No licence was taken from memory and none was inferred from a `package.json` `license` field alone (the manifest fields are recorded separately, and where they differ from the licence file that is stated). |
| Clone revisions | `git -C "<clone>" rev-parse HEAD` and `git log -1 --format="%H\|%ad\|%s"`. |
| Candidate source files | Read via `git show HEAD:<path>` in the clone (two clones are sparse-checkouts; `git show` was used throughout so that no working-tree state was relied on). |
| Paka-side material | Read from the Paka repository and the named worktrees, read-only. |
| Existing dependency coverage | `package.json` (4 runtime deps), `src-tauri/Cargo.toml`, `src/types/brush.ts`, `src/core/brushes/defaults.ts`, `src/core/brushes/strokeBuilder.ts`, `src/core/tools/shapeGeometry.ts`, `src/core/rendering/viewport.ts`, `src/core/commands/documentCommand.ts`, `src/core/project/projectGateway.ts`, `src-tauri/src/project_io.rs`. |
| Notices machinery | `scripts/generate-third-party-notices.mjs` (read in full), `licenses/` listing, `licenses/dependency-inventory.json` header, `docs/RELEASE-READINESS.md` R5/R9. |

**Two of the clones are sparse-checkouts** and were therefore read exclusively
through `git -C "<path>" show HEAD:<path>`: `chroma.js` and
`tauri-apps-plugins-workspace`. The same method was used for the rest, so every
quote in this report is from the committed tree at the recorded revision.

### 0.4 The vocabulary this gate uses

| Decision | Meaning here |
| --- | --- |
| `COPY-ELIGIBLE` | The material may be copied or adapted into Paka, provided the stated obligations are met and the stated risks and clean-room requirements are satisfied. |
| `REFERENCE-ONLY` | The material may be read as a **behavioural reference** — its observable behaviour may be studied and reimplemented — but no part of its expression may be copied into Paka. |
| `LICENSE-BLOCKED` | The material may not be copied, adapted or bundled by Paka, whatever the technical merit. |
| `NO-SOURCE` | The candidate needs **no third-party source at all**: Paka's own code and documents already specify it, so neither copying nor referencing is required. |

---

## 1. Verified source licences

Every identifier line below is quoted from the clone's own licence file at the
revision in the table.

| Clone | Revision (HEAD) | Licence file read | Identifier line, as read | Assets shipped | Notes |
| --- | --- | --- | --- | --- | --- |
| **chroma.js** | `14e2b8adc753b018718bdfce53cc0dcc1ebb8d91` (2026-09-15) | `LICENSE` | *"chroma.js - JavaScript library for color conversions / Copyright (c) 2011-2025, Gregor Aisch / All rights reserved."* followed by the three BSD clauses | **Yes — data tables.** `src/colors/colorbrewer.js` carries its own Apache-2.0 header (ColorBrewer, © 2002 Cynthia Brewer, Mark Harrower, Penn State); `src/colors/w3cx11.js` is the X11/CSS3 named-colour table | **Not MIT.** The body is BSD-3-Clause (with a **no-endorsement** clause 3). `package.json` declares `"license": "(BSD-3-Clause AND Apache-2.0)"` — an **AND**, so adopting the package as a whole carries **both** obligations. |
| **fabric.js** | `47484957f95fb8c817a6ce66c78e8191be771d35` (2026-10-20) | `LICENSE` | *"MIT License / Copyright (c) 2008-2015 Printio (Juriy Zaytsev, Maxim Chernyak) / Copyright (c) 2016-present Andrea Bogazzi, Shachar Nen and Fabric.js contributors (https://github.com/fabricjs/fabric.js/graphs/contributors)"* | Website images only (`packages/website/public/site_assets/**`), not in the published packages (`@fabricjs/core` `files: ["dist", "README.md"]`; `@fabricjs/aligning-guidelines` `files: ["dist", "README.md"]`) | `packages/aligning-guidelines/package.json` declares `"license": "MIT"`; `packages/core/package.json` declares `"license": "MIT"`. Root `LICENSE` covers the tree. |
| **gifenc** | `27db5b982dba701ca440b55ea36fad3999040973` (2024-09-19) | `LICENSE.md` | *"The MIT License (MIT) / Copyright (c) 2017 Matt DesLauriers"* | **None.** `src/` is code only (`color.js`, `constants.js`, `index.js`, `lzwEncode.js`, `palettize.js`, `pnnquant2.js`, `rgb-packing.js`, `stream.js`) | `package.json` declares `"license": "MIT"`; the licence file agrees. |
| **opentype.js** | `5d65b6dcfab5115f90d375f8ba6b7942fdaa0138` (2026-05-19) | `LICENSE` | *"The MIT License (MIT) / Copyright (c) 2020 Frederik De Bleser"* | **Yes — 45 font files** under `test/fonts/` plus `docs/fonts/FiraSansMedium.woff`. Licences are mixed: OFL-1.1 (several with Reserved Font Names), Apache-2.0, **CC BY-SA 4.0**, one CC0-1.0 subset, and one "All rights reserved" family with no licence statement | `package.json` declares `"license": "MIT"`; the licence file agrees. **The font licences are governed by `test/fonts/LICENSE`, not by the root MIT.** See §2.5. |
| **perfect-freehand** | `176e00f2399f4969e1b0965c5921d96a3e50ce9f` (2026-02-01) | `LICENSE` and `packages/perfect-freehand/LICENSE` (identical) | *"MIT License / Copyright (c) 2021 Stephen Ruiz Ltd"* | `packages/perfect-freehand/assets/{icons.png, perfect-freehand-card.png, perfect-freehand-logo.svg, process.gif}` — **not published**: `package.json` `files: ["dist/**/*"]` | The root `LICENSE` and the package `LICENSE` are the same MIT text. The npm tarball ships `dist/` only. |
| **react-colorful** | `8506e8c4b777e0056ce3567dc3a06ced143034bc` (2026-09-01, "5.8.1") | `LICENSE` | *"MIT License / Copyright (c) 2020-present Vlad Shilov <omgovich@ya.ru>"* | **None.** The published `files` list is `dist/*`, `LICENSE`, `ACKNOWLEDGMENTS`, `README.md`, `package.json`; `src/css/styles.css` is CSS | `package.json` declares `"license": "MIT"`; the licence file agrees. |
| **svg-path-editor** | `937d75a83b6be2bdda11d02b9b3594841315223a` (2026-06-18) | `LICENSE` | *"Apache License / Version 2.0, January 2004 / http://www.apache.org/licenses/"* | Angular demo assets under `src/` and `doc/` | **Not among the candidates gated in this report.** Recorded here because it sits in the same clone set. `package.json` states no `license` field, which shows why the licence file — not the manifest — is authoritative. |
| **tauri-apps-plugins-workspace** | `11211c30e71796cd737280303244552bb7f70797` (2026-10-18) | `LICENSE_MIT`, `LICENSE_APACHE-2.0`, `LICENSE.spdx` at the root **and** `plugins/store/LICENSE*`, `plugins/fs/LICENSE*` | *"MIT License / Copyright (c) 2017 - Present Tauri Apps Contributors"* (MIT); *"Apache License / Version 2.0, January 2004"* (Apache-2.0); `LICENSE.spdx`: `PackageLicenseDeclared: Apache-2.0` **and** `MIT`, `PackageSupplier: Organization: The Tauri Programme in the Commons Conservancy` | `plugins/store/banner.png`, `plugins/fs/banner.png`, example-app icons under `plugins/store/examples/**` | Root `Cargo.toml` `[workspace.package] license = "Apache-2.0 OR MIT"`; `plugins/store/Cargo.toml` and `plugins/fs/Cargo.toml` set `license = { workspace = true }`. The npm side declares `"license": "MIT OR Apache-2.0"` (`plugins/store/package.json`). **Dual-licensed: Paka elects the MIT branch.** |

**Cross-cutting fact about the notices machinery.** `scripts/generate-third-party-notices.mjs`
already has a `BSD-3-Clause` family (text `licenses/BSD-3-Clause.txt`, obligation
text *"Retain the copyright notice, the conditions and the disclaimer in the
source and in redistributions."*) and an `Apache-2.0` family
(`licenses/Apache-2.0.txt`). Its `effectiveFamilies()` splits a licence
expression on `AND` and elects one branch per group from `ELECTION_ORDER`
(`MIT`, `Apache-2.0`, `Zlib`, `ISC`, `BSD-3-Clause`, …). Therefore a
`(BSD-3-Clause AND Apache-2.0)` package such as `chroma-js` would appear under
**both** families and both texts are already shipped. No generator change is
needed for the licences read in §1.

---

## 2. The gate decisions

### 2.1 T-13 — contrast and colour difference

* **Source repository / revision:** `gka/chroma.js` at
  `14e2b8adc753b018718bdfce53cc0dcc1ebb8d91` (2026-09-15, "fix(hsl): keep
  alpha when constructing from an object (#396)"), `chroma-js` 3.2.0.
* **Candidate plan:** `docs/t13-contrast-dee-plan.md`, branch
  `docs/t13-contrast-dee-plan`, commit `23d9992aa1a1064316621fb227945e68984d9012`
  (2026-10-20), in worktree
  `C:\Users\aissa\.local\share\opencode\worktree\252257\t13-contrast-dee`.
* **Files / symbols that would be reused:** *none, in the plan as written.*
  The plan's §9.1 recommends "no new dependency" and implements the metrics
  from the published standards. The candidate source that was pointed at this
  task is:
  * `src/utils/contrast.js` — default export `(a, b) => …`, the WCAG contrast
    ratio over `Color.luminance()`. *(Verified: no `src/contrast/` directory
    exists at this revision. The task brief's path `src/contrast/` is not
    present in the clone; the two contrast files live under `src/utils/`.)*
  * `src/utils/contrastAPCA.js` — default export `(text, bg) => …`, APCA
    0.1.17 / APCA-0.0.98G, with a `@license` doc block citing Myndex's
    specification. The file itself states *"the APCA implementation is still
    beta"*.
  * `src/utils/delta-e.js` — default export `(a, b, Kl = 1, Kc = 1, Kh = 1)`,
    CIEDE2000 over `Color.lab()`.
* **Licence, with the line read:** `LICENSE` — *"Copyright (c) 2011-2025,
  Gregor Aisch / All rights reserved."*, followed by the three BSD clauses.
  **BSD-3-Clause**, **not MIT**. `package.json`: `"license": "(BSD-3-Clause
  AND Apache-2.0)"`. Clause 3 is a **no-endorsement** clause: *"The name
  Gregor Aisch may not be used to endorse or promote products derived from this
  software without specific prior written permission."*
* **Assets that would travel with them:** the two contrast files and the ΔE
  file carry **no** assets. If the *package* were adopted rather than two
  files, it would also carry `src/colors/colorbrewer.js` (ColorBrewer,
  © 2002 Cynthia Brewer, Mark Harrower and The Pennsylvania State University,
  **Apache-2.0**) and `src/colors/w3cx11.js` (the X11/CSS3 named-colour
  table). The `LICENSE` file itself records both in prose.
* **Decision:**
  * **`NO-SOURCE` for the implementation as planned.** The plan is a clean
    Strategy-A implementation: WCAG 2.2's relative luminance and contrast
    ratio, and CIE 142-2001 / ISO 11664-6's CIELAB and CIEDE2000, are
    **published specifications**, and the plan implements them in Paka's own
    words with a citation rather than a copy. The plan's own acceptance
    criterion **AC-14** requires that `package.json`, `pnpm-lock.yaml`,
    `licenses/dependency-inventory.json` and `THIRD_PARTY_NOTICES.md` stay
    unchanged.
  * **`REFERENCE-ONLY` if chroma.js is read at all.** Reading it as a
    cross-check on the published formulas is permitted; no part of its
    expression may enter the tree.
  * **`COPY-ELIGIBLE` is available but not needed.** If the coordinator
    nevertheless elects to copy chroma.js's expression, that is a BSD-3-Clause
    copy: the copyright notice, the three conditions and the disclaimer must
    be retained in the source and reproduced in the binary distribution
    (§2 of the BSD text), the no-endorsement clause must be respected (Paka
    must not be described as by, or endorsed by, Gregor Aisch), and the
    material would appear in `THIRD_PARTY_NOTICES.md` under BSD-3-Clause. If
    the whole package is taken, the Apache-2.0 ColorBrewer data comes with it
    as well (§4(a) licence copy, §4(b) modified-file marking, §4(d) NOTICE
    carry-forward, §6 no trademark grant).
* **Obligations a distributor would owe if copied:** retain the BSD-3-Clause
  copyright notice, conditions and disclaimer in source and binary
  redistributions; reproduce them in the shipped documentation
  (`licenses/BSD-3-Clause.txt` + a `chroma-js` row in `THIRD_PARTY_NOTICES.md`
  — the generator already emits both); no endorsement or promotional use of
  "Gregor Aisch"; if the package (not the two files) is taken, also comply
  with Apache-2.0 for the bundled ColorBrewer data. **No express patent grant**
  in BSD-3-Clause or MIT — this ties to R6 (§4) but does not change this
  decision. **No trademark rights** in either licence.
* **Does an existing dependency already cover it?** Paka has **no colour
  library and no numeric library of any kind**; the runtime dependency set is
  `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `react`, `react-dom`
  (`package.json`). T-10 added `src/utils/color.ts` with **HSV only** — no
  luminance, no Lab, no ΔE. So no, nothing existing covers it; the right
  answer is nonetheless to implement ~120 lines of published-standard
  arithmetic rather than take a dependency, which the plan already does.
* **Risks and clean-room requirements:**
  * **Clean-room (§2.5) — the decisive requirement.** Because a Paka-authored
    behaviour specification exists (the plan's §5 "The formulas", with the
    Sharma–Wu–Dalal verification corpus), Strategy A holds **only** if the
    implementer either never opens chroma.js, or writes the implementation
    from the plan without reproducing chroma.js's expression, structure,
    constants, comments, identifier names or code layout. chroma.js's ΔE file
    uses a shifted-prime notation (`a1p`, `C1p`, `h1p`, `avgCp`) that the
    plan does not use (`a'`, `C'`, `h'`, `C̄'`); the two expressions are
    visibly different, which is consistent with Strategy A — but the gate
    **cannot verify the implementer's reading history**, so the §2.5
    attestation is the implementer's obligation.
  * **Judgement — the verification corpus.** The plan proposes embedding all
    34 Sharma–Wu–Dalal (2005) Lab/ΔE00 pairs as test data. My judgement: the
    *numbers* are unprotectable facts published for exactly this purpose, but
    the paper's prose must not be pasted (gate condition C3), and the paper
    must be **cited**. This is a judgement, not a verified fact, and the owner
    may want to accept it explicitly.
  * **Judgement — APCA.** The plan rejects APCA as non-normative, and
    chroma.js's own file labels its APCA implementation beta. If APCA is ever
    added, the plan's §2.3 already asks the metric module to return raw
    relative luminance so a second ratio can be added without changing the
    API. No provenance issue arises, but chroma.js's APCA file would be a
    **copy-eligible** BSD-3 file *and* a citation to Myndex's APCA
    specification; a clean-room reimplementation would need only the
    specification, and would not carry chroma.js's notice at all.
* **Blocking condition:** none. Strategy A is clear to proceed. The gate
  requires the §2.5 attestation (the owner's R3 countersignature) before the
  slice is merged.

---

### 2.2 T-14 — polygon and star shape tools

* **Source repository / revision:** `fabricjs/fabric.js` at
  `47484957f95fb8c817a6ce66c78e8191be771d35` (2026-10-20), `@fabricjs/core`
  7.4.0.
* **Candidate plan:** `docs/T-14-polygon-star-discovery.md`, branch
  `docs/t14-polygon-star-discovery`, commit
  `4a08df9bbb540b3e3993f3accd25472bfe184887` (2026-10-20). Also copied to
  `C:\Users\aissa\Desktop\Paka-feature-factory\wave1\T-14-polygon-star-discovery.md`.
* **Files / symbols that would be reused:** *none, in the plan as written.*
  The plan specifies the geometry from scratch in §3.3–§3.5 (vertex angles
  `-π/2 + 2πk/n`, the ellipse inscription rule, the `2p`-vertex star, the
  `innerRatio`, the rotation) and extends Paka's own
  `src/core/tools/shapeGeometry.ts` (`ShapeKind = "line" | "rectangle" |
  "ellipse"`, `shapeOutline`, `outlineExtent`, `dragBox`).
  The candidate source that was pointed at this task is:
  * `packages/core/src/shapes/Polygon.ts` — **verified to contain no geometry
    at all.** It is thirteen lines: `export class Polygon extends Polyline`
    with `static ownDefaults = polylineDefaultValues`, `static type =
    'Polygon'`, `protected isOpen() { return false; }`, and two
    `classRegistry` registrations. There is **no regular-polygon-from-a-box
    generator anywhere in `@fabricjs/core`** — the polygon geometry that
    exists in the fabric.js project lives in the website demos, which are not
    a published package.
  * `packages/core/src/shapes/Polyline.ts` — bounding-box and dimension
    bookkeeping for a polyline (`_calcDimensions`, `setDimensions`,
    `setBoundingBox`, `_getNonTransformedDimensions`).
  * `packages/aligning-guidelines/` — see §2.3.
* **Licence, with the line read:** `LICENSE` — *"MIT License / Copyright (c)
  2008-2015 Printio (Juriy Zaytsev, Maxim Chernyak) / Copyright (c)
  2016-present Andrea Bogazzi, Shachar Nen and Fabric.js contributors"*.
  `packages/core/package.json` and `packages/aligning-guidelines/package.json`
  both declare `"license": "MIT"`.
* **Assets that would travel with them:** none from these files. The only
  fabric.js images are in `packages/website/public/site_assets/**` and the
  website demo content, none of which is in the published packages
  (`files: ["dist", "README.md"]`).
* **Decision: `NO-SOURCE`.**
  The plan already specifies the geometry as mathematics, and the named
  candidate file contains no geometry. There is nothing to copy and nothing
  that would need to be referenced. fabric.js is `REFERENCE-ONLY` if consulted
  at all — for instance to check how a polyline's bounding box is derived.
* **Obligations if copied anyway:** retain the MIT copyright and permission
  notice in all copies or substantial portions — `licenses/MIT.txt` plus a
  `fabric.js` row in `THIRD_PARTY_NOTICES.md`, both of which the generator
  already produce. MIT carries **no express patent grant** (touches R6, §4)
  and **no trademark rights**: the "Fabric.js" name must not be used as a mark.
* **Does an existing dependency already cover it?** Paka already has the whole
  shape pipeline: `src/core/tools/shapeGeometry.ts` (the line/rectangle/ellipse
  outlines and the Shift/Alt drag rules), `src/core/tools/shapeTool.ts`
  (one `ShapeTool` class parameterised by kind), `shapeBrush()` in
  `DrawingEngine.ts` (which forces the segment path for every shape), and
  the non-zero fill branch in `canvas2dStroke.ts`. **A polygon and a star need
  no document-format change, no new element kind and no new command type** —
  a shape is an ordinary `StrokeRecord` whose `xs`/`ys` hold the outline.
  Adding `"polygon"` and `"star"` to `ShapeKind` is the whole of it. So: an
  existing *Paka* facility already covers it; a third-party geometry library
  would be a second copy of nothing.
* **Risks and clean-room requirements:** Strategy A. The implementer must not
  open fabric.js's shape sources while producing the implementation; the
  plan's §3 is a sufficient Paka-authored specification. Note the plan's
  §10 open questions (3: inscribed in the box's ellipse vs scaled to fill the
  box; 1 and 2: where the options live and whether rotation is in scope) are
  product decisions and are **not** licence decisions — the gate has no view
  on them.
* **Blocking condition:** none.

---

### 2.3 T-11 — composition guides

* **Source repository / revision:** `fabricjs/fabric.js` at
  `47484957f95fb8c817a6ce66c78e8191be771d35`; `packages/aligning-guidelines`
  (`@fabricjs/aligning-guidelines` 7.4.0).
* **Candidate plan:** `docs/t11-guides-discovery.md`, branch
  `docs/t11-guides-discovery`, commit
  `283777bea07ddd81048d24c92608a5f25b69401d` (2026-10-20), in worktree
  `C:\Users\aissa\.local\share\opencode\worktree\252257\t11-guides-discovery`.
* **Files / symbols that would be reused:** *none, in the plan as written.*
  The plan specifies the model (`Guide = { id, axis, position }`,
  `DrawingDocument.guides`), the gesture rules, the screen-space chrome
  (`lineWidth = 1 / scale`) and the persistence (additive field, no version
  bump under decision P1). The candidate source is:
  * `packages/aligning-guidelines/src/util/basic.ts` — `getDistance(a, b)`,
    `getDistanceList(point, list, type)`, `getPointMap(target)`,
    `getContraryMap(target)`.
  * `packages/aligning-guidelines/src/util/collect-line.ts`,
    `collect-point.ts`, `draw.ts`, `get-objects-by-target.ts`.
* **Licence, with the line read:** root `LICENSE` — *"MIT License / Copyright
  (c) 2008-2015 Printio (Juriy Zaytsev, Maxim Chernyak) / Copyright (c)
  2016-present Andrea Bogazzi, Shachar Nen and Fabric.js contributors"*;
  `packages/aligning-guidelines/package.json` declares `"license": "MIT"`.
* **Assets that would travel with them:** none.
* **Decision: `NO-SOURCE`.**
  Two independent reasons, one factual and one architectural:
  1. **Factual:** fabric's aligning-guidelines is a **different feature**.
     It computes *alignment guides between objects* — the lines that appear
     when a rectangle's edge lines up with another object's edge. T-11 is
     **user-placed composition guides** in document space: a vertical or
     horizontal registration mark the user drags out, with no object
     involvement at all. The two share no behaviour, so there is nothing to
     copy and nothing to reference.
  2. **The plan already specifies it.** §2.1–§2.6 of the discovery cover the
     coordinate rule, the data model, the interaction rules, the display
     idiom and the persistence.
  fabric.js is `REFERENCE-ONLY` if consulted.
* **Obligations if copied anyway:** MIT notice retention in the source and in
  the shipped documentation (`licenses/MIT.txt` + a row in
  `THIRD_PARTY_NOTICES.md`); no trademark use of "Fabric.js"; no express
  patent grant (R6, §4).
* **Does an existing dependency already cover it?** Yes, in Paka itself:
  `src/core/rendering/viewport.ts` already provides `docToScreen` /
  `screenToDoc` (the coordinate rule), `src/core/commands/documentCommand.ts`
  already provides the whole-document before/after snapshot with a `mergeKey`
  (the one-undo-step drag rule), and `src/core/rendering/Canvas2DRenderer.ts`
  already owns the display-only overlay idiom (`paintSelection`, the
  `SELECTION_TRACE_WIDTH / scale` hairline, and the rule that the trace is
  *"not part of the document"* so exports are byte-identical). The plan
  explicitly needs **no new renderer interface method**. No third-party
  geometry or alignment package is needed.
* **Risks and clean-room requirements:** Strategy A. §8's product decisions
  P1–P7 (exported or display-only, diagonal guides, duplicate positions,
  off-paper positions, position labels, guide colour, dedicated tool vs
  modifier chord) are product decisions and are **not** licence decisions.
  One substantive note that *is* in the gate's remit: under decision **P1**,
  if the guides were ever exported, the project format would need a version
  bump (`docs/PROJECT_FORMAT.md`'s own rule) — that is a format decision, not
  a licence one.
* **Blocking condition:** none.

---

### 2.4 T-06 — settings and autosave

* **Source repository / revision:** `tauri-apps/tauri-apps-plugins-workspace`
  at `11211c30e71796cd737280303244552bb7f70797` (2026-10-18);
  `tauri-plugin-store` 2.5.0 and `tauri-plugin-fs` 2.7.1.
* **Candidate plan:** `docs/SETTINGS-AUTOSAVE-DISCOVERY.md`, branch
  `chore/t06-discovery`, commit
  `43e8a576746bfb426151f8b83d7aed88b199bc60` (2026-10-20), worktree
  `C:\Users\aissa\Desktop\Paka-feature-factory\worktrees\t06-settings-autosave`.
* **Files / symbols that would be reused:** *none, in the plan as written.*
  The plan proposes Paka's own `src/core/settings/{appSettings,
  settingsGateway, settingsStore}.ts` and `src/core/autosave/{autosaveService,
  recovery}.ts`, plus two new Rust commands (`app_config_dir`, and
  `delete_file` / `file_exists`). The candidate source is:
  * `plugins/store/` — Rust `src/store.rs` (`Store::save`, `Store::load`,
    `Store::set`, the auto-save debounce machinery), Rust `src/lib.rs`, and
    `plugins/store/guest-js/index.ts` (the npm `@tauri-apps/plugin-store`
    client).
  * `plugins/fs/` — Rust `src/commands.rs` (`write_file_inner`, `write_file`,
    `write_text_file`, `create`, `open`, `truncate`, `ftruncate`, `exists`,
    `mkdir`), Rust `src/scope.rs`, `src/file_path.rs`, `src/watcher.rs`, and
    `plugins/fs/guest-js/index.ts`.
* **Licence, with the line read:** `plugins/store/LICENSE_MIT` and
  `plugins/fs/LICENSE_MIT` — *"MIT License / Copyright (c) 2017 - Present
  Tauri Apps Contributors"*. The Apache-2.0 branch is
  `plugins/store/LICENSE_APACHE-2.0` — *"Apache License / Version 2.0,
  January 2004"*. `LICENSE.spdx` declares both. Root `Cargo.toml`
  `[workspace.package] license = "Apache-2.0 OR MIT"`; the npm manifests
  declare `"license": "MIT OR Apache-2.0"`.
  **Dual-licensed — Paka elects the MIT branch**, consistent with the
  generator's `ELECTION_ORDER` and with `docs/g1/provenance-record.json`
  R-017's stated election rule.
* **Assets that would travel with them:** `plugins/store/banner.png` and
  `plugins/fs/banner.png` are the plugins' README badges; the example
  applications under `plugins/store/examples/AppSettingsManager/**` carry
  Tauri template icons and a `tauri.svg`. None of these is in the published
  crates or npm packages. **If the plugins were adopted, the assets that
  would actually matter are Paka's own app icons, which are unaffected.**
* **Decision: `NO-SOURCE` for the plan as written** — the plan specifies its
  own Rust commands and its own modules and takes no dependency.
  **`COPY-ELIGIBLE` is available** (MIT branch) if the coordinator instead
  elects to adopt the two plugins; and the plugins are `REFERENCE-ONLY` for
  their idioms (the store's debounced auto-save is a good pattern to read).
* **Verified technical fact that bears on the choice — the earlier audit's
  finding is confirmed, and it is a regression risk, not a licence issue:**
  * **`tauri-plugin-fs` truncates in place.** `plugins/fs/src/commands.rs`,
    `write_file_inner`, opens the target with
    `crate::OpenOptions { read: false, write: true, truncate: !opts.append,
    append: opts.append, create: opts.create, … }` and then calls
    `file_handle.write_all(&data)`. There is **no temp file and no rename**:
    a crash or a full disk mid-write leaves a truncated file.
  * **`tauri-plugin-store` is not atomic.** `plugins/store/src/store.rs`,
    `Store::save`:
    ```rust
    fs::create_dir_all(self.path.parent().expect("invalid store path"))?;
    let bytes = (self.serialize_fn)(&self.cache).map_err(crate::Error::Serialize)?;
    fs::write(&self.path, bytes)?;
    ```
    `std::fs::write` creates-or-truncates and writes in place. **No temp
    file, no rename, no `sync_all`.**
  * **Paka's own writer is stronger.** `src-tauri/src/project_io.rs`
    `write_atomic` (L134) writes `.{name}.{pid}.{counter}.tmp` beside the
    target, `sync_all()`s it (L152) and `fs::rename`s it over the target
    (L160), removing the temporary on failure. Paka's writer also enforces
    an extension allow-list (`PROJECT_EXTENSIONS = ["paka", "json"]`, L30) and
    requires the parent directory to exist.
  * **Judgement:** adopting `tauri-plugin-fs` for the settings write would
    **downgrade** Paka's data-integrity guarantee on the one file whose loss
    loses user work, and adopting `tauri-plugin-store` would do the same for
    the settings file. That is an engineering judgement about a
    permissive-MIT library, not a licence constraint — but it is the reason
    the plan's own design (its own Rust commands) is the better route, and
    the reason the gate does not recommend the plugins.
* **Obligations if copied/adopted:** retain the MIT copyright and permission
  notice in all copies or substantial portions — `licenses/MIT.txt` plus
  `tauri-plugin-store` and `tauri-plugin-fs` rows in `THIRD_PARTY_NOTICES.md`
  (the generator emits both, and the MIT text already ships with the
  installer via `bundle.resources`). No trademark rights: Tauri is a
  trademark of The Tauri Programme within the Commons Conservancy — the
  same trademark point that finding **B-1** already raised for the TAURI
  logo, and it is unaffected by these plugins. No express patent grant under
  the elected MIT branch (**R6**, §4). Note: `tauri-plugin-fs` adds a large
  **permission surface** (`plugins/fs/permissions/**`, including
  `base-directories` scopes for appdata, appconfig, desktop, document,
  download, home and more) and a **capabilities** entry — Paka's
  `src-tauri/capabilities/default.json` currently grants only `core:default`,
  two window permissions and `dialog:default`. That is a security-surface
  change, and the gate notes it without deciding it.
* **Does an existing dependency already cover it?** Yes, substantially.
  Paka already has the whole architecture T-06 needs: the
  `ProjectFileGateway` interface (`src/core/project/projectGateway.ts` L11,
  with `readTextFile` / `writeTextFile`) and its Tauri-free seam; the
  `ProjectFiles` service pattern; the atomic Rust writer; and the dirty model
  (`revision !== savedRevision`, `markSaved` as the only thing that clears
  it). The plan's proposal mirrors these exactly. The only genuinely new
  pieces are `app_config_dir()` and `delete_file` / `file_exists` — three
  small Rust commands Paka can write itself. **Adding two whole plugins (and
  their permission scopes) to obtain three Rust functions would be a second
  copy of machinery Paka already has.**
* **Risks and clean-room requirements:** Strategy A; no third-party code
  needed. The plan's §9 (identifier collision between the factory's `T-06`
  and the analyst's `T-06`) and §12 open questions are project decisions, not
  licence decisions. The one provenance-adjacent item: the plan says the
  settings file will be `settings.json` in the OS config directory, and
  `require_extension` already allows `.json` — so no format change and no
  notice obligation arises.
* **Blocking condition:** none. The gate records that the **plugins are not
  needed** and that adopting them would weaken the write path.

---

### 2.5 Text tool (a future task) — opentype.js

* **Source repository / revision:** `opentypejs/opentype.js` at
  `5d65b6dcfab5115f90d375f8ba6b7942fdaa0138` (2026-05-19), `opentype.js` 1.x
  (ESM, `.mjs` sources under `src/`).
* **Candidate plan:** none exists yet. This is a future task; the gate is
  deciding the *policy* so the task is not started on a wrong assumption.
* **Files / symbols that would be reused (code):** the parser and layout
  machinery — `src/parse.mjs` (the OpenType/TrueType/WOFF parser),
  `src/font.mjs`, `src/glyph.mjs`, `src/glyphset.mjs`, `src/layout.mjs`,
  `src/position.mjs`, `src/substitution.mjs`, `src/bidi.mjs`,
  `src/encoding.mjs`, `src/tables/*.mjs` (the table parsers),
  `src/features/**` (the OpenType layout feature tables), `src/path.mjs`
  (the glyph outline → SVG path conversion) and `src/draw.mjs`.
* **Licence, with the line read:** `LICENSE` — *"The MIT License (MIT) /
  Copyright (c) 2020 Frederik De Bleser"*. `package.json`: `"license":
  "MIT"`.
* **Assets — this is where the decision actually bites.** `test/fonts/` holds
  **45 font files**, governed by `test/fonts/LICENSE`; plus
  `docs/fonts/FiraSansMedium.woff`. Verified contents of
  `test/fonts/LICENSE`:
  * **SIL-OFL-1.1** — the large majority: Abril Fatface (RFNs *"Abril"*,
    *"Abril Fatface"*), CFF1SingleLinePaintTypeTEST, Changa (+ variable),
    Fira Sans (RFN *"Fira Sans"*), Jomhuria, Source Sans Pro (RFN *"Source"*),
    Scheherazade (RFNs *"Scheherazade"*, *"SIL"*), Noto Emoji, Vibur, Zycon
    (RFN *"Zycon"*), the Unicode test fonts, Google/Monotype test fonts.
  * **Apache-2.0** — Roboto-Black.ttf (*"Font data copyright Google 2012 /
    Apache License Version 2.0, January 2004"*).
  * **CC0-1.0** — `TestGVAR-Composite-0.ttf` / `-Missing.ttf`: *"This subset
    of the Normschrift font is licensed under
    https://creativecommons.org/publicdomain/zero/1.0/deed.en. The full
    Normschrift font is copyright 2017 by Jens Kutilek."*
  * **CC BY-SA 4.0** — `OpenMojiCOLORv0-subset.ttf`: *"All emojis designed by
    OpenMoji … Creative Commons Share Alike License 4.0 (CC BY-SA 4.0)"*.
  * **"All rights reserved", no licence statement** —
    `TestGVAROne.ttf`, `TestGVARThree.ttf`, `TestGVARTwo.ttf`: *"Copyright
    2016 Monotype Hong Kong Ltd. and Monotype Imaging Inc. All rights
    reserved. See font metadata for the exact license terms."*
  * **The licence file and the directory do not line up — verified by exact
    name comparison (45 files present; 34 names in the licence file; 29
    files covered by an exact-name entry).**
    * **16 files present have no licence entry naming that exact filename:**
      `badfont.otf`, `CFFRecursionTest.otf`, `circular-composite.ttf`,
      `FDArrayTest257.otf`, `HintingJMPRLoop.ttf`,
      `HintingMutualRecursion.ttf`, `HintingRecursiveCALL.ttf`,
      `NotoSansThai-Medium-Testing-v1.ttf`, `OpenMojiCOLRv0-subset.otf`,
      `sub5.ttf`, `TestCMAP13.ttf`, `TestGVAR-Composite-Missing.ttf`,
      `TestHVAROne.otf`, `TestItalicSwitch.ttf`, `TestTracking3.ttf`,
      `VARTest.ttf`.
    * **5 licence names have no file of that exact name:**
      `liga-sub5.ttf`, `OpenMojiCOLORv0-subset.ttf`, `TestCMAP13.otf`,
      `TestGVAR-Composite-0-Missing.ttf`, `TestHVAR.ttf`.
    * **Five of the sixteen have a plausibly-intended counterpart under a
      different name — but that is an inference, not a licence statement:**
      `sub5.ttf` ↔ `liga-sub5.ttf` (OFL-1.1); `TestCMAP13.ttf` ↔
      `TestCMAP13.otf` (OFL-1.1); `TestGVAR-Composite-Missing.ttf` ↔
      `TestGVAR-Composite-0-Missing.ttf` (CC0-1.0); `TestHVAROne.otf` ↔
      `TestHVAR.ttf` (OFL-1.1); `OpenMojiCOLRv0-subset.otf` ↔
      `OpenMojiCOLORv0-subset.ttf` (**CC BY-SA 4.0**). Whether each pair is
      the same artefact under two names is **not determinable from the
      clone**. *Unverified.*
    * **The remaining eleven files have no counterpart of any kind in the
      licence file** and therefore carry **no licence statement at all**:
      `badfont.otf`, `CFFRecursionTest.otf`, `circular-composite.ttf`,
      `FDArrayTest257.otf`, `HintingJMPRLoop.ttf`,
      `HintingMutualRecursion.ttf`, `HintingRecursiveCALL.ttf`,
      `NotoSansThai-Medium-Testing-v1.ttf`, `TestItalicSwitch.ttf`,
      `TestTracking3.ttf`, `VARTest.ttf`.
* **Decision — the code and the assets are gated separately, as asked:**
  * **Code: `COPY-ELIGIBLE`.** opentype.js's code is MIT
    ("Copyright (c) 2020 Frederik De Bleser"). Paka may copy or adapt
    `src/**` under the MIT notice obligation. The obligations are: retain
    the copyright and permission notice in all copies or substantial
    portions (`licenses/MIT.txt` plus an `opentype.js` row in
    `THIRD_PARTY_NOTICES.md` — the generator produces both), no trademark
    rights in the "opentype.js" name, and no express patent grant under MIT
    (**R6**, §4). If the library were added as an npm dependency rather than
    vendored, the same obligations attach plus version pinning and
    re-verification on every bump.
  * **Assets: mixed, and three classes are `LICENSE-BLOCKED` for bundling.**
    * `LICENSE-BLOCKED` — **the CC BY-SA 4.0 OpenMoji emoji fonts**
      (`OpenMojiCOLORv0-subset.ttf`, and `OpenMojiCOLRv0-subset.otf`, which
      is named in no licence statement at all). Gate §3.7 rule 3 blocks
      CC-BY-SA from being bundled, and a share-alike asset would attach an
      obligation to Paka's own distribution.
    * `LICENSE-BLOCKED` — **the "All rights reserved" Monotype GVAR fonts**
      (`TestGVAROne.ttf`, `TestGVARThree.ttf`, `TestGVARTwo.ttf`) and **the
      sixteen files named in no licence statement at all** (see the name
      mismatch above). Gate §3.7 rule 3: *"any asset with no licence
      statement at all (default = all rights reserved)"*.
    * `COPY-ELIGIBLE` — the **OFL-1.1 fonts**, with the OFL text shipped
      alongside, the copyright notice retained, and **Reserved Font Name
      compliance** (OFL-1.1 §3: a Reserved Font Name may not be used to
      promote a Modified Version). Also the **Apache-2.0 Roboto** (with the
      Apache-2.0 notice, §4(a) licence copy, §4(b) modified-file marking,
      §4(d) NOTICE carry-forward, §6 no trademark grant) and the **CC0-1.0
      Normschrift subset** (the preferred bar; no attribution burden).
    * The **Apache-2.0 text is not in `licenses/` for fonts** — it is
      (`licenses/Apache-2.0.txt`), so the OFL text is the one that would have
      to be **added** if OFL fonts are ever bundled.
  * **The library ships no usable asset model for Paka.** `test/fonts/` is
    upstream's *test corpus*; it is not a curated, redistributable font set,
    it is not covered by the root MIT, and it contains fonts that Paka may
    not bundle. **opentype.js has no subsetter** (verified: no subsetting
    module exists in `src/`; the word "subset" appears only in
    `src/encoding.mjs`, `src/tables/cff.mjs` and `src/tables/colr.mjs` in
    unrelated contexts). Paka therefore cannot take opentype.js's fonts and
    trim them to what it needs; a font pipeline would have to be sourced
    separately.
* **Obligations a distributor would owe if the code were copied:** MIT
  notice retention in source and binary redistributions; `licenses/MIT.txt`
  plus an `opentype.js` row in the notices file; no trademark use of
  "opentype.js"; no express patent grant (R6). **If fonts were bundled:**
  the OFL text and each font's copyright notice must accompany the font;
  Reserved Font Names must be respected; an Apache-2.0 font requires the
  Apache-2.0 notice; every bundled asset must be recorded in the provenance
  record with source URL, file name, SHA-256, SPDX id, author and retrieval
  date (gate §3.7 rule 4) and in `THIRD_PARTY_NOTICES.md`'s "Material that is
  not a dependency" table.
* **Does an existing dependency already cover it?** **No.** Paka has no font
  parser, no shaper, no text tool, and no font assets (gate finding B-7:
  *"the repository contains no assets at all — no fonts, textures, presets,
  sample art, LUTs, audio"*). There is also no existing text-layer concept in
  the document model: a text element would be a **new layer element kind**
  (`src/core/document/types.ts`), which per the repository's own map means a
  document-model change, a renderer path, a command, and a `projectFormat.ts`
  change plus a `docs/PROJECT_FORMAT.md` update. **That is a design fact the
  owner should know before starting the task**: a text tool in Paka is not a
  small slice.
* **Risks and clean-room requirements:**
  * **Font policy is the real decision, and it is the owner's.** The safe
    shape is: ship the text tool with **no bundled font** (system fonts
    loaded at runtime by the user, which is the user's own content and
    creates no Paka notice obligation), or bundle a **single, deliberately
    chosen** OFL-1.1 or CC0-1.1 family with the OFL text shipped and RFNs
    respected. Shipping a font *set* scraped from opentype.js's test corpus
    would put CC-BY-SA and unlicensed fonts into the installer.
  * **Do not "fix" a licence problem by adding a `LICENSE` file to a vendored
    font directory** (gate §5). A vendored font directory carries the
    *font's* licence, not the project's.
  * **Reserved Font Names and subsetting interact.** If Paka ever builds a
    subsetter, any OFL font with an RFN must be renamed on modification.
    opentype.js does not help here; a separate, licence-checked subsetting
    route is needed (and `fonttools`/the `fonttools` Python toolchain or
    `harfbuzzjs` would each need their own gate run).
  * **Clean-room:** not applicable to the MIT-licensed code (Strategy C is
    permitted); the §2.5 protocol only becomes necessary if the implementer
    consults a **GPL** text engine (e.g. a GPL shaper) to reproduce its
    behaviour.
* **Blocking condition:** the *code* is unblocked. The **assets** are
  blocked as a set: opentype.js's `test/fonts/` cannot be bundled wholesale.
  A font policy must be decided before any font enters the tree.

---

### 2.6 Stroke dynamics (taper, velocity-derived pressure, pressure easing) — perfect-freehand

* **Source repository / revision:** `steveruizok/perfect-freehand` at
  `176e00f2399f4969e1b0965c5921d96a3e50ce9f` (2026-02-01), package
  `perfect-freehand` 1.2.3.
* **Candidate plan:** none exists yet.
* **Files / symbols that would be reused:** the small, well-factored pieces:
  * `packages/perfect-freehand/src/simulatePressure.ts` —
    `simulatePressure(prevPressure, distance, size)`: `sp = min(1, distance /
    size)`, `rp = min(1, 1 - sp)`, `prevPressure + (rp - prevPressure) * (sp *
    RATE_OF_PRESSURE_CHANGE)`.
  * `packages/perfect-freehand/src/getStrokeRadius.ts` —
    `getStrokeRadius(size, thinning, pressure, easing = (t) => t)`:
    `size * easing(0.5 - thinning * (0.5 - pressure))`. This is the
    **pressure-easing** hook.
  * `packages/perfect-freehand/src/getStrokePoints.ts` — `getStrokePoints`,
    including the **taper** machinery: the `start` / `end` options with
    `cap`, `taper` and `easing`, the `last` flag, the interpolation of
    intermediate points, and the "minimum length before tapering starts"
    rule (`if (runningLength < size) continue`).
  * `packages/perfect-freehand/src/getStrokeOutlinePoints.ts` —
    `getStrokeOutlinePoints`, which builds the **outline polygon** (with
    rounded and sharp corner caps).
  * `packages/perfect-freehand/src/constants.ts` — `RATE_OF_PRESSURE_CHANGE =
    0.275`, `START_CAP_SEGMENTS = 13`, `END_CAP_SEGMENTS = 29`,
    `CORNER_CAP_SEGMENTS = 13`, `END_NOISE_THRESHOLD = 3`,
    `DEFAULT_FIRST_PRESSURE = 0.25`, `DEFAULT_PRESSURE = 0.5`.
  * `packages/perfect-freehand/src/vec.ts` — the vector helpers.
* **Licence, with the line read:** root `LICENSE` and
  `packages/perfect-freehand/LICENSE` (identical text) — *"MIT License /
  Copyright (c) 2021 Stephen Ruiz Ltd"*. `package.json` declares
  `"license": "MIT"`.
* **Assets that would travel with them:** the npm tarball ships **only**
  `dist/**/*` (`package.json` `files`), so `packages/perfect-freehand/assets/`
  (`icons.png`, `perfect-freehand-card.png`, `perfect-freehand-logo.svg`,
  `process.gif`) does **not** travel with the package. If the repository were
  vendored rather than the package installed, those images would come along
  and would need recording; they are the author's own artwork under the
  repository's MIT grant.
* **Decision: `COPY-ELIGIBLE`.**
  MIT ("Copyright (c) 2021 Stephen Ruiz Ltd"). Paka may copy or adapt the
  named files under the MIT notice obligation. It may equally implement the
  same behaviour independently — a pressure easing curve, a velocity-derived
  pressure law and a taper are *behaviour*, and behaviour is not
  copyrightable; only the expression is.
* **Obligations if copied:** retain the MIT copyright and permission notice
  in all copies or substantial portions — `licenses/MIT.txt` plus a
  `perfect-freehand` row in `THIRD_PARTY_NOTICES.md`; the generator already
  handles MIT. No trademark rights in the "perfect-freehand" name. No express
  patent grant under MIT (**R6**, §4).
* **Does an existing dependency already cover it?** **Partly — Paka already
  has a great deal of this.**
  * `src/core/brushes/strokeBuilder.ts` already does the sampling, the
    bounded interpolation, the pressure interpolation (`lerp(this.lastPressure,
    smoothedPressure, t)`, L156), the stabilizer (`STABILIZER_MAX_LAG`, L39)
    and the settle-on-`finish()`.
  * `src/types/brush.ts` already has `pressureSize`, `pressureOpacity`,
    `minSizeRatio`, `spacing`, `stabilizer`, `hardness`, `texture`, `stamp`,
    `stampSpacing`, `stampHardness`.
  * **The genuine gaps** are exactly the three named in the candidate:
    **taper** (start/end taper), **velocity-derived pressure** (simulated
    pressure when the device reports none), and **pressure easing** (a curve
    applied to the pressure values before they drive diameter/opacity).
    Nothing in Paka does these today.
  * **Do not adopt the library as a dependency.** `getStroke` returns a
    **stroke outline polygon**, not a coverage/dab engine. Paka's renderer is
    a one-buffer coverage engine that unions dab coverage and composites
    once at the stroke opacity, and the stamp engine's invariants (one buffer
    = one stroke, union/max coverage, opacity applied once, pixel-identical
    output across live / commit / undo / reopen / export) are properties of
    Paka's own renderer, not of a stroke primitive. Adopting perfect-freehand
    as a library would replace that pipeline with a polygon rasteriser, which
    the earlier gate already recorded as *"RESTRICTED — not recommended"* on
    fit grounds (`docs/g1/reuse-decision.md` §3.2, strategy B). **The
    reusable part is the small set of functions named above, not the
    library.**
* **Risks and clean-room requirements:**
  * **Strategy A is available and preferable** for the three behaviours: they
    are small, they are describable in Paka's own words (a taper is "the
    radius ramps toward zero over the first/last N document pixels"; velocity
    pressure is "the pressure follows the speed of the pointer"), and Paka's
    own sampling layer is the natural home. If Strategy A is taken, the
    implementer must not open perfect-freehand's source while implementing
    (gate §2.5), and the behaviour specification must be Paka-authored.
  * **If the code is copied**, the practical obligations are mechanical: the
    MIT notice, the notices row, and — because these are *small* functions
    whose expression is short — a record of exactly which file and which
    symbol was taken, in the provenance record, with the upstream revision
    `176e00f2…`. That is the "copy/adapt" trail the record is designed to
    hold.
  * **The engineering risk, not a licence risk:** a taper and a velocity
    pressure law change what the *stored samples* mean. Paka's project format
    stores the samples and re-rasterizes from them, so a taper expressed as a
    per-sample pressure curve is format-compatible (it rides in the existing
    `pressures` array), whereas a taper applied at rasterization time would
    change what an old reader draws and would force a format-version bump
    under the repository's own rule. **That is a design constraint for the
    implementer, not a licence constraint.**
* **Blocking condition:** none. MIT is permissive and the material is
  small; the open question is a design one (Strategy A vs copying four small
  functions), and the gate's recommendation is Strategy A with perfect-freehand
  as the cross-check, because the library as a whole does not fit Paka's
  renderer.

---

### 2.7 T-10 — the integrated HSV colour wheel (react-colorful)

* **Source repository / revision:** `oleksii/react-colorful` at
  `8506e8c4b777e0056ce3567dc3a06ced143034bc` (2026-09-01, "5.8.1").
* **Implementation under review:** worktree
  `C:\Users\aissa\Desktop\Paka-feature-factory\worktrees\integration-t10`,
  branch `integration/t10-hsv-color-wheel`, HEAD `bc062c7` ("Merge branch
  'feat/t10-hsv-color-wheel' into the development branch"), feature commit
  `dbcb446`. `git status --porcelain` is empty.
* **Files / symbols that would be reused:** *none.* The implemented files are
  `src/utils/color.ts` (191 lines), `src/features/color/wheelGeometry.ts`
  (102), `src/features/color/ColorWheel.tsx` (189),
  `src/features/color/ColorPanel.tsx` (18), `src/features/color/color.css`.
  **Every import in every one of those files is either `react` or Paka's own
  module** — verified by reading each `import` line:
  `useEditor, useEditorState` (Paka), `Panel` (Paka), `ColorWheel` (Paka),
  `./color.css` (Paka), `react`, `hexToHsv, hsvToHex, Hsv` (Paka),
  `hsvToWheelPoint, resolveWheelHsv, wheelPointToHsv` (Paka), `clamp` (Paka),
  `normalizeHue` (Paka). **There is no third-party import anywhere in the
  feature.**
* **Licence, with the line read:** `LICENSE` — *"MIT License / Copyright (c)
  2020-present Vlad Shilov <omgovich@ya.ru>"*. `package.json`:
  `"license": "MIT"`.
* **Assets:** none. react-colorful ships `src/css/styles.css` only; the
  published `files` list contains no images.
* **Decision: `NO-SOURCE` for react-colorful. The implemented code raises no
  provenance question.**
* **The direct comparison, as asked — is any of it close to a copy?**
  **No. It is an independent reimplementation, not an adaptation.** The
  evidence, function by function:

  | Paka | react-colorful | Verdict |
  | --- | --- | --- |
  | `hsvToRgb` (`color.ts` L103-140) — the **chroma / second / base**
    decomposition: `chroma = v*s`, `second = chroma * (1 - abs((h/60 % 2) - 1))`,
    `base = v - chroma`, then a six-branch `if (hue < 60) … else` ladder | `hsvaToRgba` (`convert.ts`) — the **v / c / d / b module** decomposition: `hh = floor(h)`, `b = v*(1-s)`, `c = v*(1-(h-hh)*s)`, `d = v*(1-(1-h+hh)*s)`, `module = hh % 6`, then two **array-index** lookups `[v,c,b,b,d,v][module]` and `[d,v,v,c,b,b][module]` | **Different algorithm structure and different code.** The two are the textbook equivalent formulations of the same published HSV definition; neither is a transcription of the other. |
  | `rgbToHsv` (L149-177) — `max`/`min`/`delta`, then `((green - blue) / delta) % 6`, `(blue - red) / delta + 2`, `(red - green) / delta + 4`, `hue *= 60`, and `if (hue < 0) hue += 360` | `rgbaToHsva` — `hh = delta ? (max === r ? (g-b)/delta : max === g ? 2+(b-r)/delta : 4+(r-g)/delta) : 0`, then `h: 60 * (hh < 0 ? hh + 6 : hh)` | Equivalent mathematics, different normalisation (`% 6` + `+360` vs `+6`), different branch shape, different naming. |
  | `toRgbByte` (L83-85) — `Math.round(value + 1e-9)` with a long doc comment explaining the `127.49999999999999` problem | `round.ts` — `Math.round(base * number) / base`, with no epsilon and no comment | **Paka's epsilon is Paka's own decision with its own stated rationale.** react-colorful has no equivalent. |
  | `hexToRgb` — a regex `/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i`, returns `null` on failure | `hexToRgba` — `parseInt` on substrings, accepts 8-digit hex with alpha | Different contracts; Paka's alpha-free, `null`-returning contract is Paka's own (`src/utils/color.ts` L1-16 documents why). |
  | `wheelGeometry.ts` — a **disc**: hue 0 at 3 o'clock growing clockwise, saturation = distance/centre, `atan2(dy, dx)`, `normalizeHue`, the CSS `conic-gradient(from 90deg …)` convention | `Saturation.tsx` / `Hue.tsx` — a **rectangular** saturation area (`s = interaction.left * 100`, `v = 100 - interaction.top * 100`) and a **separate horizontal** hue bar (`h = 360 * interaction.left`) | **Different product geometry entirely.** react-colorful has no disc, no angle, no hue ring, and no conic gradient. |
  | `resolveWheelHsv` (L92-102) — prefers the *requested* hue/saturation while the brush colour still equals the colour the wheel wrote, so the 8-bit grid does not snap the hue away from the user's choice | **No analogue.** react-colorful's `useColorManipulation` has no such policy | **Paka-specific behaviour.** |
  | `ColorWheel.tsx` — **Pointer Events** with `setPointerCapture` / `releasePointerCapture`; the disc is `role="presentation" aria-hidden="true"` and not focusable; keyboard access is via three native `<input type="range">` elements | `Interactive.tsx` — **mouse and touch events** with **document-level** `mousemove`/`mouseup` listeners, `tabIndex={0}`, `role="slider"`, arrow-key handling on the container | **Different event model, different accessibility model.** The shared surface is generic: a draggable region with a marker positioned in percentages. |

  **In plain terms: none of the implemented T-10 code is close to a copy of
  react-colorful.** The shared material is the *published HSV definition*
  and the *generic* idea of a draggable colour area with a marker — neither
  is copyrightable expression, and the code that expresses them is
  demonstrably different. No attribution to react-colorful is owed, and
  adding one would be inaccurate.
* **Obligations:** **none.** Nothing from react-colorful was copied, so no
  notice obligation attaches. `THIRD_PARTY_NOTICES.md` correctly does not list
  react-colorful, `licenses/dependency-inventory.json` correctly does not
  list it, and `package.json` is unchanged by the feature.
* **Does an existing dependency already cover it?** Moot — the feature is
  implemented in Paka's own code and adds no dependency.
* **Risks and clean-room requirements:**
  * **State note.** The assessment above was made against the **committed**
    state, HEAD `bc062c7`. At the time of review the worktree also carried
    **uncommitted** work by another agent — a new pure module
    `src/features/color/wheelState.ts`, changes to `ColorWheel.tsx`,
    `color.css`, `src/app/app.css` and the two colour test files (5 files,
    +110/−7). That work was **not** produced by this gate. Re-checked for
    provenance: every import in the new and changed colour files is still
    `react` or a Paka module, and a search for `colorful`, `third-party`,
    `adapted`, `copied from`, `inspired by`, `SPDX` and `Copyright (c)`
    across them returns **no matches**. **The conclusion is unchanged**, but
    the gate's verdict is bound to a revision and the in-flight state should
    be re-checked when it is committed.
  * The gate **cannot verify the implementer's reading history**. The
    evidence available (different algorithms, different product geometry, a
    Paka-specific policy function, no third-party import, and an independent
    review that exercised the maths over all 16,777,216 colours and found
    zero mismatches) is consistent with Strategy A, but the §2.5 process
    property remains the implementer's to attest. **Recommendation: add
    T-10 to the scope of the existing clean-room attestation
    (`docs/CLEAN-ROOM-ATTESTATION.md`), rather than opening a second one.**
    That is a bookkeeping point; the countersignature itself is R3 and is the
    owner's.
  * The independent review (`wave0/t10-independent-review.md`) found eight
    behavioural defects (D1–D8), including D1 (the Layers panel's buttons
    pushed off-screen) and D2 (the disc's saturation gradient not reaching
  full saturation at the rim). **Those are review findings, not provenance
    findings**, and the gate takes no view on them.
* **Blocking condition:** none. The implemented code raises **no** provenance
  question.

---

### 2.8 Animation and playback (a future task) — gifenc + fabric.js

* **Source repositories / revisions:**
  * `mattdesl/gifenc` at `27db5b982dba701ca440b55ea36fad3999040973`
    (2024-09-19), `gifenc` 1.0.3.
  * `fabricjs/fabric.js` at `47484957f95fb8c817a6ce66c78e8191be771d35`,
    `@fabricjs/core` 7.4.0. *(Note: the task brief says `util/animation/`; at
    this revision the animation code lives at
    `packages/core/src/util/animation/`.)*
* **Candidate plan:** none exists yet.
* **Files / symbols that would be reused:**
  * gifenc: `src/index.js` (`GIFEncoder`, `writeFrame`, `finish`, `reset`,
    `quantize`, `applyPalette`), `src/palettize.js` (`prequantize`,
    `applyPalette`, `nearestColorIndex`, `nearestColorIndexWithDistance`,
    `snapColorsToPalette`), `src/pnnquant2.js` (the quantiser),
    `src/lzwEncode.js`, `src/rgb-packing.js`, `src/stream.js`,
    `src/color.js`, `src/constants.js`.
  * fabric.js: `packages/core/src/util/animation/easing.ts` — the easing
    functions (`defaultEasing`, `easeInCubic`, `easeOutCubic`,
    `easeInOutCubic`, `easeInQuart`, `easeOutQuart`, `easeInOutQuart`,
    `easeInQuint`, …, `easeInElastic`, `easeOutElastic`,
    `easeInOutElastic`, `easeInBack`, `easeOutBack`, `easeInOutBack`,
    `easeInBounce`, `easeOutBounce`, `easeInOutBounce`, and the `normalize`
    helper), plus `packages/core/src/util/animation/animate.ts`,
    `AnimationBase.ts`, `ValueAnimation.ts`, `ArrayAnimation.ts`,
    `ColorAnimation.ts`, `AnimationRegistry.ts`,
    `AnimationFrameProvider.ts`, `types.ts`.
* **Licence, with the line read:**
  * gifenc: `LICENSE.md` — *"The MIT License (MIT) / Copyright (c) 2017 Matt
    DesLauriers"*. `package.json`: `"license": "MIT"`.
  * fabric.js: `LICENSE` — *"MIT License / Copyright (c) 2008-2015 Printio
    (Juriy Zaytsev, Maxim Chernyak) / Copyright (c) 2016-present Andrea Bogazzi,
    Shachar Nen and Fabric.js contributors"*.
* **Assets that would travel with them:** **none** from either. gifenc's
  `src/` is code only. fabric.js's images live in
  `packages/website/public/site_assets/**` and the website demos, none of
  which is in the published packages.
* **Decision: `COPY-ELIGIBLE` for both.**
  * **gifenc** — MIT ("Copyright (c) 2017 Matt DesLauriers"). Paka may copy
    or adapt the encoder.
  * **fabric.js easing** — MIT. One nuance worth recording: `easing.ts`
    carries the comment *"@see http://gizma.com/easing/ Easing Equations by
    Robert Penner"*. Robert Penner's easing equations are a published,
    freely-redistributable set of curves; the **expressions in fabric.js's
    file are fabric.js's own MIT-licensed code**, so copying the file
    attracts the fabric.js MIT notice only. The *curves themselves* are
    behaviour and are not copyrightable — so an independent implementation
    from the published equations attracts no notice obligation at all.
* **Obligations if copied:** MIT notice retention in source and binary
  redistributions — `licenses/MIT.txt` plus `gifenc` and `fabric.js` rows in
  `THIRD_PARTY_NOTICES.md` (the generator emits both). No trademark rights
  in "gifenc" or "Fabric.js". No express patent grant under MIT (**R6**,
  §4). If the libraries were added as npm dependencies rather than vendored,
  version pinning and re-verification on every bump apply
  (gate §3.2 requirement 3).
* **Does an existing dependency already cover it?** **No.** Paka has no
  animation, timeline, tween, playback or export-animation machinery, and no
  timeline model in the document format. There is also **no existing
  dependency** to reuse — this would be a genuinely new dependency (or
  new code).
* **Risks and clean-room requirements:**
  * **Verified limitation — gifenc has no dithering.** The upstream README
    says: *"Because there is currently no dithering support, and because of
    the current choice of color quantizer, this encoder is probably best
    suited for simple flat-style vector graphics, rather than photographs or
    video that might need special handling across frames (e.g. temporal
    dithering) or better perceptual color quantizers."* A `grep -i dither`
    over `src/` returns **no matches**. The upstream README also lists
    *"Dithering support"* under its roadmap. So a GIF export of a Paka
    drawing would band on gradients.
  * **Verified limitation — gifenc has no timeline.** The per-frame options
    are `delay` (ms, default 0) and `repeat`; the caller drives the frames.
    There is no keyframe, track, layer or scrubbing model. **The animation
    *model* is Paka's to design**, and it would live in the document format
    (`src/core/document/types.ts`) — which means a format version bump under
    the repository's own rule, because an older reader would draw a different
    picture.
  * **Product-level risk, recorded because it affects the licence strategy:**
    GIF is a 256-colour, palette-indexed format. A drawing application's
    "export the artwork as an animation" is a lossy export with a hard
    format ceiling. This is a product decision, and the gate takes no view on
    it — but it bears on whether a GIF encoder is the right dependency at
    all, versus a vector or WebP/AVIF route.
  * **Clean-room:** not required for MIT-licensed sources (Strategy C is
    permitted). The §2.5 protocol would become necessary only if a GPL
    animation engine were consulted for behaviour.
* **Blocking condition:** none for the libraries. The open items are
  product decisions (the animation model, the export format, the timeline
  semantics) and one format question (a version bump if the timeline is
  stored).

---

## 3. Summary table

| Candidate | Source | Provenance decision | Blocking condition |
| --- | --- | --- | --- |
| **T-13** — contrast & ΔE | `gka/chroma.js` @ `14e2b8a` — `src/utils/contrast.js`, `src/utils/contrastAPCA.js`, `src/utils/delta-e.js` | **`NO-SOURCE`** (the plan implements WCAG 2.2 and CIEDE2000 from the published standards). chroma.js is **`REFERENCE-ONLY`** if consulted; `COPY-ELIGIBLE` under **BSD-3-Clause** if the expression were ever taken, with the notice + no-endorsement obligations. *(`src/contrast/` does not exist at this revision.)* | None. Requires the §2.5 clean-room attestation (owner's R3) before merge. |
| **T-14** — polygon & star | `fabricjs/fabric.js` @ `4748495` — `packages/core/src/shapes/Polygon.ts`, `Polyline.ts`, `packages/aligning-guidelines/` | **`NO-SOURCE`** — the plan specifies the geometry itself, and fabric's `Polygon` class contains **no geometry** (13-line subclass of `Polyline`). MIT, `REFERENCE-ONLY` if consulted. | None. |
| **T-11** — composition guides | `fabricjs/fabric.js` @ `4748495` — `packages/aligning-guidelines/` | **`NO-SOURCE`** — fabric's aligning-guidelines is a **different feature** (object-alignment guides, not user-placed composition guides), and the plan already specifies the model. MIT, `REFERENCE-ONLY` if consulted. | None. |
| **T-06** — settings & autosave | `tauri-apps/tauri-apps-plugins-workspace` @ `11211c3` — `plugins/store/`, `plugins/fs/` | **`NO-SOURCE`** for the plan (its own Rust commands). **`COPY-ELIGIBLE`** (MIT branch) if the plugins were adopted. `REFERENCE-ONLY` for the store's debounce idiom. | None — but **adopting the plugins would weaken the write path**: verified, `fs.write_file_inner` truncates in place and `Store::save` uses `fs::write` (no temp file, no rename), against Paka's own `write_atomic` (`project_io.rs` L134-166). |
| **Text tool** (future) | `opentypejs/opentype.js` @ `5d65b6d` — `src/**` (parser, layout, glyph, path) | **Code: `COPY-ELIGIBLE`** (MIT, "Copyright (c) 2020 Frederik De Bleser"). **Assets: mixed** — OFL-1.1 and Apache-2.0 and CC0-1.0 fonts are `COPY-ELIGIBLE` with their notices and RFN compliance; the **CC BY-SA 4.0 OpenMoji fonts** and the **"all rights reserved" / unnamed fonts** are **`LICENSE-BLOCKED`**. opentype.js has **no subsetter**. | The **assets**: `test/fonts/` cannot be bundled wholesale (45 files; 3 licence classes; 16 files with no licence entry naming that exact filename, 5 of them with a differently-named counterpart and 11 with none; 5 licence names with no file). A **font policy** must be decided before any font enters the tree. |
| **Stroke dynamics** (future) | `steveruizok/perfect-freehand` @ `176e00f` — `simulatePressure.ts`, `getStrokeRadius.ts`, `getStrokePoints.ts` (taper), `constants.ts`, `vec.ts` | **`COPY-ELIGIBLE`** (MIT, "Copyright (c) 2021 Stephen Ruiz Ltd"). `REFERENCE-ONLY`/Strategy A equally available — the behaviours are small and Paka's own `StrokeBuilder` already covers sampling, stabilizer and pressure interpolation. | None. **Do not adopt the library as a dependency**: `getStroke` returns an outline polygon, which does not satisfy Paka's one-buffer/union-max/single-composite renderer invariants. |
| **T-10** — HSV colour wheel (**implemented**) | `oleksii/react-colorful` @ `8506e8c` — `src/utils/convert.ts`, `src/components/common/{Interactive,Pointer,Saturation,Hue}.tsx` | **`NO-SOURCE` for react-colorful. The implemented code raises no provenance question.** The comparison is recorded function by function in §2.7: **no part of it is close to a copy.** Different HSV algorithms, a disc instead of react-colorful's rectangle + hue bar, a Paka-specific hue policy, Pointer Events instead of mouse/touch, native range inputs instead of a `role="slider"` container. No third-party import anywhere in the feature. | None. Recommendation: fold T-10 into the existing clean-room attestation (the countersignature itself is R3). |
| **Animation & playback** (future) | `mattdesl/gifenc` @ `27db5b9`; `fabricjs/fabric.js` @ `4748495` — `packages/core/src/util/animation/easing.ts` | **`COPY-ELIGIBLE`** for both (MIT). fabric's easing file credits Robert Penner's published easing equations — the *curves* are unprotected behaviour, so an independent implementation attracts no notice at all. | None for the libraries. Verified: gifenc has **no dithering** and **no timeline**; the animation model and the format bump are Paka's own design decisions. |

---

## 4. What is still the owner's decision (R6, R9, R3, and anything else)

The gate does not decide these. It reports them only where a candidate's
decision depends on them, and says so.

| Item | Why it is not the gate's | What the gate reports, and where it bites |
| --- | --- | --- |
| **R6 — the patent-grant position** | A product/licensing decision about Paka's own licence (MIT vs Apache-2.0), not a per-dependency question. | **Dependency:** every candidate library in §2 is MIT, BSD-3-Clause or Apache-2.0. **None of them carries an express patent grant** unless the Apache-2.0 branch is elected. Paka's own MIT carries none either. So adopting **any** of these candidates does not change the product's patent position — and the candidates that offer an Apache-2.0 branch (chroma.js's `AND` expression, tauri-plugin-store/fs's `MIT OR Apache-2.0`) would only change it if the owner elected Apache-2.0 *and* changed Paka's own licence. **No candidate's decision depends on R6.** |
| **R9 — the CI licence allow-list** | An owner policy about which SPDX ids a new dependency may carry. | **Dependency:** §2 would add new npm/Rust dependencies only in two places — the text tool (opentype.js, MIT) and the animation task (gifenc, MIT; fabric.js, MIT). Both are already on the allow-list that R9 describes (*"MIT, Apache-2.0, BSD-2/3, ISC, Zlib, 0BSD, Unlicense, MPL-2.0, Unicode-3.0 and Apache-2.0 WITH LLVM-exception"*). **chroma.js's `(BSD-3-Clause AND Apache-2.0)` is also already covered** by that list, and the generator's `effectiveFamilies()` splits the `AND` and emits both families (both licence texts are already in `licenses/`). **R9 therefore does not block any candidate**, but the allow-list is not yet enforced by CI, and the two *asset* classes in §2.5 (CC-BY-SA and unlicensed fonts) are **not** dependency licences and would not be caught by a dependency allow-list at all — they need the §3.7 asset rule instead. |
| **R3 — the clean-room countersignature** | The owner's signature on an attestation. | **Dependency:** T-13, T-14, T-11, T-06 and the stroke-dynamics slice all rely on Strategy A, whose §2.5 attestation is the implementer's obligation. T-10 is already implemented and shows no sign of being derived from react-colorful, but the §2.5 *process* property cannot be verified from the repository. **Recommendation (a bookkeeping point, not a decision):** extend `docs/CLEAN-ROOM-ATTESTATION.md` to cover T-10 and the other Strategy-A slices rather than opening a second attestation. The countersignature remains the owner's. |
| **The font policy for the text tool** | A product decision about what Paka ships. | The gate's contribution: opentype.js's `test/fonts/` is **not** a redistributable font set, it carries three incompatible licence classes including one copyleft (CC BY-SA 4.0) and one "all rights reserved" family, 16 of its 45 files are named in no licence statement at all, and the library has no subsetter. The owner must choose between shipping **no bundled font** (system fonts at runtime) and shipping a **deliberately selected** OFL-1.1 or CC0 family with the OFL text shipped and Reserved Font Names respected. |
| **The animation model and export format** | A product decision. | The gate's contribution: gifenc is a 256-colour, undithered, timeline-less GIF encoder. Whether GIF is the right export for a drawing application, and how the timeline is stored (which implies a project-format version bump), are the owner's. |
| **Whether T-06 should adopt the Tauri plugins** | An engineering decision. | The gate's contribution (verified): both plugins write **non-atomically**, which is weaker than Paka's own `write_atomic`. The gate's recommendation is the plan's own design — Paka's own small Rust commands. |

---

## 5. Limitations

1. **This is not legal advice.** It is engineering triage under the evidence
   available on 2026-10-21. It creates, transfers and waives no right.
2. **Scope.** Only the eight candidates, the eight clones, the revisions and
   the files named above. It is **not** a clearance of the Paka repository as a
   whole; findings **B-1 … B-8** in `docs/g1/provenance-record.json` stand as
   issued, and nothing here re-opens them.
3. **Clean-room compliance is a process property** that the gate records but
   cannot verify from a repository. Every Strategy-A verdict in §2 is
   therefore conditional on the §2.5 attestation being made.
4. **Only the named revisions were inspected.** A later upstream revision may
   carry a different licence. This is not hypothetical: the `vercel-labs`
   skill in finding B-2 states its licence in a README rather than in a
   `LICENSE` file, and the gate's own lesson from that finding — *"a licence
   map that only looks for licence files is not a licence map"* — applies
   here. For each clone the **licence file** was read, and where a manifest
   `license` field differed from it, that difference is stated in §1.
5. **Nothing was verified about patents, export control, app-store policy,
   code-signing, or the licences of the future toolchains** Paka might
   target.
6. **One unresolved asset fact.** `test/fonts/LICENSE` and the `test/fonts/`
   directory do not line up: 5 licence names have no file of that name and 16
   files have no licence entry naming that exact filename. Five of the 16 have
   a plausibly-intended counterpart under a different name (`sub5.ttf` /
   `liga-sub5.ttf`; `TestCMAP13.ttf` / `.otf`;
   `TestGVAR-Composite-Missing.ttf` / `TestGVAR-Composite-0-Missing.ttf`;
   `TestHVAROne.otf` / `TestHVAR.ttf`; `OpenMojiCOLRv0-subset.otf` /
   `OpenMojiCOLORv0-subset.ttf`); whether each pair is the same artefact is
   **not determinable from the clone** and is recorded as unverified in §2.5.
7. **The `svg-path-editor` clone was read but not gated** — it is not among
   the candidates in the brief. Its licence (Apache-2.0) is recorded in §1 for
   completeness.
8. **The two independent reviews of T-10** (`wave0/t10-independent-review.md`)
   were read for context. Their findings D1–D8 are **review findings, not
   provenance findings**, and this gate takes no view on them.
9. **No repository, worktree or clone was modified.** The only file written
   by this gate is this report.
