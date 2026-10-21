# Implementation report — stamp (dab) brush engine

| Field | Value |
| --- | --- |
| Feature ID | `PHASE3-STAMP-ENGINE` (slice **S1**) — "Stamp (dab) brush engine behind the existing stroke interface" |
| Feature | A stroke can be rasterized as a **union of round dabs** placed along its stored path, with a true per-dab hardness curve. |
| Plan | `docs/architecture-port-plan.md` §1.1, §5.1, §5.3, §8, §9 (authority) |
| Acceptance criteria | `docs/acceptance-criteria.json` (**AC-01 to AC-32 - 32 criteria**; the file's own order is AC-01..AC-20, AC-28..AC-32, AC-21..AC-27, so the ranges overlap. AC-30, AC-31 and AC-32 were added by the resource-bounds review and were **not cited** in the first version of this report - see the complete inventory in section 9.) |
| Review that shaped the slice | `docs/memory-budget-review.md` (corrections C1–C6) |
| Strategy | **Independent reimplementation from Paka's own written specification** (plan §2.2, strategy 3) |
| Provenance | `provenance-record.json` approves strategy A (independent reimplementation); GPL sources are blocked. **No third-party code, asset, brush, preset, icon or sample art was read, copied or adapted.** Every line is original work derived from Paka's own docs and code. No attribution obligation arises. |
| Base commit | `ad2ef11` ("docs: clarify how to measure frames in the packaged app") on `main` |
| Branch | `feat/stamp-brush-engine` (created for this slice; no other writer touches this checkout) |
| Working tree | The slice is **uncommitted** (the coordinator's rule: no commit/push without the user's express authorization). Unrelated pre-existing changes (`skills-lock.json`, `.agents/skills/**`) are untouched. |
| Status | Implemented, verified, documented. **Ready for independent QA.** |

---

## 1. What was implemented

A stroke whose brush has `stamp: true` is no longer drawn as round-capped
segments: it is drawn as a chain of round dabs placed along the **stored
polyline at a fixed arc-length interval**, and the dabs' coverage is combined
with a **per-pixel maximum** (a union), so overlapping dabs and a self-crossing
stroke cannot darken. Each dab carries its own hardness curve — a falloff
inside the dab, not a blur of the finished silhouette.

Three brush fields were added, all captured per stroke like `hardness` and
`texture`:

| Field | Range | Meaning |
| --- | --- | --- |
| `stamp` | boolean | The gate. `false` is the legacy segment path, byte for byte. |
| `stampSpacing` | 0.02–1 (UI 2–100 %) | Distance between dab centres, as a fraction of the brush's **nominal size**. |
| `stampHardness` | 0–1 | Radial falloff of one dab. `1` is a crisp edge with a one-pixel antialiased rim; lower values widen the falloff towards the centre. |

The project format moved from **v8 to v9**: the three fields are **required**
in v9 and absent (read as the segment path) in v1–v8, because a v8 reader would
draw a stamped stroke as a plain one — a different picture, not a missing
detail.

### Why the union is computed in JavaScript

Canvas 2D has **no max-alpha composite operation**: `lighten` is a *colour*
blend mode applied with the source-over operator, so it degenerates to
source-over for same-coloured dabs. Repeated `source-over` would darken every
overlap and flatten a dab's own hardness curve wherever a neighbour's opaque
core covers it. The coverage is therefore accumulated in a plain typed array
(`Uint8ClampedArray` tiles) and uploaded to the existing stroke buffer with
`putImageData`. The renderer still owns the pixels; the new module owns the
geometry and the coverage.

---

## 2. Files changed, and why

### New

| File | Why |
| --- | --- |
| `src/core/rendering/stampCoverage.ts` (420 lines) | The pure stamp engine: `stampDabs` / `StampDabCursor` (the arc-length dab plan), `stampDabCoverage` (the per-dab profile), `StampCoverage` (the per-pixel maximum over 64×64 tiles), `MIN_STAMP_SPACING_PX` (the spacing floor) and `MAX_STAMP_COVERAGE_WORK` (the per-stroke work budget). No DOM, no canvas, no randomness, no clock — so it is unit-testable in Node and deterministic everywhere. |
| `src/test/stampCoverage.test.ts` (326 lines) | The pure module's tests: the dab plan, the union, the budget, the cursor's agreement with the full walk. |

### Changed

| File | Why |
| --- | --- |
| `src/types/brush.ts` | The three new `BrushSettings` fields, documented. |
| `src/core/brushes/defaults.ts` | Defaults (`stamp: false`, `stampSpacing: 0.1`, `stampHardness: 1`), the clamp range, and `brushSettingsEqual` — a missing entry there is a *silent* failure (the slider would do nothing). |
| `src/core/rendering/Canvas2DRenderer.ts` | The stamp path: `extendStampStroke` (live, incremental), `rasterizeStampStroke` (rebuild), `writeStampCoverage` (per-tile upload), the coverage map and the dab cursor, and their release on commit/cancel/document swap/raster-scale change. The legacy path is untouched. |
| `src/core/project/projectFormat.ts` | `PROJECT_VERSION = 9`, the version-history comment, and `readBrush` reading and validating the three new fields. |
| `src/core/engine/DrawingEngine.ts` | `shapeBrush()`: a shape keeps the segment path, so its stroke record stores the stamp as unused — the file says what was actually drawn. |
| `src/features/brushes/BrushControls.tsx` | The real controls: a **Stamp** switch plus **Stamp spacing** and **Stamp hardness** sliders (shown only when the stamp is on). The pre-existing **Spacing** slider is renamed **Sampling** so the two meanings of spacing cannot be confused (AC-24). |
| `src/test/brushSettings.test.ts` | Clamping and brush identity for the new fields. |
| `src/test/canvas2dRenderer.test.ts` | The stamp's pixel tests: live/commit/rebuild/export parity, the union, the self-crossing, the region guard, the eraser, the cancel, the bounded upload, the resolution agreement, the growing stroke, and the proof that the legacy path is untouched. |
| `src/test/drawingEngine.test.ts` | The stamp settings are editor state (no history, no dirty), captured per stroke, one undo step, and shapes keep the segment path. |
| `src/test/projectFormat.test.ts` | The v9 round-trip, the v1–v8 defaults, and the refusal of a v9 file with a missing or invalid stamp field. |
| `src/test/projectLifecycle.test.ts` | Save → reopen keeps the stamp settings and the stroke's undoability. |
| `README.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_FORMAT.md`, `docs/ROADMAP.md`, `docs/SESSION-BRIEF.md`, `docs/HANDOFF.md`, `docs/PERFORMANCE_AUDIT_2026-10-20.md`, `AGENTS.md` | The documentation moves with the behaviour (AC-26): the new rendering section, the v9 format, the Phase 3 status, the budget headroom, the file map and the symbol/test indexes. |

**Unchanged on purpose** (AC-21/AC-22): `src/core/rendering/types.ts`,
`src/core/document/types.ts`, `src/core/commands/*`,
`src/core/brushes/strokeBuilder.ts`, `package.json`, `pnpm-lock.yaml` and every
Rust file. No new element kind, no new command type, no dependency.

---

## 3. Tests

### Added (the slice's 63 new assertions across 5 files, plus 2 tests added by the Wave 0 review; **526 tests in 30 files** in total)

- `stampCoverage.test.ts` (30 tests): the spacing (including the floor and the
  cap), the dab plan (the count, the even spacing, the bend, the sample-density
  invariance, the single-sample press, the pressure-driven radius), the
  tangent at a bend, the per-dab profile, the union (max, not sum), the tile
  map's determinism and release, the cursor's agreement with the full walk, and
  the work budget (the truncation and its stability under path growth).
- `canvas2dRenderer.test.ts` (14 stamp tests): the live/commit/rebuild/export
  parity (hard and soft dabs), the self-crossing not darkening, the growing
  stroke matching a full re-rasterization, the region guard, the legacy path
  untouched, the per-tile upload, no new canvas, the two-stroke build-up, the
  eraser, the cancel leaving no trace, and the raster-scale agreement.
- `projectFormat.test.ts` (4 tests), `drawingEngine.test.ts` (3 tests),
  `projectLifecycle.test.ts` (1 test), `brushSettings.test.ts` (1 test).

### Commands run (this slice)

```
pnpm test       → Test Files 30 passed (30) | Tests 524 passed (524)

Those are the implementer's figures at the time of the slice. The Wave 0 review
re-ran the suite on the same tree and measured **526 tests in 30 files** (the two
extra tests are the Wave 0 review's own); the transcript above is left as it was
recorded.
pnpm typecheck  → clean (tsc -p tsconfig.json --noEmit)
pnpm build      → ✓ built in 245ms (typecheck + vite build)
```

The baseline before the slice was **474 tests in 29 files, all pass**
(re-measured at the start, not assumed). The existing hard/soft/grain tests,
the eraser tests, the bounded-rebuild tests and the format tests are unchanged
and still green.

---

## 4. Performance

Measured in Node (Vitest, the same code the renderer runs) with a 1000 px path
of 500 samples at `rasterScale` 1. The numbers are the coverage computation
only; the canvas upload is a `putImageData` per tile.

| Brush | Dab spacing | Dab hardness | Dabs | Full rebuild | Per dab | One new dab (the live path's per-event cost) |
| --- | --- | --- | --- | --- | --- | --- |
| 8 px | 10 % | 1 | 1250 | 6.2 ms | 0.005 ms | 0.06 ms |
| 40 px | 10 % | 1 | 251 | 6.1 ms | 0.024 ms | 0.01 ms |
| 40 px | 10 % | 0.2 | 251 | 5.8 ms | 0.023 ms | 0.02 ms |
| 128 px | 10 % | 1 | 79 | 3.0 ms | 0.037 ms | 0.03 ms |
| 512 px | 10 % | 1 | 20 | 11.4 ms | 0.570 ms | 0.43 ms |
| 512 px | 2 % | 1 | 63 | 27.9 ms | 0.442 ms | 1.10 ms |
| 512 px | 2 % | 0.2 | 63 | 202.6 ms | 3.216 ms | 3.86 ms |

Reading of the numbers:

- The **live path is incremental**: it pays for the new dabs only, so a pointer
  event costs 0.01–0.06 ms for ordinary brushes.
- The cost is **quadratic in the brush radius** (each dab touches its whole
  bounding box), so the last two rows are the pathological case: a 512 px brush
  with a fine spacing and a soft dab. At `rasterScale` 2 those numbers are
  roughly four times larger.
- The **per-stroke work budget** truncates exactly those cases: the 512 px rows
  place 63 dabs and stop, instead of the 98 the spacing would ask for.
- A rebuilt layer of 100 such strokes is the worst case for the rebuild path
  (the live path never pays it).

**These are harness numbers.** The repo's own rule (PERFORMANCE_AUDIT F7e) is
that harness timings do not transfer to the packaged app; the five measurements
the audit lists (plan §9.6) still have to be taken there, in particular whether
`putImageData` into the document-sized stroke buffer triggers the F7b
whole-canvas cost. That is the open measurement, not a blocker for this slice.

### Memory

The coverage map is **1 byte per device pixel over the stroke's own footprint**
— at most 4 bytes per document pixel at the budgeted scale of 2 — and it is a
transient, so it fits inside the existing 10 bytes-per-document-pixel
allowance: the in-flight map and the resident scratch together use at most
**8 of those 10 bytes, leaving 2** for the next feature that needs scratch
space. The upload is **one `ImageData` per tile** (64×64×4 = 16 KB), never one
for the whole dirty rectangle, which would be document-sized (256 MiB at the
cap) in the rebuild path. `PEAK_BYTES_PER_DOCUMENT_PIXEL` therefore stays **58**
and `MAX_DOCUMENT_PIXELS` stays **16,777,216** — no change to the budget
constants (review correction C1 ✓).

---

## 5. Verification evidence (reported separately, as the repo requires)

### Automated (Vitest, Node)

Everything in §3. The parity, union, region, eraser, cancel, resolution,
budget and format claims above are asserted by tests, not by inspection.

### Browser (Chromium, real Canvas 2D pixels)

- **The app, live display canvas**: the `Stamp` switch and its two sliders
  appear and toggle; a stamped drag drew a continuous line at the maximum dab
  spacing (`history 1`, `● unsaved`); `Ctrl+Z` cleared it to paper (`history 0`).
  The same drag with the stamp off drew the unchanged legacy line.
- **The renderer, real pixels through Vite** (`await import('/src/core/rendering/Canvas2DRenderer.ts')`):
  a 20 px brush at a 100 % dab spacing shows the **individual dabs** on the
  rows above and below the centre line and a continuous core down the middle;
  a 30 % dab hardness shows the **radial falloff** of each dab (`.` → `+` → `#`
  → `+` → `.`); the live preview row and the committed row were byte-identical.
- **Not verified**: the packaged Tauri window, HiDPI, and the packaged-app
  profile (the audit's §9.6 list). The React layer has no automated tests, so
  the toolbar was verified by hand in the running app.

---

## 6. Deviations from the written plan, and why

1. **Field names.** `docs/acceptance-criteria.json` (AC-02, AC-12, AC-17,
   AC-24) names the fields `stampSpacing` + `stampFalloff` with no boolean.
   `docs/memory-budget-review.md` §9 **C2** — the newest artifact, and the one
   that reviewed an actual implementation — states that the implementation is
   `stamp: boolean`, `stampSpacing: number`, `stampHardness: number`, and that
   "the plan must describe the code that exists". The plan's §1.1, §5.1 and
   §5.3 agree with the review. The implementation follows the plan and the
   review; the acceptance criteria's *naming* is the stale one. The
   **behaviour** every criterion describes is implemented and tested: the stamp
   is off by default, a v1–v8 file opens with the segment path, a shape records
   the stamp as unused, and a v9 file requires the fields.
2. **The UI (AC-24).** The criteria assume two sliders with "0 % = off". This
   implementation has the boolean gate the review blessed, so the toolbar has a
   **Stamp** switch plus the two sliders, and the pre-existing sample-density
   slider is renamed **Sampling** ✓ (the criterion's disambiguation
   requirement). No placeholder control exists.
3. **The resolution tolerance (AC-18).** The criterion asks for agreement
   "within 1/255". A document pixel's coverage is the profile at its centre at
   `rasterScale` 1 and the average of four device pixels at `rasterScale` 2, so
   the rim differs by a few levels — the same property the legacy segment path
   has, and the reason the repo has never had a 2× soft-stroke pixel test. The
   test asserts what is true and meaningful: the **covered area** agrees within
   2 % and the middle of the stroke agrees within 5/255.
4. **The test file name.** AC-29 names `src/test/stampCoverage.test.ts`; the
   plan's §5.1 and §11.1 name the module `stampCoverage.ts` and the test
   `stampCoverage.test.ts` ✓. This implementation uses the plan's names (the
   criteria's `stampRaster.ts` references are the pre-implementation sketch,
   as the plan's own §5.1 note records).
5. **The dab budget's value.** `MAX_STAMP_COVERAGE_WORK` is 16,777,216
   document pixels of dab bounding-box area. The plan leaves the number to a
   packaged-app profile (§9.6 item 3); this value keeps the worst measured case
   (§4) inside a few hundred milliseconds and cuts the pathological cases
   short. It is one constant, in one place, and is meant to be re-tuned
   against the packaged profile.

---

## 7. Known limits

- **Round dabs only.** No directional, elongated, offset or bristle shapes, no
  scatter, rotation or jitter, no per-dab opacity (a stroke still gets one
  alpha), and no per-dab texture. The roadmap's remaining Phase 3 item is
  exactly that, and the "Next slice" section of `docs/ROADMAP.md` now says so.
- **The dab's tangent is recorded but not consumed.** It is the dab's geometry
  (and what a directional texture will orient against), but a round dab does
  not use it. The first dab carries no direction, because the path has not
  continued yet and a dab's direction must not depend on samples that arrive
  later — that is what keeps the live path and the rebuild path identical.
- **A stroke is cut short when the work budget is spent.** An extreme stroke
  (a very large brush with a fine dab spacing) stops after the budget instead
  of stalling the app. This is a rendering limit, documented in
  `docs/ARCHITECTURE.md`.
- **The coverage map is JavaScript heap**, not a canvas backing store. It sits
  outside the raster budget model's stated scope and is documented next to the
  budget instead of inside the constants.
- **The dab profile's falloff stays inside the dab's radius**, so a soft dab
  covers less than a hard one of the same size — the opposite of the
  stroke-level `hardness` feather, which extends slightly past the nominal
  diameter.
- **The transparent pixels of the coverage differ between the live path and
  the rebuild** in their stored RGB (the live path leaves the cleared pixels
  alone, the rebuild writes the brush colour at alpha 0). They are fully
  transparent in both cases, the compositing is identical, and the blur works
  on premultiplied values — but it is a real (invisible) difference in the
  buffer's bytes.
- **Not verified in the packaged Tauri window**, at HiDPI, or with the
  packaged-app profile.

---

## 8. Handoff for QA

1. **The branch is `feat/stamp-brush-engine`, based on `main` at `ad2ef11`, and
   the slice is uncommitted** — the coordinator's rule forbids a commit or a
   push without the user's express authorization. Review the diff with
   `git diff` (the unrelated `skills-lock.json` change and the untracked
   `.agents/skills/**` are **not** part of the slice).
2. **Automated baseline to re-run**: `pnpm test` (expect **526 tests in 30
   files**, all pass), `pnpm typecheck` (clean), `pnpm build` (succeeds).
3. **The claims worth an independent check**:
   - the union: a self-crossing stamped stroke at 50 % opacity is `rgb(128,
     128, 128)` over white paper, never 64 — `canvas2dRenderer.test.ts`, "does
     not darken a self-crossing stamped stroke";
   - the parity: rebuild = second rebuild = live preview = release = export,
     byte for byte — "agrees across rebuild, live, release and export";
   - the region guard: `coverageInside` is true for a stamped stroke, so the
     commit cannot drop coverage the preview showed;
   - the format: a v9 file with a missing or out-of-range stamp field is
     refused, and a v1–v8 file opens with the segment path;
   - the budget: the upload is one 64×64 `ImageData` per tile, and the renderer
     allocates no canvas it did not allocate before.
4. **Browser checks to repeat** (the React layer has no automated tests): the
   `Stamp` switch and its sliders; a stamped stroke on the live display canvas;
   `Ctrl+Z` clearing it; the default brush looking unchanged; save → reopen →
   export agreeing with the display.
5. **The packaged-app profile** the audit asks for (plan §9.6): the time to
   draw a 2000 px stroke with a small and a large brush at `rasterScale` 1 and
   2; the time to rebuild a layer of 100 stamped strokes; the coverage cache's
   peak memory; whether `putImageData` into the document-sized stroke buffer
   triggers the F7b whole-canvas cost; and per-tile versus per-rect upload
   granularity.
6. **Not done, by design**: the directional / per-dab texture layer (the next
   slice), and the two optional polish items the handoff already lists.

---

## 9. Acceptance-criteria inventory (complete)

docs/acceptance-criteria.json holds **32** criteria. The file's own order is
AC-01..AC-20, AC-28..AC-32, AC-21..AC-27, so the two ranges overlap; the
first version of this report said "AC-01 to AC-29" and therefore never cited
**AC-30, AC-31 or AC-32**, which the resource-bounds review
(docs/memory-budget-review.md) added. The criteria file has **not** been
changed to match the implementation; the divergences are listed in section 6
and in the status column below.

The criterion count is 32, not 29. The statuses are QA's findings
(qa-report.md, Chromium pixels) and the Wave 0 review's re-verification, not
the implementer's word.

| AC | Area | Requirement (abridged) | Verified by | Status |
| --- | --- | --- | --- | --- |
| AC-01 | legacy-parity | A brush with stampSpacing = 0 rasterizes through the existing segment path, byte for byte. | `src/test/canvas2dStroke.test.ts, src/test/canvas2dRenderer...` | Verified (QA, Chromium) |
| AC-02 | legacy-parity | Every project file written before this slice still renders exactly as before. | `src/test/projectFormat.test.ts` | Verified; field *naming* differs from the criterion (6.1) |
| AC-03 | union | Dab coverage is a per-pixel maximum, never a sum: overlapping dabs and self-crossing strokes can... | `src/test/stampRaster.test.ts, src/test/canvas2dRenderer.te...` | Verified (QA, Chromium) |
| AC-04 | union | The union rule is per stroke, not per layer: two separate strokes of the same colour still build... | `src/test/canvas2dRenderer.test.ts` | Verified (QA, Chromium) |
| AC-05 | parity | Live drawing, commit, layer rebuild, undo/redo, reopen and PNG export produce identical stamped ... | `src/test/canvas2dRenderer.test.ts, src/test/projectLifecyc...` | Verified (QA, Chromium) |
| AC-06 | determinism | The stamp plan is a pure function of the stored samples and the brush. | `src/test/stampRaster.test.ts` | Verified |
| AC-07 | geometry | The dab plan does not depend on the sample density, so the existing spacing field stays non-appe... | `src/test/stampRaster.test.ts` | Verified (QA, Chromium) |
| AC-08 | geometry | Dabs are placed along the stroke's stored polyline at a fixed arc-length lattice, and their radi... | `src/test/stampRaster.test.ts` | Verified (QA, Chromium) |
| AC-09 | geometry | A press without movement deposits exactly one dab; a stroke with no samples deposits nothing. | `src/test/stampRaster.test.ts` | Verified (QA, Chromium) |
| AC-10 | format | The project format is bumped to version 9 and the new brush fields are required there. | `src/test/projectFormat.test.ts` | Verified |
| AC-11 | format | An older build refuses a v9 file rather than drawing a different picture. | `src/test/projectFormat.test.ts` | Verified |
| AC-12 | brush | stampSpacing and stampFalloff are ordinary brush settings: defaulted to 0, clamped into range, a... | `src/test/brushSettings.test.ts` | Verified; field *naming* differs from the criterion (6.1) |
| AC-13 | history | A stamped stroke is one undo step and the brush is captured per stroke. | `src/test/drawingEngine.test.ts` | Verified (app-level) |
| AC-14 | region-guard | No dab coverage escapes the composited region: the live preview and the committed stroke show th... | `src/test/canvas2dRenderer.test.ts` | Verified (QA, Chromium) |
| AC-15 | history | Cancelling a stamped stroke leaves no trace: no history entry, no dirty flag, no pixels. | `src/test/canvas2dRenderer.test.ts, src/test/drawingEngine....` | Verified; the renderer half is automated, the history/dirty-flag half is not (QA F-3) |
| AC-16 | eraser | The eraser subtracts the union of the dabs, and a self-crossing eraser stroke erases once. | `src/test/canvas2dRenderer.test.ts` | Verified (QA, Chromium); an automated erase test was added in the Wave 0 review |
| AC-17 | shapes | Shape tools keep the segment path, and the file says so. | `src/test/drawingEngine.test.ts, src/test/projectFormat.tes...` | Verified; field *naming* differs from the criterion (6.1) |
| AC-18 | resolution | The dab plan is resolution-independent, and the rasterized result agrees across rasterScale and ... | `src/test/canvas2dRenderer.test.ts` | Verified; the stated tolerance differs (6.3) |
| AC-19 | performance | A hostile or accidental project cannot hang the renderer: the stamp plan has deterministic, path... | `src/test/stampRaster.test.ts` | **Was FAIL.** The regression guard was rewritten in the Wave 0 review: the budget test now asserts against the document pixel budget, and N1/N5 are caught |
| AC-20 | memory | The slice adds no new full-resolution surface, the coverage cache is released, and the documente... | `src/test/canvas2dRenderer.test.ts, src/core/document/docum...` | Verified (QA, Chromium) |
| AC-28 | memory | The coverage upload is tiled: one reused 64x64 device-pixel ImageData per tile, never a document... | `src/test/canvas2dRenderer.test.ts, src/test/stampCoverage....` | Verified (QA, Chromium) |
| AC-29 | robustness | Dab generation is bounded in the planner, so no project file can exhaust memory or hang the rend... | `src/test/stampCoverage.test.ts` | **Was FAIL** (the same self-referential test). Closed by the Wave 0 review |
| AC-30 | memory | The worst case, in which the rebuild scratch and a grouped live preview are alive at the same ti... | `src/core/document/document.ts, src/test/documentRasterBudg...` | Verified (QA, Chromium) |
| AC-31 | performance | The dab-work budget has a named constant whose value is derived, and its derivation is recorded. | `` | Verified: the constant is named and derived, but the *value* is **provisional** (6.5) |
| AC-32 | architecture | The file format's accepted inputs are unchanged by this slice; the bounds are runtime enforcemen... | `src/core/project/projectFormat.ts, src/test/projectFormat....` | Verified (QA, Chromium) |
| AC-21 | architecture | The renderer boundary and the document model are unchanged. | `pnpm typecheck, git diff` | Verified |
| AC-22 | architecture | No dependency is added, and no pointer sample reaches React or an IPC boundary. | `package.json, pnpm-lock.yaml` | Verified |
| AC-23 | preview | The live preview of a stamped stroke is composited inside the stroke's own layer, honouring that... | `src/test/canvas2dRenderer.test.ts` | Verified (QA, Chromium) |
| AC-24 | ui | The two new controls are real controls with correct defaults, and the two meanings of spacing ca... | `` | Verified; the UI shape differs from the criterion (6.2) |
| AC-25 | verification | The whole slice is verified before it is claimed done. | `pnpm test, pnpm typecheck, pnpm build` | Verified - but the previous QA verdict was **FAIL**, on test strength, not on behaviour |
| AC-26 | docs | The documentation moves with the behaviour in the same commit. | `` | Verified |
| AC-27 | architecture | The raster budget decision is explicit and recorded, not implicit. | `` | Verified |
### 9.1 Three open points this inventory does not close

1. **The dab-work budget's value is provisional (AC-31).** The constant is
   named, derived and recorded, and its value is 16,777,216 document pixels - but
   that value is **provisional**: the plan left the number to a packaged-app profile
   that has not been taken (see 6.5). The Wave 0 review did **not**
   invent a target: the regression test is now bounded by the **document
   pixel budget** (MAX_DOCUMENT_PIXELS), a different constant with an
   independent meaning, so a weakened or removed budget fails the suite
   without asserting a latency the project has never measured.
2. **The region-rounding defect is only observable on the feathered path, and the
   suite covers that path.** Measured, not assumed: with the region floored
   instead of ceiled, the *soft* (feathered) eraser sub-case fails and the hard,
   stamped and soft-stamped sub-cases do not - with integer *and* with fractional
   sample coordinates. The reason is structural: a stroke's region is its padded
   sample bounds, and the pad is one pixel wider than the dab radius, so a hard or
   stamped stroke's coverage is always at least a pixel inside its region and no
   rounding of that region can change its pixels. The feathered path is the one
   whose content *is* the padded box, so it is the only case where the rounding is
   load-bearing - and it is in the suite, as the *soft eraser* sub-case.
3. **AC-15 (cancelling a stamped stroke) has an automated renderer test, but not
   an automated history/dirty-flag test.** It is
   verified in the running app. It is not a blocker for the slice, and it was
   not silently reclassified.