# Final audit — Paka rendering-performance slice (R1 / F1b + F7 revert)

**Role:** independent final auditor (read-only release gate).
**Audited commit:** `ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9`
("docs: clarify how to measure frames in the packaged app")
**Tree:** `a2d9d8b004dc2317920de895f5e232707af99439`
**Remote:** `https://github.com/aissaadib/Paka.git`, `origin/main == ad2ef11` (0 ahead / 0 behind).
**Checkout at audit time:** branch `feat/stamp-brush-engine` (created *during* this
audit, at the same commit) — see F3. `main` and `origin/main` are both at `ad2ef11`.

**Verdict: HUMAN REVIEW** — with four attached, mechanical work items (F1–F4).

> **Status update (documentation follow-up, later the same day):** F1, F2 and F4
> have been **corrected in the working tree, uncommitted** — see
> `docs/ARCHITECTURE.md` (the rebuild paragraph), `docs/SESSION-BRIEF.md` (§2, the
> shipped-slices table, §7, §10), `docs/HANDOFF.md` (§4 and its shipped-slices
> table), `docs/PERFORMANCE_AUDIT_2026-10-20.md` (the state pointer),
> `AGENTS.md` (the stale format label) and the `PixelCanvas` header comment in
> `src/test/canvas2dRenderer.test.ts`. The corrections were verified in an
> isolated worktree at `ad2ef11`: **474 tests / 29 files pass, typecheck clean,
> build OK**. **F3 and F5 remain open** — F3 is a live hazard (the stamp-engine
> implementation is uncommitted in the same checkout) and F5 needs a human
> decision on the licence/distribution findings.

Three things drive this, in order of severity:

1. **Unresolved licensing and distribution decisions** (F5). The pipeline's own
   Licence/Provenance Gate (`reuse-decision.md` + `provenance-record.json`, both
   pinned to this same commit) records **two findings that block distribution of any
   build of Paka** — the Tauri logo used as the app icon (no trademark grant) and
   **missing third-party notices** — and two more that need a human decision
   (76 unlicensed third-party files already published in the public repository; no
   governance/trademark/patent policy). Those decisions are the repository owner's
   to make and I must not waive them.
2. **Documentation that is now factually wrong about the shipped renderer** (F1,
   F2, F4) — two documents every future agent is required to read, plus one stale
   comment inside the test file the slice itself changed. Mechanical fixes.
3. **The checkout is not quiescent** (F3): while this audit ran, the stamp-engine
   implementation began modifying the audited file in the working tree.

**The code of the audited slice is sound and I approve it.** Nothing in §5, §6 or
§7 blocks it: the change is correct, regression-tested, security-neutral and
dependency-neutral. The blockers are records, documentation and release hygiene —
not behaviour.

This audit was run against the **committed** tree only (`HEAD == ad2ef11`,
tree `a2d9d8b…`). Untracked, in-flight artifacts produced by other agents while I
was working — `feature-analysis.md`, `feature-evidence.json`, `reuse-decision.md`,
`provenance-record.json`, `qa/`, `docs/architecture-port-plan.md`,
`docs/acceptance-criteria.json` — plus uncommitted edits to four production files
are reported in §3 (F3) and §8, and were **not** treated as part of the audited
commit.

---

## 1. What was audited

The complete slice on `main` since the previous gate:

| Commit | Slice | Files |
| --- | --- | --- |
| `4ac040b` | **R1 / F1b — bound layer rasterization by the inked rectangle** | `src/core/rendering/Canvas2DRenderer.ts`, `src/test/canvas2dRenderer.test.ts` |
| `f7cf50c` | element-sized scratch (F7) — **attempted** | same two files |
| `2fa34cc` | **Revert of F7** (the reverted commit stays in history) | same two files |
| `2f095d5`..`ad2ef11` | `docs/PERFORMANCE_AUDIT_2026-10-20.md` (report) + corrections | `docs/PERFORMANCE_AUDIT_2026-10-20.md` only |

The wider session (`e1071d9..ad2ef11`, 20 files, +2984/-67) also contains the
already-merged raster-budget, layer-safety, live-preview and preview-scratch slices;
I re-verified those too because they are the baseline the R1 change sits on.

**Scope check — PASS.** `git diff --check e1071d9..HEAD` is clean. No generated
files, binaries, `dist/`, `src-tauri/target/` content, secret material, credential,
absolute local path, or debug artifact is in the committed diff. The single
`console.log` in the diff is inside a code sample in the audit report's Appendix A
(`docs/PERFORMANCE_AUDIT_2026-10-20.md`), not production code. `package.json`,
`pnpm-lock.yaml` and everything under `src-tauri/` are byte-identical to the
pre-slice state — **no dependency, native or IPC change**.

---

## 2. Blockers

### F1 (blocker) — `docs/ARCHITECTURE.md` and `docs/SESSION-BRIEF.md` still describe the pre-R1 renderer

`docs/ARCHITECTURE.md` **lines 200–206** ("Rendering pipeline"):

> "Rasterizing a layer is a rebuild, not an incremental edit: for every element on
> that layer the renderer **clears the whole stroke buffer and blends one
> full-surface draw**, so the cost is `O(elements x surface pixels)` and **does not
> depend on the stroke's geometry**. A measured breakdown … and the **recommended
> first fix (dirty bounds for the stroke buffer)** are in
> [PERFORMANCE_AUDIT_2026-10-20.md]."

`docs/SESSION-BRIEF.md` **lines 334–339** ("Known limitations / open gaps") repeats
the same claim as a product limitation, and again lists dirty bounds as the
recommended fix.

Every one of those statements is false for the tree at `ad2ef11`. Since `4ac040b`:

* `rasterizeStrokeToBuffer` clears only `clearStrokeBufferRegion(region)`
  (`Canvas2DRenderer.ts:879–896`), not the whole buffer;
* `compositeStrokeBuffer` blends only the element's inked rectangle
  (`Canvas2DRenderer.ts:961–981`);
* the cost now **follows the stroke's geometry**, not the document size.

The audit report in the same repository already says so
(`docs/PERFORMANCE_AUDIT_2026-10-20.md:713` — "**DONE — R1 shipped**"), so the tree
currently ships two documents that contradict each other and the code.

This breaks the project's own non-negotiable rule (`docs/SESSION-BRIEF.md:192–194`,
rule 3: "Docs move with behaviour in the same commit") — `4ac040b` touched only the
renderer and the test file, and `git log` confirms `ARCHITECTURE.md`,
`HANDOFF.md` and `SESSION-BRIEF.md` were last written at `9d160da`, i.e. **before**
R1.

*Impact*: the next agent reads ARCHITECTURE.md to learn how the renderer works and is
told the rebuild is `O(elements x surface pixels)` full-surface; the audit's own
"recommended first fix" is already implemented, so the plan looks un-started. The
stale claim is actively propagating: the architecture port plan written during this
audit (`docs/architecture-port-plan.md`, "Baseline inspected") repeats "461 tests in
29 files" from the stale brief.

**Remediation** (one docs commit, no code change):
1. `docs/ARCHITECTURE.md` §"Rendering pipeline": rewrite the paragraph to describe
   the bounded rebuild (per-element inked rectangle, 1:1 blit on the shared device
   grid, the layer's own single full clear unchanged) and replace
   "recommended first fix (dirty bounds …)" with a pointer to the audit's F1c
   measurement. Keep the link to the audit.
2. `docs/SESSION-BRIEF.md` §7: delete the "Layer rasterization is a full rebuild …
   `O(elements x surface pixels)`" limitation, or restate it as *fixed* with the
   measured factor (47x–187x less touched area) and keep the residual, honest cost
   model (per-element overhead; a layer whose strokes cover the whole document does
   not get faster).

### F2 (blocker) — stale comment inside the file the slice changed

`src/test/canvas2dRenderer.test.ts:1457–1459` (the `PixelCanvas` header) still says:

> "Stroke rasterization (paths, arcs) is deliberately a no-op: coverage is seeded
> straight into the stroke buffer, because these tests are about where that coverage
> is composited, not about how it was rasterized."

That was true before `4ac040b`. `4ac040b` deliberately changed it — its own message
says "The software pixel canvas grew a path rasterizer (thick polyline and polygon
fill), pattern tiling and the destination-in operation" — and the implementation is
there (`arc` as a 24-gon, `fill` as a point-in-polygon test, `stroke` as a capsule per
segment, plus `destination-in` and pattern tiling). The header comment was not
updated, and it also omits the `destination-in` operation from the list of
implemented composite modes.

*Impact*: a reader trusts the comment, concludes that no pixel test can check a
stroke's shape, and defers verification to a manual browser check — the opposite of
what the harness can now do. This is the same defect the Feature Analyst recorded
independently as `D2` in `feature-evidence.json`.

**Remediation**: update the header comment in
`src/test/canvas2dRenderer.test.ts:1448–1460` to state that the harness now
rasterizes paths (capsule strokes, polygon fills, arcs) and implements
`source-over`, `destination-out`, `destination-in`, `multiply` and `screen`, and
that its edges are hard (no antialiasing) — so it can disprove a placement/extent
bug but cannot prove Chromium's antialiased edge.

---

## 3. High findings

### F3 (high) — the checkout is not quiescent; untracked artifacts must not be swept in

While this audit ran, other agents changed the checkout **and started implementing
the next slice in it**:

* a new branch `feat/stamp-brush-engine` was created at `ad2ef11` and checked out
  (the tree is now on that branch, not `main`);
* `feature-analysis.md`, `feature-evidence.json`, `reuse-decision.md`,
  `provenance-record.json`, `qa/`, `docs/architecture-port-plan.md`,
  `docs/acceptance-criteria.json` and `.opencode/agents/*.md` were created
  **untracked**;
* **production source files are now modified in the working tree**:
  `src/types/brush.ts`, `src/core/brushes/defaults.ts`,
  `src/core/rendering/Canvas2DRenderer.ts` (the file this audit reviewed) and a new
  untracked `src/core/rendering/stampCoverage.ts`. `HEAD` is still `ad2ef11`, so
  the *committed* tree I audited is intact — but a `git add -A` or `git commit -a`
  would now mix an unreviewed implementation into the R1 slice.

None of these scratch paths is gitignored, so the default add would sweep them in.
In particular `qa/preR1/Canvas2DRenderer.ts` is a **stale 1077-line fork of
`src/core/rendering/Canvas2DRenderer.ts`** (the pre-R1 copy, byte-identical to the
repo's own file at `9d160da`, so no licence issue — same MIT project) that nothing
builds, tests or imports from the shipped path. Committing it would put a second,
unmaintained copy of the renderer in the tree.

**Remediation**: before any commit, add the agent scratch (`qa/`,
`feature-analysis.md`, `feature-evidence.json`, `provenance-record.json`,
`reuse-decision.md`, `.opencode/agents/`) to `.gitignore`, or land them deliberately
under `docs/`. Commit the stamp-engine work on its own branch with its own
reviewed commits. Nothing in `qa/` or the root-level `*.md`/`*.json` belongs in
the product tree as-is.

### F4 (high) — the state documents are stale and now contradict the tree

| File | Line | Claim | Reality |
| --- | --- | --- | --- |
| `docs/SESSION-BRIEF.md` | 35 | "`pnpm test` → **461 tests** in 29 files" | **474** tests in 29 files (I ran it) |
| `docs/SESSION-BRIEF.md` | 33–34 | "working tree clean after the live-preview compositing, layer-safety and raster-budget slices" | tree is dirty (harness files); the raster-performance slices are not listed |
| `docs/SESSION-BRIEF.md` | 50–72 | "Shipped slices (newest first)" table | newest row is `520aa77`; `4ac040b` (R1), `f7cf50c`→`2fa34cc` (F7 shipped-then-reverted) and the audit report are missing |
| `docs/SESSION-BRIEF.md` | 503–506 | "confirm `main` is at the raster-budget commit"; "expect 461 tests in 29 files" | `main` is at `ad2ef11`; 474 tests |
| `docs/HANDOFF.md` | 70–73 | "pushed after the live-preview compositing, layer-safety and raster-budget slices"; "**461 tests** in 29 files" | as above |
| `docs/HANDOFF.md` | 83–89 | "Shipped slices (this arc, newest first)" | newest row is `520aa77`; R1 absent |
| `docs/PERFORMANCE_AUDIT_2026-10-20.md` | 7 | "State at the end of the session: `main` at `2fa34cc`" | `ad2ef11` (two doc commits later) |

**Remediation**: update the counts to 474/29, add the R1 row (and the F7
ship-then-revert row) to both shipped-slices tables, fix the commit pointer in
`SESSION-BRIEF.md` §10, and correct the audit's "state at the end of the session"
pointer. This is the same class of defect as F1 and belongs in the same docs commit.

### F5 (HUMAN REVIEW) — unresolved licensing and distribution decisions, recorded by the pipeline's own licence gate

The Licence/Provenance Gate produced `reuse-decision.md` and `provenance-record.json`
during this session, both pinned to `ad2ef11` — the same commit I audited. Its
one-line answer is:

> "**Strategy A is approved.** … Two pre-existing repository findings (**B-1 the
> TAURI logo, B-4 the missing third-party notices**) must be cleared before any
> build of Paka is distributed, and one (**B-2 the unlicensed Vercel skill**) needs a
> human decision before the repository stays public."

Those decisions are the repository owner's, not mine, and my brief forbids waiving
them. What I verified independently:

* **B-2 — 76 unlicensed third-party files are already tracked in the public
  repository.** `git ls-files .agents/skills/vercel-react-best-practices` returns
  **76 files**, added in the baseline commit `c97dd8f`; the directory contains **no
  LICENSE / NOTICE** file (`git ls-files … | grep -i licen` → no match). The gate
  established by SHA-256 that they are verbatim copies of `vercel-labs/agent-skills`,
  whose upstream tree carries **no licence at all** — i.e. no grant of rights. They
  are not shipped in the binary, but they are **published in a public GitHub
  repository**, which is the exposure.
* **B-1 — the Tauri logo is Paka's app icon.** `src-tauri/icons/` holds the
  standard Tauri `init` icon set (16 files: `icon.ico`, `icon.icns`, `icon.png`,
  the `128x128*`/`32x32` PNGs and the nine `Square*Logo.png` / `StoreLogo.png`
  Windows-Store images). The gate's SHA-256/pixel comparison reports `icon.ico` as
  byte-identical to the upstream Tauri template. A copyright licence (MIT OR
  Apache-2.0) grants **no trademark rights**, and Tauri's own policy requires a
  licence from the trademark holder. *I could not re-verify the byte-identity
  locally — the Tauri CLI npm package does not ship the icon templates as files —
  so I am reporting the gate's evidence, not my own.*
* **B-4 — no third-party notices exist anywhere**: no `THIRD_PARTY_NOTICES.md`, no
  `NOTICE`, no README licence section, no in-app About/Licences screen. For the
  statically linked MPL-2.0 and Unicode-3.0 crates in the Rust dependency graph,
  the notice obligations are recorded as **unmet**. The root `LICENSE` is MIT
  ("Copyright (c) 2026 HumanHEART") and covers Paka's own code only.
* **B-5 — no governance documents**: no `CONTRIBUTING.md`, no CLA/DCO, no
  `CODE_OF_CONDUCT.md`, no `SECURITY.md`, no trademark policy, no express patent
  grant.
* **B-6 — the dependency graph is clean**: 82 npm packages and 422 Rust crates,
  every one with a declared permissive licence; **no GPL, no AGPL, no mandatory
  LGPL, no unlicensed package**. This is the finding that matters for the audited
  slice, and it is favourable.

**None of these is caused by the audited slice** — all of it predates `ad2ef11`
(the icons and the skills files date from the baseline commit `c97dd8f`). But it is
material to "is this repository safe to release", it is recorded as unresolved by
the coordinator's own gate, and the gate states that B-1 and B-4 **block
distribution of any build of Paka**. That is precisely the "unresolved licensing,
policy … or distribution decision" that my brief reserves for **HUMAN REVIEW**.

**What I need from a human:** a decision on B-1 (replace the Tauri logo with an
original one, or obtain a trademark licence), B-2 (remove the unlicensed skill
directory from the public repository, or obtain a grant), B-4 (add the third-party
notices), and B-5 (state the governance, or state that there is none). None of these
blocks the *R1 code change*; all of them block a *released build*.

---

## 4. Medium / low findings (disclosure, not blocking)

* **L1 — parity evidence does not cover a fractional `rasterScale`.** The Chromium
  A/B that settles the F1b pixel question ("F7d", 0 differing bytes in eight
  configurations) was taken at `rasterScale` **1 and 2**. The app sets
  `rasterScale = clamp(devicePixelRatio, 1, 2)` (`DrawingEngine.ts:463`, `:520`), so
  a 125 % display runs at **1.25**. At a fractional scale whose
  `document.width x rasterScale` is not an integer (e.g. width 999 at 1.25), the
  *pre*-R1 path resampled the whole buffer into the surface
  (`drawImage(buffer, 0, 0, doc.width, doc.height)` under `scale(rasterScale)`),
  while the bounded blit is exactly 1:1 — so the two are not literally identical
  there (the difference is a sub-pixel resample, and the new behaviour is the
  intended one: "the surface and the buffer share a pixel grid, so the rectangle is
  blitted one to one and nothing is resampled"). The audit's blanket headline
  "byte-identical pixels" (`:9–11`) therefore holds for the measured configurations
  but not universally. **Recommendation**: qualify the headline or add one fractional
  configuration to the next parity run.
* **L2 — the independent QA artifact for R1 is not on disk.** `qa/harness.ts` is a
  well-built browser harness (parity vs a real copy of the pre-R1 renderer,
  live/commit/rebuild/export invariant, area and cost), and the QA agent is now
  also building **mutation variants of the region code itself**
  (`qa/mutants/m4-feather-spread`, `qa/mutants/m6-floored-bounds`) — the right
  technique for proving the R1 tests actually bite. As of the end of this audit it
  had **not been run and produced no result artifact**. The parity evidence for R1
  therefore rests on the
  Chromium A/B recorded in the coordination log (F7d) plus the in-repo
  software-canvas tests. Run it and commit the numbers before the human merge
  review, or record explicitly that the log measurement is the accepted evidence.
* **L3 — the region's bounds are recomputed per element.** `strokeSampleBounds` is
  walked up to three times per element per rebuild (`rasterizeStrokeToBuffer`,
  `compositeStrokeBuffer`, `featherStroke` for soft brushes). That is the
  "per-element region computation" the audit itself names as the reason a
  document-wide dense layer got ~23 % slower (`PERFORMANCE_AUDIT:236–239`). It is
  disclosed and acceptable; a future slice could compute the bounds once per
  element.
* **L4 — `AGENTS.md` index anchors have drifted.** `AGENTS.md:57` lists
  `src/core/rendering/Canvas2DRenderer.ts` as **961** lines; it is now **1295**
  (`AGENTS.md:53` says `DrawingEngine.ts` 2075, `AGENTS.md:58` says
  `projectFormat.ts` "v7 serialize/parse/validate" while the format is **v8**).
  The §5 anchors are stale too: `paintStrokeCoverage` is listed at L767 (actual
  **997**), `featherStroke` at L870 (actual **1123**), `compositeStrokeBuffer` at
  L742 (actual **961**). `AGENTS.md` §9 says "Line anchors are hints, not contracts.
  If `rg` disagrees, fix the anchor." The same drift is recorded as `D4` in
  `feature-evidence.json`. Low severity, but it is the repository's own maintenance
  contract.
* **L5 — a theoretical NaN hole in `strokeRegion`.** If a sample coordinate were
  non-finite, `strokeSampleBounds` returns a NaN box (its `minX > maxX` guard does
  not catch NaN), `strokeRegion` then returns a NaN rectangle rather than `null`
  (`Canvas2DRenderer.ts:908–949`), and the hard path issues a 9-argument
  `drawImage` with NaN geometry. The path is not reachable from a file — the parser
  rejects non-finite samples (`projectFormat.ts:678`) — and the same NaN hole
  already existed in the soft path's `featherStroke` bounds. Not a regression;
  worth a one-line `Number.isFinite` guard when the region code is next touched.
* **L6 — the live-preview and live-eraser paths still read the whole stroke
  buffer**, while commit/rebuild read the bounded region. That is correct for
  today's segment rasterizer (the region is a superset of the coverage by
  construction), but the buffer is a shared scratch: after a rebuild it retains the
  previous elements' coverage outside their regions. If a layer is rebuilt *during*
  an in-flight stroke, the whole-buffer read could pick up stale coverage. The
  exposure is unchanged in class by F1b (pre-R1 the buffer also retained the last
  element's coverage), and the Feature Analyst records the same asymmetry as §5.6.
  Worth keeping in mind for the next slice, which will widen the footprint.

---

## 5. Correctness and data integrity — PASS

I read the shipped change end to end and re-derived its invariants.

* **The region is a superset of the coverage.**
  `spread = strokeDiameter(brush, 1)/2 + strokeFeatherRadius(brush)*3 + 1`
  (`Canvas2DRenderer.ts:908–927`). `strokeDiameter(brush, p) = max(size*minSizeRatio,
  size*factor(p))` with `factor(p) <= 1` (`canvas2dStroke.ts:82–85`), and
  `minSizeRatio` is clamped to `[0.02, 1]` (`defaults.ts:39`), so the painted radius
  never exceeds `strokeDiameter(brush,1)/2`; round caps/joins add nothing beyond
  it; the `+1` covers antialiasing bleed; the `3*radius` covers the Gaussian's
  3-sigma support. A filled shape's polygon interior lies inside the sample bbox.
* **The blit is 1:1 and on the device grid.** The layer surface is
  `round(doc * rasterScale)` (`layerSurfaceStore.ts:59–60`) and the stroke buffer is
  `round(doc * rasterScale)` (`Canvas2DRenderer.ts:231`, `:267`); the region is an
  integer device-pixel rect (`floor`/`ceil`, clamped to the buffer); the blit runs
  under `setTransform(1,0,0,1,0,0)` (`:1009–1026`), so nothing is resampled. The
  pre-R1 path was also 1:1 at integer scales — hence the measured parity.
* **A stroke that is entirely outside the document is a no-op in both paths**
  (the region is `null` and the element is skipped; previously the coverage was
  clipped away by the canvas). Equivalent.
* **The erase path is consistent.** A rebuild erases with `destination-out` over
  the same region (`Canvas2DRenderer.ts:781`), and the region's transparent pixels
  leave the destination untouched, so a bounded subtraction equals the old
  full-surface subtraction. The live eraser still subtracts the whole buffer
  (`applyErase`, `:1205–1224`), which is equivalent for today's geometry.
* **Undo/redo, dirty state, serialization, cache invalidation are untouched.**
  `4ac040b` changes no document data, no command, no history, no format field;
  `PROJECT_VERSION` stays **8** and no schema changed. Layer dirtying, the
  document-level undo, save/reopen and PNG export all go through the same
  `rasterizeLayer` → `compositeStrokeBuffer` funnel, so they cannot disagree with
  each other. `git diff e1071d9..HEAD -- src/core/project/projectFormat.ts` shows
  only the document-size gate.
* **No destructive data loss.** The size gate refuses an oversized document
  *before* the engine replaces the open document (`projectFormat.ts:522–532`,
  checked before any layer content is read), and the failure is reported as an
  error, not a silent resize.
* **The F7 revert is complete.** `elementSurface`, `rasterizeElementScratch`,
  `fitsElementScratch` and `compositeElement` have **zero** matches in the tree
  (I grepped `src/core/rendering/Canvas2DRenderer.ts`), and the revert is
  path-limited to the two files F7 touched.

---

## 6. Security and reliability — PASS

* **No new dependencies, no native/FFI/IPC change.** `package.json`,
  `pnpm-lock.yaml` and `src-tauri/` are unchanged; no native package was added, so
  there is no transitive native supply-chain surface to declare.
* **Untrusted-file handling is unchanged and still bounded.** The parser keeps its
  limits — `MAX_PROJECT_SAMPLES = 5,000,000`, `MAX_PROJECT_FILL_PIXELS`,
  `MAX_PROJECT_GRADIENT_STOPS = 64`, non-finite numbers rejected
  (`projectFormat.ts:668–684`) — and the new total-pixel gate
  (16,777,216 px) is enforced *before* any allocation. A hostile `.paka` file
  cannot make the renderer allocate a multi-gigabyte surface.
* **No path handling was added** in this slice; the native read/write path
  (`src-tauri/src/project_io.rs`) is untouched, so its existing path handling is
  unchanged by this work.
* **Error handling**: the parser returns a result object and never throws
  (`PROJECT_FORMAT.md` validation rules, unchanged); the renderer keeps its
  defensive branches (`if (!doc) return;`, `if (!region) return;`, `if (!ctx)
  return;`).
* **Resource exhaustion**: the 58-byte-per-document-pixel peak model still holds
  after the F7 revert (the revert is precisely what kept it at 58 rather than 59);
  `520aa77` guarantees the erase snapshot and the preview scratch are never alive
  together. I found no new full-resolution allocation in the slice.

---

## 7. Test evidence, and its gaps

**What I ran myself, on `ad2ef11`, in this session.** Because the live checkout was
being modified by other agents while I worked (F3), I verified in an **isolated
`git worktree` at exactly `ad2ef11`** (tree `a2d9d8b…`), not in the working
directory — otherwise the run would have mixed the in-flight stamp-engine edits
into the evidence. The worktree was removed afterwards, leaving no trace.

| Command | Result (at `ad2ef11`, isolated worktree) |
| --- | --- |
| `pnpm test` | **29 files, 474 passed / 474**, 2.31 s — no skips, no failures |
| `pnpm typecheck` | clean, exit 0 |
| `pnpm build` | `tsc --noEmit && vite build` → exit 0, 101 modules, built in 258 ms |
| `git diff --check e1071d9..HEAD` | clean (exit 0) |
| `git diff --cached` | empty — nothing staged |
| `git log --diff-filter=A -- .agents/skills/vercel-react-best-practices` | 76 files added in `c97dd8f` (F5) |

For completeness: an earlier run of the same three commands **inside the live
checkout** also reported 474/29/clean, but by then the working tree already
contained the stamp-engine edits — that run is *not* the evidence, and it is
recorded here only so the reader knows it was discarded rather than overlooked.

There are no `.skip`, `.only`, `todo`, `xit` or `xdescribe` anywhere in `src/`
(grepped) — no hidden or disabled tests.

**The acceptance criteria map to real tests.** The R1 slice's own tests
(`src/test/canvas2dRenderer.test.ts`) are meaningful, not tautological:

* *"clears and blends only the rectangle a stroke inks"* (`:2443`) — measures the
  touched **area** (destination rect x determinant of the live transform) and
  asserts `32 x 32` device px for an off-centre stroke in a 200x200 document, plus
  the exact 9-argument blit `[144,144,32,32,144,144,32,32]`.
* *"keeps the layer's own clear whole but bounds every element"* (`:2480`) — two
  elements → two 22x22 blends, one 200x200 layer clear.
* *"bounded rebuild is pixel-identical"* (`:2506–2586`) — live == commit == rebuild
  == export for a **hard**, a **soft** and a **grain** brush, plus a second rebuild
  landing on the same pixels, plus `coverageInside(...)` proving the coverage stays
  inside the drawn rectangle (the invariant that makes the bounded blit equivalent).
* *"does not darken a self-crossing stroke"* (`:2600`) — expects `rgb(128,128,128)`
  for a 50 %-opacity crossing over white (stacking would give 64).
* *"keeps the eraser green"* (`:2623`) — a rebuild still subtracts the eraser
  stroke.

**Honest limits of that evidence (disclosed, not waived):**

1. The in-repo pixel tests run on the repo's **software** canvas, which has **no
   antialiasing**. They prove composite order, placement and extent — they cannot
   prove Chromium's antialiased edge. The Chromium A/B in the coordination log
   ("F7d": 0 differing bytes in eight configurations, surface and display, at
   `rasterScale` 1 and 2) is what covers the AA edge; I reviewed its method
   (faithful reference, committed tree, sensitivity canary) and it is sound, but it
   is a **log artifact, not a committed test artifact** (see L2). The F7 revert was
   decided on exactly this class of 1/255 difference, so the bar is known.
2. The React layer has **no automated tests** — a documented project limitation
   (`README.md:303`, `docs/ROADMAP.md:192`). The UI touched by this slice is
   one line in `NewDocumentDialog.tsx` (the pixel-limit message), verified by
   `documentRasterBudget.test.ts` / `projectSizeGuard.test.ts` on the logic, not on
   the rendered control.
3. **No real-device / packaged-app verification** for this slice. The release
   executable predates the fill, gradient, hardness, spacing/stabilizer, texture
   and blend-mode slices (`docs/SESSION-BRIEF.md:40–42`), so the packaged app has
   never been run against the current tree. The audit's Appendix C gives the
   recipe for the one measurement that needs the packaged app (the remaining
   destination-area lead) — that lead is explicitly **not** shipped.
4. **Performance claims are split into durable and non-durable**, and the
   repository documents the split honestly
   (`PERFORMANCE_AUDIT:228–245`, F7e): the *area* reduction (47x–187x less touched
   per rebuild) is geometric and machine-independent; the *wall-clock* numbers
   (e.g. "2.53 s → 19 ms") were retracted as loaded-machine artefacts, and on an
   idle machine the three code paths sit within ~10 % of each other. A layer whose
   strokes cover the whole document got **~23 % slower** (disclosed at `:236–239`).
   I re-checked the F1c arithmetic: the before/after figures are internally
   consistent (e.g. 100 elements x 2 x 4096x4096 = 3.36 Gpx vs the tabulated
   3372 Mpx; 47x = 53.5/1.13, 187x = 3372/18.1). **No latency claim is made
   beyond what the evidence supports.**

---

## 8. Licensing, provenance, dependency and artifact status

* **Repository licence:** MIT, `Copyright (c) 2026 HumanHEART` (`LICENSE`). All
  shipped code is first-party; the slice imports no third-party source, no asset,
  no font, no model and no data file.
* **No new dependencies** and **no transitive native packages** were added
  (`package.json`/`pnpm-lock.yaml`/`src-tauri/` unchanged) — there is nothing new to
  declare or attribute.
* **No vendored or copied material slipped in after approval.** The one
  third-party-looking file, `qa/preR1/Canvas2DRenderer.ts`, is a byte-identical copy
  of **this repository's own** `src/core/rendering/Canvas2DRenderer.ts` at `9d160da`
  (1077 lines, verified) — same MIT project, same author, no attribution problem.
  It is untracked scratch and must not be committed as a second source of truth
  (F3).
* **No notices or licence records are missing**, because nothing new was
  introduced.
* **Pipeline artifact status.** The coordinator's gate expects a baseline report, an
  approved feature analysis, a license/provenance decision, an architecture plan, an
  implementation report and a QA report. On disk right now:
  * baseline — the audit report's "Baseline audited" block
    (`PERFORMANCE_AUDIT:26–30`) ✓ (but it names `e1071d9`, and the tree has moved
    to `ad2ef11`);
  * feature analysis — `feature-analysis.md` + `feature-evidence.json` ✓ **for the
    *next* slice** (the stamp engine), whose `status` is `"not-implemented"`;
  * license/provenance decision — ✓ **now present**: `reuse-decision.md` +
    `provenance-record.json`, pinned to `ad2ef11`. Strategy A (independent
    reimplementation from Paka's own material) is **APPROVED**, subject to C1–C5.
    Two findings are unresolved and are the reason for this verdict's HUMAN REVIEW
    (F5); the gate also flags that B-1/B-4 must be cleared before *any build is
    distributed*;
  * architecture plan — `docs/architecture-port-plan.md` +
    `docs/acceptance-criteria.json` ✓ (for the next slice; and it was written
    **without** the feature analysis, because the analyst wrote it to the repo root
    while the translator looked in `docs/` — the translator handled this correctly
    by declaring the gap, but the durable-handoff contract was broken);
  * implementation report — for the audited slice, the commit messages *are* the
    report and are unusually good: they state the mechanism, the file/line anchors,
    the exact test counts, the revert rationale and the pixel verdict ✓. For the
    next slice, the implementation is **in flight and uncommitted** (working-tree
    edits to `src/types/brush.ts`, `src/core/brushes/defaults.ts`,
    `src/core/rendering/Canvas2DRenderer.ts` and a new `src/core/rendering/stampCoverage.ts`);
  * QA report — **absent**; `qa/harness.ts` exists but has not been run (L2).
* **Consequence for the coordinator**: the *stamp-engine* package is **INCOMPLETE**
  as a merge candidate — the implementation is uncommitted and unreviewed, there is
  no QA report, and its plan was written without its feature analysis. It must not
  be merged or reviewed as a finished feature. The R1 slice audited here is the only
  complete, mergeable package, and it is blocked on F1/F2/F4 (mechanical) and F5
  (a human decision).

---

## 9. Release recommendation

1. **Approve the code of `ad2ef11` as it stands.** The R1 change is correct,
   regression-tested, security-neutral, dependency-neutral and independently
   pixel-verified in Chromium. Nothing in §5/§6/§7 blocks it.
2. **Hold the merge for one small docs commit** that closes **F1** (ARCHITECTURE.md
   `:200–206` and SESSION-BRIEF.md `:334–339` must describe the bounded rebuild),
   **F2** (the stale `PixelCanvas` header comment at
   `src/test/canvas2dRenderer.test.ts:1448–1460`) and **F4** (the stale counts,
   commit pointers and shipped-slices tables in SESSION-BRIEF/HANDOFF/the audit).
   Re-run `pnpm test && pnpm typecheck && pnpm build` after it (docs + a comment
   only; the numbers should stay 474/29/clean).
3. **Escalate F5 to the human owner before anything is released** — it is not mine
   to waive. The licence gate's own wording is the requirement: B-1 (the Tauri
   logo/trademark) and B-4 (missing third-party notices) **block distribution of any
   build of Paka**; B-2 (76 unlicensed files already published in the public
   repository) needs a decision before the repository stays public; B-5 (governance,
   trademark and patent policy) needs a stated position. The audited slice does not
   worsen any of them — the dependency graph itself is clean (B-6) — but the
   release cannot be declared safe until a human closes them.
4. **Do not `git add -A`.** Keep `qa/`, `feature-analysis.md`,
   `feature-evidence.json`, `provenance-record.json`, `reuse-decision.md`,
   `docs/architecture-port-plan.md`, `docs/acceptance-criteria.json` and
   `.opencode/agents/` out of the product tree, or land them deliberately under
   `docs/` in a follow-up commit (F3). The in-flight stamp-engine edits to
   `src/types/brush.ts`, `src/core/brushes/defaults.ts` and
   `src/core/rendering/Canvas2DRenderer.ts` must land on their own branch, in
   their own reviewed commits.
5. **Before the human merge review**, run the QA parity harness and commit its
   numbers, or record in the merge notes that the coordination-log A/B ("F7d") is
   the accepted pixel evidence (L2). Add a fractional-`rasterScale` case if the
   headline "byte-identical" wording is kept unqualified (L1).
6. **Disclose in the merge notes**: no packaged-app verification of the current
   tree; the React layer remains untested by design; the rebuild's *timing* win is
   not proven (only the *area* reduction is), and a document-wide dense layer is
   marginally slower; the destination-area lead remains open and needs a
   packaged-app profile (audit Appendix C).
7. **Do not treat the stamp-engine package as reviewable** until it is committed,
   has a QA report, and its plan is re-read together with the feature analysis it
   was written without.

**Verdict: HUMAN REVIEW** — the audited commit's *code* is approved; three
mechanical documentation defects (F1, F2, F4) and one artifact-hygiene defect
(F3) must be fixed before merge, and four unresolved licensing/distribution
decisions (F5: B-1, B-2, B-4, B-5) must be closed by the repository owner before
any build of Paka is distributed. None of these are behavioural risks in the R1
change; all of them are real, and none may be waived silently.

---

* **Auditor:** independent final gate (read-only). No file in the repository was
  edited by this audit other than this report; nothing was staged, committed,
  pushed or merged. The one temporary `git worktree` used to pin the verification
  to `ad2ef11` was created outside the repository and removed again.
