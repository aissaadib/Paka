# Reuse decision — `PHASE3-STAMP-ENGINE`

> **Artifact type:** gate decision produced by the License and Provenance Gate.
> It is *not* a project doc and not an implementation plan. Nothing in the
> analysed repository was modified to produce it.
>
> **This decision applies only to the commit, files, dependencies and strategies
> named below.** It is not a clearance of the repository as a whole.

| Field | Value |
| --- | --- |
| Candidate ID | `PHASE3-STAMP-ENGINE` — "Stamp-based brush engine behind the existing stroke interface (per-dab spacing, true hardness curves, directional/image textures)" |
| Upstream source of the candidate description | `docs/SESSION-BRIEF.md` §9; `docs/ROADMAP.md` §"Next slice" (L195-221); `feature-analysis.md` (analyst report, untracked) |
| Repository | `https://github.com/aissaadib/Paka.git` (`origin`, branch `main`) |
| Exact commit reviewed | `ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9` — *"docs: clarify how to measure frames in the packaged app"*, 2026-10-20 16:56:36 +0000 |
| Checkout path | `C:\Users\aissa\Desktop\Paka` |
| Working tree at review | `main` clean except `skills-lock.json` (modified), `.agents/skills/**` (untracked), `feature-analysis.md` (untracked) |
| Paka's licence | MIT — `LICENSE`, "Copyright (c) 2026 HumanHEART" |
| Distribution model | Public GitHub repository (`aissaadib/Paka`, `"private": false`) **and** a Tauri desktop installer (`src-tauri/tauri.conf.json`: `bundle.active: true`, `bundle.targets: "all"`). `package.json` is `"private": true` — not published to npm. |
| Gate date | 2026-10-20 |
| Machine-readable companion | `provenance-record.json` (same commit, same candidate) |

---

## 0. Decision summary

### 0.1 The candidate, precisely

Paka would gain a **stamp (dab) rasterizer** behind the existing
`DrawingRenderer` boundary. A stroke would no longer be drawn as a segment
path; it would be drawn as a sequence of **dabs** placed along the path at a
controllable spacing, each dab contributing a **coverage** profile, with all
coverage accumulated into **one** stroke buffer and composited **once** at the
stroke opacity. Appearance-changing stamp settings would be captured per
stroke and recorded in the `.paka` format.

The behaviour that must be reproduced is already fully specified in
`feature-analysis.md` §8 ("Essential to the feature's behaviour", 9 items) and
in `docs/ARCHITECTURE.md` (rendering pipeline, brush hardness, grain texture)
— **from Paka's own material**.

### 0.2 Outcomes, one per strategy

| # | Strategy | Outcome |
| --- | --- | --- |
| **A** | **Independent reimplementation from Paka's own documented behaviour and code** (the plan in `feature-analysis.md`; no third-party code, no external assets) | **APPROVED FOR SPECIFIED STRATEGY** — subject to the conditions in §2.4 |
| **B** | Adopt an existing third-party library as the dab engine | **RESTRICTED** — §3.2. Permissive licences only, with notice obligations. No library found that satisfies the candidate's core invariants. |
| **C** | Copy or adapt code from an existing brush engine | **BLOCKED** — §3.3 (GIMP, Krita, MyPaint are GPL; commercial paint apps are proprietary) |
| **D** | Port a particular implementation to TypeScript | **BLOCKED** — §3.4 (translation does not launder a GPL licence) |
| **E** | Clean-room reimplementation from a GPL source's published behaviour | **RESTRICTED** — §3.5 (only under a written clean-room protocol; default is not to do it) |
| **F** | Separate-process integration (shell out to an external painting app) | **RESTRICTED** — §3.6 (legal risk lowest of the GPL options, but rejected on architecture grounds for this slice) |
| **G** | Bundle brush presets / stamp images / textures / LUTs / palettes / fonts | **RESTRICTED** — §3.7 (CC0 or permissively licensed, each recorded; GPL/CC-BY-SA/CC-BY-NC blocked) |
| **H** | Add third-party icons / fonts / LUTs to the tree later | **RESTRICTED** — §3.8 |

### 0.3 Repository-wide findings (independent of the candidate)

These are **not** about the stamp engine. They are pre-existing facts about the
repository that the gate must record, because two of them block
**distribution** of any build of Paka, including the one this slice produces.

| ID | Finding | Outcome | Blocks the slice? | Blocks distribution? |
| --- | --- | --- | --- | --- |
| **B-1** | `src-tauri/icons/*` (16 files) — the **TAURI logo** is Paka's app icon. Copyright licence (MIT OR Apache-2.0) grants **no trademark rights**; Tauri's own policy requires a licence from the trademark holder to use the logo for a third-party product. | **BLOCKED** | No | **Yes** |
| **B-2** | `.agents/skills/vercel-react-best-practices/**` (76 tracked files) — verbatim copies of `vercel-labs/agent-skills`. **Corrected 2026-10-20: the upstream project states its licence as MIT in the "## License" section of its README** (present since the repository's first commit, 2025-12-08, and present at every commit that touched the copied files). It ships no standalone `LICENSE` file and states no copyright line, so the holder is recorded as Vercel, Inc. | **RESTRICTED** — MIT; only the notice obligation remains, discharged by `THIRD_PARTY_NOTICES.md` + `licenses/MIT.txt` | No | No |
| **B-3** | `.agents/skills/frontend-ui-engineering/**` + 7 further installed skills — MIT (Addy Osmani). Permitted, but the MIT notice is **not retained anywhere** in Paka. | **RESTRICTED** | No | No |
| **B-4** | No third-party notices anywhere: no `THIRD_PARTY_NOTICES.md`, no `NOTICE`, no in-app About/Licences screen, no README licence section. MIT / Apache-2.0 / BSD / MPL-2.0 / Unicode notice obligations are undocumented and, for the statically linked MPL-2.0 and Unicode-3.0 crates, **unmet**. | **RESTRICTED** | No | **Yes** (notice obligations) |
| **B-5** | Paka's own governance is undocumented: no `CONTRIBUTING.md`, no CLA/DCO, no `CODE_OF_CONDUCT.md`, no `SECURITY.md`, no trademark policy, no express patent grant. | **NEEDS HUMAN REVIEW** | No | No |
| **B-6** | The dependency graph is **clean**: 82 npm packages and 422 Rust crates, every one with a declared permissive licence. **No GPL, no AGPL, no mandatory LGPL, no unlicensed package.** | **APPROVED FOR SPECIFIED STRATEGY** (existing dependency set only) | No | No |
| **B-7** | Apart from the icons, the repository contains **no assets at all** — no fonts, textures, presets, sample art, LUTs, audio; no remote or CDN asset references. | **APPROVED FOR SPECIFIED STRATEGY** | No | No |
| **B-8** | `docs/architecture-port-plan.md` (untracked internal artifact) records **incorrect licence attributions** for its contingency upstreams: Krita as "GPL-2.0" (it is **GPL-3.0**), MyPaint as "LGPL-2.1" (it is **GPL-2.0**), and names **`xp-brush`**, which is not a verifiable brush-engine project. The document also states "There is no separate licence-gate document because there is nothing to gate" — now superseded by this gate. | **RESTRICTED** | No | No (but it is a provenance defect in a document the coordinator will read) |

### 0.4 The one-line answer

> **Strategy A is approved. Implement the stamp engine as an independent
> reimplementation from Paka's own code and docs, adding no third-party code
> and no external assets.** Two pre-existing repository findings (B-1 the TAURI
> logo, B-4 the missing third-party notices) must be cleared before any build
> of Paka is distributed.
>
> **Correction, 2026-10-20 (later the same day):** finding **B-2** was
> mis-stated. The gate reported that `vercel-labs/agent-skills` carried no
> licence at all, on the strength of a missing `LICENSE` file and a
> `license: null` from the GitHub API. The upstream README states the licence
> as **MIT**, and has done so since the repository's first commit. B-2 is
> therefore re-issued as **RESTRICTED** — the material is redistributable, and
> the only requirement left is the MIT notice obligation, which
> `THIRD_PARTY_NOTICES.md` and `licenses/MIT.txt` discharge. **Nothing needs to
> be untracked or purged.** B-1 and B-4 are unchanged. See §9.4.

---

## 1. Method and evidence

No license scanner was present in the harness, so the **path-level license map
was produced by this gate** and is reproducible from the commands below.

| Evidence | How it was obtained |
| --- | --- |
| Paka root licence | Read `LICENSE` at the commit (MIT, "Copyright (c) 2026 HumanHEART"). |
| Per-file SPDX / copyright headers in `src/` | `grep -E "SPDX-License-Identifier\|@license\|Copyright \(c\)\|Licensed under" src` → **no matches**. Paka's own sources carry no per-file headers; the root MIT covers them. |
| Tracked-file inventory | `git ls-files` → 243 tracked files (§4.1). |
| Vendored content identity | SHA-256 of every tracked `.agents/skills/**` file compared byte-for-byte against `raw.githubusercontent.com` for `addyosmani/agent-skills@main` and `vercel-labs/agent-skills@main`. |
| Upstream licence existence | GitHub REST API `/repos/{owner}/{repo}` → `license.spdx_id` (and `null` where no licence is detected), plus a full recursive `git/trees` scan for `LICENSE`/`COPYING`/`NOTICE`. |
| Upstream licence text | `raw.githubusercontent.com` for the exact licence file. |
| Icon identity | SHA-256 and pixel inspection of `src-tauri/icons/*` against `tauri-apps/tauri@dev:crates/tauri-cli/templates/app/src-tauri/icons/*`; `icon.ico` is **byte-identical** to upstream. |
| npm licences (82 packages) | The `license` field of each published manifest at `registry.npmjs.org/{name}/{version}`, cross-checked against the 44 copies installed on disk. |
| Rust licences (422 crates) | The `license` field of each `Cargo.toml` in the local cargo registry (248 crates) plus the crates.io API `/crates/{name}/{version}` for the 173 platform-specific crates not vendored locally. |
| Submodules / vendored code | No `.gitmodules`; no third-party blobs inside `src/`. |
| Generated code | `src-tauri/gen/schemas/**` — Tauri-generated, Apache-2.0 OR MIT, **not tracked** by git. `src-tauri/target/**` — build output, not tracked. |

**Explicitly not verified** (recorded as an assumption, not as clearance):
code-signing/notarisation terms, app-store review policies, the eventual
licence of a future commercial release, and whether the four Linux/macOS
toolchains Paka might target ship their own licence obligations.

---

## 2. Strategy A — independent reimplementation (the proposed plan)

### 2.1 Exact source material Paka would use

**All of it is Paka's own, at commit `ad2ef11…`:**

| Path | What is taken from it |
| --- | --- |
| `src/core/rendering/canvas2dStroke.ts` | `rasterizeStroke` (L121), `stampDot` (L87), `strokeOpacity` (L67), `strokeFeatherRadius` (L43), `SOFT_EDGE_RADIUS_RATIO` (L32), `textureCoverage` (L65), `TEXTURE_TILE_SIZE` (L52) |
| `src/core/rendering/Canvas2DRenderer.ts` | `paintStrokeCoverage` (L767), `applyStrokeTexture` (L805), `textureTile` (L831), `featherStroke` (L870), `compositeStrokeBuffer` (L742), the inked-rectangle rebuild path |
| `src/core/brushes/strokeBuilder.ts` | `addSample` (L114), `STABILIZER_MAX_LAG` (L39), `finish` (L193) — sample spacing and stabilizer semantics |
| `src/types/brush.ts`, `src/core/brushes/defaults.ts` | `BrushSettings` (L11), `DEFAULT_BRUSH` (L15), `normalizeBrush` (L28), `brushSettingsEqual` (L50) |
| `src/core/rendering/types.ts` | The `DrawingRenderer` boundary the slice must not move |
| `src/core/project/projectFormat.ts` | `PROJECT_VERSION` (L84), `serializeProject` (L384), `parseProject` (L456), `readBrush` (~L675) |
| `docs/ARCHITECTURE.md`, `docs/PROJECT_FORMAT.md`, `docs/SESSION-BRIEF.md` §9 | The behavioural specification |
| `feature-analysis.md` §8 | The Paka-authored list of 9 essential behaviours |

### 2.2 Licence and notices

Paka's own MIT licence. The MIT notice already in `LICENSE` covers this
material; **no new notice is required** for Strategy A, and no third-party
notice is created by it.

### 2.3 Obligations

1. The implementation must not contain code copied from, or translated from, a
   GPL/AGPL/LGPL source (see §3.4, §3.5 and the clean-room rule in §2.5).
2. The implementation must not introduce a third-party runtime dependency
   without re-running this gate for that dependency.
3. The implementation must not introduce a bundled asset without §3.7's
   requirements.
4. The implementation must not modify the licence of any vendored file, and
   must not add a `LICENSE` file to a vendored directory (§5).

### 2.4 Conditions of the approval

The approval holds **only** while all of the following are true:

- **C1 — no third-party code or asset enters the tree.** The slice is
  implemented entirely from Paka's own sources and documents.
- **C2 — clean-room discipline.** The implementer must not open GIMP, Krita,
  MyPaint, SAI, Clip Studio, Procreate, Corel Painter, ArtRage, or any other
  brush engine's source **while producing the implementation**. `feature-analysis.md`
  §8 already contains a sufficient Paka-authored behaviour specification.
  If the implementer has already read such source, the implementation must be
  re-written from scratch by someone who has not — see §2.5.
- **C3 — no third-party documentation or tutorial content is pasted into the
  repository**, including in comments, doc-comments, commit messages and
  design notes.
- **C4 — the slice's own acceptance criteria (determinism, one-buffer union,
  pixel identity across live/commit/undo/reopen/export) are met without
  borrowing an implementation.** This is a technical requirement, but it is
  also the licence requirement: the feature must be Paka's own work.
- **C5 — this gate's outcome is not treated as clearance of the repository.**
  B-1 and B-4 are unresolved at this commit and remain open.

### 2.5 The clean-room rule, stated precisely

> A strategy is "independent reimplementation" only if **either**
> (a) the implementer has not read the source implementation being referenced,
> **or**
> (b) the implementation was written from a **Paka-authored** behaviour
> specification that does not reproduce the source's expression, structure,
> constants, comments, identifier names or code layout.
>
> **Renaming symbols, changing language, reformatting, or rewriting syntax
> does not change the status of copied implementation.** A faithful
> translation of a GPL implementation is a derivative work of it.
>
> If an implementer has read GPL brush-engine source in order to produce the
> implementation, that implementer's output is tainted: it must be discarded
> and re-written by someone who has not read the source, from the Paka-authored
> specification.

---

## 3. The other strategies

### 3.1 What "existing library" would even mean here

The candidate's hard invariants (`feature-analysis.md` §8) are: one stroke =
one coverage buffer; coverage accumulated by **union/max**, not by repeated
`source-over`; a per-dab alpha applied **once** at composite time; and
pixel-identical output across live → commit → undo/redo → reopen → export at
any zoom and `rasterScale`. **No general-purpose canvas library implements
these**; they are properties of Paka's own renderer, not of a drawing
primitive. A library could supply *math* (interpolation, offsetting) but not
the coverage-union semantics.

### 3.2 Strategy B — adopt an existing library → **RESTRICTED**

| Library | Licence (evidence) | Fit | Verdict |
| --- | --- | --- | --- |
| `steveruizok/perfect-freehand` | MIT — "Copyright (c) 2021 Stephen Ruiz Ltd" | Produces a stroke **outline polygon**, not a dab/coverage engine. Does not satisfy invariants 1, 3, 4. | RESTRICTED — not recommended |
| `fabricjs/fabric.js` | MIT — "Copyright (c) 2008-2015 Printio…, 2016-present … Fabric.js contributors" | Scene-graph canvas; would replace `DrawingRenderer`, violating SESSION-BRIEF §9 constraint 1. | RESTRICTED — architecturally out of scope |
| `konvajs/konva` | MIT — "Original work Copyright (C) 2011-2013 Eric Rowell (KineticJS); Modified work Copyright (C) 2014-present Anton Lavrenov (Konva)" | Same objection. | RESTRICTED — architecturally out of scope |
| `paperjs/paper.js` | MIT — "Copyright (c) 2011-2020, Jürg Lehni & Jonathan Puckey" (`LICENSE.txt`) | Same objection. | RESTRICTED — architecturally out of scope |
| `processing/p5.js` | **LGPL-2.1** (`license.txt`) | Bundling LGPL code into a single-file web app raises the replaceable-library question for the shipped bundle. | RESTRICTED — treat as blocked for a shipped bundle absent an explicit human decision |

**Requirements if any permissive library is used anyway:**

1. Licence must be MIT / Apache-2.0 / BSD / ISC (or a permissive dual licence
   where Paka picks the permissive branch). **GPL, AGPL, or a mandatory LGPL
   branch is not acceptable.**
2. The library's **copyright notice and licence text** must be copied into
   `THIRD_PARTY_NOTICES.md` (see B-4) and be shipped with the installer.
3. The library must be pinned in `package.json` / `Cargo.toml` with its
   version recorded in the provenance record, and re-verified on every bump.
4. It must be recorded in `provenance-record.json` with the exact commit of
   the upstream copy that was inspected.
5. For Apache-2.0: retain any upstream `NOTICE` content and mark modified
   files (§4(b)).

**Source-offer / source-disclosure implications:** none arise for MIT/BSD/ISC/
Apache-2.0. They arise only for the GPL-family sources in §3.3 — and there
the obligation is not a source offer but a **licence change of the whole
product** (§4(c)).

### 3.3 Strategy C — copy or adapt code → **BLOCKED**

| Source | Licence | Why blocked |
| --- | --- | --- |
| GIMP brush engine (`GNOME/gimp`, `COPYING`) | **GPL-3.0** | Copying or adapting it makes Paka a derivative work. Paka is MIT; MIT is not compatible with distributing GPL-derived code in a non-GPL product. **Paka would have to be GPL-3.0.** |
| Krita brush engine (`KDE/krita`, `COPYING`) | **GPL-3.0** | Same. |
| MyPaint brush engine (`mypaint/mypaint`, `master/COPYING`) | **GPL-2.0** | Same. |
| SAI, Clip Studio, Corel Painter, Procreate, ArtRage, Rebelle, Krita Studio commercial tiers | Proprietary — no grant of any kind | Redistribution without permission; no source permission exists to seek. |

**Note on mixed-licence repositories.** GIMP and Krita are mixed-licensed at the
repository level (some parts are LGPL, some are GPL, some are
public-domain/CC0). That does not help: the **brush engine** is GPL, and it is
the brush engine that would be copied. A file-by-file licence scan of the
exact file to be copied is required before any future reconsideration — and the
answer for the brush engines is GPL.

**Source-offer / source-disclosure implications.** Under GPL-3.0 §6, a
distribution must include the **complete corresponding source** of the
derivative work, and the whole product must be licensed GPL-3.0. This is not a
"we'll add a source tarball" obligation; it changes the product's licence.
That is a business and product decision for the Paka owner, not something a
license gate can waive.

### 3.4 Strategy D — port a particular implementation → **BLOCKED**

A translation of a GPL implementation into TypeScript **remains a derivative
work** of that implementation. The FSF's position on translation is explicit:
a translated version is a derivative work and must be distributed under the
same licence.

This strategy is blocked for the same sources as §3.3. It is called out
separately because it is the most tempting failure mode in practice — "I
wrote it in TypeScript, so it isn't the same code" — and because the gate's
own rule states that *merely renaming symbols or rewriting syntax does not
make copied implementation independent*.

### 3.5 Strategy E — clean-room reimplementation from a GPL source's behaviour → **RESTRICTED**

*Behaviour* (the observable result of an algorithm) is not copyrightable, so a
reimplementation written from a **behavioural** description is not a
derivative work. This strategy is therefore possible — **but only** if the
clean-room protocol in §2.5 is genuinely followed, and only if a
Paka-authored behaviour specification exists.

**Requirements:**

1. A written specification authored by Paka that describes the *observable
   behaviour* (inputs → outputs), not the implementation. `feature-analysis.md`
   §8 already satisfies this for the candidate.
2. The implementer has **not** read the GPL source, and does not read it
   during the work.
3. No GPL code, comments, constants, identifier names, structure or test
   fixtures are reproduced.
4. The decision to consult the GPL source at all is **recorded explicitly** by
   the coordinator before the work starts, with the implementer identified.

**Verdict: RESTRICTED, and not recommended.** The candidate does not need
it. If the coordinator nonetheless wants GIMP/Krita consulted for behaviour,
that must be a recorded human decision (see §6, Q6), and the implementation
must be produced under the §2.5 protocol.

### 3.6 Strategy F — separate-process integration → **RESTRICTED**

**Shape:** Paka writes a file and invokes an external painting application
(GIMP, Krita, MyPaint) through its command line or scripting interface.

**Licence position:** this is the lowest-risk way to *use* GPL software,
because Paka ships no GPL code and no GPL code is linked into Paka. The GPL
obligations attach to the external program and to its users, not to Paka. The
risks are therefore mostly **non-licence** risks:

- the external tool's own terms (its CLI/automation surface, trademark and
  attribution requirements) must be checked per tool, separately;
- the output file's licence status depends on the external tool and its
  inputs, not on Paka;
- Paka becomes a multi-application workflow instead of a single-binary app,
  which contradicts the product shape in `README.md` and `docs/SESSION-BRIEF.md` §1;
- `docs/SESSION-BRIEF.md` §7 and `feature-analysis.md` §7 confirm the stamp
  engine is **pure front-end** and the Rust shell is not involved.

**Verdict: RESTRICTED** — permitted in principle, but rejected on
architecture grounds for this slice. If it is ever proposed for a different
feature, it needs its own gate decision naming the specific tool and its
specific licence.

### 3.7 Strategy G — bundled presets, stamp images, textures, LUTs, palettes, fonts → **RESTRICTED**

**Current state:** the repository contains **no** such assets (see B-7). The
slice as described introduces **procedural** stamp behaviour — per-dab
spacing, hardness curves, directional/texture stamps — with no bundled
binary assets. Verified: the only tracked binaries are the 16 icon files;
`index.html` references no remote or CDN asset; there is no `public/`
directory in the tree.

**Rules if any asset is ever bundled:**

1. **CC0-1.0** is the preferred bar for generated textures, noise tiles, LUTs
   and stamp masks — no attribution burden, no downstream copyleft.
2. Otherwise: MIT / Apache-2.0 / BSD / ISC / SIL-OFL-1.1 are acceptable
   **with** their notices recorded in `THIRD_PARTY_NOTICES.md` and shipped
   with the installer. SIL-OFL additionally requires the OFL text and
   compliance with any Reserved Font Name.
3. **BLOCKED** for bundling: GPL, AGPL, LGPL, CC-BY-SA, CC-BY-NC, and any
   asset with **no licence statement at all** (default = all rights
   reserved).
4. Each bundled asset must be recorded in `provenance-record.json` with:
   source URL, exact file name, SHA-256, licence SPDX id, author, and the
   date it was retrieved.
5. **User-supplied** stamp images are the user's content, not Paka's
   distribution, and carry no Paka notice obligation. If the `.paka` format
   ever embeds an external image, the format is unaffected but the *file* is
   the user's document.

### 3.8 Strategy H — third-party icons / fonts / LUTs added later → **RESTRICTED**

Same bar as §3.7, plus:

- the TAURI trademark problem in **B-1** must not be repeated with another
  vendor's mark: an icon pack's licence covers the *artwork*, and usually
  does **not** grant the right to use the pack's or the vendor's brand;
- icons in `src-tauri/icons/` are part of the **installed product**, so they
  are distribution, not build-time.

---

## 4. Repository-wide provenance audit

### 4.1 Path-level license map (243 tracked files)

| Path / area | Files | Provenance | SPDX / licence | Class |
| --- | --- | --- | --- | --- |
| `LICENSE` | 1 | Paka-authored | `MIT` ("Copyright (c) 2026 HumanHEART") | Own |
| `AGENTS.md`, `README.md`, `docs/**` (6) | 8 | Paka-authored | MIT (root) | Own |
| `src/**` (`.ts` 96, `.tsx` 24, `.css` 3) | 122 | Paka-authored; **no third-party blob, no per-file SPDX header** | MIT (root) | Own |
| `src-tauri/src/**` (`.rs` 5), `build.rs`, `Cargo.toml`, `Cargo.lock`, `capabilities/default.json`, `tauri.conf.json`, `.gitignore` | 11 | Paka-authored | MIT (root) | Own |
| `src-tauri/icons/**` | 16 | **Third party: the TAURI logo**, re-encoded at 15 sizes + `icon.ico` byte-identical to upstream | Copyright: MIT OR Apache-2.0 (Tauri repo). **Trademark: unlicensed for this use.** | **Third party — BLOCKED (B-1)** |
| `.agents/skills/frontend-ui-engineering/**` | 1 | Third party: `addyosmani/agent-skills@main` (SHA-256 identical) | `MIT` — "Copyright (c) 2025 Addy Osmani" | Third party — RESTRICTED (B-3) |
| `.agents/skills/vercel-react-best-practices/**` | 76 | Third party: `vercel-labs/agent-skills@main` (SHA-256 identical) | **MIT, stated in the upstream README** (see B-2; no standalone `LICENSE` file, no copyright line) | Third party — RESTRICTED (B-2, corrected) |
| `.vscode/extensions.json` | 1 | Paka-authored | MIT (root) | Own |
| root: `package.json`, `pnpm-lock.yaml`, `skills-lock.json`, `tsconfig*.json`, `vite.config.ts`, `index.html`, `.gitignore` | 11 | Paka-authored | MIT (root) | Own |
| *untracked* `.agents/skills/{code-review-and-quality,debugging-and-error-recovery,git-workflow-and-versioning,incremental-implementation,performance-optimization,source-driven-development,test-driven-development}/**` | 7 dirs | `addyosmani/agent-skills@main` (MIT) | `MIT` | Third party — RESTRICTED (B-3) |
| *untracked* `feature-analysis.md` | 1 | This gate-set's analyst artifact | n/a | Internal |
| `src-tauri/gen/schemas/**` | — | Tauri-generated (not tracked) | Apache-2.0 OR MIT | Generated — no action |
| `src-tauri/target/**` | — | Build output (not tracked) | n/a | Generated — no action |
| `node_modules/**`, `dist/**` | — | Generated (not tracked) | per dependency | Generated — no action |

**Submodules:** none (`.gitmodules` absent).
**Vendored code inside `src/`:** none.
**Per-file SPDX headers in `src/`:** none — the root MIT is the only grant.

### 4.2 Dependency license map — npm (82 packages in `pnpm-lock.yaml`)

| SPDX | Count | Packages |
| --- | --- | --- |
| `MIT` | 51 | `@jridgewell/*` (3), `@oxc-project/types`, `@rolldown/binding-*` (14), `@rolldown/pluginutils`, `@types/*` (5), `@vitejs/plugin-react`, `@vitest/mocker`, `@vitest/spy`, `assertion-error`, `chai`, `es-module-lexer`, `estree-walker`, `fdir`, `fsevents`, `magic-string`, `nanoid`, `obug`, `picomatch`, `postcss`, `react`, `react-dom`, `rolldown`, `scheduler`, `std-env`, `tinybench`, `tinyexec`, `tinyglobby`, `vite`, `vitest`, `why-is-node-running` |
| `Apache-2.0 OR MIT` | 13 | `@tauri-apps/api`, `@tauri-apps/cli` + 11 platform binaries |
| `MPL-2.0` | 12 | `lightningcss` + 11 platform binaries |
| `Apache-2.0` | 3 | `detect-libc`, `expect-type`, `typescript` |
| `MIT OR Apache-2.0` | 1 | `@tauri-apps/plugin-dialog` |
| `ISC` | 1 | `picocolors` |
| `BSD-3-Clause` | 1 | `source-map-js` |
| **GPL / AGPL / LGPL / unlicensed** | **0** | — |

`lightningcss` is a **build-time dev dependency** (Vite's optional CSS
transformer) and is **not** shipped in the app bundle; MPL-2.0 §3.2 is
therefore not engaged by it in the shipped artifact, but the licence should
still be recorded.

### 4.3 Dependency license map — Rust (422 crates in `src-tauri/Cargo.lock`)

| SPDX | Observed count | Notes |
| --- | --- | --- |
| `MIT` | ~99 | — |
| `MIT OR Apache-2.0` (and `Apache-2.0 OR MIT`, `MIT/Apache-2.0`, `Apache-2.0 / MIT`, `Apache-2.0 AND MIT`, `(MIT OR Apache-2.0) AND Unicode-3.0`) | ~157 | Includes `tauri`, `wry`, `tao`, `muda`, `tauri-plugin-dialog`, `serde`, `serde_json`, `base64` |
| `Apache-2.0` | 2 | `tao` (Apache-2.0 only), `sync_wrapper` |
| `Apache-2.0 WITH LLVM-exception` / `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | 4 | `target-lexicon`, `wasi`, `wasip2`, `wit-bindgen` |
| `BSD-3-Clause` (+ `BSD-3-Clause AND MIT`, `BSD-3-Clause/MIT`) | 4 | `alloc-no-stdlib`, `alloc-stdlib`, `brotli`, `brotli-decompressor` |
| `Zlib` (+ `Zlib OR Apache-2.0 OR MIT`, `MIT OR Apache-2.0 OR Zlib`, `MIT OR Zlib OR Apache-2.0`) | 6 | — |
| `MPL-2.0` | 5 | **`cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors`** — file-level copyleft, statically linked into the shipped binary |
| `Unicode-3.0` | 18 | ICU4X data crates — notice obligation |
| `0BSD` / `Unlicense` / `ISC` | 11 | notice-only obligations |
| `MIT OR Apache-2.0 OR LGPL-2.1-or-later` | 2 | **`r-efi` 5.3.0 and 6.0.0** — the only LGPL string anywhere in the graph, and it is in a **disjunctive** `OR` grant. Select the MIT or Apache-2.0 branch. |
| **GPL / AGPL / mandatory LGPL / unlicensed** | **0** | — |

**MPL-2.0 in the shipped binary.** Five crates are MPL-2.0 and are statically
linked into the Paka executable. MPL-2.0 is file-level copyleft: Paka does not
modify those files, so no source-disclosure obligation is triggered. **However
§3.2 of the MPL requires the licence text to be made available with the
distribution.** Today Paka ships no licence texts at all — see **B-4**. This is
the one place where a bundled-binary licence obligation is substantive rather
than cosmetic, and it is a distribution blocker.

### 4.4 Obligations table (what must be satisfied)

| Obligation | Source | Applies to | Currently met? |
| --- | --- | --- | --- |
| Retain the copyright + permission notice in all copies | MIT | Paka's own code; all MIT deps; `addyosmani` skills | **No** — no notices file |
| Retain upstream `NOTICE` content if the work has one | Apache-2.0 §4(d) | `tauri`/`wry` family (no upstream `NOTICE` file) | Vacuously yes |
| Mark modified Apache-2.0 files | Apache-2.0 §4(b) | Any Apache-2.0 file Paka edits | Paka edits none |
| Make MPL-2.0 licence text available with the distribution | MPL-2.0 §3.2 | `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors` (linked in) | **No** |
| Unicode licence text with the distribution | Unicode-3.0 | 18 ICU4X data crates | **No** |
| BSD-3-Clause / Zlib / ISC / Unlicense notice text | respective | 21 crates + `source-map-js`, `picocolors` | **No** |
| Do **not** take the LGPL branch of `r-efi` | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` | `r-efi` | **Action** — record the chosen branch |
| No trademark rights from the copyright licence | MIT; Apache-2.0 §6 | **the TAURI logo** | **No — B-1** |
| "It is your responsibility to verify that you are complying with all upstream licenses" | Tauri docs, Architecture → License | Paka as a Tauri distributor | **No — B-4** |

### 4.5 Paka's own licence and distribution model

- **Licence:** MIT, `LICENSE`, "Copyright (c) 2026 HumanHEART". Known and
  unambiguous, so **no copyleft obligation currently attaches to Paka** and the
  §"copyleft may affect the product" trigger in the gate's brief is **not**
  active. It becomes active the moment Paka links a copyleft dependency, or
  copies/links GPL code, or the owner changes the licence.
- **Distribution model:** a public GitHub repository **and** a Tauri desktop
  installer. A desktop installer is a distribution; the MIT notice must
  accompany it (it does not today), and the third-party notices must be
  available to recipients.
- **Undocumented obligations and governance (B-5):** no `CONTRIBUTING.md`, no
  CLA or DCO, no `CODE_OF_CONDUCT.md`, no `SECURITY.md`, no trademark policy,
  no README "License" section, **no express patent grant** (MIT contains
  none). Inbound contributions therefore arrive without an explicit licence
  grant. Not a distribution blocker; it is a governance gap that a human
  should close.
- **Patents:** no patent policy anywhere in Paka or in its dependencies'
  documentation. Note that Paka takes the MIT branch of `tauri`/`wry`
  (`MIT OR Apache-2.0`), and **MIT carries no express patent grant**, whereas
  Apache-2.0 §3 does. Choosing the MIT branch therefore forgoes the upstream
  patent grants that the Apache-2.0 option would have provided. Low risk,
  recorded, human decision if patents matter.

---

## 5. What is explicitly blocked

| Material | Why | Outcome |
| --- | --- | --- |
| GIMP brush engine source or any derivative | GPL-3.0 | **BLOCKED** |
| Krita brush engine source or any derivative | GPL-3.0 | **BLOCKED** |
| MyPaint brush engine source or any derivative | GPL-2.0 | **BLOCKED** |
| A faithful translation/port of any of the above | Translation is still a derivative work | **BLOCKED** |
| Source, presets, textures or code from SAI / Clip Studio / Procreate / Corel Painter / ArtRage | Proprietary; no grant | **BLOCKED** |
| The TAURI logo as Paka's application icon | No trademark licence | **BLOCKED** (§0.3 B-1) |
| `.agents/skills/vercel-react-best-practices/**` — **removed from this list on 2026-10-20** | The upstream project states its licence as MIT in its README (see B-2, corrected) | **Not blocked.** MIT; the notice obligation is discharged by `THIRD_PARTY_NOTICES.md` + `licenses/MIT.txt`. |
| Bundled CC-BY-SA / CC-BY-NC / GPL / unlicensed assets | Not redistributable under Paka's terms | **BLOCKED** |
| `p5.js` (LGPL-2.1) in the shipped bundle | LGPL obligations on a bundled web app | **RESTRICTED** — treat as blocked absent a human decision |

**Do not "fix" a licence problem by adding a `LICENSE` file to a vendored
directory.** That would assert rights Paka does not hold and misattribute
copyright. The only correct fixes are to obtain a grant, to remove the
material, or to replace it.

---

## 6. Answers to the required decision questions

**Q1 — What exact code or asset would Paka use?**
Strategy A only: Paka's own code and documents at commit `ad2ef11…`, listed in
§2.1. No third-party code. No new assets. The existing dependency set
(§4.2, §4.3) is unchanged and already permissive.

**Q2 — Under what exact licence and copyright notices?**
Paka's own: MIT, "Copyright (c) 2026 HumanHEART" (`LICENSE`). The existing
dependency set carries MIT / Apache-2.0 / BSD-3-Clause / ISC / Zlib / MPL-2.0 /
Unicode-3.0 / 0BSD / Unlicense, plus one disjunctive `MIT OR Apache-2.0 OR
LGPL-2.1-or-later` (`r-efi`) for which the MIT or Apache-2.0 branch must be
recorded. Two vendored skill sets carry MIT (Addy Osmani) and one carries **no
licence at all** (Vercel).

**Q3 — Is the intended distribution model known?**
**Partly.** Known: public GitHub repository plus a Tauri desktop installer;
the npm package is private and unpublished. **Not documented:** the owner's
confirmation that MIT is the intended *distribution* licence (not merely the
source licence), the intended release channel, whether a commercial release is
planned, and whether the app will be submitted to app stores (which impose
their own attribution and trademark-review requirements).

**Q4 — Which obligations or restrictions must be satisfied?**
(a) Preserve the MIT notice in every distributed copy and add a
`THIRD_PARTY_NOTICES.md`; (b) ship the MPL-2.0 licence text for the five
statically linked MPL crates, and the Unicode/BSD/Zlib/ISC notice texts;
(c) record the chosen licence branch for `r-efi`; (d) **replace the TAURI
logo** with Paka-owned artwork before distribution, and use only artwork Paka
owns or is licensed to use as a *mark*; (e) keep every MIT notice for the
vendored skills; (f) do not add third-party code or assets without re-running
this gate.

**Q5 — Is there a lower-risk alternative?**
Yes, and it is the recommended path: **Strategy A**. It is already the
plan in `feature-analysis.md` §8, it adds no dependency, and it creates no
notice obligation. The alternatives are strictly higher-risk: B adds a
dependency for a problem the candidate does not have; C and D are blocked;
E requires a clean-room protocol the candidate does not need; F changes the
product shape; G and H add asset-by-asset provenance work for no functional
gain.

**Q6 — What must a human explicitly decide?**
1. **Confirm MIT as Paka's distribution licence**, and confirm that the app
   will be distributed (installer) and not merely published as source.
2. **Decide on the TAURI logo** (B-1): replace with Paka artwork (recommended),
   or contact `trademark@tauri.app` for a licence. Paka cannot simply recolour
   or redraw it — the policy forbids changing the logo, so a modified Tauri
   mark is still the Tauri mark.
3. **Decide on the Vercel skill** (B-2): **resolved on 2026-10-20 — the
   upstream project states its licence as MIT in its README**, so the files may
   stay tracked; the only obligation is to retain the MIT notice and record
   the copyright holder as Vercel, Inc. Both are done in
   `THIRD_PARTY_NOTICES.md` and `licenses/MIT.txt`. Optional: ask Vercel to add
   a canonical `LICENSE` file upstream.
4. **Decide whether to add** `THIRD_PARTY_NOTICES.md`, a README "License"
   section, `CONTRIBUTING.md` (with a DCO or CLA), and an in-app About /
   Licences screen. The licence texts must ship with the installer.
5. **Decide whether to consult GIMP/Krita at all** for the stamp engine
   (§3.5). If yes, name the implementer and the clean-room protocol in
   advance; if the implementer has already read GPL source, assign a
   different implementer.
6. **Decide on patents** (§4.5): whether to add an express patent grant.
7. **Decide on `r-efi`'s branch** (MIT or Apache-2.0) and record it.

---

## 7. Assumptions and limits of this review

1. `feature-analysis.md` is an **untracked internal artifact**, not upstream
   material. It is used here only as the description of the candidate; it is
   not treated as an approved design, and its technical conclusions (notably
   the format-version conflict in §9.2) are **not** ratified by this gate.
2. The version conflict in `feature-analysis.md` §9.2 (whether the slice needs
   format v9) is a **technical** decision for the coordinator and architecture
   translator. It has **no licence consequence** and is not decided here.
3. "Independent reimplementation" is treated as a **process** property
   (clean-room discipline), not as a property of the resulting code. The gate
   cannot verify the process; it records the requirement and the implementer's
   obligation. See the `provenance-record.json` field
   `cleanroom.implementerAttestation`.
4. This is engineering triage under the evidence available on 2026-10-20. It
   is **not legal advice** and does not create or transfer rights. It does
   not assess patentability, export control, privacy of user content, or
   app-store policy in detail.
5. The npm and Rust licence maps reflect the **exact lockfile versions** at
   this commit. A dependency bump re-opens the gate for that dependency.
6. Only the versions of the upstream sources named in the provenance record
   were inspected. A later upstream revision may carry a different licence
   (this is not hypothetical: `vercel-labs/agent-skills` states MIT in a README
   rather than in a `LICENSE` file, so a future revision could move, reword or
   remove that statement — which is why the statement's presence at the
   commits that touched the copied files was verified rather than assumed).
7. The 44 npm packages installed on disk were cross-checked against the 82 in
   the lockfile; the 38 not installed on this Windows host are
   platform-specific optional binaries. The Rust map covers all 422 lockfile
   crates: 248 read from the local cargo registry, 173 resolved through the
   crates.io API, and 1 (`paka 0.1.0`) is the local crate.
8. No conclusion is drawn about the toolchain licences of the Rust compilers
   or of any future target platform.

---

## 8. Primary sources

| # | Source | Link |
| --- | --- | --- |
| S1 | MIT License (canonical text) | https://opensource.org/license/mit |
| S2 | Apache License 2.0 (canonical text) | https://www.apache.org/licenses/LICENSE-2.0 |
| S3 | Mozilla Public License 2.0 | https://www.mozilla.org/media/MPL/2.0/index.txt |
| S4 | Paka `LICENSE` at the reviewed commit | `LICENSE` (this repository) |
| S5 | Paka public repository | https://github.com/aissaadib/Paka |
| S6 | Tauri `LICENSE-MIT` — "Copyright (c) 2017 - Present Tauri Apps Contributors" | https://github.com/tauri-apps/tauri/blob/dev/LICENSE-MIT |
| S7 | Tauri `LICENSE-APACHE-2.0` (§6 Trademarks, §4(b)(c)(d)) | https://github.com/tauri-apps/tauri/blob/dev/LICENSE-APACHE-2.0 |
| S8 | **Tauri Trademark Guidelines** — logos may not be used for a third-party product without contacting the holder | https://tauri.app/about/trademark |
| S9 | Tauri upstream template icons (source of Paka's `src-tauri/icons/`) | https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-cli/templates/app/src-tauri/icons |
| S10 | Tauri docs — Architecture → License: *"If you repackage it and modify any source code, it is your responsibility to verify that you are complying with all upstream licenses."* | https://v2.tauri.app/concept/architecture/#license |
| S11 | `addyosmani/agent-skills` — MIT, "Copyright (c) 2025 Addy Osmani" | https://github.com/addyosmani/agent-skills/blob/main/LICENSE |
| S12 | `vercel-labs/agent-skills` — **licence stated as MIT in the repository README** ("## License" → "MIT"), present since the first commit `740483462a` (2025-12-08) and at every commit that touched the copied files (`805687f34e`, `dc8367e6f9`, 2026-04-14). No standalone `LICENSE` file; the GitHub API reports `license: null` for that reason alone. | https://github.com/vercel-labs/agent-skills |
| S13 | GIMP `COPYING` — GNU GPL v3 | https://github.com/GNOME/gimp/blob/master/COPYING |
| S14 | Krita `COPYING` — GNU GPL v3 | https://github.com/KDE/krita/blob/master/COPYING |
| S15 | MyPaint `COPYING` (master) — GNU GPL v2 | https://github.com/mypaint/mypaint/blob/master/COPYING |
| S16 | p5.js `license.txt` — LGPL-2.1 | https://github.com/processing/p5.js/blob/main/license.txt |
| S17 | `perfect-freehand` LICENSE — MIT, "Copyright (c) 2021 Stephen Ruiz Ltd" | https://github.com/steveruizok/perfect-freehand/blob/master/LICENSE |
| S18 | `fabric.js` LICENSE — MIT | https://github.com/fabricjs/fabric.js/blob/master/LICENSE |
| S19 | `konva` LICENSE — MIT | https://github.com/konvajs/konva/blob/master/LICENSE |
| S20 | `paper.js` LICENSE.txt — MIT, "Copyright (c) 2011-2020, Jürg Lehni & Jonathan Puckey" | https://github.com/paperjs/paper.js/blob/develop/LICENSE.txt |
| S21 | crates.io API (per-crate licence) | https://crates.io/api/v1/crates/{name}/{version} |
| S22 | npm registry (per-manifest licence) | https://registry.npmjs.org/{name}/{version} |

---

## 9. Post-review re-check (2026-10-20, after the slice started)

The coordinator began implementing while this gate was running. The tree was
re-scanned at the end of the review. The re-check **does not change the
decision**; it records three facts and one correction.

### 9.1 The in-progress implementation is Strategy-A clean (on the checks the gate can run)

| Check | Result |
| --- | --- |
| New source `src/core/rendering/stampCoverage.ts` imports | Only Paka's own modules: `../../types/brush`, `../../utils/color`, `../../utils/math`, `./canvas2dStroke`. **No third-party import.** |
| Attribution strings in the new source | None (`Copyright`, `SPDX`, `adapted from`, `ported from`, `based on`, `inspired by`, `reference` → no matches) |
| New runtime dependencies | **None.** `package.json` and `src-tauri/Cargo.toml` are unchanged; the dependency sets in §4.2 and §4.3 still hold exactly. |
| New assets | **None.** The tracked-binary set is still the 16 icon files. |
| Modified files | `src/types/brush.ts`, `src/core/brushes/defaults.ts` (new stamp fields), `src/core/rendering/Canvas2DRenderer.ts` (+1 line) |

This is **consistent with Strategy A** and with condition C1. It is *not* proof
of clean-room status: the gate cannot verify the implementer's reading history
from the repository. The §2.5 attestation remains outstanding and is recorded
as such in `provenance-record.json` → `cleanroom.implementerAttestation`.

### 9.2 Correction: `docs/architecture-port-plan.md` mis-states three licences

That plan is the architecture translator's artifact and lists upstreams it
considered and rejected. Its licence attributions are **wrong** on two
verifiable projects and name one project that cannot be verified:

| Plan says | Actually is | Evidence |
| --- | --- | --- |
| "Krita GPL-2.0" (L134, L816) | **Krita is GPL-3.0** | `KDE/krita` → API `license.spdx_id = GPL-3.0`; `KDE/krita@master/COPYING` = "GNU GENERAL PUBLIC LICENSE Version 3" |
| "mypaint LGPL-2.1" (L134, L816) | **MyPaint is GPL-2.0** | `mypaint/mypaint` → API `license.spdx_id = GPL-2.0`; `mypaint/mypaint@master/COPYING` = "GNU GENERAL PUBLIC LICENSE Version 2, June 1991" |
| "xp-brush GPL-2.0" (L134, L816) | **No such brush-engine project could be verified.** A GitHub repository search for `xp-brush` returns 4 unrelated results and nothing resembling a painting brush engine. | https://api.github.com/search/repositories?q=xp-brush |

The plan's downstream reasoning is **not affected** — its conclusion (do not
copy; implement independently) is correct and matches Strategy A — but two of
its stated reasons are wrong, and the MyPaint reason is wrong *in kind*: the
plan says MyPaint's "LGPL option has linking obligations", whereas MyPaint is
GPL, so the consequence is **relicensing Paka**, not a linking obligation. A
licence attribution that is wrong in a project document is a provenance defect:
it must be corrected rather than carried forward.

**Required correction (action A8):** fix the three attributions in
`docs/architecture-port-plan.md` to the values above, or remove the
contingency list entirely (it is not needed — the plan's chosen path uses no
third-party code).

### 9.3 The plan's "no licence gate document" note is superseded

`docs/architecture-port-plan.md` L29 states *"There is no separate licence-gate
document because there is nothing to gate"*, and L35/L158 conclude
*"no licence obligation at all"*. That reasoning was reached without a gate and
without the dependency, asset and vendored-file evidence in §4. The conclusion
happens to be right for the recommended path, but the reasoning was not
evidence-backed, and it missed two findings that are not about the slice at
all: **B-1** (the TAURI logo is Paka's app icon) and **B-4** (no third-party
notices are published, and the licence texts of five statically linked
MPL-2.0 crates are not shipped). This document and `provenance-record.json`
are that gate.

### 9.4 Correction: finding B-2 was wrong, and it is now fixed

**What the gate first reported.** That `vercel-labs/agent-skills` carried **no
licence at all**, on the strength of three observations: the repository has no
`LICENSE`, `COPYING` or `NOTICE` file; a full recursive tree scan found no
licence file; and the GitHub API reports `license: null`.

**Why that was wrong.** The licence was there — in the repository README, in a
`## License` section, stating **MIT**. The scan looked for a licence *file* and
the API only detects licence *files*, so a licence stated in prose was
invisible to both checks. A fourth check — reading the README's text — would
have caught it.

**What was verified, and when.**

| Check | Result |
| --- | --- |
| Upstream `README.md`, `## License` section | `MIT` |
| First commit in which the statement appears | `740483462a`, 2025-12-08 — the repository's first commit |
| Present at `805687f34e` (2026-04-14), the last commit to touch the copied `SKILL.md` | yes |
| Present at `dc8367e6f9` (2026-04-14), the last commit to touch the copied `rules/` | yes |
| Present on `main` today | yes |
| Standalone `LICENSE` file | none |
| Explicit copyright line | none — the rules' own README credits "Originally created by [@shuding](https://x.com/shuding) at [Vercel](https://vercel.com)" |

**The corrected finding.** **B-2 is RESTRICTED, not NEEDS HUMAN REVIEW.** The
rights holder (Vercel, Inc.) has published an MIT grant for this material,
continuously, since the repository was created. The material may be
redistributed and may stay tracked. The two caveats — no `LICENSE` file, no
copyright line — are recorded in `THIRD_PARTY_NOTICES.md` rather than hidden;
neither prevents redistribution under MIT.

**What this changes.**

* Nothing is untracked, git-ignored or purged. The earlier recommendation to
  remove the directory from the public repository, and the history-purge
  option that went with it, are **withdrawn**.
* The remaining obligation is the MIT notice. `THIRD_PARTY_NOTICES.md` records
  the copyright holder as Vercel, Inc., and `licenses/MIT.txt` ships the
  permission notice with the installer.
* The optional follow-up is to ask Vercel to add a canonical `LICENSE` file
  upstream. That would remove the caveat; it does not change Paka's position.

**What it does not change.** B-1 (the TAURI logo) and B-4 (no third-party
notices) stand exactly as issued, and they are the two that actually block
distribution. The decision on the candidate (Strategy A) is unchanged.

**The lesson, recorded so it is not repeated.** A licence map that only looks
for licence *files* is not a licence map. A repository can grant rights in its
README, in a per-directory `LICENSE`, in a `Cargo.toml` `license` field, or in
a package manifest — and "the API says `license: null`" means "the API did not
detect a file", not "there is no licence". `scripts/generate-third-party-notices.mjs`
now reads the licence **field or file each package ships**, and the Vercel
skill's licence is recorded from the upstream README, with the evidence for
where and when that statement was present.

---

## 10. Required actions before the coordinator may proceed

**Blocking for implementation of the candidate:** none. Strategy A is
approved and can start immediately, subject to C1-C5 in §2.4 — in particular,
the implementer must not read GPL brush-engine source.

**Blocking for distribution of any build:**

| # | Action | Owner |
| --- | --- | --- |
| A1 | Replace all 16 files in `src-tauri/icons/` with Paka-owned artwork (`pnpm tauri icon <source>`), and confirm the source is Paka-owned or licensed **as a mark**. | Paka owner |
| A2 | Create `THIRD_PARTY_NOTICES.md` covering: Paka's own MIT notice, all MIT / Apache-2.0 / BSD-3-Clause / ISC / Zlib / 0BSD / Unlicense dependencies, the **five MPL-2.0 crates with their licence text**, the **Unicode-3.0 notice**, the `r-efi` chosen branch, and the Addy Osmani MIT notice for the vendored skills. Ship it with the installer (a `licenses/` folder in the Tauri bundle, and/or an in-app About/Licences screen). | Paka owner |
| A3 | Add a README "License" section, `CONTRIBUTING.md` (with a DCO or CLA), and an in-app About screen naming Tauri. | Paka owner |
| A4 | **Done on 2026-10-20.** The Vercel skill is MIT (upstream README); the files stay tracked, the MIT notice ships in `licenses/MIT.txt`, and the copyright holder is recorded as Vercel, Inc. in `THIRD_PARTY_NOTICES.md`. Optional follow-up: ask Vercel to add a canonical `LICENSE` file upstream. | Paka owner |

**Should not block the slice, but should be scheduled:**

| # | Action |
| --- | --- |
| A5 | Add a CI check that fails when a new dependency appears whose licence is not on an allow-list of permissive SPDX ids (this is what would have caught the `r-efi` LGPL string and keeps the map current). |
| A6 | Re-run this gate on every dependency bump and before every release; record the result in `provenance-record.json`. |
| A7 | Decide the patent-grant question (§4.5). |
| **A8** | **Correct the licence attributions in `docs/architecture-port-plan.md`**: Krita is GPL-3.0 (not GPL-2.0), MyPaint is GPL-2.0 (not LGPL-2.1), and `xp-brush` could not be verified and should be removed. Alternatively remove the contingency list, which the chosen path does not need. |
| **A9** | Record the implementer's **clean-room attestation** (§2.5) for the stamp engine before the slice is merged: that no GIMP / Krita / MyPaint / SAI / Clip Studio / Procreate / Corel Painter / ArtRage brush-engine source was read while producing the implementation, or the name of the implementer who must re-do the work. |

---

*Gate decision produced 2026-10-20 for candidate `PHASE3-STAMP-ENGINE` at
commit `ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9`. This decision applies only
to the commit, files, dependencies and strategies named above. It is not a
clearance of the repository. Uncertainty is recorded here, not converted into
permission.*
