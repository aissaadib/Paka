# QA report — G1: stamp (dab) brush engine, final verification

**Agent:** independent QA / regression verifier (`paka-feature-qa`).
**Date:** 2026-10-20 (19:00–19:20Z).
**Subject:** the completed stamp-engine slice on `feat/stamp-brush-engine`,
verified against `implementation-report.md` and the current
`docs/acceptance-criteria.json`.

**Verdict: FAIL — merge blocked on one MEDIUM test-strength gap.**
No product defect was found. Every behaviour that could be verified against the
acceptance criteria is correct in real Chromium pixels. The blocker is that the
slice's headline safety guard (the per-stroke work budget) is **not protected
by the test suite**: removing the guard, or weakening it 100×, leaves the suite
green. One further MEDIUM (single-sample-point pixel assertions) is
recommended.

This report supersedes the earlier QA draft of the same file, which covered an
earlier state of the slice. The earlier draft's HIGH finding (no dab budget)
and MEDIUM findings (F-2/F-3) are **closed** by the current implementation —
see §5.

---

## 1. State verified

| Item | Value |
| --- | --- |
| `HEAD` | `ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9` (unchanged; the slice is **uncommitted**) |
| Branch | `feat/stamp-brush-engine` |
| `git diff \| sha256` | `3b07edb310ee63e59cfda0e11474e860ea794fd3fd5e35f1a821145657cdc7e8` |
| Measured at | 2026-10-20T18:59:15Z and re-checked 2026-10-20T19:15:37Z — **identical**, so the tree did not move during this verification |
| Implementation | `src/core/rendering/stampCoverage.ts` (420 lines), `src/core/rendering/Canvas2DRenderer.ts`, `src/types/brush.ts`, `src/core/brushes/defaults.ts`, `src/core/project/projectFormat.ts` (v9), `src/core/engine/DrawingEngine.ts`, `src/features/brushes/BrushControls.tsx` |
| Tests | `src/test/stampCoverage.test.ts` (326 lines) + additions in 5 existing test files |
| QA artifacts | `qa/` (disposable) — see §7 |

Nothing in `src/`, `docs/` or the project configuration was modified by QA. No
staging, commit, reset or revert was performed. The only repository writes were
untracked QA files (`qa/`, this report) and two throwaway `git worktree`s, both
removed again (`git worktree list` shows only the main checkout and the
pre-existing `paka-release-readiness` worktree, which is not mine).

---

## 2. Agent 5's reported results — independently confirmed

| Claim (`implementation-report.md` §3) | QA result | Exit |
| --- | --- | --- |
| `pnpm test` → 524 tests in 30 files, all pass | **524 tests in 30 files, all pass** (19:02Z and 19:15Z) | 0 |
| `pnpm typecheck` → clean | **clean** | 0 |
| `pnpm build` → succeeds | **succeeds** (built in 232 ms) | 0 |

The baseline claim (474 tests / 29 files at `ad2ef11`) was verified earlier in
this session at the same commit ✓.

---

## 3. The AC-28…AC-32 vs AC-01…AC-29 discrepancy — resolved

**Resolution: the resource-bounds criteria were ADDED and are IMPLEMENTED. They
were neither renamed nor omitted. The discrepancy is in the *report's*
inventory, not in the code.**

`docs/acceptance-criteria.json` contains **32** criteria, in this order:

```
AC-01 … AC-20,  AC-28, AC-29, AC-30, AC-31, AC-32,  AC-21 … AC-27
```

* `implementation-report.md:8` says the criteria are “AC-01 … AC-29”. The file
  has **32**; the report therefore **under-counts by three** (AC-30, AC-31,
  AC-32 are never mentioned in it). The report was written against the
  29-criterion version of the file.
* The file's own ordering is non-monotonic (the new block was inserted between
  AC-20 and AC-21) — cosmetic, but it is what makes the two ranges look
  contradictory.
* Each of the five added criteria is satisfied by the code, verified below:
  **AC-28** tiled upload ✓, **AC-29** bounded generation ✓, **AC-30** worst-case
  budget ✓, **AC-31** named derived constant ✓, **AC-32** parser inputs
  unchanged ✓.

The report's *behavioural* claims about these areas are accurate even though it
does not cite AC-30–AC-32.

---

## 4. Independent verification

Method: the repository's own renderer tests use a recording canvas (no pixels)
and its software pixel canvas (no antialiasing, no blur). QA therefore drives
the **real `Canvas2DRenderer` in a real Chromium** and compares **whole
canvases byte for byte**, against frozen references:

| Reference | What it is |
| --- | --- |
| `qa/head/` | the committed renderer (`ad2ef11`) — the legacy segment path |
| `qa/frozen/` | the earlier working tree — **single-rect** upload, unbounded planner |
| `qa/current/` | the working tree as verified — **tiled** upload, bounded planner |
| `qa/mutant-n6/` | a one-line placement defect in `qa/current/` (for §6.2) |

### 4.1 Resource bounds (AC-19, AC-28, AC-29, AC-31, AC-32)

| Check | Result |
| --- | --- |
| **AC-28** largest `ImageData` created by the stamp path | **64 × 64** (one buffer, reused); no non-tile `ImageData` at all |
| **AC-28** `putImageData` calls | **10 calls, 10 distinct tile origins** → exactly one upload per tile |
| **AC-28** tiled upload vs the earlier single-rect upload | **byte-identical** (display and export) |
| **AC-28** tile edges: crossing many 64 px boundaries / starting on a tile corner / at the right+bottom edge / starting off-document / ending off-document / entirely off-document | **byte-identical in all 6 cases** — no shift, no dropped coverage, no duplication |
| **AC-29** coordinates at ±1e9 | 63 dabs, **0.1 ms**, work 16,579,647 ≤ budget |
| **AC-29** 500,000-sample path | 63 dabs, **22 ms**, work 16,579,647 ≤ budget |
| **AC-29** non-finite coordinates | 1 dab, 2.4 ms, no hang |
| **AC-19/AC-31** budget actually binds | 63 dabs placed where the spacing asks for 3,907 → **truncated**; the work reaches **98.8 %** of `MAX_STAMP_COVERAGE_WORK` (16,777,216) — the guard is not vacuous |
| **AC-19** worst-case paint cost (512 px brush, 2 % spacing) | **145 ms** at rasterScale 1, **507 ms** at rasterScale 2 (was 1,709 ms / 6,487 ms before the budget landed) |
| **AC-30** `PEAK_BYTES_PER_DOCUMENT_PIXEL` | **58**, unchanged (`src/core/document/document.ts:69` = 3×4×2²+10); the worst case 48 + 8 + 0.005 = **≤ 56.005 B/doc px** is stated in ARCHITECTURE.md:893, SESSION-BRIEF.md and PERFORMANCE_AUDIT_2026-10-20.md:449 ✓ |
| **AC-32** parser's accepted inputs | `git diff src/core/project/projectFormat.ts` touches **only** the version constant and `readBrush` — no new bounds, no changed validation ✓ |
| **AC-20** cache release | commit (renderer:415), cancel (:425), destroy (:662), raster-scale change (:293 → `abandonStroke` → :1450), document size change (:263) — all release the map, the cursor and the upload buffer ✓ |
| **AC-32** bounds reachable from every path | a truncated stroke is **identical** live = committed = rebuilt = export ✓ |

### 4.2 Pixel behaviour (AC-01 … AC-23)

| Criterion | QA result (real pixels, whole canvas) |
| --- | --- |
| AC-01 legacy parity | **byte-identical** to the committed renderer for hard / soft / grain / opacity / stamp-off-with-spacing-set (display **and** export) |
| AC-02 pre-slice files | v4/v6/v7/v8 parse with `stamp: false`; the parsed brush equals the old brush + the three new fields |
| AC-03 union, no darkening | self-crossing stamped stroke: crossing pixel **= single-pass pixel** (127,127,127) → no stacking |
| AC-04 per-stroke, not per-layer | two strokes of the same colour: overlap **63** vs **127** for one stroke → they build up |
| AC-05 parity | live = commit = rebuild = export, **0 differing pixels**, for hard dab / soft dab / wide spacing / dab+grain |
| AC-07 density independence | dense (9 samples) vs sparse (3 samples) over the same path: **0 differing pixels**, 81 dabs both |
| AC-08 lattice | 101 dabs = ceil(length/spacing)+1, steps exactly 1.0 px, first dab on the first sample |
| AC-09 press / empty | 1 dab and 0 dabs |
| AC-16 eraser | the eraser subtracts the union; a self-crossing eraser erases once; the rest of the stroke is untouched |
| AC-17 shapes | a shape record as the engine writes it is **byte-identical** to a plain-brush shape |
| AC-18 resolution | scale 1 vs 2: 182 px differ, max Δ30/255 — the **legacy** path differs by 38 px, max Δ35 → same order; the repo's test asserts the covered area within 2 % and the stroke interior within 5/255 |
| AC-23 preview in its layer | live = committed for layer opacity 0.5, `multiply`, and a hidden layer |
| AC-24 UI (app, real browser) | the **Stamp** switch appears and reveals **Stamp spacing** / **Stamp hardness**; the pre-existing slider is renamed **Sampling** ✓ (the disambiguation AC-24 asks for) |
| AC-25 app-level | a stamped stroke draws (788 px), `history 1`; `Ctrl+Z` restores the paper **exactly**; `Ctrl+Shift+Z` reproduces the stroke **exactly**; the same for hard, soft and grain brushes |

---

## 5. Findings

### G1-1 — MEDIUM (merge blocker) — the per-stroke work budget is not protected by the suite

* **Where:** `src/test/stampCoverage.test.ts:161-177` (the budget test) and
  `src/core/rendering/stampCoverage.ts:52` (`MAX_STAMP_COVERAGE_WORK`).
* **The flaw:** the test's binding assertion is
  `expect(work).toBeLessThanOrEqual(MAX_STAMP_COVERAGE_WORK)` (line 176) — it
  compares the spent work against **the same constant that is supposed to bound
  it**. A raised or removed constant therefore satisfies it by construction.
* **Evidence (mutation testing, throwaway worktree, the repo's own suite):**

  | Mutation | Result |
  | --- | --- |
  | N1 — `MAX_STAMP_COVERAGE_WORK = Number.POSITIVE_INFINITY` (the guard removed) | **112 / 112 pass — NOT CAUGHT** |
  | N5 — `MAX_STAMP_COVERAGE_WORK = 1_677_721_600` (100× weaker) | **112 / 112 pass — NOT CAUGHT** |
  | N3 — the planner truncates after the first dab | caught (10 failures) |
  | N2 — the tiled upload replaced by one document-sized upload | caught (1 failure: “uploads one tile at a time…”) |
  | N4 — every uploaded tile shifted one pixel right | caught (9 failures) |
  | N7 — the padded region loses its 1 px margin | caught (3 failures) |
  | N8 — the upload writes black in transparent pixels | caught (4 failures) |

  With N1 applied the planner places 3,907 dabs instead of 63, i.e. ~1.03 × 10⁹
  document pixels of dab work for a single legal stroke — the hang AC-19 and
  AC-29 exist to forbid — and **the whole suite stays green**.
* **Expected vs actual:** expected a test that fails when the guard is removed
  or weakened; actual: the guard is invisible to the suite.
* **Current behaviour is correct** (measured: 63 dabs, 98.8 % of the budget
  spent, worst-case paint 145 ms / 507 ms) — this is a missing regression test,
  not a defect.
* **Fix (one line):** assert an *independent* bound, e.g.
  `expect(dabs.length).toBeLessThanOrEqual(64)` for that fixture, or
  `expect(work).toBeGreaterThan(MAX_STAMP_COVERAGE_WORK * 0.5)` (QA measures
  98.8 %), plus a hard-coded ceiling that does not move with the constant.

### G1-2 — MEDIUM (recommended before merge) — the pixel-parity tests compare one sample point

* **Where:** `src/test/canvas2dRenderer.test.ts:2791-2820`
  (`checkEveryPathAgrees` compares `readPixel(display, STAMP_X, STAMP_Y)` — a
  single pixel), and the same pattern in the R1 test
  (`describe("Canvas2DRenderer bounded rebuild is pixel-identical")`).
* **Evidence:** mutation **N6** (the composited region floored instead of
  ceiled) passes the **whole** suite (112/112), yet changes the real rendering:
  QA's browser A/B (`qa/n6-check.ts`, current vs `qa/mutant-n6/`) shows
  **122 pixels differing, max channel Δ71** on a soft eraser over a painted
  stroke (the erase's rim is clipped). Painted strokes and hard erasers are
  unaffected, which is why the single sample point misses it.
* **This is the same gap QA reported for R1**; it is not fixed by this slice.
* **Fix:** compare the whole canvas (the test file's `PixelCanvas` harness can
  do it), or add a soft-erase rim assertion.

### G1-3 — LOW — the implementation report under-counts the acceptance criteria

* **Where:** `implementation-report.md:8` — “Acceptance criteria:
  `docs/acceptance-criteria.json` (AC-01 … AC-29)”. The file has **32**
  criteria; AC-30, AC-31 and AC-32 are never cited in the report, although the
  implementation satisfies all three (§4.1).
* **Fix:** update the report's inventory (and, ideally, the criteria file's
  ordering, which is non-monotonic).

### G1-4 — NOTE — AC-03's literal “rgb(128,128,128)” is a harness artefact

* The repo's test asserts 128 (`src/test/canvas2dRenderer.test.ts:2891`) — that
  is the *software* canvas's integer arithmetic. In real Chromium, 50 % black
  over white composites to **127** (255 × 0.5 = 127.5 → 127). QA measured 127
  for **both** the single pass and the crossing, i.e. the invariant that
  matters (no darkening) holds; only the criterion's number is off by one.

### G1-5 — NOTE — the slice is uncommitted and the checkout carries unrelated changes

* `implementation-report.md:14` states the slice is intentionally uncommitted
  (the coordinator's rule) and that `skills-lock.json` and `.agents/skills/**`
  are pre-existing and untouched ✓ (both were already modified before the slice
  began). Nothing was staged, committed, reset or reverted by QA.

### G1-6 — NOTE — QA's own environment repair (disclosure)

Earlier in this session (previous round) a throwaway worktree's `node_modules`
junction caused `node_modules/.bin` to be emptied; QA repaired it with
`pnpm install --offline --frozen-lockfile` (no lockfile/package.json change).
In this round the same technique was used again and the junction was removed
with `cmd /c rmdir` (junction-safe) **before** the worktree was removed:
`node_modules/.bin` verified at 15 entries after both steps ✓.

---

## 6. Verified vs unverified

### 6.1 Verified (this session, with evidence)

* The repo's three commands, twice, exit 0 (§2).
* Every pixel behaviour in §4.2, with real Chromium pixels and whole-canvas
  comparisons, plus an app-level run (§4.2, AC-24/AC-25 rows).
* Every resource bound in §4.1: tiled upload, one-upload-per-tile, tile edges
  and clipping, hostile input, the work budget, the cache lifecycle, the
  unchanged parser inputs, the unchanged 58 B/doc px constants.
* The strength of the repository's own tests, by mutation testing (N1–N8).

### 6.2 NOT verified — stated as unverified, not as passing

| Claim | Status |
| --- | --- |
| **Packaged Tauri app** (window, native save/reopen, the packaged profile) | **unverified** — not launched in this session; `implementation-report.md:189` and `:263` say so too |
| **HiDPI / `devicePixelRatio = 2`** in the running app | **unverified** — only the renderer's `rasterScale = 2` path was exercised |
| **Real pen/tablet hardware**, pressure curves, `pointerType: "pen"` | **unverified** — all pointer input was synthetic `mouse` events |
| **The packaged-app performance profile** (audit §9.6: the time to draw a 2000 px stroke at rasterScale 1 and 2, the rebuild time of a 100-stroke layer, the coverage cache's peak memory, whether `putImageData` into the document-sized buffer triggers the F7b whole-canvas cost, per-tile vs per-rect granularity) | **unverified** — the report's numbers are harness numbers and are labelled as such (`implementation-report.md:150-154`); QA's own figures (145 ms / 507 ms worst case) are **browser** numbers on this idle machine and do not transfer either |
| Screenshots / visual comparison | **not possible** — the browser tool needs a visible tab; QA used pixel read-back instead |
| `cargo test --lib` | **not run** — documented as impossible on this toolchain (`0xC0000139`) |

---

## 7. Reproduction

```bash
# the repository's own commands
pnpm test          # 524 tests / 30 files
pnpm typecheck     # clean
pnpm build         # succeeds

# QA harness (needs `pnpm dev` on port 1420 and the browser tool)
node qa/tools/extract-prer1.mjs 520aa77   # pre-R1 renderer reference
node qa/tools/freeze-tree.mjs current     # freeze the working tree (tiled, bounded)
node qa/tools/freeze-tree.mjs frozen      # the earlier working tree (single-rect)
node qa/tools/build-mutant-n6.mjs         # the N6 placement mutant
# http://localhost:1420/qa/g1.html      -> window.__qaG1.runG1Checks()   (resource bounds)
# http://localhost:1420/qa/stamp.html   -> window.__qaStamp.runStampChecks() (pixel criteria)
# http://localhost:1420/qa/format.html  -> window.__qaFormat.runFormatChecks() (format)
# http://localhost:1420/qa/n6.html      -> window.__qaN6.runN6Check()     (N6 impact)
# http://localhost:1420/qa/app.html     -> the real app with an rAF shim
```

---

## 8. Verdict and remaining merge blockers

### Verdict: **FAIL — merge blocked**

The **behaviour** of the G1 stamp engine is correct: the legacy path is
byte-identical, the stamp path is internally consistent across live, commit,
rebuild and export, the tiled upload is byte-identical to the earlier
single-rect upload at every tile edge and clipping case, the planner is bounded
against hostile input, the raster-budget constants are unchanged, and the
repository's three commands pass exactly as reported.

The slice is nonetheless **not ready to merge**, because its own headline
guarantee is unverified by its own tests:

1. **G1-1 (MEDIUM, blocking)** — the per-stroke work budget can be removed or
   weakened 100× with the suite green (`src/test/stampCoverage.test.ts:176`).
   AC-19/AC-29 exist precisely to forbid a renderer hang; the guard needs one
   independent assertion. *Fix: ~1 line.*
2. **G1-2 (MEDIUM, recommended)** — the pixel-parity tests compare a single
   sample point, so a 1 px coverage-clipping defect in the soft-erase path
   escapes the suite while changing 122 real pixels (max Δ71).
   *Fix: compare the whole canvas.*

### Remaining merge blockers

| # | Blocker | Severity | Fix |
| --- | --- | --- | --- |
| 1 | The work-budget regression test is self-referential (N1/N5 escape) | MEDIUM | Assert an independent bound on the dab count or on the work spent |
| 2 | Single-sample-point pixel assertions (N6 escapes) | MEDIUM | Whole-canvas comparison, or a soft-erase rim assertion |

### Everything else is clear to merge

* `implementation-report.md`'s behavioural claims are accurate; only its
  criterion inventory needs correcting (G1-3, LOW).
* The packaged Tauri app, HiDPI and the packaged performance profile remain
  **unverified** by construction (§6.2) and are declared as such in the
  report — they are **not** merge blockers for this slice, but they stay open
  items for the release checklist, exactly as `SESSION-BRIEF §7` records.
* The slice is intentionally uncommitted (G1-5); QA performed no staging,
  commit, reset or revert.
